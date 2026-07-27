/// Hard ceiling for governance-settable platform fees: 10% (1000 bps).
/// A fee of 10_000 bps would equal 100% of the transacted amount, which is
/// economically nonsensical and effectively a rug. Capping at 1_000 bps
/// keeps the maximum take at a reasonable 10%.
pub const MAX_FEE_BPS: u32 = 1_000;

pub fn assert_valid_fee_bps(fee_bps: u32) {
    assert!(
        fee_bps <= MAX_FEE_BPS,
        "Fee exceeds maximum of 1000 basis points (10%)"
    );
}

pub fn compute_fee(amount: i128, fee_bps: u32) -> i128 {
    assert_valid_fee_bps(fee_bps);
    amount * (fee_bps as i128) / 10_000
}

pub fn compute_net(amount: i128, fee_bps: u32) -> i128 {
    amount - compute_fee(amount, fee_bps)
}
