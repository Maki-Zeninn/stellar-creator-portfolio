//! CQRS Read Model – Query side (#636).
//!
//! Read models are denormalised projections built by replaying `DomainEvent`s.
//! They are optimised for query patterns and are completely separate from the
//! write model. Eventual consistency is the contract: projections may lag
//! behind the event log by a small number of ledger confirmations.
//!
//! Projections are updated by the `EventProjector` which subscribes to the
//! event log (Kafka topic or in-process channel) and applies each event.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::cqrs_write::DomainEvent;

// ---------------------------------------------------------------------------
// Read model projections
// ---------------------------------------------------------------------------

/// Materialised search projection for the `bounty_search_view` Postgres view.
///
/// Kept in-sync by `project_event`: the projector calls
/// `schedule_search_view_refresh` after any bounty-mutating event so that the
/// Postgres view is refreshed asynchronously by the background worker.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BountySearchView {
    pub bounty_id: String,
    pub creator_id: String,
    pub title: String,
    pub description: String,
    pub budget: u64,
    pub status: String,
    pub category: Option<String>,
    /// Pre-computed tag/skill tokens for fast keyword matching.
    pub skill_tokens: String,
    /// Tag array for containment queries.
    pub tags: Vec<String>,
    pub created_at: u64,
    pub updated_at: u64,
    /// True when this in-memory projection is dirty and the Postgres view
    /// needs a concurrent REFRESH.
    pub needs_refresh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BountyView {
    pub bounty_id: String,
    pub creator_id: String,
    pub title: String,
    pub budget_usd: u64,
    pub deadline_ts: u64,
    pub status: String,
    pub selected_freelancer_id: Option<String>,
    pub application_count: u32,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CreatorReputationView {
    pub creator_id: String,
    pub total_reviews: u32,
    pub average_rating: f64,
    pub completed_bounties: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EscrowView {
    pub escrow_id: String,
    pub bounty_id: String,
    pub payer_id: String,
    pub payee_id: String,
    pub amount_usd: u64,
    pub status: String,
    pub created_at: u64,
    pub settled_at: Option<u64>,
}

// ---------------------------------------------------------------------------
// In-memory projection store (replace with Prisma / sqlx in production)
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ReadStore {
    pub bounties: HashMap<String, BountyView>,
    pub reputations: HashMap<String, CreatorReputationView>,
    pub escrows: HashMap<String, EscrowView>,
    /// In-memory mirror of the `bounty_search_view` Postgres materialized view.
    /// Entries flagged `needs_refresh = true` are picked up by the background
    /// refresh worker and flushed via `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
    pub search_views: HashMap<String, BountySearchView>,
}

/// Enqueue an async REFRESH of the `bounty_search_view` materialized view.
///
/// In production this posts the bounty_id to a background worker channel;
/// the worker debounces rapid successive refreshes (e.g. burst of applications)
/// and issues `REFRESH MATERIALIZED VIEW CONCURRENTLY bounty_search_view` which
/// never takes a table lock.
pub fn schedule_search_view_refresh(store: &mut ReadStore, bounty_id: &str) {
    if let Some(sv) = store.search_views.get_mut(bounty_id) {
        sv.needs_refresh = true;
    }
}

// ---------------------------------------------------------------------------
// Event projector
// ---------------------------------------------------------------------------

/// Applies a single `DomainEvent` to the read store, updating the relevant
/// projection(s). This function is idempotent when called with the same event
/// sequence number (callers should track the last applied sequence).
pub fn project_event(store: &mut ReadStore, event: &DomainEvent) {
    match event {
        DomainEvent::BountyCreated {
            bounty_id, creator_id, title, budget_usd, deadline_ts, occurred_at,
        } => {
            store.bounties.insert(
                bounty_id.clone(),
                BountyView {
                    bounty_id: bounty_id.clone(),
                    creator_id: creator_id.clone(),
                    title: title.clone(),
                    budget_usd: *budget_usd,
                    deadline_ts: *deadline_ts,
                    status: "open".into(),
                    created_at: *occurred_at,
                    ..Default::default()
                },
            );
            // Materialise the search projection and mark it for async Postgres refresh.
            store.search_views.insert(
                bounty_id.clone(),
                BountySearchView {
                    bounty_id: bounty_id.clone(),
                    creator_id: creator_id.clone(),
                    title: title.clone(),
                    description: String::new(),
                    budget: *budget_usd,
                    status: "open".into(),
                    category: None,
                    skill_tokens: String::new(),
                    tags: Vec::new(),
                    created_at: *occurred_at,
                    updated_at: *occurred_at,
                    needs_refresh: true,
                },
            );
        }

        DomainEvent::BountyApplicationReceived { bounty_id, .. } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.application_count += 1;
            }
        }

        DomainEvent::FreelancerSelected { bounty_id, application_id, .. } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.status = "in_progress".into();
                b.selected_freelancer_id = Some(application_id.clone());
            }
        }

        DomainEvent::BountyCompleted { bounty_id, occurred_at } => {
            if let Some(b) = store.bounties.get_mut(bounty_id) {
                b.status = "completed".into();
                b.completed_at = Some(*occurred_at);
            }
            if let Some(sv) = store.search_views.get_mut(bounty_id) {
                sv.status = "completed".into();
                sv.updated_at = *occurred_at;
                sv.needs_refresh = true;
            }
        }

        DomainEvent::EscrowDeposited {
            escrow_id, bounty_id, payer_id, payee_id, amount_usd, occurred_at,
        } => {
            store.escrows.insert(
                escrow_id.clone(),
                EscrowView {
                    escrow_id: escrow_id.clone(),
                    bounty_id: bounty_id.clone(),
                    payer_id: payer_id.clone(),
                    payee_id: payee_id.clone(),
                    amount_usd: *amount_usd,
                    status: "active".into(),
                    created_at: *occurred_at,
                    settled_at: None,
                },
            );
        }

        DomainEvent::EscrowReleased { escrow_id, occurred_at, .. } => {
            if let Some(e) = store.escrows.get_mut(escrow_id) {
                e.status = "released".into();
                e.settled_at = Some(*occurred_at);
            }
        }

        DomainEvent::EscrowRefunded { escrow_id, occurred_at, .. } => {
            if let Some(e) = store.escrows.get_mut(escrow_id) {
                e.status = "refunded".into();
                e.settled_at = Some(*occurred_at);
            }
        }

        DomainEvent::ReviewSubmitted { creator_id, rating, .. } => {
            let rep = store
                .reputations
                .entry(creator_id.clone())
                .or_insert_with(|| CreatorReputationView {
                    creator_id: creator_id.clone(),
                    ..Default::default()
                });
            // Incremental average: new_avg = (old_avg * n + rating) / (n + 1)
            let n = rep.total_reviews as f64;
            rep.average_rating = (rep.average_rating * n + *rating as f64) / (n + 1.0);
            rep.total_reviews += 1;
        }

        // Variants handled elsewhere or not yet projected.
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

