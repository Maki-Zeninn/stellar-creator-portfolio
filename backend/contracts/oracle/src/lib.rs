#![no_std]

//! Decentralized Oracle integration for fiat-pegged bounties (#634).
//!
//! Provides:
//! - A standardised `PriceFeed` trait consumed by the bounty contract.
//! - An `OracleClient` that reads price data from a registered oracle contract.
//! - Fallback logic when the oracle reports anomalous (stale or out-of-band) prices.
//! - Atomic valuation helpers used at exact execution time.

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol,
};

#[cfg(test)]
mod test;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum age of a price feed entry before it is considered stale (5 minutes).
pub const MAX_PRICE_AGE_SECS: u64 = 300;

/// Allowed deviation from the last accepted price before triggering fallback (10 %).
pub const MAX_PRICE_DEVIATION_BPS: i128 = 1_000;

/// Fallback USD/XLM rate in micro-units (1 XLM = $0.12 → 120_000 micro-USD).
/// Used only when the oracle is unavailable or reports anomalous data.
pub const FALLBACK_PRICE_MICRO_USD: i128 = 120_000;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// A single price observation from the oracle network.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceData {
    /// Asset price in micro-USD (6 decimal places, e.g. 1 USD = 1_000_000).
    pub price_micro_usd: i128,
    /// Ledger timestamp when this price was recorded.
    pub timestamp: u64,
    /// Number of oracle sources that agreed on this price.
    pub sources: u32,
}

/// Result of an atomic valuation at execution time.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ValuationResult {
    /// USD amount requested (micro-USD).
    pub usd_amount_micro: i128,
    /// Equivalent token amount at the locked-in price.
    pub token_amount: i128,
    /// Price used for the conversion (micro-USD per token).
    pub price_used: i128,
    /// Whether the fallback price was used instead of the live oracle price.
    pub used_fallback: bool,
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
enum DataKey {
    /// Contract administrator, set once by `initialize`.
    Admin,
    /// Address of the registered oracle contract.
    OracleAddress,
    /// Last accepted price snapshot.
    LastPrice,
}

// ---------------------------------------------------------------------------
// Oracle contract
// ---------------------------------------------------------------------------

#[contract]
pub struct OracleContract;

#[contractimpl]
impl OracleContract {
    // ── Admin ────────────────────────────────────────────────────────────────

    /// Set the contract administrator. Callable once.
    ///
    /// Without this, `set_oracle`'s `admin` parameter was self-asserted: the
    /// caller passed whichever address they controlled, `require_auth()`
    /// confirmed only that they controlled *that* address, and nothing tied it
    /// to any privileged role. Anyone could re-point the oracle.
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().persistent().has(&DataKey::Admin),
            "Contract already initialized"
        );
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    /// Register the address of the upstream oracle contract. Admin-only.
    pub fn set_oracle(env: Env, admin: Address, oracle: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::OracleAddress, &oracle);

        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "oracle_set")),
            oracle,
        );
    }

    /// Return the registered oracle address, if one has been set.
    pub fn get_oracle(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::OracleAddress)
    }

    /// Return the administrator, if the contract has been initialized.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Admin)
    }

    // ── Price feed ───────────────────────────────────────────────────────────

    /// Push a new price observation. Callable only by the registered oracle.
    pub fn update_price(env: Env, caller: Address, price_data: PriceData) {
        caller.require_auth();

        // The check this contract is named for, and previously did not perform.
        //
        // `require_auth()` alone proves only that `caller` authorised the call —
        // it says nothing about *who* `caller` is. Any address could satisfy it
        // with its own signature and write the authoritative price.
        //
        // Rejecting when no oracle is registered matters as much as the
        // comparison: with an empty LastPrice there is nothing to deviate from,
        // so the first writer could set any positive price at all, and every
        // subsequent update would then be anchored to that value.
        let registered: Address = env
            .storage()
            .persistent()
            .get(&DataKey::OracleAddress)
            .expect("No oracle registered; call set_oracle first");
        assert!(caller == registered, "Caller is not the registered oracle");

        // Reject obviously anomalous prices (zero or negative).
        assert!(price_data.price_micro_usd > 0, "Price must be positive");

        // Check deviation against last accepted price.
        if let Some(last) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::LastPrice)
        {
            let deviation = deviation_bps(last.price_micro_usd, price_data.price_micro_usd);
            assert!(
                deviation <= MAX_PRICE_DEVIATION_BPS,
                "Price deviation exceeds allowed threshold"
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::LastPrice, &price_data);

        env.events().publish(
            (Symbol::new(&env, "oracle"), Symbol::new(&env, "price_updated")),
            (price_data.price_micro_usd, price_data.timestamp),
        );
    }

    /// Return the current price, falling back to the hardcoded rate if the
    /// oracle data is stale or unavailable.
    pub fn get_price(env: Env) -> PriceData {
        let now = env.ledger().timestamp();

        if let Some(data) = env
            .storage()
            .persistent()
            .get::<DataKey, PriceData>(&DataKey::LastPrice)
        {
            if now.saturating_sub(data.timestamp) <= MAX_PRICE_AGE_SECS {
                return data;
            }
        }

        // Fallback: return the hardcoded conservative price.
        PriceData {
            price_micro_usd: FALLBACK_PRICE_MICRO_USD,
            timestamp: now,
            sources: 0,
        }
    }

    // ── Atomic valuation ─────────────────────────────────────────────────────

    /// Convert a USD-denominated bounty amount to tokens at the current oracle
    /// price, atomically at the moment of execution.
    ///
    /// `usd_amount_micro` – the bounty value in micro-USD (e.g. $100 = 100_000_000).
    pub fn value_in_tokens(env: Env, usd_amount_micro: i128) -> ValuationResult {
        assert!(usd_amount_micro > 0, "Amount must be positive");

        let price_data = Self::get_price(env.clone());
        let used_fallback = price_data.sources == 0;

        // token_amount = usd_amount_micro / price_micro_usd
        // Both values are in micro-units so the result is in whole tokens.
        let token_amount = usd_amount_micro
            .checked_div(price_data.price_micro_usd)
            .expect("Division by zero in price conversion");

        ValuationResult {
            usd_amount_micro,
            token_amount,
            price_used: price_data.price_micro_usd,
            used_fallback,
        }
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /// Assert that `caller` is the stored administrator.
    ///
    /// Panics when the contract has not been initialized, rather than treating
    /// an absent admin as "anyone may proceed" — an uninitialized contract must
    /// be closed, not open.
    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized; call initialize first");
        assert!(*caller == admin, "Caller is not the admin");
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the absolute deviation between two prices in basis points.
fn deviation_bps(old: i128, new: i128) -> i128 {
    if old == 0 {
        return 0;
    }
    let diff = if new > old { new - old } else { old - new };
    diff * 10_000 / old
}
