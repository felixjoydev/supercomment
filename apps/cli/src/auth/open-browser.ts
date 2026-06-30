/**
 * Best-effort cross-platform "open this URL in the default browser".
 *
 * Opening a browser is a convenience, never a requirement: the caller ALWAYS
 * prints the URL too, so `--no-browser`, headless boxes, or a missing opener
 * degrade gracefully to "click this link". We therefore swallow spawn errors —
 * a failed open must not fail the login.
 */
import { spawn } from "node:child_process";
import { platform } from "node:process";

/** Opens a URL; resolves whether or not the OS actually had a browser. */
export type BrowserOpener = (url: string) => Promise<void>;

/**
 * Pick the platform command + args for opening a URL.
 *   - macOS:   `open <url>`
 *   - Windows: `cmd /c start "" <url>`  (empty title arg so a quoted URL works)
 *   - else:    `xdg-open <url>`         (Linux / BSD desktops)
 */
export function openCommand(
  url: string,
  os: NodeJS.Platform = platform,
): { command: string; args: string[] } {
  if (os === "darwin") return { command: "open", args: [url] };
  if (os === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * The default opener: spawn the platform command detached and unref it so the
 * CLI doesn't wait on the browser process. Any failure (ENOENT, etc.) resolves
 * quietly — the printed URL is the real fallback.
 */
export const defaultOpener: BrowserOpener = async (url) => {
  const { command, args } = openCommand(url);
  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      /* no browser available; the printed URL is the fallback */
    });
    child.unref();
  } catch {
    /* swallow — never fail login on an open() failure */
  }
};
