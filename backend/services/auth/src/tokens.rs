// This module is not yet wired into any live HTTP handler in `main.rs` — it's
// compiled and unit tested here, but nothing in the running service calls it
// today. Suppress dead_code accordingly rather than scattering allows.
#![allow(dead_code)]

use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccessClaims {
    pub sub: String,
    pub jti: Uuid,
    pub family_id: Uuid,
    pub exp: i64,
    pub iat: i64,
}

pub fn hash_refresh_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub fn generate_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn sign_access_token(
    user_id: &str,
    family_id: Uuid,
    jwt_secret: &str,
    ttl: Duration,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = now + ttl;
    let claims = AccessClaims {
        sub: user_id.to_string(),
        jti: Uuid::new_v4(),
        family_id,
        exp: exp.timestamp(),
        iat: now.timestamp(),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
}

#[allow(dead_code)]
pub fn verify_access_token(
    token: &str,
    jwt_secret: &str,
) -> Result<AccessClaims, jsonwebtoken::errors::Error> {
    let mut validation = Validation::default();
    validation.validate_exp = true;
    let token = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )?;
    Ok(token.claims)
}

#[derive(Clone, Default)]
pub struct RevocationList {
    revoked_jtis: Arc<Mutex<HashMap<Uuid, i64>>>,
}

impl RevocationList {
    pub fn new() -> Self {
        Self {
            revoked_jtis: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn revoke(&self, jti: Uuid, exp: i64) {
        let mut revoked = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        revoked.insert(jti, exp);
        self.cleanup_expired(&mut revoked);
    }

    pub fn is_revoked(&self, jti: &Uuid, now: i64) -> bool {
        let mut revoked = self
            .revoked_jtis
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        if let Some(&exp) = revoked.get(jti) {
            if exp > now {
                return true;
            } else {
                revoked.remove(jti);
            }
        }
        false
    }

    fn cleanup_expired(&self, revoked: &mut HashMap<Uuid, i64>) {
        let now = Utc::now().timestamp();
        revoked.retain(|_, exp| *exp > now);
    }
}

pub fn verify_access_token_with_revocation(
    token: &str,
    jwt_secret: &str,
    revocation_list: &RevocationList,
) -> Result<AccessClaims, TokenError> {
    let claims = verify_access_token(token, jwt_secret)
        .map_err(|e| TokenError::Jwt(e.to_string()))?;

    let now = Utc::now().timestamp();
    if revocation_list.is_revoked(&claims.jti, now) {
        return Err(TokenError::Revoked);
    }

    Ok(claims)
}

#[derive(Debug, Clone)]
pub enum TokenError {
    Jwt(String),
    Revoked,
    Reused,
}

impl std::fmt::Display for TokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenError::Jwt(e) => write!(f, "JWT error: {}", e),
            TokenError::Revoked => write!(f, "token has been revoked"),
            TokenError::Reused => write!(f, "token reuse detected — all sessions revoked"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_token_round_trip() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.family_id, family);
    }

    #[test]
    fn access_token_has_jti() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();
        assert!(!claims.jti.is_nil());
    }

    #[test]
    fn two_tokens_have_different_jtis() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let t1 = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let t2 = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let c1 = verify_access_token(&t1, secret).unwrap();
        let c2 = verify_access_token(&t2, secret).unwrap();
        assert_ne!(c1.jti, c2.jti);
    }

    #[test]
    fn refresh_token_hash_stable() {
        let t = "abc";
        assert_eq!(hash_refresh_token(t), hash_refresh_token(t));
    }

    #[test]
    fn revocation_list_blocks_revoked_token() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();
        let claims = verify_access_token(&token, secret).unwrap();

        let rev_list = RevocationList::new();
        let now = Utc::now().timestamp();
        assert!(!rev_list.is_revoked(&claims.jti, now));

        rev_list.revoke(claims.jti, claims.exp);
        assert!(rev_list.is_revoked(&claims.jti, now));

        let result = verify_access_token_with_revocation(&token, secret, &rev_list);
        assert!(matches!(result, Err(TokenError::Revoked)));
    }

    #[test]
    fn revocation_check_survives_poisoned_lock() {
        let rev_list = RevocationList::new();
        let jti = Uuid::new_v4();
        let exp = Utc::now().timestamp() + 900;

        // Poison the lock by panicking while holding it in another thread.
        let list_clone = rev_list.clone();
        let handle = std::thread::spawn(move || {
            let _guard = list_clone.revoked_jtis.lock().unwrap();
            panic!("simulated panic while holding lock");
        });
        assert!(handle.join().is_err());

        // Revocation checks must still work (not panic) after the lock is poisoned.
        let now = Utc::now().timestamp();
        assert!(!rev_list.is_revoked(&jti, now));
        rev_list.revoke(jti, exp);
        assert!(rev_list.is_revoked(&jti, now));
    }

    #[test]
    fn revocation_list_allows_non_revoked_token() {
        let secret = "01234567890123456789012345678901";
        let family = Uuid::new_v4();
        let token = sign_access_token("user-1", family, secret, Duration::minutes(15)).unwrap();

        let rev_list = RevocationList::new();
        let result = verify_access_token_with_revocation(&token, secret, &rev_list);
        assert!(result.is_ok());
    }

    #[test]
    fn revocation_list_expires_old_entries() {
        let rev_list = RevocationList::new();
        let jti = Uuid::new_v4();
        let exp_time = Utc::now().timestamp() - 100;

        rev_list.revoke(jti, exp_time);
        let now = Utc::now().timestamp();
        assert!(!rev_list.is_revoked(&jti, now));
    }
}
