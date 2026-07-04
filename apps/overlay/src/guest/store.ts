/**
 * Guest reviewer identity (R5, R24 guest identity).
 *
 * The display name is cosmetic (trust level is decided server-side) but is
 * required before a comment can submit. We persist it per-preview in
 * localStorage so a returning reviewer is not asked twice, and surface a
 * "Reviewing as <name> — change" chip so they can correct it.
 */
import type { NameStorage } from "../core/types.js";

const KEY_PREFIX = "supercomment:guest-name:";

/** A no-op storage used when none is available (e.g. privacy mode). */
const memoryStorage = (): NameStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
};

export class GuestNameStore {
  private readonly storage: NameStorage;
  private readonly key: string;

  constructor(previewKey: string, storage?: NameStorage) {
    this.key = `${KEY_PREFIX}${previewKey}`;
    this.storage = storage ?? resolveStorage();
  }

  /** The stored name, or null if the reviewer hasn't identified themselves. */
  get(): string | null {
    const raw = safeGet(this.storage, this.key);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  }

  /** True once a non-empty name is stored (gates submission). */
  has(): boolean {
    return this.get() !== null;
  }

  /**
   * Persist a name. Returns the cleaned value, or null if the input was empty
   * (an empty name is never stored — submission stays blocked).
   */
  set(name: string): string | null {
    const cleaned = name.trim();
    if (!cleaned) return null;
    safeSet(this.storage, this.key, cleaned);
    return cleaned;
  }
}

const EMAIL_KEY_PREFIX = "supercomment:guest-email:";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lowercase + trim an email; null if it is not a plausible address. Mirrors the
 * server-side normalize_email (0036) so the client and server agree on the key. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().toLowerCase();
  return EMAIL_RE.test(t) ? t : null;
}

/**
 * Guest reviewer email (0036 / U11). Unverified, captured once before the first
 * comment so per-viewer unread + "pages I commented on" have a durable key.
 * Persisted per-preview in localStorage so a returning reviewer is not asked twice.
 */
export class GuestEmailStore {
  private readonly storage: NameStorage;
  private readonly key: string;

  constructor(previewKey: string, storage?: NameStorage) {
    this.key = `${EMAIL_KEY_PREFIX}${previewKey}`;
    this.storage = storage ?? resolveStorage();
  }

  /** The stored normalized email, or null if none/invalid. */
  get(): string | null {
    return normalizeEmail(safeGet(this.storage, this.key));
  }

  /** True once a valid email is stored (gates the first guest submit). */
  has(): boolean {
    return this.get() !== null;
  }

  /** Persist a normalized email; returns it, or null when the input is invalid. */
  set(email: string): string | null {
    const n = normalizeEmail(email);
    if (!n) return null;
    safeSet(this.storage, this.key, n);
    return n;
  }
}

function resolveStorage(): NameStorage {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // Access can throw under strict privacy settings; fall back to memory.
  }
  return memoryStorage();
}

function safeGet(storage: NameStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: NameStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore quota / privacy errors — name simply won't persist this session.
  }
}
