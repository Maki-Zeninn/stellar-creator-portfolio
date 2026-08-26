#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// Simple constant product AMM (x * y = k)

#[contracttype]
pub enum StorageKey {
    Reserves(Symbol),
    TotalLp,
    LpBalance(Address),
}

/// Permanently-locked LP amount minted on the first deposit (Uniswap V2's
/// approach). It's included in `TotalLp` but never credited to any
/// `LpBalance`, so it can never be withdrawn — this guarantees the pool can
/// never be fully drained back to `total_lp == 0` / `reserves == 0`, which
/// would otherwise let anyone re-trigger the first-deposit pricing branch.
const MINIMUM_LIQUIDITY: i128 = 1000;

/// Integer square root (Babylonian method). Used so first-deposit LP minting
/// follows the standard `sqrt(x * y)` invariant instead of a naive average,
/// which has no relationship to the deposited value ratio and lets a lopsided
/// first deposit set an arbitrary implied price.
fn isqrt(y: i128) -> i128 {
    if y < 2 {
        return y;
    }
    let mut x = y;
    let mut z = (y + 1) / 2;
    while z < x {
        x = z;
        z = (y / z + x) / 2;
    }
    x
}

#[contract]
pub struct AmmContract;

#[contractimpl]
impl AmmContract {
    pub fn init(_env: Env) {}

    pub fn add_liquidity(env: Env, user: Address, amount_x: i128, amount_y: i128) -> i128 {
        user.require_auth();
        assert!(amount_x > 0 && amount_y > 0, "invalid amounts");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");

        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);
        let total_lp: i128 = env.storage().instance().get(&StorageKey::TotalLp).unwrap_or(0);

        let is_first_deposit = total_lp == 0 || reserves_x == 0 || reserves_y == 0;

