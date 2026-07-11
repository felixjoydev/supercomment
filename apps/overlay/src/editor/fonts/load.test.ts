import { describe, it, expect, vi } from "vitest";

import {
  loadGoogleFont,
  buildCss2Url,
  weightAxis,
  parseFontFaces,
  isGstaticUrl,
  isValidFamilyName,
  type FontFaceCtor,
  type FetchLike,
  type Scheduler,
} from "./load.js";
import { FontRegistry } from "./registry.js";

// --- fakes -----------------------------------------------------------------

/** Drain pending microtasks by yielding a real macrotask. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const CSS_INTER = `
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v1/b.woff2) format('woff2'); }
`;

const CSS_OFF_ORIGIN = `
@font-face { font-family: 'Evil'; font-weight: 400;
  src: url(https://evil.example.com/x.woff2) format('woff2'); }
`;

function okFetch(css: string): FetchLike {
  return () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(css) });
}

/** The driver surface each FontFace double exposes to the test. */
interface FakeFaceHandle {
  family: string;
  weight: string;
  style: string;
  status: string;
  resolveLoad: () => void;
  rejectLoad: (e?: unknown) => void;
}

/** A FontFace double whose load() stays pending until the test drives it. */
function fontFaceClass(): { cls: FontFaceCtor; instances: FakeFaceHandle[] } {
  const instances: FakeFaceHandle[] = [];
  class FakeFace {
    family: string;
    weight: string;
    style: string;
    status = "unloaded";
    resolveLoad!: () => void;
    rejectLoad!: (e?: unknown) => void;
    private readonly p: Promise<FakeFace>;
    constructor(family: string, _src: string, d?: { weight?: string; style?: string }) {
      this.family = family;
      this.weight = d?.weight ?? "400";
      this.style = d?.style ?? "normal";
      this.p = new Promise<FakeFace>((res, rej) => {
        this.resolveLoad = () => {
          this.status = "loaded";
          res(this);
        };
        this.rejectLoad = (e) => {
          this.status = "error";
          rej(e ?? new Error("load failed"));
        };
      });
      instances.push(this);
    }
    load(): Promise<FakeFace> {
      return this.p;
    }
  }
  return { cls: FakeFace as unknown as FontFaceCtor, instances };
}

function fakeDoc() {
  const added: unknown[] = [];
  const deleted: unknown[] = [];
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    fonts: {
      add: (f: unknown) => added.push(f),
      delete: (f: unknown) => {
        deleted.push(f);
        return true;
      },
    },
    addEventListener: (t: string, cb: (e: unknown) => void) => {
      const l = listeners.get(t) ?? [];
      l.push(cb);
      listeners.set(t, l);
    },
    removeEventListener: (t: string, cb: (e: unknown) => void) => {
      const l = listeners.get(t);
      if (l) listeners.set(t, l.filter((f) => f !== cb));
    },
    emit: (t: string, e: unknown) => {
      for (const cb of listeners.get(t) ?? []) cb(e);
    },
    added,
    deleted,
  };
}

