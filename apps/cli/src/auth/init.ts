/**
 * `supercomment init` — re-point an existing binding at a different review link
 * WITHOUT re-authenticating. Reuses the token + anon key already stored by
 * `supercomment login`; only the project/review-link scope changes.
 *
 * Use it to switch which project's comments the AI agent reads, or to attach a
 * review link to a (legacy) project that lacks one. If there is no binding yet,
 * it tells the developer to run `supercomment login` first.
 */
import {
  loadProjectBinding,
  writeProjectBinding,
  type ProjectBinding,
} from "../config/binding.js";
import { assertAllowedSupabaseUrl } from "../config/supabase-url.js";
import {
  readlinePrompter,
  readlineTextPrompter,
  resolveTarget,
  type Prompter,
  type ReviewTarget,
  type SupabaseQuery,
  type TextPrompter,
} from "./select.js";

/** Build a Supabase client from a stored binding (anon key + member bearer). */
async function defaultMakeClient(
  binding: ProjectBinding,
): Promise<SupabaseQuery> {
  const anonKey = binding.anonKey ?? process.env.SUPERCOMMENT_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      "Binding has no anon key. Run `supercomment login` to refresh it.",
    );
  }
  const mod = await import("@supabase/supabase-js");
  const client = mod.createClient(binding.supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${binding.token}` } },
  });
  return client as unknown as SupabaseQuery;
}

export interface RunInitOptions {
  projectFlag?: string;
  // --- injectable collaborators (tests) ---
  loadBinding?: () => Promise<ProjectBinding>;
  makeClient?: (binding: ProjectBinding) => Promise<SupabaseQuery>;
  writeBinding?: (binding: ProjectBinding) => Promise<string>;
  prompt?: Prompter;
  promptText?: TextPrompter;
  isTTY?: boolean;
  log?: (line: string) => void;
}

export interface InitResult {
  bindingPath: string;
  target: ReviewTarget;
}

/** Re-select the bound review link using the stored session. */
export async function runInit(opts: RunInitOptions = {}): Promise<InitResult> {
  const log = opts.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const loadBinding = opts.loadBinding ?? (() => loadProjectBinding());
  const makeClient = opts.makeClient ?? defaultMakeClient;
  const writeBinding =
    opts.writeBinding ?? ((b: ProjectBinding) => writeProjectBinding(b));
  const isTTY = opts.isTTY ?? Boolean(process.stdin.isTTY);
  const prompt = opts.prompt ?? readlinePrompter;
  const promptText = opts.promptText ?? readlineTextPrompter;

  let binding: ProjectBinding;
  try {
    binding = await loadBinding();
  } catch (err) {
    throw new Error(
      `Not logged in (${
        err instanceof Error ? err.message : String(err)
      }). Run \`supercomment login\` first.`,
    );
  }

  assertAllowedSupabaseUrl(binding.supabaseUrl);
  const client = await makeClient(binding);
  const target = await resolveTarget(client, {
    ...(opts.projectFlag ? { projectFlag: opts.projectFlag } : {}),
    prompt,
    promptText,
    isTTY,
    log,
  });

  const updated: ProjectBinding = {
    supabaseUrl: binding.supabaseUrl,
    token: binding.token,
    previewId: target.previewId,
    projectId: target.projectId,
    ...(binding.anonKey ? { anonKey: binding.anonKey } : {}),
    ...(binding.backendOrigin ? { backendOrigin: binding.backendOrigin } : {}),
    ...(target.linkSecret ? { linkSecret: target.linkSecret } : {}),
  };
  const bindingPath = await writeBinding(updated);

  log("");
  log(`✔ Bound to "${target.projectName}" (review link ${target.slug}).`);
  log(`  Binding: ${bindingPath}`);
  log("Restart Claude Code (or run /mcp) to pick up the change.");

  return { bindingPath, target };
}
