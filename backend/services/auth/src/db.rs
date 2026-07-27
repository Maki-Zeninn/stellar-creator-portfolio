use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AuthError;

pub async fn insert_refresh_token(
    pool: &PgPool,
    id: Uuid,
    user_id: &str,
    token_hash: &[u8],
    family_id: Uuid,
    expires_at: DateTime<Utc>,
) -> Result<(), AuthError> {
    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(token_hash)
    .bind(family_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Atomically rotates a refresh token: deletes the old one and inserts a new one.
/// If the old token is not found (already used), this indicates token theft —
/// all tokens in the same family are revoked.
pub async fn rotate_refresh_token(
    pool: &PgPool,
    old_hash: &[u8],
    new_id: Uuid,
    new_hash: &[u8],
    expires_at: DateTime<Utc>,
) -> Result<(String, Uuid), AuthError> {
    let mut tx = pool.begin().await?;

    let row: Option<(String, Uuid)> = sqlx::query_as(
        r#"
        DELETE FROM refresh_tokens
        WHERE token_hash = $1 AND expires_at > NOW()
        RETURNING user_id, family_id
        "#,
    )
    .bind(old_hash)
    .fetch_optional(&mut *tx)
    .await?;

    let (user_id, family_id) = match row {
        Some(r) => r,
        None => {
            // Token not found — check if it was already consumed (reuse detection).
            // Look for any token in a family that matches this user via the hash
            // in the used_refresh_tokens audit table.
            let reused: Option<(String, Uuid)> = sqlx::query_as(
                r#"
                SELECT user_id, family_id FROM used_refresh_tokens
                WHERE token_hash = $1
                LIMIT 1
                "#,
            )
            .bind(old_hash)
            .fetch_optional(&mut *tx)
            .await
            .unwrap_or(None);

            if let Some((uid, fid)) = reused {
                tracing::warn!(
                    user_id = %uid,
                    family_id = %fid,
                    "Refresh token reuse detected — revoking all sessions for user"
                );
                // Revoke all tokens for this user
                let _ = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
                    .bind(&uid)
                    .execute(&mut *tx)
                    .await;
                tx.commit().await?;
                return Err(AuthError::TokenReuseDetected);
            }

            return Err(AuthError::InvalidRefreshToken);
        }
    };

    // Record the consumed token in the audit table for reuse detection
    let _ = sqlx::query(
        r#"
        INSERT INTO used_refresh_tokens (token_hash, user_id, family_id, used_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (token_hash) DO NOTHING
        "#,
    )
    .bind(old_hash)
    .bind(&user_id)
    .bind(family_id)
    .execute(&mut *tx)
    .await;

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(new_id)
    .bind(&user_id)
    .bind(new_hash)
    .bind(family_id)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok((user_id, family_id))
}

/// Revoke all refresh tokens for a given user (e.g., on logout or compromise).
pub async fn revoke_all_user_tokens(pool: &PgPool, user_id: &str) -> Result<u64, AuthError> {
    let result = sqlx::query("DELETE FROM refresh_tokens WHERE user_id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    use sqlx::postgres::PgPoolOptions;

    /// Connects to `DATABASE_URL` and ensures the `refresh_tokens` and
    /// `used_refresh_tokens` tables exist. Returns `None` (causing callers to
    /// skip) when no database is reachable, since CI does not run a Postgres
    /// instance for this crate. Run against a real database locally via
    /// `backend/docker-compose.yml` (schema: `backend/migrations/`).
    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .ok()?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id UUID PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash BYTEA NOT NULL UNIQUE,
                family_id UUID NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(&pool)
        .await
        .ok()?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS used_refresh_tokens (
                token_hash BYTEA PRIMARY KEY,
                user_id TEXT NOT NULL,
                family_id UUID NOT NULL,
                used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            "#,
        )
        .execute(&pool)
        .await
        .ok()?;
        Some(pool)
    }

    /// A hash unlikely to collide with any other test run or concurrent test.
    fn unique_hash() -> Vec<u8> {
        Uuid::new_v4().as_bytes().to_vec()
    }

    #[tokio::test]
    async fn insert_persists_the_exact_row_that_was_written() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let id = Uuid::new_v4();
        let family = Uuid::new_v4();
        let hash = unique_hash();
        let expires_at = Utc::now() + Duration::hours(1);

        insert_refresh_token(&pool, id, "user-insert", &hash, family, expires_at)
            .await
            .expect("insert should succeed");

        let row: (String, Vec<u8>, Uuid, DateTime<Utc>) = sqlx::query_as(
            "SELECT user_id, token_hash, family_id, expires_at FROM refresh_tokens WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&pool)
        .await
        .expect("row should be readable back");

        assert_eq!(row.0, "user-insert");
        assert_eq!(row.1, hash);
        assert_eq!(row.2, family);
        assert_eq!(row.3.timestamp(), expires_at.timestamp());

        sqlx::query("DELETE FROM refresh_tokens WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn rotate_replaces_old_token_and_preserves_user_and_family() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let id = Uuid::new_v4();
        let family = Uuid::new_v4();
        let old_hash = unique_hash();
        let expires_at = Utc::now() + Duration::hours(1);
        insert_refresh_token(&pool, id, "user-rotate", &old_hash, family, expires_at)
            .await
            .expect("insert should succeed");

        let new_id = Uuid::new_v4();
        let new_hash = unique_hash();
        let (user_id, family_id) =
            rotate_refresh_token(&pool, &old_hash, new_id, &new_hash, expires_at)
                .await
                .expect("rotation of a valid token should succeed");

        assert_eq!(user_id, "user-rotate");
        assert_eq!(family_id, family);

        // The new row is in place with the same family id. Checked before the
        // reuse attempt below, because reuse detection revokes every session
        // for this user — including the row we're about to verify.
        let row: (String, Uuid) =
            sqlx::query_as("SELECT user_id, family_id FROM refresh_tokens WHERE id = $1")
                .bind(new_id)
                .fetch_one(&pool)
                .await
                .expect("rotated row should exist");
        assert_eq!(row.0, "user-rotate");
        assert_eq!(row.1, family);

        sqlx::query("DELETE FROM refresh_tokens WHERE id = $1")
            .bind(new_id)
            .execute(&pool)
            .await
            .ok();
        sqlx::query("DELETE FROM used_refresh_tokens WHERE token_hash = $1")
            .bind(&old_hash)
            .execute(&pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn reusing_a_rotated_away_token_is_detected_and_revokes_all_sessions() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let id = Uuid::new_v4();
        let family = Uuid::new_v4();
        let old_hash = unique_hash();
        let expires_at = Utc::now() + Duration::hours(1);
        insert_refresh_token(&pool, id, "user-theft", &old_hash, family, expires_at)
            .await
            .expect("insert should succeed");

        // Legitimate rotation: old_hash is now recorded in used_refresh_tokens.
        let (user_id, _) =
            rotate_refresh_token(&pool, &old_hash, Uuid::new_v4(), &unique_hash(), expires_at)
                .await
                .expect("first rotation should succeed");

        // An attacker (or a client that missed the response) replays the old
        // token. This must be rejected as theft, not treated as merely invalid,
        // and must revoke every active session for the user.
        let reuse = rotate_refresh_token(&pool, &old_hash, Uuid::new_v4(), &unique_hash(), expires_at)
            .await;
        assert!(
            matches!(reuse, Err(AuthError::TokenReuseDetected)),
            "replaying a rotated-away token must be flagged as reuse, not a generic invalid token"
        );

        let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .expect("count query should succeed");
        assert_eq!(remaining, 0, "reuse detection must revoke all sessions for the user, including the legitimately-rotated one");

        sqlx::query("DELETE FROM used_refresh_tokens WHERE token_hash = $1")
            .bind(&old_hash)
            .execute(&pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn rotate_unknown_token_is_rejected() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let result = rotate_refresh_token(
            &pool,
            &unique_hash(),
            Uuid::new_v4(),
            &unique_hash(),
            Utc::now() + Duration::hours(1),
        )
        .await;
        assert!(matches!(result, Err(AuthError::InvalidRefreshToken)));
    }

    #[tokio::test]
    async fn rotate_expired_token_is_rejected() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let id = Uuid::new_v4();
        let family = Uuid::new_v4();
        let hash = unique_hash();
        let already_expired = Utc::now() - Duration::hours(1);
        insert_refresh_token(&pool, id, "user-expired", &hash, family, already_expired)
            .await
            .expect("insert should succeed even for an already-expired row");

        let result = rotate_refresh_token(
            &pool,
            &hash,
            Uuid::new_v4(),
            &unique_hash(),
            Utc::now() + Duration::hours(1),
        )
        .await;
        assert!(
            matches!(result, Err(AuthError::InvalidRefreshToken)),
            "an expired refresh token must not be rotatable"
        );

        sqlx::query("DELETE FROM refresh_tokens WHERE id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .ok();
    }

    #[tokio::test]
    async fn revoke_all_user_tokens_deletes_only_that_users_rows() {
        let Some(pool) = test_pool().await else {
            eprintln!("skipping: DATABASE_URL not set/unreachable (see backend/docker-compose.yml)");
            return;
        };

        let expires_at = Utc::now() + Duration::hours(1);
        let id_a1 = Uuid::new_v4();
        let id_a2 = Uuid::new_v4();
        let id_b = Uuid::new_v4();
        insert_refresh_token(&pool, id_a1, "user-a", &unique_hash(), Uuid::new_v4(), expires_at)
            .await
            .expect("insert should succeed");
        insert_refresh_token(&pool, id_a2, "user-a", &unique_hash(), Uuid::new_v4(), expires_at)
            .await
            .expect("insert should succeed");
        insert_refresh_token(&pool, id_b, "user-b", &unique_hash(), Uuid::new_v4(), expires_at)
            .await
            .expect("insert should succeed");

        let revoked = revoke_all_user_tokens(&pool, "user-a")
            .await
            .expect("revoke should succeed");
        assert_eq!(revoked, 2);

        let remaining_a: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind("user-a")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining_a, 0);

        let remaining_b: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1")
            .bind("user-b")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(remaining_b, 1, "revoking user-a must not touch user-b's tokens");

        sqlx::query("DELETE FROM refresh_tokens WHERE id = $1")
            .bind(id_b)
            .execute(&pool)
            .await
            .ok();
    }
}
