import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGatewayUrl,
  fetchViaGateways,
  verifyContentHash,
  IPFS_GATEWAYS,
} from '@/lib/ipfs/gateways';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake ArrayBuffer whose SHA-256 we can pre-compute in tests. */
function makeBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer;
}

async function sha256Hex(content: string): Promise<string> {
  const buf = makeBuffer(content);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// buildGatewayUrl — pure URL construction, no I/O
// ---------------------------------------------------------------------------

describe('buildGatewayUrl', () => {
  it('returns the primary gateway URL for a valid CID', () => {
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const url = buildGatewayUrl(cid);
    expect(url).toContain(cid);
    expect(url.startsWith('https://')).toBe(true);
  });

  it('always appends the CID after a trailing slash', () => {
    const cid = 'testcid123';
    const url = buildGatewayUrl(cid, 0);
    // The URL must end with the CID, not contain a double-slash before it
    expect(url.endsWith(cid)).toBe(true);
    expect(url).not.toMatch(/\/\//);
  });

  it('selects alternate gateways by index', () => {
    const cid = 'testcid';
    const primary = buildGatewayUrl(cid, 0);
    const secondary = buildGatewayUrl(cid, 1);
    // Different gateways produce different base URLs
    expect(primary).not.toBe(secondary);
    expect(secondary).toContain(cid);
  });

  it('falls back to the primary gateway for an out-of-range index', () => {
    const cid = 'testcid';
    const fallback = buildGatewayUrl(cid, 9999);
    const primary = buildGatewayUrl(cid, 0);
    expect(fallback).toBe(primary);
  });

  it('handles an empty CID without throwing', () => {
    expect(() => buildGatewayUrl('')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// verifyContentHash — hash verification logic
// ---------------------------------------------------------------------------

describe('verifyContentHash', () => {
  it('returns true when the hash matches the content', async () => {
    const content = 'hello ipfs';
    const expected = await sha256Hex(content);
    const buf = makeBuffer(content);
    expect(await verifyContentHash(buf, expected)).toBe(true);
  });

  it('returns false when the hash does not match', async () => {
    const buf = makeBuffer('hello ipfs');
    expect(await verifyContentHash(buf, 'deadbeef')).toBe(false);
  });

  it('accepts a Blob as input', async () => {
    const content = 'blob content';
    const expected = await sha256Hex(content);
    const blob = new Blob([content], { type: 'text/plain' });
    expect(await verifyContentHash(blob, expected)).toBe(true);
  });

  it('is case-insensitive for the expected hex string', async () => {
    const content = 'case test';
    const expected = (await sha256Hex(content)).toUpperCase();
    const buf = makeBuffer(content);
    expect(await verifyContentHash(buf, expected)).toBe(true);
  });

  it('returns false for an empty expected hash', async () => {
    const buf = makeBuffer('some content');
    expect(await verifyContentHash(buf, '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchViaGateways — smoke test with fetch mock
// ---------------------------------------------------------------------------

describe('fetchViaGateways', () => {
  const cid = 'bafytestcid';
  const content = 'gateway content';
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('returns blob and gateway URL when the primary gateway responds 200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob([content]),
    } as unknown as Response);

    const result = await fetchViaGateways(cid);

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.gateway).toContain(cid);
    expect(result.verified).toBe(false); // no hash passed → unverified
  });

  it('falls back to the next gateway when the first returns a non-200 status', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 503 } as unknown as Response;
      return { ok: true, blob: async () => new Blob([content]) } as unknown as Response;
    });

    const result = await fetchViaGateways(cid);

    expect(callCount).toBe(2);
    expect(result.blob).toBeInstanceOf(Blob);
    // The URL should reference the second gateway (index 1)
    expect(result.gateway).toContain(IPFS_GATEWAYS[1].replace(/\/$/, ''));
  });

  it('throws when all gateways fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(fetchViaGateways(cid)).rejects.toThrow();
  });

  it('marks result as verified when a correct hash is provided', async () => {
    const expectedHash = await sha256Hex(content);

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob([content]),
    } as unknown as Response);

    const result = await fetchViaGateways(cid, expectedHash);

    expect(result.verified).toBe(true);
  });

  it('rejects with a hash-mismatch error when the retrieved content does not match the expected hash', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([content]),
    } as unknown as Response);

    // Providing a deliberately wrong hash should exhaust all gateways and throw
    await expect(fetchViaGateways(cid, 'incorrecthash')).rejects.toThrow();
  });
});
