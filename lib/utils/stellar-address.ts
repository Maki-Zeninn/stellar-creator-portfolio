import { StrKey } from '@stellar/stellar-sdk';

/**
 * True for a syntactically valid Stellar Ed25519 public key (G..., 56 chars,
 * correct checksum) — format/checksum only, no on-chain existence check.
 */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim());
}
