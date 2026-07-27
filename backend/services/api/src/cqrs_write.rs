//! CQRS Write Model – Command side (#636).
//!
//! All state mutations flow through typed `Command` variants. Each command
//! produces one or more `DomainEvent`s that are appended to the event log.
//! The write model never reads from the read-optimised projection tables.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    CreateBounty {
        bounty_id: String,
        creator_id: String,
        title: String,
        budget_usd: u64,
        deadline_ts: u64,
    },
    ApplyForBounty {
        application_id: String,
        bounty_id: String,
        freelancer_id: String,
        proposed_budget_usd: u64,
    },
    SelectFreelancer {
        bounty_id: String,
        application_id: String,
    },
    CompleteBounty {
        bounty_id: String,
    },
    DepositEscrow {
        escrow_id: String,
        bounty_id: String,
        payer_id: String,
        payee_id: String,
        amount_usd: u64,
    },
    ReleaseEscrow {
        escrow_id: String,
        authorizer_id: String,
    },
    RefundEscrow {
        escrow_id: String,
        authorizer_id: String,
    },
    SubmitReview {
        review_id: String,
        bounty_id: String,
        creator_id: String,
        rating: u8,
        zk_proof: String,
        zk_nullifier: String,
    },
}

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type", rename_all = "snake_case")]
pub enum DomainEvent {
    BountyCreated {
        bounty_id: String,
        creator_id: String,
        title: String,
        budget_usd: u64,
        deadline_ts: u64,
        occurred_at: u64,
    },
    BountyApplicationReceived {
        application_id: String,
        bounty_id: String,
        freelancer_id: String,
        proposed_budget_usd: u64,
        occurred_at: u64,
    },
    FreelancerSelected {
        bounty_id: String,
        application_id: String,
        occurred_at: u64,
    },
    BountyCompleted {
        bounty_id: String,
        occurred_at: u64,
    },
    EscrowDeposited {
        escrow_id: String,
        bounty_id: String,
        payer_id: String,
        payee_id: String,
        amount_usd: u64,
        occurred_at: u64,
    },
    EscrowReleased {
        escrow_id: String,
        authorizer_id: String,
        occurred_at: u64,
    },
    EscrowRefunded {
        escrow_id: String,
        authorizer_id: String,
        occurred_at: u64,
    },
    ReviewSubmitted {
        review_id: String,
        bounty_id: String,
        creator_id: String,
        rating: u8,
        zk_nullifier: String,
        occurred_at: u64,
    },
}

