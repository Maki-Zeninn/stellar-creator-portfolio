import { describe, expect, it } from 'vitest';
import { getInitials } from '@/lib/utils';

describe('getInitials', () => {
  it('returns two uppercase initials for a full name', () => {
    expect(getInitials('Jane Doe')).toBe('JD');
  });

  it('returns a single initial for a single-word name', () => {
    expect(getInitials('Alice')).toBe('A');
  });

  it('uses only the first two words when given more than two', () => {
    expect(getInitials('John Michael Smith')).toBe('JM');
  });

  it('uppercases lowercase names', () => {
    expect(getInitials('john doe')).toBe('JD');
  });

  it('trims extra whitespace', () => {
    expect(getInitials('  Jane   Doe  ')).toBe('JD');
  });

  // Edge cases
  it('returns empty string for empty input', () => {
    expect(getInitials('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(getInitials('   ')).toBe('');
  });

  it('returns empty string for a very large name with no letters', () => {
    expect(getInitials('   '.repeat(100))).toBe('');
  });

  it('handles a very long single word gracefully', () => {
    const longName = 'A'.repeat(500);
    expect(getInitials(longName)).toBe('A');
  });

  it('handles unexpected non-string input gracefully', () => {
    // @ts-expect-error — intentionally passing wrong type to verify runtime guard
    expect(getInitials(null)).toBe('');
    // @ts-expect-error
    expect(getInitials(undefined)).toBe('');
    // @ts-expect-error
    expect(getInitials(42)).toBe('');
  });
});
