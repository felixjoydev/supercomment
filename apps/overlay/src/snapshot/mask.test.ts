import { describe, it, expect } from 'vitest';
import {
  redactSecrets,
  containsSecret,
  maskFieldAttributes,
  MASKED_VALUE,
  REDACTION_PLACEHOLDER,
  SECRET_PATTERNS,
} from './mask';

describe('redactSecrets', () => {
  it('redacts a Bearer token in text', () => {
    const out = redactSecrets('Authorization: Bearer abc123DEF456ghi789');
    expect(out).toContain(REDACTION_PLACEHOLDER);
    expect(out).not.toContain('abc123DEF456ghi789');
  });

  it('redacts a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactSecrets(`token is ${jwt} end`);
    expect(out).toBe(`token is ${REDACTION_PLACEHOLDER} end`);
  });

  it('redacts an OpenAI sk- key and a GitHub token', () => {
    const out = redactSecrets('sk-abcdefghijklmnopqrstuvwx ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(out).not.toContain('ghp_');
  });

  it('redacts an AWS access key id', () => {
    const out = redactSecrets('key=AKIAIOSFODNN7EXAMPLE done');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts a long hex blob', () => {
    const out = redactSecrets('hash 0123456789abcdef0123456789abcdef value');
    expect(out).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('preserves ordinary visible text', () => {
    const text = 'Welcome back, please review the dashboard for new comments.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('does not mangle short words that merely look hexy', () => {
    const text = 'The cafe served decaf at 9am.';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('containsSecret', () => {
  it('detects a secret-shaped string', () => {
    expect(containsSecret('Bearer abc123DEF456ghi789')).toBe(true);
  });
  it('returns false for plain prose', () => {
    expect(containsSecret('hello world')).toBe(false);
  });
});

describe('maskFieldAttributes', () => {
  it('masks a password input value', () => {
    const out = maskFieldAttributes({
      tag: 'input',
      attributes: { type: 'password', value: 'hunter2' },
    });
    expect(out.value).toBe(MASKED_VALUE);
    expect(out.value).not.toContain('hunter2');
  });

  it('masks a text input value too (may contain PII)', () => {
    const out = maskFieldAttributes({
      tag: 'input',
      attributes: { type: 'text', value: 'jane.doe@example.com' },
    });
    expect(out.value).toBe(MASKED_VALUE);
  });

  it('masks a textarea value', () => {
    const out = maskFieldAttributes({
      tag: 'textarea',
      attributes: { value: 'private notes' },
    });
    expect(out.value).toBe(MASKED_VALUE);
  });

  it('leaves non-value-bearing elements untouched', () => {
    const attrs = { class: 'btn', 'data-id': '7' };
    expect(maskFieldAttributes({ tag: 'div', attributes: attrs })).toEqual(attrs);
  });

  it('keeps placeholder text (not user data)', () => {
    const out = maskFieldAttributes({
      tag: 'input',
      attributes: { type: 'text', placeholder: 'Enter your name' },
    });
    expect(out.placeholder).toBe('Enter your name');
  });
});

describe('SECRET_PATTERNS', () => {
  it('is exported as a reusable list (for U13 consolidation)', () => {
    expect(Array.isArray(SECRET_PATTERNS)).toBe(true);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SECRET_PATTERNS) {
      expect(typeof p.name).toBe('string');
      expect(p.regex).toBeInstanceOf(RegExp);
    }
  });
});
