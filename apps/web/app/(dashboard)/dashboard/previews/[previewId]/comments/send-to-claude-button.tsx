"use client";

import { useReducer, useState } from "react";

import type { CommentView } from "@/lib/comments/types";
import { requiresGuestConfirm } from "@/lib/comments/view";
import { sendReducer, sendButtonLabel, isInFlight } from "@/lib/comments/send-state";

/**
 * Per-comment "Send to Claude" button (R20 + R23).
 *
 * Member comments enqueue directly. GUEST comments are untrusted to the agent:
 * clicking surfaces an explicit confirm step (the pure state machine moves to
 * `confirm_required`); only after confirming does it POST. The server
 * (/api/send-to-claude) independently re-enforces the same gate, so the UI
 * cannot bypass it.
 */
export function SendToClaudeButton({
  comment,
  canMutate,
}: {
  comment: CommentView;
  canMutate: boolean;
}) {
  const [state, dispatch] = useReducer(sendReducer, "idle");
  const [error, setError] = useState<string | null>(null);

  if (!canMutate) return null;

  const needsConfirm = requiresGuestConfirm(comment);

  async function enqueue(confirmGuest: boolean) {
    setError(null);
    dispatch({ type: "request", requiresConfirm: false });
    try {
      const res = await fetch("/api/send-to-claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId: comment.id, confirmGuest }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message || data?.error || `Failed (${res.status})`);
        dispatch({ type: "failed" });
        return;
      }
      dispatch({ type: "succeeded" });
    } catch {
      setError("Network error");
      dispatch({ type: "failed" });
    }
  }

  function onPrimaryClick() {
    if (state === "confirm_required") return; // handled by confirm UI below
    if (needsConfirm && state === "idle") {
      dispatch({ type: "request", requiresConfirm: true });
      return;
    }
    void enqueue(false);
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.4rem" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={onPrimaryClick}
          disabled={isInFlight(state) || state === "confirm_required"}
          style={{
            padding: "0.35rem 0.75rem",
            borderRadius: 6,
            border: "1px solid #7c3aed",
            background: state === "failed" ? "#fff" : "#7c3aed",
            color: state === "failed" ? "#7c3aed" : "#fff",
            fontSize: "0.8125rem",
            cursor: isInFlight(state) ? "default" : "pointer",
            opacity: isInFlight(state) ? 0.8 : 1,
          }}
        >
          {sendButtonLabel(state)}
        </button>
        {needsConfirm && state !== "confirm_required" && (
          <span style={{ fontSize: "0.6875rem", color: "#c2410c" }}>guest — needs confirm</span>
        )}
      </span>

      {state === "confirm_required" && (
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: "0.4rem",
            padding: "0.6rem",
            border: "1px solid #fed7aa",
            background: "#fff7ed",
            borderRadius: 6,
            fontSize: "0.75rem",
            color: "#9a3412",
          }}
        >
          <span>
            This comment is from a <strong>guest</strong> and is untrusted to the agent. Confirm you
            want to send it to Claude.
          </span>
          <span style={{ display: "inline-flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "confirm" });
                void enqueue(true);
              }}
              style={{
                padding: "0.3rem 0.7rem",
                borderRadius: 6,
                border: "1px solid #c2410c",
                background: "#c2410c",
                color: "#fff",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Confirm &amp; send
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "cancel" })}
              style={{
                padding: "0.3rem 0.7rem",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#374151",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </span>
        </span>
      )}

      {error && <span style={{ fontSize: "0.6875rem", color: "#dc2626" }}>{error}</span>}
    </span>
  );
}
