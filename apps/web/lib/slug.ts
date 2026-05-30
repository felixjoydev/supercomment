import { randomBytes } from 'node:crypto';

/**
 * Pure slug generation for previews. The slug is the stable, public,
 * non-secret path segment (…/s/<slug>) that survives tunnel churn. It is NOT a
 * secret — guest access still requires the link_secret (see lib/link.ts).
 *
 * Kept dependency-free for unit testing.
 */

/** Lowercase, URL-safe alphabet (no ambiguous chars like 0/o, 1/l/i). */
const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG_LENGTH = 12;

/** Generate a random, URL-safe, non-secret preview slug. */
export function generateSlug(length: number = SLUG_LENGTH): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SLUG_ALPHABET[bytes[i]! % SLUG_ALPHABET.length];
  }
  return out;
}

/** Normalize a user-typed name into a slug-prefix (cosmetic; not unique). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