/** A scheduler whose timers only fire when the test calls fireAll(). */
function fakeScheduler(): Scheduler & { fireAll: () => void } {
  const timers: { cb: () => void; cleared: boolean }[] = [];
  return {
    setTimeout: (cb: () => void) => {
      const t = { cb, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h: unknown) => {
      (h as { cleared: boolean }).cleared = true;
    },
    fireAll: () => {
      for (const t of timers) if (!t.cleared) t.cb();
    },
  };
}

// --- pure helpers ----------------------------------------------------------

describe("css2 request builders (U7)", () => {
  it("validates family names against a strict charset", () => {
    expect(isValidFamilyName("Inter")).toBe(true);
    expect(isValidFamilyName("Roboto Mono")).toBe(true);
    expect(isValidFamilyName("PT-Sans")).toBe(true);
    expect(isValidFamilyName("<script>")).toBe(false);
    expect(isValidFamilyName('Evil"; }')).toBe(false);
  });

  it("URL-encodes the family and builds a discrete weight axis", () => {
    const url = buildCss2Url("Roboto Mono", ["700", "400", "400"]);
    expect(url).toContain("family=Roboto+Mono:wght@400;700");
    expect(url).toContain("display=swap");
  });

  it("builds a variable-range weight axis", () => {
    expect(weightAxis(["100 900"])).toBe("100..900");
    expect(weightAxis([])).toBe("400");
  });

  it("parses @font-face weight + url descriptors", () => {
    const faces = parseFontFaces(CSS_INTER);
    expect(faces).toHaveLength(2);
    expect(faces[0]).toEqual({
      weight: "400",
      url: "https://fonts.gstatic.com/s/inter/v1/a.woff2",
    });
  });

  it("allow-lists only the gstatic origin", () => {
    expect(isGstaticUrl("https://fonts.gstatic.com/s/x.woff2")).toBe(true);
    expect(isGstaticUrl("https://evil.example.com/x.woff2")).toBe(false);
    expect(isGstaticUrl("not a url")).toBe(false);
  });
});

// --- load state machine ----------------------------------------------------

describe("loadGoogleFont (U7)", () => {
  it("loads faces from the css2 response and reports the real weights (happy path)", async () => {
    const { cls, instances } = fontFaceClass();
    const doc = fakeDoc();
    const registry = new FontRegistry();
    const resultP = loadGoogleFont("Inter", {
      doc,
      fetch: okFetch(CSS_INTER),
      FontFace: cls,
      scheduler: fakeScheduler(),
      registry,
    });
    await tick();
    instances.forEach((i) => i.resolveLoad());
    const result = await resultP;
    expect(result.ok).toBe(true);
    expect(result.previewUnavailable).toBe(false);
    expect(result.weights).toEqual(["400", "700"]);
    expect(doc.added).toHaveLength(2);
    expect(registry.size(doc)).toBe(2);
  });

  it("rejects an invalid family before any fetch", async () => {
    const { cls } = fontFaceClass();
    const fetchSpy = vi.fn();
    const result = await loadGoogleFont('Evil"; }', {
      doc: fakeDoc(),
      fetch: fetchSpy as unknown as FetchLike,
      FontFace: cls,
      scheduler: fakeScheduler(),
    });
    expect(result.reason).toBe("invalid");
    expect(result.previewUnavailable).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("drops a css2 response whose src is off the gstatic allow-list", async () => {
    const { cls } = fontFaceClass();
    const doc = fakeDoc();
    const result = await loadGoogleFont("Evil", {
      doc,
      fetch: okFetch(CSS_OFF_ORIGIN),
      FontFace: cls,
      scheduler: fakeScheduler(),
    });
    expect(result.reason).toBe("no-faces");
    expect(doc.added).toHaveLength(0);
  });

  it("labels a network failure distinctly", async () => {
    const { cls } = fontFaceClass();
    const result = await loadGoogleFont("Inter", {
      doc: fakeDoc(),
      fetch: () => Promise.reject(new Error("offline")),
      FontFace: cls,
      scheduler: fakeScheduler(),
    });
    expect(result.reason).toBe("network");
    expect(result.previewUnavailable).toBe(true);
  });

  it("marks a load rejection as previewUnavailable, keeping the parsed weights", async () => {
    const { cls, instances } = fontFaceClass();
    const resultP = loadGoogleFont("Inter", {
      doc: fakeDoc(),
      fetch: okFetch(CSS_INTER),
      FontFace: cls,
      scheduler: fakeScheduler(),
    });
    await tick();
    instances.forEach((i) => i.rejectLoad());
    const result = await resultP;
    expect(result.reason).toBe("load-error");
    expect(result.previewUnavailable).toBe(true);
    expect(result.weights).toEqual(["400", "700"]);
  });

  it("labels a CSP block distinctly from a plain load error", async () => {
    const { cls, instances } = fontFaceClass();
    const doc = fakeDoc();
    const resultP = loadGoogleFont("Inter", {
      doc,
      fetch: okFetch(CSS_INTER),
      FontFace: cls,
      scheduler: fakeScheduler(),
    });
    await tick();
    doc.emit("securitypolicyviolation", {
      blockedURI: "https://fonts.gstatic.com/s/inter/v1/a.woff2",
      violatedDirective: "font-src",
    });
    instances.forEach((i) => i.rejectLoad());
    const result = await resultP;
    expect(result.reason).toBe("csp");
  });

  it("times out provisionally and recovers on a late resolution", async () => {
    const { cls, instances } = fontFaceClass();
    const scheduler = fakeScheduler();
    const onLateResolve = vi.fn();
    const resultP = loadGoogleFont("Inter", {
      doc: fakeDoc(),
      fetch: okFetch(CSS_INTER),
      FontFace: cls,
      scheduler,
      deadlineMs: 3500,
      onLateResolve,
    });
    await tick();
    scheduler.fireAll(); // deadline wins — provisional timeout
    const result = await resultP;
    expect(result.reason).toBe("timeout");
    expect(result.previewUnavailable).toBe(true);
    expect(onLateResolve).not.toHaveBeenCalled();

    // The face resolves AFTER the deadline: the caller is notified to recover.
    instances.forEach((i) => i.resolveLoad());
    await tick();
    expect(onLateResolve).toHaveBeenCalledWith("Inter");
  });

  it("registry.drain removes every face the load added from the document", async () => {
    const { cls, instances } = fontFaceClass();
    const doc = fakeDoc();
    const registry = new FontRegistry();
    const resultP = loadGoogleFont("Inter", {
      doc,
      fetch: okFetch(CSS_INTER),
      FontFace: cls,
      scheduler: fakeScheduler(),
      registry,
    });
    await tick();
    instances.forEach((i) => i.resolveLoad());
    await resultP;
    expect(registry.size(doc)).toBe(2);
    registry.drain(doc);
    expect(registry.size(doc)).toBe(0);
    expect(doc.deleted).toHaveLength(2);
  });
});
