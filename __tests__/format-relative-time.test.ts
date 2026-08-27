import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatRelativeTime } from '@/lib/utils';

const FIXED_NOW = new Date('2025-09-01T12:00:00Z');

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Happy-path cases ──────────────────────────────────────────────────────

  it('returns "just now" for a timestamp less than 60 seconds ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 30_000); // 30 s ago
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('returns "1m ago" for exactly 60 seconds ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 60_000);
    expect(formatRelativeTime(date)).toBe('1m ago');
  });

  it('returns minutes for timestamps between 1 and 59 minutes ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 5 * 60_000); // 5 min ago
    expect(formatRelativeTime(date)).toBe('5m ago');
  });

  it('returns hours for timestamps between 1 and 23 hours ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 3 * 3_600_000); // 3 h ago
    expect(formatRelativeTime(date)).toBe('3h ago');
  });

  it('returns "1h ago" for exactly 60 minutes ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 60 * 60_000);
    expect(formatRelativeTime(date)).toBe('1h ago');
  });

  it('returns days for timestamps between 1 and 6 days ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 2 * 86_400_000); // 2 days ago
    expect(formatRelativeTime(date)).toBe('2d ago');
  });

  it('returns a locale date string for timestamps 7 or more days ago', () => {
    const date = new Date(FIXED_NOW.getTime() - 10 * 86_400_000); // 10 days ago
    const result = formatRelativeTime(date);
    // Should NOT be a relative label — falls back to toLocaleDateString()
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toBe('just now');
    expect(result.length).toBeGreaterThan(0);
  });

  // ── Accepts string input ──────────────────────────────────────────────────

  it('accepts an ISO date string as input', () => {
    const isoString = new Date(FIXED_NOW.getTime() - 10 * 60_000).toISOString();
    expect(formatRelativeTime(isoString)).toBe('10m ago');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('returns "just now" for the exact current timestamp (0 ms diff)', () => {
    expect(formatRelativeTime(FIXED_NOW)).toBe('just now');
  });

  it('handles exactly 59 seconds ago as "just now"', () => {
    const date = new Date(FIXED_NOW.getTime() - 59_000);
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('handles exactly 23 hours 59 minutes ago as hours', () => {
    const date = new Date(FIXED_NOW.getTime() - (23 * 60 + 59) * 60_000);
    expect(formatRelativeTime(date)).toBe('23h ago');
  });

  it('handles exactly 24 hours ago as "1d ago"', () => {
    const date = new Date(FIXED_NOW.getTime() - 24 * 3_600_000);
    expect(formatRelativeTime(date)).toBe('1d ago');
  });

  it('handles a very large diff (years in the past) without throwing', () => {
    const date = new Date('2000-01-01T00:00:00Z');
    expect(() => formatRelativeTime(date)).not.toThrow();
    const result = formatRelativeTime(date);
    expect(result.length).toBeGreaterThan(0);
  });
});
