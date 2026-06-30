import { describe, expect, it } from "vitest";

import {
  createProjectTarget,
  loadChoices,
  NoProjectsError,
  pickChoice,
  resolveTarget,
  type ProjectChoice,
  type SupabaseQuery,
} from "./select.js";

/**
 * A flexible in-memory fake of the slice of the Supabase client we use:
 * `.from(t).select(c).order()/.eq().order()`, `.from(t).insert(r).select().single()`,
 * and `.rpc()`. Reads come from `tables`; inserts append + return a synthetic row.
 */
function fakeClient(tables: {
  projects?: { id: string; name: string }[];
  previews?: {
    id: string;
    slug: string;
    link_secret: string | null;
    project_id: string;
  }[];
  workspaces?: { id: string }[];
}): SupabaseQuery {
  let projSeq = 0;
  let prevSeq = 0;
  const state = {
    projects: tables.projects ?? [],
    previews: tables.previews ?? [],
    workspaces: tables.workspaces ?? [],
  };
  return {
    from(table: string) {
      const rows =
        table === "projects"
          ? state.projects
          : table === "previews"
            ? state.previews
            : state.workspaces;
      return {
        select() {
          const result = Promise.resolve({ data: rows, error: null });
          return {
            order: () => result,
            eq: () => ({ order: () => result }),
          };
        },
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                single: async () => {
                  if (table === "projects") {
                    const created = {
                      id: `proj-${++projSeq}`,
                      name: String(row.name),
                    };
                    state.projects.push(created);
                    return { data: created, error: null };
                  }
                  if (table === "previews") {
                    const created = {
                      id: `prev-${++prevSeq}`,
                      slug: String(row.slug),
                      link_secret: null,
                      project_id: String(row.project_id),
                    };
                    state.previews.push(created);
                    return { data: created, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(fn: string) {
      if (fn === "create_workspace") {
        const ws = { id: "ws-new" };
        state.workspaces.push(ws);
        return { data: ws, error: null };
      }
      return { data: null, error: null };
    },
  };
}

const CHOICE = (over: Partial<ProjectChoice> = {}): ProjectChoice => ({
  projectId: "p1",
  projectName: "Alpha",
  previewId: "v1",
  slug: "rl-alpha",
  linkSecret: null,
  ...over,
});

describe("pickChoice (pure)", () => {
  it("flags empty input", () => {
    expect(pickChoice([])).toEqual({ empty: true });
  });
  it("auto-selects a sole project", () => {
    const c = CHOICE();
    expect(pickChoice([c])).toEqual({ choice: c });
  });
  it("matches --project by name (case-insensitive) and by id", () => {
    const a = CHOICE();
    const b = CHOICE({ projectId: "p2", projectName: "Beta", slug: "rl-beta" });
    expect(pickChoice([a, b], "beta").choice).toBe(b);
    expect(pickChoice([a, b], "p1").choice).toBe(a);
  });
  it("errors when --project matches nothing", () => {
    const res = pickChoice([CHOICE()], "ghost");
    expect(res.error).toMatch(/No project matching "ghost"/);
  });
  it("asks for a prompt when ambiguous and no flag", () => {
    expect(pickChoice([CHOICE(), CHOICE({ projectId: "p2" })])).toEqual({
      needsPrompt: true,
    });
  });
});

describe("loadChoices", () => {
  it("pairs each project with its earliest review link", async () => {
    const client = fakeClient({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      previews: [
        { id: "v1", slug: "rl-a1", link_secret: "sk1", project_id: "p1" },
        { id: "v2", slug: "rl-a2", link_secret: null, project_id: "p1" },
        { id: "v3", slug: "rl-b1", link_secret: null, project_id: "p2" },
      ],
    });
    const choices = await loadChoices(client);
    expect(choices).toEqual([
      {
        projectId: "p1",
        projectName: "Alpha",
        previewId: "v1",
        slug: "rl-a1",
        linkSecret: "sk1",
      },
      {
        projectId: "p2",
        projectName: "Beta",
        previewId: "v3",
        slug: "rl-b1",
        linkSecret: null,
      },
    ]);
  });

  it("yields a null preview for a project with no review link", async () => {
    const client = fakeClient({
      projects: [{ id: "p9", name: "Lonely" }],
      previews: [],
    });
    const [choice] = await loadChoices(client);
    expect(choice).toMatchObject({ projectId: "p9", previewId: null, slug: null });
  });
});

describe("resolveTarget", () => {
  it("auto-selects the sole project's review link", async () => {
    const client = fakeClient({
      projects: [{ id: "p1", name: "Alpha" }],
      previews: [{ id: "v1", slug: "rl-a1", link_secret: "sk1", project_id: "p1" }],
    });
    const target = await resolveTarget(client, { isTTY: false });
    expect(target).toEqual({
      projectId: "p1",
      projectName: "Alpha",
      previewId: "v1",
      slug: "rl-a1",
      linkSecret: "sk1",
    });
  });

  it("honors --project among several", async () => {
    const client = fakeClient({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      previews: [
        { id: "v1", slug: "rl-a", link_secret: null, project_id: "p1" },
        { id: "v2", slug: "rl-b", link_secret: null, project_id: "p2" },
      ],
    });
    const target = await resolveTarget(client, {
      isTTY: false,
      projectFlag: "Beta",
    });
    expect(target.projectId).toBe("p2");
  });

  it("refuses to guess among several without a TTY or flag", async () => {
    const client = fakeClient({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      previews: [
        { id: "v1", slug: "rl-a", link_secret: null, project_id: "p1" },
        { id: "v2", slug: "rl-b", link_secret: null, project_id: "p2" },
      ],
    });
    await expect(resolveTarget(client, { isTTY: false })).rejects.toThrow(
      /pass --project/,
    );
  });

  it("uses the injected prompter when ambiguous on a TTY", async () => {
    const client = fakeClient({
      projects: [
        { id: "p1", name: "Alpha" },
        { id: "p2", name: "Beta" },
      ],
      previews: [
        { id: "v1", slug: "rl-a", link_secret: null, project_id: "p1" },
        { id: "v2", slug: "rl-b", link_secret: null, project_id: "p2" },
      ],
    });
    const target = await resolveTarget(client, {
      isTTY: true,
      prompt: async () => 1, // choose the second project
    });
    expect(target.projectId).toBe("p2");
  });

  it("creates a review link for a project that has none", async () => {
    const client = fakeClient({
      projects: [{ id: "p9", name: "Lonely" }],
      previews: [],
    });
    const target = await resolveTarget(client, {
      isTTY: false,
      genSlug: async () => "rl-fresh",
    });
    expect(target.projectId).toBe("p9");
    expect(target.slug).toBe("rl-fresh");
    expect(target.previewId).toMatch(/^prev-/);
  });

  it("throws NoProjectsError when none exist and creation is off", async () => {
    const client = fakeClient({ projects: [], previews: [] });
    await expect(
      resolveTarget(client, { isTTY: false, allowCreate: false }),
    ).rejects.toBeInstanceOf(NoProjectsError);
  });

  it("creates a project (and link) on a TTY when none exist", async () => {
    const client = fakeClient({ projects: [], previews: [], workspaces: [{ id: "ws1" }] });
    const target = await resolveTarget(client, {
      isTTY: true,
      promptText: async () => "My New Project",
      genSlug: async () => "rl-new",
    });
    expect(target.projectName).toBe("My New Project");
    expect(target.slug).toBe("rl-new");
  });
});

describe("createProjectTarget", () => {
  it("bootstraps a workspace via RPC when the user has none", async () => {
    const client = fakeClient({ projects: [], previews: [], workspaces: [] });
    const target = await createProjectTarget(client, "First", {
      genSlug: async () => "rl-1",
    });
    expect(target.projectName).toBe("First");
    expect(target.previewId).toMatch(/^prev-/);
    expect(target.slug).toBe("rl-1");
  });
});
