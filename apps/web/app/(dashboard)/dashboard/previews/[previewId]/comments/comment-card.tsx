"use client";

import { useState } from "react";

import type { CommentView } from "@/lib/comments/types";
import {
  severityColors,
  severityLabel,
  intentLabel,
  trustLabel,
  statusLabel,
} from "@/lib/comments/labels";
import { ContextDetail } from "./context-detail";
import { LifecycleControls } from "./lifecycle-controls";
import { SendToClaudeButton } from "./send-to-claude-button";

/**
 * A single comment in the review list: prominent number, severity colour badge,
 * intent + trust (guest vs member) badges, the note, an expandable captured-
 * context block, lifecycle controls (owner/dev only), and Send-to-Claude.
 */
export function CommentCard({
  comment,
  canMutate,
  onLocalUpdate,
}: {
  comment: CommentView;
  canMutate: boolean;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sev = severityColors(comment.severity);
  const resolved = comment.status === "resolved";
  const dismissed = comment.status === "dismissed";
  const muted = resolved || dismissed;

  return (
    <article
      style={{
        border: "1px solid #e5e7eb",
        borderLeft: `4px solid ${sev.fg}`,
        borderRadius: 8,
        padding: "1rem",
        background: muted ? "#fafafa" : "#fff",
        opacity: dismissed ? 0.7 : 1,
      }}
    >
      <header style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <span
          aria-label={`Comment number ${comment.number}`}
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {comment.number}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
            <Badge bg={sev.bg} fg={sev.fg} border={sev.border}>
              {severityLabel(comment.severity)}
            </Badge>
            <Badge bg="#f3f4f6" fg="#374151" border="#e5e7eb">
              {intentLabel(comment.intent)}
            </Badge>
            <TrustBadge trust={comment.trustLevel} />
            {comment.fidelity === "snapshot" && (
              <Badge bg="#f5f3ff" fg="#6d28d9" border="#ddd6fe">
                Snapshot
              </Badge>
            )}
            {muted && (
              <Badge bg="#f3f4f6" fg="#6b7280" border="#e5e7eb">
                {statusLabel(comment.status)}
              </Badge>
            )}
          </div>

          <p
            style={{
              margin: 0,
              color: "#111827",
              textDecoration: dismissed ? "line-through" : "none",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {comment.note}
          </p>

          <div style={{ marginTop: "0.4rem", fontSize: "0.75rem", color: "#6b7280" }}>
            {comment.author ?? "Unknown"} · {comment.path ?? "—"}
          </div>

          {muted && comment.resolvedSummary && (
            <p style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "#4b5563", fontStyle: "italic" }}>
              {resolved ? "Resolution: " : "Reason: "}
              {comment.resolvedSummary}
            </p>
          )}

          <div style={{ marginTop: "0.6rem", display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              style={{
                background: "none",
                border: "none",
                color: "#2563eb",
                cursor: "pointer",
                fontSize: "0.8125rem",
                padding: 0,
              }}
            >
              {expanded ? "Hide context" : "Show context"}
            </button>

            {comment.status === "open" && (
              <SendToClaudeButton comment={comment} canMutate={canMutate} />
            )}
          </div>

          {expanded && <ContextDetail comment={comment} />}

          {canMutate && comment.status === "open" && (
            <LifecycleControls comment={comment} onLocalUpdate={onLocalUpdate} />
          )}
        </div>
      </header>
    </article>
  );
}

function Badge({
  children,
  bg,
  fg,
  border,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
  border: string;
}) {
  return (
    <span
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "0.15rem 0.45rem",
        borderRadius: 4,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
      }}
    >
      {children}
    </span>
  );
}

function TrustBadge({ trust }: { trust: CommentView["trustLevel"] }) {
  const guest = trust === "guest";
  return (
    <Badge
      bg={guest ? "#fff7ed" : "#ecfdf5"}
      fg={guest ? "#c2410c" : "#047857"}
      border={guest ? "#fed7aa" : "#a7f3d0"}
    >
      {trustLabel(trust)}
    </Badge>
  );
}
