/**
 * Project binding — the CANONICAL local, developer-scoped link between this
 * machine's Claude Code session and a single SuperComment preview/project in
 * Supabase.
 *
 * This module is the single source of truth for the binding shape, its on-disk
 * location, and its read/write/clear lifecycle. U5 (the authenticated OUTBOUND
 * channel) WRITES this file at `supercomment start`; U12 (the MCP server) READS
 * it. `apps/cli/src/mcp/binding.ts` now re-exports from here so the two surfaces
 * cannot drift.
 *
 * Security (R25): the token here is loopback-local only. It is read from / written
 * to a file the developer owns (`~/.supercomment/binding.json`, written 0600) or
 * supplied via env. It is never transmitted anywhere except to Supabase over the
 * developer's own OUTBOUND connection. Never log the token. The backend never
 * connects inbound to the dev machine; this binding only authorizes the helper's
 * outbound Supabase client.
 */
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the binding lives by default. U5 writes this file. */
export const DEFAULT_BINDING_DIR = ".supercomment";
export const DEFAULT_BINDING_FILE = "binding.json";

/**
 * The developer-scoped local project binding. Shape is the contract between U5
 * (writer) and U12 (reader). Keep it small and explicit.
 */
export interface ProjectBinding {
  /** Supabase project URL, e.g. "https://<ref>.supabase.co". */
  supabaseUrl: string;
  /**
   * Developer-scoped Supabase access token (a member session JWT or a scoped
   * key). NOT the anonymous guest path (R25). Used as the `Authorization`
   * bearer so RLS applies the developer's member identity.
   */
  token: string;
  /** The preview this working directory is bound to (drives comment scoping). */
  previewId: string;
  /** The owning project (informational / future multi-preview scoping). */
  projectId?: string;
  /**
   * Public anon/publishable key for `supabaseUrl`. REQUIRED as the Supabase
   * `apikey` header on every request — the member JWT in `token` is NOT a valid
   * apikey (PostgREST rejects it with "Invalid API key"); the JWT travels only in
   * the `Authorization` bearer so RLS still applies the member identity. Written
   * by `supercomment login`; the MCP server falls back to SUPERCOMMENT_ANON_KEY
   * when a (pre-anonKey) binding lacks it.
   */
  anonKey?: string;
  /**
   * Supabase refresh token. Lets the MCP server mint a fresh access token when
   * the short-lived `token` is near expiry, so the workflow keeps working
   * without re-running `supercomment login`. MORE sensitive than the access
   * token (longer-lived) — stored 0600 and rotated in place on each refresh.
   */
  refreshToken?: string;
  /**
   * Guest link secret for the bound review link. Lets `supercomment start`
   * inject the guest-submit path without a separate SUPERCOMMENT_LINK_SECRET.
   * Sensitive (authorizes guest writes) — stored 0600 alongside the token.
   */
  linkSecret?: string;
  /** The SuperComment app origin this binding was created against (share URL + CSP base). */
  backendOrigin?: string;
}

/** Narrow runtime guard so a malformed binding file fails loudly, not silently. */
function isProjectBinding(value: unknown): value is ProjectBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.supabaseUrl === "string" &&
    v.supabaseUrl.length > 0 &&
    typeof v.token === "string" &&
    v.token.length > 0 &&
    typeof v.previewId === "string" &&
    v.previewId.length > 0 &&
    (v.projectId === undefined || typeof v.projectId === "string") &&
    (v.anonKey === undefined || typeof v.anonKey === "string") &&
    (v.refreshToken === undefined || typeof v.refreshToken === "string") &&
    (v.linkSecret === undefined || typeof v.linkSecret === "string") &&
    (v.backendOrigin === undefined || typeof v.backendOrigin === "string")
  );
}

/** Raised when no usable binding can be found/parsed. */
export class BindingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingNotFoundError";
  }
}

/**
 * Resolve the binding file path. Precedence:
 *   1. `SUPERCOMMENT_BINDING_PATH` env (explicit override / tests)
 *   2. `~/.supercomment/binding.json` (where U5 writes it)
 *
 * `env`/`home` are injectable for tests.
 */
export function resolveBindingPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const override = env.SUPERCOMMENT_BINDING_PATH;
  if (override && override.length > 0) return override;
  return join(home, DEFAULT_BINDING_DIR, DEFAULT_BINDING_FILE);
}

/**
 * Build a binding directly from env vars, when present. Lets a developer (or a
 * CI harness) point the MCP server at a preview without a file. All three of
 * URL/token/previewId must be present for the env path to apply.
 */
export function bindingFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectBinding | undefined {
  const supabaseUrl = env.SUPERCOMMENT_SUPABASE_URL;
  const token = env.SUPERCOMMENT_TOKEN;
  const previewId = env.SUPERCOMMENT_PREVIEW_ID;
  if (!supabaseUrl || !token || !previewId) return undefined;
  const projectId = env.SUPERCOMMENT_PROJECT_ID;
  const anonKey = env.SUPERCOMMENT_ANON_KEY;
  const refreshToken = env.SUPERCOMMENT_REFRESH_TOKEN;
  const linkSecret = env.SUPERCOMMENT_LINK_SECRET;
  const backendOrigin = env.SUPERCOMMENT_BACKEND_ORIGIN;
  return {
    supabaseUrl,
    token,
    previewId,
    ...(projectId ? { projectId } : {}),
    ...(anonKey ? { anonKey } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(linkSecret ? { linkSecret } : {}),
    ...(backendOrigin ? { backendOrigin } : {}),
  };
}

/** Injectable dependencies so tests don't touch the real fs/env/home. */
export interface LoadBindingDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Reads a file as UTF-8 text; defaults to fs/promises readFile. */
  readTextFile?: (path: string) => Promise<string>;
}

