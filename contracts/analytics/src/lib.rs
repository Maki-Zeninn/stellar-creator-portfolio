#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Env, String, Symbol};

const TTL_THRESHOLD: u32 = 100;
const TTL_TARGET: u32 = 518_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
}

#[contracttype]
pub struct AnalyticsEvent {
    pub event_id: u64,
    pub timestamp: u64,
    pub event_type: String,
}

#[contract]
pub struct AnalyticsContract;

#[contractimpl]
impl AnalyticsContract {
    pub fn record_event(env: Env, event_id: u64, event_type: String) -> bool {
        let key = (Symbol::new(&env, "event"), event_id);
        let event = AnalyticsEvent {
            event_id,
            timestamp: env.ledger().timestamp(),
            event_type,
        };
        env.storage().persistent().set(&key, &event);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_TARGET);
        true
    }

    pub fn get_event(env: Env, event_id: u64) -> Option<AnalyticsEvent> {
        let key = (Symbol::new(&env, "event"), event_id);
        let result = env.storage()
            .persistent()
            .get::<(Symbol, u64), AnalyticsEvent>(&key);
        if result.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_TARGET);
        }
        result
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Ledger;

    #[test]
    fn record_and_get_event_happy_path() {
        let env = Env::default();
        let contract_id = env.register(AnalyticsContract, ());
        let client = AnalyticsContractClient::new(&env, &contract_id);

        env.ledger().with_mut(|li| li.timestamp = 12345);

        let event_type = String::from_str(&env, "bounty_created");
        let recorded = client.record_event(&1, &event_type);
        assert!(recorded);

        let fetched = client.get_event(&1).unwrap();
        assert_eq!(fetched.event_id, 1);
        assert_eq!(fetched.timestamp, 12345);
        assert_eq!(fetched.event_type, event_type);
    }
}
