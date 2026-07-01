import { describe, it, expect } from 'vitest';

import { toCommentView } from '../lib/comments/transform';
import type { CommentRow } from '../lib/comments/types';

function row(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'c1',
    preview_id: 'p1',
    number: 1,
    trust_level: 'member',
    intent: 'change',
    severity: 'important',
    note: 'Make the hero bigger',
    status: 'open',
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as CommentRow;
}

describe('toCommentView — comment kind (U16/R11)', () => {
  it("threads kind='template' from the row so the dashboard can differentiate it", () => {
    expect(toCommentView(row({ kind: 'template' })).kind).toBe('template');
  });

  it("defaults to 'comment' when the column is absent or null (older rows)", () => {
    expect(toCommentView(row()).kind).toBe('comment');
    expect(toCommentView(row({ kind: null })).kind).toBe('comment');
  });
});
