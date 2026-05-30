"use client";

import { useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { toCommentView } from "@/lib/comments/transform";
import type { CommentRow, CommentView } from "@/lib/comments/types";
import {
  mergeComment,
  selectView,
  countByStatus,
  type DashboardFilter,
} from "@/lib/comments/view";
import { CommentCard } from "./comment-card";

/**
 * Root client island for the realtime comment review surface.
 *
 * Initial list is server-rendered (RLS-scoped) and passed in. We then subscribe
 * to the per-preview PRIVATE broadcast channel `preview:<id>` and merge each
 * delivery through the pure `mergeComment` (insert / update-by-id / dedup). The
 * channel is authorized by the realtime.messages RLS policy from migration 0004
 * — only the preview's team members + participants receive its topic.
 *
 * VERIFY IN REAL ENV: the live websocket round-trip (subscribe, receive a
 * broadcast, status SUBSCRIBED) cannot be exercised in this sandbox; the merge
 * logic it feeds is unit-tested in __tests__/dashboard-realtime.test.ts.
 */
export function CommentBoard({
  previewId,
  initialComments,
  canMutate,
}: {
  previewId: string;
  initialComments: CommentView[];
  canMutate: boolean;
}) {
  const [comments, setComments] = useState<CommentView[]>(initialComments);
  const [filter, setFilter] = useState<DashboardFilter>("open");
  const [connection, setConnection] = useState<"connecting" | "live" | "error">(
    "connecting",
  );

  useEffect(() => {
    const supabase = createClient();
    const topic = `preview:${previewId}`;
    const channel = supabase.channel(topic, { config: { private: true } });

    function ingest(payload: unknown) {
      // broadcast_changes delivers { record, old_record, operation, ... }.
      const p = payload as
        | { record?: CommentRow; payload?: { record?: CommentRow } }
        | undefined;
      const record = p?.record ?? p?.payload?.record;
      if (!record || !record.id) return;
      setComments((current) => mergeComment(current, toCommentView(record)));
    }

    channel
      .on("broadcast", { event: "INSERT" }, (msg: { payload?: unknown }) => ingest(msg.payload))
      .on("broadcast", { event: "UPDATE" }, (msg: { payload?: unknown }) => ingest(msg.payload))
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") setConnection("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setConnection("error");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [previewId]);

  const visible = useMemo(() => selectView(comments, filter), [comments, filter]);
  const counts = useMemo(() => countByStatus(comments), [comments]);

  function handleLocalUpdate(updated: CommentView) {
    setComments((current) => mergeComment(current, updated));
  }

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem" }} role="tablist" aria-label="Comment filter">
          <FilterTab label={`Open (${counts.open})`} active={filter === "open"} onClick={() => setFilter("open")} />
          <FilterTab
            label={`History (${counts.resolved + counts.dismissed})`}
            active={filter === "history"}
            onClick={() => setFilter("history")}
          />
          <FilterTab label={`All (${counts.total})`} active={filter === "all"} onClick={() => setFilter("all")} />
        </div>
        <ConnectionDot state={connection} />
      </div>

      {visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem" }}>
          {visible.map((comment) => (
            <li key={comment.id}>
              <CommentCard comment={comment} canMutate={canMutate} onLocalUpdate={handleLocalUpdate} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "0.35rem 0.75rem",
        borderRadius: 999,
        border: "1px solid " + (active ? "#2563eb" : "#e5e7eb"),
        background: active ? "#2563eb" : "#fff",
        color: active ? "#fff" : "#374151",
        fontSize: "0.8125rem",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function ConnectionDot({ state }: { state: "connecting" | "live" | "error" }) {
  const color = state === "live" ? "#16a34a" : state === "error" ? "#dc2626" : "#9ca3af";
  const label = state === "live" ? "Live" : state === "error" ? "Reconnecting…" : "Connecting…";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "#6b7280" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} aria-hidden />
      {label}
    </span>
  );
}

function EmptyState({ filter }: { filter: DashboardFilter }) {
  if (filter === "open") {
    return (
      <div
        style={{
          border: "1px dashed #d1d5db",
          borderRadius: 8,
          padding: "2rem",
          textAlign: "center",
          color: "#6b7280",
        }}
      >
        <p style={{ fontWeight: 600, margin: "0 0 0.25rem", color: "#374151" }}>No open comments yet</p>
        <p style={{ margin: 0, fontSize: "0.875rem" }}>
          Share this preview&rsquo;s link with your team to start collecting visual feedback.
        </p>
      </div>
    );
  }
  return (
    <div style={{ border: "1px dashed #d1d5db", borderRadius: 8, padding: "1.5rem", textAlign: "center", color: "#6b7280" }}>
      <p style={{ margin: 0, fontSize: "0.875rem" }}>Nothing here yet.</p>
    </div>
  );
}