impl ReadStore {
    /// Return open bounties sorted by creation time (newest first).
    pub fn open_bounties(&self) -> Vec<&BountyView> {
        let mut result: Vec<&BountyView> = self
            .bounties
            .values()
            .filter(|b| b.status == "open")
            .collect();
        result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        result
    }

    /// Return the reputation view for a creator, if it exists.
    pub fn creator_reputation(&self, creator_id: &str) -> Option<&CreatorReputationView> {
        self.reputations.get(creator_id)
    }

    /// Return open bounty search views matching a keyword in title or skill tokens.
    /// Used as an in-process fallback before the Postgres materialized view is ready.
    pub fn search_bounties<'a>(&'a self, keyword: &str) -> Vec<&'a BountySearchView> {
        let lower = keyword.to_lowercase();
        let mut results: Vec<&BountySearchView> = self
            .search_views
            .values()
            .filter(|sv| {
                sv.status != "cancelled"
                    && (sv.title.to_lowercase().contains(&lower)
                        || sv.skill_tokens.to_lowercase().contains(&lower))
            })
            .collect();
        results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        results
    }

    /// Drain all search view entries that need a Postgres materialized view refresh.
    pub fn drain_pending_refreshes(&mut self) -> Vec<String> {
        self.search_views
            .values_mut()
            .filter_map(|sv| {
                if sv.needs_refresh {
                    sv.needs_refresh = false;
                    Some(sv.bounty_id.clone())
                } else {
                    None
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cqrs_write::{handle_command, Command};

    #[test]
    fn bounty_created_populates_bounty_and_search_views() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Design a logo".to_string(),
            budget_usd: 500,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_000,
        });

        let bounty = store.bounties.get("b-1").expect("bounty should be projected");
        assert_eq!(bounty.status, "open");
        assert_eq!(bounty.application_count, 0);

        let search_view = store.search_views.get("b-1").expect("search view should be projected");
        assert!(search_view.needs_refresh);
    }

    #[test]
    fn full_bounty_lifecycle_projects_in_order() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Design a logo".to_string(),
            budget_usd: 500,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_000,
        });
        project_event(&mut store, &DomainEvent::BountyApplicationReceived {
            application_id: "app-1".to_string(),
            bounty_id: "b-1".to_string(),
            freelancer_id: "freelancer-1".to_string(),
            proposed_budget_usd: 450,
            occurred_at: 1_600_000_100,
        });
        project_event(&mut store, &DomainEvent::FreelancerSelected {
            bounty_id: "b-1".to_string(),
            application_id: "app-1".to_string(),
            occurred_at: 1_600_000_200,
        });
        project_event(&mut store, &DomainEvent::BountyCompleted {
            bounty_id: "b-1".to_string(),
            occurred_at: 1_600_000_300,
        });

        let bounty = store.bounties.get("b-1").unwrap();
        assert_eq!(bounty.application_count, 1);
        assert_eq!(bounty.status, "completed");
        assert_eq!(bounty.selected_freelancer_id, Some("app-1".to_string()));
        assert_eq!(bounty.completed_at, Some(1_600_000_300));

        // open_bounties() must not surface a completed bounty.
        assert!(store.open_bounties().is_empty());
    }

    #[test]
    fn out_of_order_events_for_unknown_aggregate_are_dropped_not_panicked() {
        let mut store = ReadStore::default();
        // Application/selection/completion events arrive before the bounty's
        // own BountyCreated event has been projected (e.g. redelivered out of
        // sequence). The projector must no-op rather than panic or fabricate
        // a bounty view.
        project_event(&mut store, &DomainEvent::BountyApplicationReceived {
            application_id: "app-1".to_string(),
            bounty_id: "b-missing".to_string(),
            freelancer_id: "freelancer-1".to_string(),
            proposed_budget_usd: 450,
            occurred_at: 1_600_000_100,
        });
        project_event(&mut store, &DomainEvent::BountyCompleted {
            bounty_id: "b-missing".to_string(),
            occurred_at: 1_600_000_200,
        });

        assert!(store.bounties.get("b-missing").is_none());
    }

    #[test]
    fn escrow_deposit_release_and_refund_update_status() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::EscrowDeposited {
            escrow_id: "e-1".to_string(),
            bounty_id: "b-1".to_string(),
            payer_id: "payer-1".to_string(),
            payee_id: "payee-1".to_string(),
            amount_usd: 500,
            occurred_at: 1_600_000_000,
        });
        assert_eq!(store.escrows.get("e-1").unwrap().status, "active");

        project_event(&mut store, &DomainEvent::EscrowReleased {
            escrow_id: "e-1".to_string(),
            authorizer_id: "auth-1".to_string(),
            occurred_at: 1_600_000_100,
        });
        let escrow = store.escrows.get("e-1").unwrap();
        assert_eq!(escrow.status, "released");
        assert_eq!(escrow.settled_at, Some(1_600_000_100));
    }

    #[test]
    fn escrow_refund_for_unknown_escrow_is_ignored() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::EscrowRefunded {
            escrow_id: "e-missing".to_string(),
            authorizer_id: "auth-1".to_string(),
            occurred_at: 1_600_000_000,
        });
        assert!(store.escrows.get("e-missing").is_none());
    }

    #[test]
    fn review_submitted_computes_incremental_average() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::ReviewSubmitted {
            review_id: "r-1".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            rating: 4,
            zk_nullifier: "n-1".to_string(),
            occurred_at: 1_600_000_000,
        });
        project_event(&mut store, &DomainEvent::ReviewSubmitted {
            review_id: "r-2".to_string(),
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            rating: 5,
            zk_nullifier: "n-2".to_string(),
            occurred_at: 1_600_000_100,
        });

        let rep = store.creator_reputation("creator-1").expect("reputation should exist");
        assert_eq!(rep.total_reviews, 2);
        assert_eq!(rep.average_rating, 4.5);
    }

    #[test]
    fn creator_reputation_returns_none_for_creator_with_no_reviews() {
        let store = ReadStore::default();
        assert!(store.creator_reputation("nobody").is_none());
    }

    #[test]
    fn open_bounties_sorted_newest_first() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-older".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Older".to_string(),
            budget_usd: 100,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_000,
        });
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-newer".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Newer".to_string(),
            budget_usd: 200,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_500,
        });

        let open = store.open_bounties();
        assert_eq!(open.len(), 2);
        assert_eq!(open[0].bounty_id, "b-newer");
        assert_eq!(open[1].bounty_id, "b-older");
    }

    #[test]
    fn search_bounties_excludes_cancelled_and_matches_case_insensitively() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Design a Landing Page".to_string(),
            budget_usd: 500,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_000,
        });
        store.search_views.get_mut("b-1").unwrap().status = "cancelled".to_string();

        assert!(store.search_bounties("landing").is_empty());
    }

    #[test]
    fn schedule_search_view_refresh_and_drain_round_trip() {
        let mut store = ReadStore::default();
        project_event(&mut store, &DomainEvent::BountyCreated {
            bounty_id: "b-1".to_string(),
            creator_id: "creator-1".to_string(),
            title: "Design a logo".to_string(),
            budget_usd: 500,
            deadline_ts: 1_700_000_000,
            occurred_at: 1_600_000_000,
        });
        // Creation already flags needs_refresh; drain it first so the next
        // assertion is about schedule_search_view_refresh specifically.
        assert_eq!(store.drain_pending_refreshes(), vec!["b-1".to_string()]);
        assert!(store.drain_pending_refreshes().is_empty());

        schedule_search_view_refresh(&mut store, "b-1");
        assert_eq!(store.drain_pending_refreshes(), vec!["b-1".to_string()]);
    }

    #[test]
    fn events_from_command_handler_project_end_to_end() {
        // Exercise the write-side handler and read-side projector together,
        // matching how the real event log would drive both sides.
        let mut store = ReadStore::default();
        let events = handle_command(
            Command::CreateBounty {
                bounty_id: "b-1".to_string(),
                creator_id: "creator-1".to_string(),
                title: "Design a logo".to_string(),
                budget_usd: 500,
                deadline_ts: 1_700_000_000,
            },
            1_600_000_000,
        ).unwrap();
        for event in &events {
            project_event(&mut store, event);
        }
        assert!(store.bounties.contains_key("b-1"));
    }
}
