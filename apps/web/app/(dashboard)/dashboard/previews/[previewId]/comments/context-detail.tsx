"use client";

import type { CommentView } from "@/lib/comments/types";

/**
 * Inline expandable view of a comment's captured context: a screenshot
 * thumbnail when one exists, the selector, URL, component path, and best-effort
 * source location. Collapsed by default in the card.
 */
export function ContextDetail({ comment }: { comment: CommentView }) {
  const ctx = comment.context;

  if (!ctx) {
    return (
      <div style={{ marginTop: "0.6rem", fontSize: "0.8125rem", color: "#9ca3af" }}>
        No captured context.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: "0.6rem",
        border: "1px solid #f1f5f9",
        borderRadius: 6,
        padding: "0.75rem",
        background: "#f8fafc",
        fontSize: "0.8125rem",
        color: "#374151",
        display: "grid",
        gap: "0.5rem",
      }}
    >
      {ctx.screenshot && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ctx.screenshot}
          alt={`Screenshot for comment ${comment.number}`}
          style={{
            maxWidth: "100%",
            maxHeight: 220,
            borderRadius: 4,
            border: "1px solid #e5e7eb",
            objectFit: "contain",
          }}
        />
      )}

      {ctx.selector && <Row label="Selector" value={ctx.selector} mono />}
      {ctx.url && <Row label="URL" value={ctx.url} mono />}
      {ctx.react?.componentPath && ctx.react.componentPath.length > 0 && (
        <Row label="Component" value={ctx.react.componentPath.join(" › ")} />
      )}
      {ctx.react?.sourceFile && (
        <Row
          label="Source"
          value={ctx.react.sourceLine ? `${ctx.react.sourceFile}:${ctx.react.sourceLine}` : ctx.react.sourceFile}
          mono
        />
      )}
      {ctx.consoleErrors && ctx.consoleErrors.length > 0 && (
        <Row label="Console" value={`${ctx.consoleErrors.length} error(s)`} />
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      <span style={{ flexShrink: 0, fontWeight: 600, color: "#6b7280", minWidth: 84 }}>{label}</span>
      <span
        style={{
          wordBreak: "break-all",
          fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
        }}
      >
        {value}
      </span>
    </div>
  );
}
