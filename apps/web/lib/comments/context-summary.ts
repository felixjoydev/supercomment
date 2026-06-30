import type {
  A11yNode,
  AppState,
  DeviceSurface,
  Environment,
  InteractionEvent,
  NetworkRequest,
  Viewport,
} from "@supercomment/shared";

/**
 * Pure, dependency-free formatters for the additive captured-context fields.
 *
 * Following the web testing convention (logic lives in pure helpers tested in
 * node; components are thin shells), each returns a single display string or
 * null when there's nothing to show — so `context-detail.tsx` can render a
 * guarded `<Row>` exactly like the existing fields without any new layout.
 */

/** "mobile · 375×812" — the device surface a comment was made on, with size. */
export function surfaceLabel(
  surface: DeviceSurface | undefined,
  viewport: Viewport | undefined,
): string | null {
  if (!surface) {
    return null;
  }
  return viewport
    ? `${surface} · ${viewport.width}×${viewport.height}`
    : surface;
}

/** "button › div › form" — role (or tag) chain, target first. */
export function a11yPathLabel(tree: A11yNode[] | undefined): string | null {
  if (!tree || tree.length === 0) {
    return null;
  }
  return tree.map((node) => node.role ?? node.tagName).join(" › ");
}

/** Platform + user agent, or just the user agent. */
export function environmentLabel(env: Environment | undefined): string | null {
  if (!env?.userAgent) {
    return null;
  }
  return env.platform ? `${env.platform} · ${env.userAgent}` : env.userAgent;
}

/** "3 local · 1 session key(s)" — counts only (keys themselves aren't shown). */
export function appStateLabel(state: AppState | undefined): string | null {
  if (!state) {
    return null;
  }
  const local = state.localStorageKeys?.length ?? 0;
  const session = state.sessionStorageKeys?.length ?? 0;
  if (local === 0 && session === 0) {
    return null;
  }
  return `${local} local · ${session} session key(s)`;
}

/** "12 request(s)" — count of observed network requests. */
export function networkLabel(reqs: NetworkRequest[] | undefined): string | null {
  if (!reqs || reqs.length === 0) {
    return null;
  }
  return `${reqs.length} request(s)`;
}

const MAX_TRAIL_STEPS = 6;

/** "5 action(s): click button#buy → input form.email → submit form". */
export function interactionTrailLabel(
  trail: InteractionEvent[] | undefined,
): string | null {
  if (!trail || trail.length === 0) {
    return null;
  }
  const recent = trail.slice(-MAX_TRAIL_STEPS);
  const steps = recent.map((event) =>
    event.target ? `${event.type} ${event.target}` : event.type,
  );
  const prefix = trail.length > MAX_TRAIL_STEPS ? "… → " : "";
  return `${trail.length} action(s): ${prefix}${steps.join(" → ")}`;
}
