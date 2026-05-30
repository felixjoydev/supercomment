/**
 * Project binding (MCP-side facade).
 *
 * The CANONICAL binding module now lives at `apps/cli/src/config/binding.ts`
 * (introduced in U5, which also owns the WRITER). This file is kept as a thin
 * re-export so U12's MCP server/store and their tests keep importing
 * `../mcp/binding.js` unchanged while there is exactly one implementation of the
 * shape, the file path, the env precedence, and the loader.
 *
 * Why a facade instead of deleting this file: U12 (server.ts, store.ts,
 * binding.test.ts) imports from here. Re-exporting preserves that contract with
 * zero behavioral change and lets the writer/heartbeat/queue (U5) build on the
 * same canonical source.
 *
 * See `../config/binding.ts` for the full documentation, including the R25
 * loopback-local / outbound-only security notes.
 */
export type {
  ProjectBinding,
  LoadBindingDeps,
} from "../config/binding.js";
export {
  BindingNotFoundError,
  DEFAULT_BINDING_DIR,
  DEFAULT_BINDING_FILE,
  bindingFromEnv,
  loadProjectBinding,
  resolveBindingPath,
} from "../config/binding.js";