        let (lp_minted, total_lp_increase): (i128, i128) = if is_first_deposit {
            let liquidity = isqrt(amount_x * amount_y);
            assert!(liquidity > MINIMUM_LIQUIDITY, "insufficient initial liquidity");
            (liquidity - MINIMUM_LIQUIDITY, liquidity)
        } else {
            let share_x = amount_x * total_lp / reserves_x;
            let share_y = amount_y * total_lp / reserves_y;
            let minted = core::cmp::min(share_x, share_y);
            (minted, minted)
        };

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x + amount_x));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y + amount_y));
        env.storage().instance().set(&StorageKey::TotalLp, &(total_lp + total_lp_increase));

        let prev_lp: i128 = env.storage().instance().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        env.storage().instance().set(&StorageKey::LpBalance(user), &(prev_lp + lp_minted));

        lp_minted
    }

    pub fn remove_liquidity(env: Env, user: Address, lp_amount: i128) -> (i128, i128) {
        user.require_auth();
        assert!(lp_amount > 0, "invalid lp amount");

        let total_lp: i128 = env.storage().instance().get(&StorageKey::TotalLp).unwrap_or(0);
        assert!(total_lp > 0, "no liquidity");

        let user_lp: i128 = env.storage().instance().get(&StorageKey::LpBalance(user.clone())).unwrap_or(0);
        assert!(user_lp >= lp_amount, "not enough lp");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");
        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);

        let amount_x = reserves_x * lp_amount / total_lp;
        let amount_y = reserves_y * lp_amount / total_lp;

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x - amount_x));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y - amount_y));
        env.storage().instance().set(&StorageKey::TotalLp, &(total_lp - lp_amount));
        env.storage().instance().set(&StorageKey::LpBalance(user), &(user_lp - lp_amount));

        (amount_x, amount_y)
    }

    pub fn swap_x_for_y(env: Env, user: Address, dx: i128, min_dy: i128) -> i128 {
        user.require_auth();
        assert!(dx > 0, "invalid amount");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");
        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);
        assert!(reserves_x > 0 && reserves_y > 0, "empty pool");

        let dx_with_fee = dx * 997;
        let dy = dx_with_fee * reserves_y / (reserves_x * 1000 + dx_with_fee);
        assert!(dy >= min_dy && dy > 0, "slippage or zero output");

        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x + dx));
        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y - dy));

        dy
    }

    /// Swap token Y for token X using the constant-product formula (x * y = k).
    ///
    /// Mirrors `swap_x_for_y` in the opposite direction. The same 0.3% fee
    /// is applied to the input amount before computing the output.
    ///
    /// # Arguments
    /// * `dy`     – amount of token Y being sold into the pool.
    /// * `min_dx` – minimum amount of token X the caller will accept
    ///              (slippage guard; panics if output falls below this).
    ///
    /// Returns the amount of token X sent to the caller.
    pub fn swap_y_for_x(env: Env, user: Address, dy: i128, min_dx: i128) -> i128 {
        user.require_auth();
        assert!(dy > 0, "invalid amount");

        let key_x = symbol_short!("x");
        let key_y = symbol_short!("y");
        let reserves_x: i128 = env.storage().instance().get(&StorageKey::Reserves(key_x.clone())).unwrap_or(0);
        let reserves_y: i128 = env.storage().instance().get(&StorageKey::Reserves(key_y.clone())).unwrap_or(0);
        assert!(reserves_x > 0 && reserves_y > 0, "empty pool");

        // Apply the 0.3% fee to the Y input before computing output X.
        let dy_with_fee = dy * 997;
        let dx = dy_with_fee * reserves_x / (reserves_y * 1000 + dy_with_fee);
        assert!(dx >= min_dx && dx > 0, "slippage or zero output");

        env.storage().instance().set(&StorageKey::Reserves(key_y), &(reserves_y + dy));
        env.storage().instance().set(&StorageKey::Reserves(key_x), &(reserves_x - dx));

        dx
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn basic_add_and_swap() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        // Amounts must comfortably clear MINIMUM_LIQUIDITY (1000) now that
        // the first deposit is priced via sqrt(x*y) with a locked floor.
        let user = Address::generate(&env);
        let lp = client.add_liquidity(&user, &100_000i128, &100_000i128);
        assert!(lp > 0);

        let dy = client.swap_x_for_y(&user, &10i128, &0i128);
        assert!(dy > 0);
    }

    #[test]
    #[should_panic(expected = "insufficient initial liquidity")]
    fn lopsided_first_deposit_cannot_mint_disproportionate_lp_share() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let attacker = Address::generate(&env);
        // Extremely lopsided first deposit: 1 unit of X against 1_000_000 of Y.
        // Under the old `(amount_x + amount_y) / 2` formula this minted
        // ~500_000 LP to the attacker for essentially no real X-side value,
        // setting an arbitrary implied price for the pool. Under sqrt(x*y) =
        // sqrt(1_000_000) = 1_000, which does not clear the locked
        // MINIMUM_LIQUIDITY floor, so the deposit is rejected outright
        // instead of minting a disproportionate LP share.
        client.add_liquidity(&attacker, &1i128, &1_000_000i128);
    }

    #[test]
    fn first_deposit_mints_sqrt_of_product_minus_minimum_liquidity() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let lp = client.add_liquidity(&user, &10_000i128, &10_000i128);

        // sqrt(10_000 * 10_000) = 10_000, minus the 1_000 locked MINIMUM_LIQUIDITY.
        assert_eq!(lp, 9_000);
    }

    #[test]
    fn pool_can_never_be_fully_drained_back_to_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        let lp = client.add_liquidity(&user, &10_000i128, &10_000i128);

        // Withdraw every LP token the user actually owns.
        let (out_x, out_y) = client.remove_liquidity(&user, &lp);
        assert!(out_x > 0 && out_y > 0);

        // The locked MINIMUM_LIQUIDITY portion was never credited to `user`,
        // so total_lp can never return to zero even after every real
        // depositor fully withdraws -- the first-deposit branch can't be
        // re-triggered by draining the pool.
        let total_lp_after: i128 = env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .get(&StorageKey::TotalLp)
                .unwrap_or(0)
        });
        assert_eq!(total_lp_after, MINIMUM_LIQUIDITY);
    }

    #[test]
    fn swap_y_for_x_works_and_is_symmetric_to_x_for_y() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.add_liquidity(&user, &100_000i128, &100_000i128);

        // Sell Y into the pool, receive X back.
        let dx = client.swap_y_for_x(&user, &1_000i128, &0i128);
        assert!(dx > 0, "swap_y_for_x must return a positive amount of X");
    }

    // ── Happy path: the full add → swap → remove lifecycle (#1247) ──────────

    /// Register the contract and return a client plus a funded first depositor.
    fn setup(env: &Env) -> (AmmContractClient<'_>, Address, Address) {
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(env, &contract_id);
        (client, contract_id, Address::generate(env))
    }

    /// Read the pool's reserves straight out of contract storage.
    fn reserves(env: &Env, contract_id: &Address) -> (i128, i128) {
        env.as_contract(contract_id, || {
            let x = env
                .storage()
                .instance()
                .get(&StorageKey::Reserves(symbol_short!("x")))
                .unwrap_or(0);
            let y = env
                .storage()
                .instance()
                .get(&StorageKey::Reserves(symbol_short!("y")))
                .unwrap_or(0);
            (x, y)
        })
    }

    #[test]
    fn happy_path_add_swap_remove_round_trip() {
        let env = Env::default();
        let (client, contract_id, user) = setup(&env);

        // 1. Seed the pool.
        let lp = client.add_liquidity(&user, &100_000i128, &100_000i128);
        // sqrt(100_000 * 100_000) = 100_000, less the locked MINIMUM_LIQUIDITY.
        assert_eq!(lp, 100_000 - MINIMUM_LIQUIDITY);
        assert_eq!(reserves(&env, &contract_id), (100_000, 100_000));

        // 2. Trade against it. 1_000 X in, 0.3% fee, constant product:
        //    dy = (1000 * 997 * 100_000) / (100_000 * 1000 + 1000 * 997)
        let dy = client.swap_x_for_y(&user, &1_000i128, &0i128);
        let expected_dy = (1_000i128 * 997 * 100_000) / (100_000 * 1000 + 1_000 * 997);
        assert_eq!(dy, expected_dy);

        let (rx, ry) = reserves(&env, &contract_id);
        assert_eq!(rx, 100_000 + 1_000);
        assert_eq!(ry, 100_000 - dy);

        // 3. The fee stays in the pool, so k must not shrink across the trade.
        assert!(
            rx * ry >= 100_000i128 * 100_000i128,
            "constant product must not decrease: k={} start={}",
            rx * ry,
            100_000i128 * 100_000i128
        );

        // 4. Withdraw everything the depositor owns.
        let (out_x, out_y) = client.remove_liquidity(&user, &lp);
        assert!(out_x > 0 && out_y > 0);

        // The trade left the pool longer on X and shorter on Y, and the
        // withdrawal reflects that rather than returning the original split.
        assert!(
            out_x > out_y,
            "after selling X into the pool the LP should redeem more X than Y: x={out_x} y={out_y}"
        );

        // 5. Only the locked minimum remains — the pool is never fully drained.
        let total_lp_after: i128 = env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .get(&StorageKey::TotalLp)
                .unwrap_or(0)
        });
        assert_eq!(total_lp_after, MINIMUM_LIQUIDITY);
    }

    #[test]
    fn second_depositor_receives_a_proportional_share() {
        let env = Env::default();
        let (client, _contract_id, first) = setup(&env);
        let second = Address::generate(&env);

        client.add_liquidity(&first, &100_000i128, &100_000i128);

        // Matching the existing ratio at half the size mints half the LP of a
        // full-size deposit — the pool prices the second deposit off reserves,
        // not off sqrt(x*y), so MINIMUM_LIQUIDITY is not deducted again.
        let minted = client.add_liquidity(&second, &50_000i128, &50_000i128);
        assert_eq!(minted, 50_000);
    }

    #[test]
    fn lopsided_later_deposit_is_priced_off_the_scarcer_side() {
        let env = Env::default();
        let (client, _contract_id, first) = setup(&env);
        let second = Address::generate(&env);

        client.add_liquidity(&first, &100_000i128, &100_000i128);

        // 10_000 X against 50_000 Y: LP is min(share_x, share_y), so the
        // surplus Y earns nothing and the depositor is credited for the X.
        let minted = client.add_liquidity(&second, &10_000i128, &50_000i128);
        assert_eq!(minted, 10_000);
    }

    // ── Edge cases ──────────────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "invalid amounts")]
    fn add_liquidity_rejects_a_zero_amount() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.add_liquidity(&user, &0i128, &100_000i128);
    }

    #[test]
    #[should_panic(expected = "invalid amounts")]
    fn add_liquidity_rejects_a_negative_amount() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.add_liquidity(&user, &100_000i128, &-1i128);
    }

    #[test]
    #[should_panic(expected = "empty pool")]
    fn swap_against_an_empty_pool_is_rejected() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        // No liquidity has ever been added.
        client.swap_x_for_y(&user, &1_000i128, &0i128);
    }

    #[test]
    #[should_panic(expected = "invalid amount")]
    fn swap_rejects_a_zero_input() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.add_liquidity(&user, &100_000i128, &100_000i128);
        client.swap_x_for_y(&user, &0i128, &0i128);
    }

    #[test]
    #[should_panic(expected = "slippage or zero output")]
    fn swap_x_for_y_respects_min_dy_slippage_guard() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.add_liquidity(&user, &100_000i128, &100_000i128);
        client.swap_x_for_y(&user, &1_000i128, &i128::MAX);
    }

    #[test]
    #[should_panic(expected = "slippage or zero output")]
    fn a_dust_trade_that_rounds_to_zero_output_is_rejected() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);

        // A pool that is deep in X and shallow in Y: 1 unit of X buys less
        // than one whole unit of Y, so integer division floors dy to 0 and
        // the trade must be refused rather than taking the input for nothing.
        client.add_liquidity(&user, &1_000_000i128, &1_001i128);
        client.swap_x_for_y(&user, &1i128, &0i128);
    }

    #[test]
    #[should_panic(expected = "not enough lp")]
    fn cannot_withdraw_more_lp_than_owned() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        let lp = client.add_liquidity(&user, &100_000i128, &100_000i128);
        client.remove_liquidity(&user, &(lp + 1));
    }

    #[test]
    #[should_panic(expected = "no liquidity")]
    fn cannot_withdraw_from_an_empty_pool() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.remove_liquidity(&user, &1i128);
    }

    #[test]
    #[should_panic(expected = "invalid lp amount")]
    fn remove_liquidity_rejects_a_zero_amount() {
        let env = Env::default();
        let (client, _contract_id, user) = setup(&env);
        client.add_liquidity(&user, &100_000i128, &100_000i128);
        client.remove_liquidity(&user, &0i128);
    }

    #[test]
    fn one_lp_cannot_withdraw_against_anothers_balance() {
        let env = Env::default();
        let (client, _contract_id, depositor) = setup(&env);
        let stranger = Address::generate(&env);

        client.add_liquidity(&depositor, &100_000i128, &100_000i128);

        // The stranger holds no LP, so any withdrawal must fail even though
        // the pool itself is well funded.
        let result = client.try_remove_liquidity(&stranger, &1i128);
        assert!(result.is_err(), "a non-LP must not be able to withdraw");
    }

    #[test]
    #[should_panic(expected = "slippage or zero output")]
    fn swap_y_for_x_respects_min_dx_slippage_guard() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, AmmContract);
        let client = AmmContractClient::new(&env, &contract_id);

        let user = Address::generate(&env);
        client.add_liquidity(&user, &100_000i128, &100_000i128);

        // min_dx set impossibly high — must panic.
        client.swap_y_for_x(&user, &1_000i128, &i128::MAX);
    }
}
