use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowCreateRequest {
    #[serde(rename = "bountyId")]
    pub bounty_id: String,
    #[serde(rename = "payerAddress")]
    pub payer_address: String,
    #[serde(rename = "payeeAddress")]
    pub payee_address: String,
    pub amount: i64,
    pub token: String,
    pub timelock: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct EscrowRefundRequest {
    #[serde(rename = "authorizerAddress")]
    pub authorizer_address: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Escrow {
    pub id: u64,
    pub bounty_id: String,
    pub payer_address: String,
    pub payee_address: String,
    pub amount: i64,
    pub token: String,
    pub status: String,
    pub transaction_hash: Option<String>,
    pub timelock: Option<u64>,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Shared in-memory store
//
// Previously every function called `get_mock_escrows()` which regenerated the
// list from scratch, so mutations were applied to a throw-away copy and were
// never visible on subsequent reads.  We now keep a single `Mutex<Vec<Escrow>>`
// as the source of truth so that release/refund updates are durable for the
// lifetime of the process.
// ---------------------------------------------------------------------------

fn escrow_store() -> &'static Mutex<Vec<Escrow>> {
    static STORE: OnceLock<Mutex<Vec<Escrow>>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(vec![
            Escrow {
                id: 1,
                bounty_id: "1".to_string(),
                payer_address: "GPAYER123".to_string(),
                payee_address: "GPAYEE456".to_string(),
                amount: 5000,
                token: "GUSDC".to_string(),
                status: "active".to_string(),
                transaction_hash: Some("tx_123456".to_string()),
                timelock: Some(1640995200),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
            Escrow {
                id: 2,
                bounty_id: "2".to_string(),
                payer_address: "GPAYER789".to_string(),
                payee_address: "GPAYEE012".to_string(),
                amount: 3000,
                token: "GUSDC".to_string(),
                status: "released".to_string(),
                transaction_hash: Some("tx_789012".to_string()),
                timelock: Some(1640995200),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            },
        ])
    })
}

pub fn get_escrow_by_id(escrow_id: u64) -> Option<Escrow> {
    let store = escrow_store().lock().unwrap();
    store.iter().find(|e| e.id == escrow_id).cloned()
}

pub fn create_escrow(request: EscrowCreateRequest) -> Escrow {
    let mut store = escrow_store().lock().unwrap();
    let escrow_id = store.iter().map(|e| e.id).max().unwrap_or(0) + 1;
    let escrow = Escrow {
    // Generate a unique escrow ID by hashing a v4 UUID down to a u64.
    // This avoids ID collisions across concurrent escrow creation calls
    // that would otherwise cause fund-misdirection on release/refund/dispute.
    let raw = uuid::Uuid::new_v4();
    let bytes = raw.as_u128().to_le_bytes();
    let escrow_id = u64::from_le_bytes(bytes[..8].try_into().unwrap());
    Escrow {
        id: escrow_id,
        bounty_id: request.bounty_id,
        payer_address: request.payer_address,
        payee_address: request.payee_address,
        amount: request.amount,
        token: request.token,
        status: "pending".to_string(),
        transaction_hash: Some(format!("tx_escrow_{}", escrow_id)),
        timelock: request.timelock,
        created_at: chrono_now(),
    };
    store.push(escrow.clone());
    escrow
}

pub fn release_escrow(escrow_id: u64) -> Option<Escrow> {
    let mut store = escrow_store().lock().unwrap();
    let escrow = store.iter_mut().find(|e| e.id == escrow_id)?;
    escrow.status = "released".to_string();
    escrow.transaction_hash = Some(format!("tx_release_{}", escrow_id));
    Some(escrow.clone())
}

pub fn refund_escrow(escrow_id: u64, _authorizer_address: String) -> Option<Escrow> {
    let mut store = escrow_store().lock().unwrap();
    let escrow = store.iter_mut().find(|e| e.id == escrow_id)?;
    escrow.status = "refunded".to_string();
    escrow.transaction_hash = Some(format!("tx_refund_{}", escrow_id));
    Some(escrow.clone())
}

fn chrono_now() -> String {
    // Stable timestamp placeholder — real impl would use chrono or time crate
    "2026-01-01T00:00:00Z".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> EscrowCreateRequest {
        EscrowCreateRequest {
            bounty_id: "test-bounty".to_string(),
            payer_address: "GPAYER".to_string(),
            payee_address: "GPAYEE".to_string(),
            amount: 1000,
            token: "GUSDC".to_string(),
            timelock: None,
        }
    }

    #[test]
    fn get_escrow_by_id_returns_none_for_unknown_id() {
        assert!(get_escrow_by_id(9999).is_none());
    }

    #[test]
    fn create_escrow_starts_pending_and_preserves_optional_timelock() {
        let created = create_escrow(sample_request());
        assert_eq!(created.status, "pending");
        assert_eq!(created.timelock, None);
        assert!(created.transaction_hash.is_some());
    }

    #[test]
    fn release_escrow_updates_status_for_existing_escrow() {
        let released = release_escrow(1).expect("escrow 1 exists in store");
        assert_eq!(released.status, "released");
        assert_eq!(released.transaction_hash, Some("tx_release_1".to_string()));
    }

    #[test]
    fn release_escrow_is_visible_on_subsequent_read() {
        // Ensure the mutation persists — this was the core bug.
        release_escrow(1).expect("escrow 1 exists");
        let fetched = get_escrow_by_id(1).expect("escrow 1 exists after release");
        assert_eq!(fetched.status, "released");
    }

    #[test]
    fn release_escrow_returns_none_for_unknown_id() {
        assert!(release_escrow(9999).is_none());
    }

    #[test]
    fn refund_escrow_updates_status_for_existing_escrow() {
        let refunded = refund_escrow(2, "GAUTHORIZER".to_string()).expect("escrow 2 exists in store");
        assert_eq!(refunded.status, "refunded");
        assert_eq!(refunded.transaction_hash, Some("tx_refund_2".to_string()));
    }

    #[test]
    fn refund_escrow_is_visible_on_subsequent_read() {
        // Ensure the mutation persists — this was the core bug.
        refund_escrow(2, "GAUTHORIZER".to_string()).expect("escrow 2 exists");
        let fetched = get_escrow_by_id(2).expect("escrow 2 exists after refund");
        assert_eq!(fetched.status, "refunded");
    }

    #[test]
    fn refund_escrow_returns_none_for_unknown_id() {
        assert!(refund_escrow(9999, "GAUTHORIZER".to_string()).is_none());
    }
}
