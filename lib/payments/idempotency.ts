/**
 * Idempotency cache for the payments API.
 *
 * Uses Redis as the primary store so the dedup guarantee holds across multiple
 * instances and serverless cold-starts. Falls back to an in-process Map when
 * Redis is not configured (local dev / test), preserving the original
 * behaviour in those environments.
 *
 * The fallback is intentionally best-effort: it protects against duplicate
 * requests within the same process but not across horizontally-scaled replicas.
 * Set REDIS_URL in production to get the full cross-instance guarantee.
 */

import { redisGet, redisSet } from '@/lib/storage/redis';

const TTL_MS = 24 * 60 * 60 * 1000;     // 24 hours (in-memory fallback)
const TTL_REDIS_S = 24 * 60 * 60;       // 24 hours (Redis TTL, in seconds)

const REDIS_PREFIX = 'idempotency:payments:';

interface CachedResponse {
  status: number;
  body: unknown;
  createdAt: number;
}

// ── In-process fallback store ─────────────────────────────────────────────────

type Store = Map<string, CachedResponse>;

function getLocalStore(): Store {
  const g = globalThis as unknown as { __idempotencyStore?: Store };
  if (!g.__idempotencyStore) {
    g.__idempotencyStore = new Map();
  }
  return g.__idempotencyStore;
}

function pruneExpired(): void {
  const now = Date.now();
  const store = getLocalStore();
  for (const [key, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(key);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up a previously cached response for this idempotency key.
 * Checks Redis first; falls back to the in-process map if Redis is
 * unavailable (REDIS_URL not set or connection error).
 */
export async function getCachedResponse(
  key: string,
): Promise<{ status: number; body: unknown } | null> {
  // Try Redis first.
  const redisEntry = await redisGet<CachedResponse>(`${REDIS_PREFIX}${key}`);
  if (redisEntry) {
    return { status: redisEntry.status, body: redisEntry.body };
  }

  // Fallback: in-process map (single-instance / dev only).
  pruneExpired();
  const entry = getLocalStore().get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    getLocalStore().delete(key);
    return null;
  }
  return { status: entry.status, body: entry.body };
}

/**
 * Persist a response so that subsequent requests with the same key return it
 * without re-running the Stripe call. Writes to Redis when available; also
 * writes the in-process fallback for immediate consistency within this replica.
 */
export async function cacheResponse(
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  const entry: CachedResponse = { status, body, createdAt: Date.now() };

  // Persist to Redis (no-op if REDIS_URL is not set).
  await redisSet(`${REDIS_PREFIX}${key}`, entry, TTL_REDIS_S);

  // Also write the local fallback so same-instance retries are instant.
  getLocalStore().set(key, entry);
}

// ── Test helper ───────────────────────────────────────────────────────────────

export function __resetIdempotencyStoreForTests(): void {
  const g = globalThis as unknown as { __idempotencyStore?: Store };
  g.__idempotencyStore = new Map();
}
