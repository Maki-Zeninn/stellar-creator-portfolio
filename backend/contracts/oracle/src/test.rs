#![cfg(test)]

//! Access-control tests for the oracle price feed (issue #1111).
//!
//! The contract's purpose is to be a trustworthy price source for fiat-pegged
//! bounties. Before this fix `update_price` checked only that the caller had
//! signed for itself, never that it was the registered oracle — so these tests
//! are mostly about proving the door is now shut, from each direction it was
//! previously open.

use super::*;
use soroban_sdk::testutils::Address as _;

fn setup() -> (Env, OracleContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, OracleContract);
    let client = OracleContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    (env, client, admin, oracle)
}

fn price(env: &Env, micro_usd: i128) -> PriceData {
    PriceData {
        price_micro_usd: micro_usd,
        timestamp: env.ledger().timestamp(),
    }
}

// ── The hole itself ──────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Caller is not the registered oracle")]
fn arbitrary_address_cannot_push_a_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    // Before the fix this succeeded: require_auth() proved only that the
    // attacker controlled its own address, which it always does.
    let attacker = Address::generate(&env);
    client.update_price(&attacker, &price(&env, 999_999));
}

#[test]
#[should_panic(expected = "No oracle registered")]
fn price_cannot_be_set_before_an_oracle_is_registered() {
    let (env, client, admin, _oracle) = setup();
    client.initialize(&admin);

    // The worst case previously: with no LastPrice there is nothing to deviate
    // from, so the first writer could set *any* positive price, and every later
    // update would be anchored to it — the deviation guard would then protect
    // the attacker's number rather than the real one.
    let attacker = Address::generate(&env);
    client.update_price(&attacker, &price(&env, 1));
}

#[test]
fn registered_oracle_can_push_a_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    client.update_price(&oracle, &price(&env, 120_000));

    assert_eq!(client.get_price().price_micro_usd, 120_000);
}

#[test]
#[should_panic(expected = "Caller is not the registered oracle")]
fn previous_oracle_cannot_push_after_being_replaced() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 120_000));

    // Rotating the oracle must actually revoke the old one.
    let new_oracle = Address::generate(&env);
    client.set_oracle(&admin, &new_oracle);
    client.update_price(&oracle, &price(&env, 121_000));
}

// ── Admin gating ─────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Caller is not the admin")]
fn non_admin_cannot_register_an_oracle() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);

    // Previously set_oracle's `admin` parameter was self-asserted — the caller
    // passed whichever address it controlled and require_auth() was satisfied.
    let impostor = Address::generate(&env);
    client.set_oracle(&impostor, &oracle);
}

#[test]
#[should_panic(expected = "Contract not initialized")]
fn set_oracle_fails_before_initialize() {
    let (_env, client, admin, oracle) = setup();

    // An uninitialized contract must be closed, not open — an absent admin is
    // not "anyone may proceed".
    client.set_oracle(&admin, &oracle);
}

#[test]
#[should_panic(expected = "Contract already initialized")]
fn initialize_is_once_only() {
    let (env, client, admin, _oracle) = setup();
    client.initialize(&admin);

    // Otherwise anyone could re-initialize and take over as admin.
    client.initialize(&Address::generate(&env));
}

#[test]
fn admin_can_rotate_the_oracle() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    let new_oracle = Address::generate(&env);
    client.set_oracle(&admin, &new_oracle);

    assert_eq!(client.get_oracle(), Some(new_oracle.clone()));
    client.update_price(&new_oracle, &price(&env, 120_000));
    assert_eq!(client.get_price().price_micro_usd, 120_000);
}

// ── Existing guards still apply to the registered oracle ─────────────────────

#[test]
#[should_panic(expected = "Price must be positive")]
fn registered_oracle_still_cannot_push_a_non_positive_price() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);

    client.update_price(&oracle, &price(&env, 0));
}

#[test]
#[should_panic(expected = "Price deviation exceeds allowed threshold")]
fn registered_oracle_still_cannot_exceed_the_deviation_bound() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));

    // +50%, well beyond MAX_PRICE_DEVIATION_BPS (10%). Authentication must not
    // become a bypass for the sanity checks.
    client.update_price(&oracle, &price(&env, 150_000));
}

#[test]
fn deviation_within_bound_is_accepted() {
    let (env, client, admin, oracle) = setup();
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle);
    client.update_price(&oracle, &price(&env, 100_000));

    // +5%, inside the bound.
    client.update_price(&oracle, &price(&env, 105_000));
    assert_eq!(client.get_price().price_micro_usd, 105_000);
}
