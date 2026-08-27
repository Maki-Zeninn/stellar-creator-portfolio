import { describe, expect, it } from 'vitest';
import { slugify } from '@/lib/utils';

describe('slugify', () => {
  it('lowercases and hyphenates a simple phrase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('My File (v1).png')).toBe('my-file-v1-.png');
  });

  it('collapses consecutive non-alphanumeric chars into a single hyphen', () => {
    expect(slugify('foo   ---   bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  hello  ')).toBe('hello');
    expect(slugify('!hello!')).toBe('hello');
  });

  it('preserves dots in filenames', () => {
    expect(slugify('image.png')).toBe('image.png');
  });

  it('handles numeric-only input', () => {
    expect(slugify('12345')).toBe('12345');
  });

  // Edge cases
  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(slugify('   ')).toBe('');
  });

  it('handles a very large input string without throwing', () => {
    const bigInput = 'a'.repeat(100_000);
    expect(slugify(bigInput)).toBe('a'.repeat(100_000));
  });

  it('handles unexpected non-string input gracefully', () => {
    // @ts-expect-error — intentionally passing wrong type to verify runtime guard
    expect(slugify(null)).toBe('');
    // @ts-expect-error
    expect(slugify(undefined)).toBe('');
    // @ts-expect-error
    expect(slugify(42)).toBe('');
  });
});
