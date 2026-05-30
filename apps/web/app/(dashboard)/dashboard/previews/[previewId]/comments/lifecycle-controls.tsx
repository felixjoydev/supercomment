"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { CommentView } from "@/lib/comments/types";

/**
 * Resolve / dismiss controls — owner/dev only (the parent gates rendering on
 * `canMutate`, and the resolve_comment / dismiss_comment RPCs re-check team
 * membership server-side, so a forged client call is still rejected).
 *
 * Resolve takes an optional summary; dismiss takes an optional reason. Both call
 * the U2 SECURITY DEFINER RPCs and optimistically update the local list (the
 * broadcast then confirms it for everyone else).
 */
export function LifecycleControls({
  comment,
  onLocalUpdate,
}: {
  comment: CommentView;
  onLocalUpdate: (updated: CommentView) => void;
}) {
  const [mode, setMode] = useState<"idle" | "resolve" | "dismiss">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "resolve" | "dismiss") {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const rpc = action === "resolve" ? "resolve_comment" : "dismiss_comment";
    const arg = action === "resolve" ? { p_comment_id: comment.id, p_summary: text } : { p_comment_id: comment.id, p_reason: text };

    const { error: rpcError } = await supabase.rpc(rpc, arg);

    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || "Action failed. Try again.");
      return;
    }

    onLocalUpdate({
      ...comment,
      status: action === "resolve" ? "resolved" : "dismissed",
      resolvedSummary: text || null,
    });
    setMode("idle");
    setText("");
  }

  if (mode === "idle") {
    return (
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
        <ActionButton onClick={() => setMode("resolve")}>Resolve</ActionButton>
        <ActionButton onClick={() => setMode("dismiss")} variant="ghost">
          Dismiss
        </ActionButton>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={mode === "resolve" ? "Resolution summary (optional)" : "Reason for dismissing (optional)"}
        rows={2}
        style={{
          width: "100%",
          padding: "0.5rem",
          borderRadius: 6,
          border: "1px solid #d1d5db",
          fontSize: "0.8125rem",
          resize: "vertical",
        }}
      />
      {error && <p style={{ color: "#dc2626", fontSize: "0.75rem", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <ActionButton onClick={() => submit(mode)} disabled={busy}>
          {busy ? "Saving…" : mode === "resolve" ? "Confirm resolve" : "Confirm dismiss"}
        </ActionButton>
        <ActionButton
          onClick={() => {
            setMode("idle");
            setText("");
            setError(null);
          }}
          variant="ghost"
          disabled={busy}
        >
          Cancel
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.4rem 0.85rem",
        borderRadius: 6,
        fontSize: "0.8125rem",
        cursor: disabled ? "not-allowed" : "pointer",
        border: variant === "solid" ? "1px solid #111827" : "1px solid #d1d5db",
        background: variant === "solid" ? "#111827" : "#fff",
        color: variant === "solid" ? "#fff" : "#374151",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}
