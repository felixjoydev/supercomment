import { redactSecrets, type ConsoleError } from "@supercomment/shared";

/**
 * Recent-console-error buffer (U7).
 *
 * A captured comment is far more useful if it carries the runtime errors that
 * were on the page when the user clicked. We install a lightweight hook that
 * wraps `console.error` / `console.warn` (and listens for uncaught errors and
 * unhandled rejections) and keeps a ring buffer of the most recent N entries as
 * `ConsoleError` records (the shape the shared schema expects). The original
 * console behaviour is preserved — every call is forwarded through.
 *
 * The hook is install-once and idempotent so repeated overlay mounts don't
 * stack wrappers.
 */

type ConsoleLevel = ConsoleError["level"];

const DEFAULT_CAPACITY = 20;

interface ConsoleBufferState {
  capacity: number;
  entries: ConsoleError[];
  installed: boolean;
  originalError?: (...args: unknown[]) => void;
  originalWarn?: (...args: unknown[]) => void;
  errorListener?: (event: ErrorEvent) => void;
  rejectionListener?: (event: PromiseRejectionEvent) => void;
}

const state: ConsoleBufferState = {
  capacity: DEFAULT_CAPACITY,
  entries: [],
  installed: false,
};

/** Push an entry into the ring buffer, evicting the oldest if at capacity. */
function record(level: ConsoleLevel, message: string): void {
  if (!message) {
    return;
  }
  // U13: console output frequently contains logged tokens/keys/PII. Redact via
  // the canonical shared module before buffering so secrets never reach a
  // captured comment.
  state.entries.push({
    level,
    message: redactSecrets(message),
    timestamp: new Date().toISOString(),
  });
  const overflow = state.entries.length - state.capacity;
  if (overflow > 0) {
    state.entries.splice(0, overflow);
  }
}

/** Best-effort stringification of an arbitrary console argument. */
function stringifyArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === "string") {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function joinArgs(args: unknown[]): string {
  return args.map(stringifyArg).join(" ");
}

/**
 * Install the console hook. Safe to call multiple times; only the first call
 * takes effect. Pass `capacity` to size the ring buffer.
 */
export function installConsoleErrorBuffer(capacity = DEFAULT_CAPACITY): void {
  state.capacity = capacity;

  if (state.installed) {
    return;
  }
  state.installed = true;

  if (typeof console !== "undefined") {
    if (typeof console.error === "function") {
      const original = console.error.bind(console);
      state.originalError = original;
      console.error = (...args: unknown[]): void => {
        record("error", joinArgs(args));
        original(...args);
      };
    }
    if (typeof console.warn === "function") {
      const original = console.warn.bind(console);
      state.originalWarn = original;
      console.warn = (...args: unknown[]): void => {
        record("warn", joinArgs(args));
        original(...args);
      };
    }
  }

  if (
    typeof globalThis.addEventListener === "function" &&
    typeof ErrorEvent !== "undefined"
  ) {
    const errorListener = (event: ErrorEvent): void => {
      const detail =
        event.error instanceof Error
          ? (event.error.stack ?? event.error.message)
          : event.message;
      record("error", `Uncaught: ${detail}`);
    };
    state.errorListener = errorListener;
    globalThis.addEventListener("error", errorListener);

    const rejectionListener = (event: PromiseRejectionEvent): void => {
      record("error", `Unhandled rejection: ${stringifyArg(event.reason)}`);
    };
    state.rejectionListener = rejectionListener;
    globalThis.addEventListener(
      "unhandledrejection",
      rejectionListener as EventListener,
    );
  }
}

/** Snapshot of buffered console entries, oldest first. Returns a copy. */
export function getRecentConsoleErrors(): ConsoleError[] {
  return state.entries.map((e) => ({ ...e }));
}

/**
 * Remove the hook and clear the buffer. Primarily for tests and teardown so one
 * test's errors don't leak into the next.
 */
export function resetConsoleErrorBuffer(): void {
  if (state.originalError) {
    console.error = state.originalError;
  }
  if (state.originalWarn) {
    console.warn = state.originalWarn;
  }
  if (
    state.errorListener &&
    typeof globalThis.removeEventListener === "function"
  ) {
    globalThis.removeEventListener("error", state.errorListener);
  }
  if (
    state.rejectionListener &&
    typeof globalThis.removeEventListener === "function"
  ) {
    globalThis.removeEventListener(
      "unhandledrejection",
      state.rejectionListener as EventListener,
    );
  }
  state.entries = [];
  state.installed = false;
  state.originalError = undefined;
  state.originalWarn = undefined;
  state.errorListener = undefined;
  state.rejectionListener = undefined;
}
