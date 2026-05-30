import { z } from "zod";
import { reactContextSchema } from "./schema.js";

/**
 * Snapshot contract (U10).
 *
 * A snapshot is a portable, self-contained representation of a page captured
 * while a preview is live, so the page can be re-rendered and annotated offline
 * once the ephemeral preview URL is gone. The serialized form is an id'd node
 * tree (tags/attributes/children) with same-origin stylesheets inlined and all
 * URLs rewritten absolute. Selectors used by comment anchors (U7) must remain
 * recomputable from this tree, so we preserve id / data-* attributes and
 * structural ordering verbatim.
 *
 * This is what gets stored in `snapshots.payload` (jsonb).
 */

/**
 * A serialized DOM node. Mirrors the live tree closely enough that the U7
 * anchor strategy (stable id -> data-testid -> nth-of-type structural path) can
 * be recomputed against it offline.
 */
export interface SnapshotNode {
  /** Stable per-snapshot id, assigned in document order. */
  nodeId: number;
  /** Node kind. We only serialize elements, text, and a comment placeholder. */
  type: "element" | "text" | "comment";
  /** Lowercased tag name for elements; undefined for text/comment. */
  tag?: string;
  /** Attribute map for elements (post-masking, post-URL-rewrite). */
  attributes?: Record<string, string>;
  /** Text content for text/comment nodes (post-masking). */
  text?: string;
  /** Child nodes in document order. */
  children?: SnapshotNode[];
}

// zod can't infer recursive types automatically; declare then assert the type.
export const snapshotNodeSchema: z.ZodType<SnapshotNode> = z.lazy(() =>
  z.object({
    nodeId: z.number(),
    type: z.enum(["element", "text", "comment"]),
    tag: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    text: z.string().optional(),
    children: z.array(snapshotNodeSchema).optional(),
  }),
);

/** A same-origin stylesheet whose rules we inlined into the payload. */
export const snapshotStylesheetSchema = z.object({
  /** Absolute href if it was a <link>, else null for inline <style>. */
  href: z.string().nullable(),
  /** Concatenated cssText with url() references rewritten absolute. */
  css: z.string(),
});
export type SnapshotStylesheet = z.infer<typeof snapshotStylesheetSchema>;

/**
 * A fidelity-degradation note: something we could not faithfully capture
 * (e.g. a cross-origin stylesheet whose rules CORS blocked us from reading).
 * Surfacing these lets the dashboard tell reviewers the offline render may
 * differ from the live page.
 */
export const snapshotDegradationSchema = z.object({
  kind: z.enum([
    "cross-origin-stylesheet",
    "unreadable-stylesheet",
    "truncated",
  ]),
  detail: z.string(),
});
export type SnapshotDegradation = z.infer<typeof snapshotDegradationSchema>;

export const snapshotPayloadSchema = z.object({
  /** Schema version so offline readers can evolve. */
  version: z.literal(1),
  /** Absolute URL of the captured document. */
  url: z.string(),
  /** Page title at capture time. */
  title: z.string(),
  /** Absolute base used to resolve relative URLs during rewriting. */
  baseUrl: z.string(),
  /** Document root (typically the <html> element). */
  root: snapshotNodeSchema,
  /** Inlined same-origin stylesheets, in document order. */
  stylesheets: z.array(snapshotStylesheetSchema),
  /**
   * Capture-time React/source context for the document root. This is
   * runtime-only (fibers are gone offline), so we grab it AT capture time and
   * store it with the snapshot. Null when React isn't present.
   */
  reactContext: reactContextSchema.nullable(),
  /** Non-fatal fidelity issues encountered during capture. */
  degraded: z.array(snapshotDegradationSchema),
  /** True when the size cap forced truncation. */
  truncated: z.boolean(),
  /** Serialized byte size (approx, pre-truncation accounting). */
  approxBytes: z.number(),
  capturedAt: z.string(),
});
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;

/** Member ingest request: authenticated, RLS-scoped insert. */
export const memberSnapshotRequestSchema = z.object({
  previewId: z.string().uuid(),
  path: z.string(),
  payload: snapshotPayloadSchema,
});
export type MemberSnapshotRequest = z.infer<typeof memberSnapshotRequestSchema>;

/** Guest ingest request: link-secret scoped, routed through the guest RPC. */
export const guestSnapshotRequestSchema = z.object({
  linkSecret: z.string().min(1),
  path: z.string(),
  payload: snapshotPayloadSchema,
});
export type GuestSnapshotRequest = z.infer<typeof guestSnapshotRequestSchema>;
