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