// ---------------------------------------------------------------------------
// Event log entry (persisted to the append-only store)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventRecord {
    /// Monotonically increasing sequence number.
    pub sequence: u64,
    /// Aggregate identifier (e.g. bounty_id, escrow_id).
    pub aggregate_id: String,
    /// Aggregate type for routing to the correct projector.
    pub aggregate_type: String,
    /// The serialised domain event.
    pub event: DomainEvent,
    /// Wall-clock timestamp (Unix seconds).
    pub occurred_at: u64,
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/// Validates a command and converts it into the corresponding domain event(s).
///
/// In a full implementation this would load aggregate state from the event log,
/// apply business rules, and return the new events to be appended. Here we
/// produce one event per command for clarity.
pub fn handle_command(cmd: Command, now: u64) -> Result<Vec<DomainEvent>, &'static str> {
    let events = match cmd {
        Command::CreateBounty { bounty_id, creator_id, title, budget_usd, deadline_ts } => {
            vec![DomainEvent::BountyCreated {
                bounty_id,
                creator_id,
                title,
                budget_usd,
                deadline_ts,
                occurred_at: now,
            }]
        }
        Command::ApplyForBounty { application_id, bounty_id, freelancer_id, proposed_budget_usd } => {
            vec![DomainEvent::BountyApplicationReceived {
                application_id,
                bounty_id,
                freelancer_id,
                proposed_budget_usd,
                occurred_at: now,
            }]
        }
        Command::SelectFreelancer { bounty_id, application_id } => {
            vec![DomainEvent::FreelancerSelected { bounty_id, application_id, occurred_at: now }]
        }
        Command::CompleteBounty { bounty_id } => {
            vec![DomainEvent::BountyCompleted { bounty_id, occurred_at: now }]
        }
        Command::DepositEscrow { escrow_id, bounty_id, payer_id, payee_id, amount_usd } => {
            vec![DomainEvent::EscrowDeposited {
                escrow_id,
                bounty_id,
                payer_id,
                payee_id,
                amount_usd,
                occurred_at: now,
            }]
        }
        Command::ReleaseEscrow { escrow_id, authorizer_id } => {
            vec![DomainEvent::EscrowReleased { escrow_id, authorizer_id, occurred_at: now }]
        }
        Command::RefundEscrow { escrow_id, authorizer_id } => {
            vec![DomainEvent::EscrowRefunded { escrow_id, authorizer_id, occurred_at: now }]
        }
        Command::SubmitReview { review_id, bounty_id, creator_id, rating, zk_proof: _, zk_nullifier } => {
            if rating == 0 || rating > 5 {
                return Err("Rating must be between 1 and 5");
            }
            vec![DomainEvent::ReviewSubmitted {
                review_id,
                bounty_id,
                creator_id,
                rating,
                zk_nullifier,
                occurred_at: now,
            }]
        }
    };

    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_bounty_produces_single_bounty_created_event() {
        let cmd = Command::CreateBounty {
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Design a logo".to_string(),
            budget_usd: 500,
            deadline_ts: 1_700_000_000,
        };
        let events = handle_command(cmd, 1_600_000_000).expect("command should succeed");
        assert_eq!(events.len(), 1);
        match &events[0] {
            DomainEvent::BountyCreated { bounty_id, creator_id, title, budget_usd, deadline_ts, occurred_at } => {
                assert_eq!(bounty_id, "b-1");
                assert_eq!(creator_id, "creator-1");
                assert_eq!(title, "Design a logo");
                assert_eq!(*budget_usd, 500);
                assert_eq!(*deadline_ts, 1_700_000_000);
                assert_eq!(*occurred_at, 1_600_000_000);
            }
            other => panic!("expected BountyCreated, got {other:?}"),
        }
    }

    #[test]
    fn apply_for_bounty_produces_application_received_event() {
        let cmd = Command::ApplyForBounty {
            application_id: "app-1".to_string(),
            bounty_id: "b-1".to_string(),
            freelancer_id: "freelancer-1".to_string(),
            proposed_budget_usd: 450,
        };
        let events = handle_command(cmd, 1_600_000_000).unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], DomainEvent::BountyApplicationReceived { .. }));
    }

    #[test]
    fn select_freelancer_produces_freelancer_selected_event() {
        let cmd = Command::SelectFreelancer {
            bounty_id: "b-1".to_string(),
            application_id: "app-1".to_string(),
        };
        let events = handle_command(cmd, 1_600_000_000).unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], DomainEvent::FreelancerSelected { .. }));
    }

    #[test]
    fn complete_bounty_produces_bounty_completed_event() {
        let cmd = Command::CompleteBounty { bounty_id: "b-1".to_string() };
        let events = handle_command(cmd, 1_600_000_000).unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], DomainEvent::BountyCompleted { .. }));
    }

    #[test]
    fn deposit_escrow_produces_escrow_deposited_event() {
        let cmd = Command::DepositEscrow {
            escrow_id: "e-1".to_string(),
            bounty_id: "b-1".to_string(),
            payer_id: "payer-1".to_string(),
            payee_id: "payee-1".to_string(),
            amount_usd: 500,
        };
        let events = handle_command(cmd, 1_600_000_000).unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], DomainEvent::EscrowDeposited { .. }));
    }

    #[test]
    fn release_and_refund_escrow_produce_matching_events() {
        let release = handle_command(
            Command::ReleaseEscrow { escrow_id: "e-1".to_string(), authorizer_id: "auth-1".to_string() },
            1_600_000_000,
        ).unwrap();
        assert!(matches!(release[0], DomainEvent::EscrowReleased { .. }));

        let refund = handle_command(
            Command::RefundEscrow { escrow_id: "e-1".to_string(), authorizer_id: "auth-1".to_string() },
            1_600_000_000,
        ).unwrap();
        assert!(matches!(refund[0], DomainEvent::EscrowRefunded { .. }));
    }

    #[test]
    fn submit_review_rejects_rating_of_zero() {
        let cmd = Command::SubmitReview {
            review_id: "r-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            rating: 0,
            zk_proof: "proof".to_string(),
            zk_nullifier: "nullifier".to_string(),
        };
        let result = handle_command(cmd, 1_600_000_000);
        assert_eq!(result.unwrap_err(), "Rating must be between 1 and 5");
    }

    #[test]
    fn submit_review_rejects_rating_above_five() {
        let cmd = Command::SubmitReview {
            review_id: "r-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            rating: 6,
            zk_proof: "proof".to_string(),
            zk_nullifier: "nullifier".to_string(),
        };
        let result = handle_command(cmd, 1_600_000_000);
        assert_eq!(result.unwrap_err(), "Rating must be between 1 and 5");
    }

    #[test]
    fn submit_review_accepts_valid_rating_and_omits_proof_from_event() {
        let cmd = Command::SubmitReview {
            review_id: "r-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            rating: 5,
            zk_proof: "secret-proof".to_string(),
            zk_nullifier: "nullifier-abc".to_string(),
        };
        let events = handle_command(cmd, 1_600_000_000).unwrap();
        assert_eq!(events.len(), 1);
        match &events[0] {
            DomainEvent::ReviewSubmitted { rating, zk_nullifier, .. } => {
                assert_eq!(*rating, 5);
                assert_eq!(zk_nullifier, "nullifier-abc");
            }
            other => panic!("expected ReviewSubmitted, got {other:?}"),
        }
    }
}
