// contracts/vault/src/batch.rs
// Issue #520 — Multi-Vault Batch Withdrawal
//
// Vectorised batch processor for vault withdrawals.
// Gas optimisation: a single contract invocation handles N withdrawals,
// avoiding per-withdrawal transaction overhead and network congestion.
//
// Atomicity guarantee: requests that fail validation are recorded as failed
// outcomes (success: false) rather than aborting the entire batch. If you
// need all-or-nothing semantics, inspect the returned outcomes and roll back
// at the caller level.

#![no_std]
use soroban_sdk::{contracterror, contracttype, Address, Env, Vec};

/// A single withdrawal request within a batch.
#[contracttype]
#[derive(Clone)]
pub struct WithdrawalRequest {
    /// Vault owner authorising this withdrawal.
    pub owner: Address,
    /// Destination address to receive funds.
    pub recipient: Address,
    /// Token amount to withdraw (in stroops / base units).
    pub amount: i128,
}

/// Outcome for a single processed withdrawal.
///
/// `success` is `false` when the request was skipped due to a zero/negative
/// amount or an insufficient balance. In those cases `amount` reflects the
/// requested amount (not debited) so the caller can distinguish the failure.
#[contracttype]
#[derive(Clone)]
pub struct WithdrawalOutcome {
    pub owner: Address,
    pub amount: i128,
    /// `true`  – funds were debited and the withdrawal event was emitted.
    /// `false` – the request was invalid; no state was changed for this entry.
    pub success: bool,
}

/// Error codes for batch-level failures (e.g. empty batch).
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BatchError {
    EmptyBatch = 1,
    /// Kept for ABI / event-log compatibility; no longer used to abort.
    ZeroAmount = 2,
    /// Kept for ABI / event-log compatibility; no longer used to abort.
    InsufficientBalance = 3,
}

/// Process a batch of withdrawal requests.
///
/// Each request is evaluated independently:
/// - A zero/negative `amount` → `success: false`, balance unchanged.
/// - An insufficient balance  → `success: false`, balance unchanged.
/// - Otherwise               → balance debited, event emitted, `success: true`.
///
/// The only hard failure is an **empty** `requests` vec, which panics
/// immediately (there is nothing meaningful to return).
///
/// # Auth
/// `require_auth()` is called once per owner within the loop. Soroban
/// deduplicates auth checks for the same address within one invocation.
pub fn process_batch(
    env: &Env,
    requests: Vec<WithdrawalRequest>,
    get_balance: impl Fn(&Env, &Address) -> i128,
    set_balance: impl Fn(&Env, &Address, i128),
) -> Vec<WithdrawalOutcome> {
    if requests.is_empty() {
        // Nothing to do — surface this as a hard error at the batch level.
        soroban_sdk::panic_with_error!(env, BatchError::EmptyBatch);
    }

    let mut outcomes: Vec<WithdrawalOutcome> = Vec::new(env);

    for req in requests.iter() {
        // Require each owner to have authorised this invocation.
        req.owner.require_auth();

        // Validate amount — record failure instead of aborting the whole batch.
        if req.amount <= 0 {
            outcomes.push_back(WithdrawalOutcome {
                owner: req.owner.clone(),
                amount: req.amount,
                success: false,
            });
            continue;
        }

        let current = get_balance(env, &req.owner);

        // Insufficient balance — record failure without touching state.
        if current < req.amount {
            outcomes.push_back(WithdrawalOutcome {
                owner: req.owner.clone(),
                amount: req.amount,
                success: false,
            });
            continue;
        }

        // Debit vault balance.
        set_balance(env, &req.owner, current - req.amount);

        // Emit withdrawal event for indexer.
        env.events().publish(
            (soroban_sdk::symbol_short!("withdraw"), req.owner.clone()),
            (req.recipient.clone(), req.amount),
        );

        outcomes.push_back(WithdrawalOutcome {
            owner: req.owner.clone(),
            amount: req.amount,
            success: true,
        });
    }

    outcomes
}
