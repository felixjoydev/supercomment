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