/**
 * Load the project binding. Env vars win (SUPERCOMMENT_*), otherwise read the
 * JSON file at the resolved path. Throws `BindingNotFoundError` with actionable
 * guidance if nothing usable is found — the MCP server surfaces this on stderr.
 */
export async function loadProjectBinding(
  deps: LoadBindingDeps = {},
): Promise<ProjectBinding> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const readTextFile =
    deps.readTextFile ?? ((p: string) => readFile(p, "utf8"));

  const fromEnv = bindingFromEnv(env);
  if (fromEnv) return fromEnv;

  const path = resolveBindingPath(env, home);
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch {
    throw new BindingNotFoundError(
      `No SuperComment project binding found. Run \`supercomment login\` to ` +
        `create ${path}, or set SUPERCOMMENT_SUPABASE_URL / SUPERCOMMENT_TOKEN / ` +
        `SUPERCOMMENT_ANON_KEY / SUPERCOMMENT_PREVIEW_ID.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BindingNotFoundError(
      `Project binding at ${path} is not valid JSON.`,
    );
  }

  if (!isProjectBinding(parsed)) {
    throw new BindingNotFoundError(
      `Project binding at ${path} is missing required fields ` +
        `(supabaseUrl, token, previewId).`,
    );
  }

  return parsed;
}

/** Injectable filesystem ops for `writeProjectBinding` (tests inject fakes). */
export interface WriteBindingFs {
  mkdir: (dir: string, opts: { recursive: true }) => Promise<unknown>;
  writeFile: (
    path: string,
    data: string,
    opts: { mode: number },
  ) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

/** Injectable dependencies for the binding writer. */
export interface WriteBindingDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  fs?: WriteBindingFs;
}

const defaultWriteFs: WriteBindingFs = {
  mkdir: (dir, opts) => mkdir(dir, opts),
  writeFile: (path, data, opts) => writeFile(path, data, opts),
  rename: (from, to) => rename(from, to),
};

/**
 * Persist the project binding to disk ATOMICALLY and PRIVATELY.
 *
 * - `mkdir -p` the binding directory (default `~/.supercomment`).
 * - Write to a sibling temp file with 0600 perms (owner read/write only, R25),
 *   then `rename` it over the final path. Rename is atomic on the same
 *   filesystem, so a reader (U12) never observes a half-written binding and a
 *   crash mid-write cannot corrupt an existing binding.
 *
 * Returns the path written so the caller can surface it to the developer.
 * The token is never logged here.
 */
export async function writeProjectBinding(
  binding: ProjectBinding,
  deps: WriteBindingDeps = {},
): Promise<string> {
  if (!isProjectBinding(binding)) {
    throw new Error(
      "Refusing to write an invalid project binding " +
        "(supabaseUrl, token, previewId are required).",
    );
  }
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const fs = deps.fs ?? defaultWriteFs;

  const path = resolveBindingPath(env, home);
  const dir = dirname(path);
  // A deterministic temp sibling: unique enough for a single-writer helper and
  // it lives on the same filesystem so the rename is atomic.
  const tmpPath = `${path}.tmp-${process.pid}`;

  // Serialize only the known fields so we never leak extra/undefined keys.
  const payload: ProjectBinding = {
    supabaseUrl: binding.supabaseUrl,
    token: binding.token,
    previewId: binding.previewId,
    ...(binding.projectId ? { projectId: binding.projectId } : {}),
    ...(binding.anonKey ? { anonKey: binding.anonKey } : {}),
    ...(binding.refreshToken ? { refreshToken: binding.refreshToken } : {}),
    ...(binding.linkSecret ? { linkSecret: binding.linkSecret } : {}),
    ...(binding.backendOrigin ? { backendOrigin: binding.backendOrigin } : {}),
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.mkdir(dir, { recursive: true });
  // 0o600 = owner read/write only. Best-effort on platforms that honor it.
  await fs.writeFile(tmpPath, json, { mode: 0o600 });
  await fs.rename(tmpPath, path);
  return path;
}

/** Injectable dependencies for `clearProjectBinding`. */
export interface ClearBindingDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Removes the file; defaults to fs/promises rm (force: missing is OK). */
  removeFile?: (path: string) => Promise<void>;
}

/**
 * Remove the on-disk binding (e.g. on `supercomment stop`/logout). Idempotent:
 * a missing file is not an error. Returns the path that was targeted.
 */
export async function clearProjectBinding(
  deps: ClearBindingDeps = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const removeFile =
    deps.removeFile ?? ((p: string) => rm(p, { force: true }));
  const path = resolveBindingPath(env, home);
  await removeFile(path);
  return path;
}
