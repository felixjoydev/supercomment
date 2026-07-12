import { describe, it, expect } from "vitest";
import {
  clusterMarkers,
  partitionByViewport,
  DEFAULT_CLUSTER_THRESHOLD_PX,
  type MarkerInput,
} from "./cluster.js";
import { MarkerLayer } from "./render.js";
import { edgeDirection } from "../core/geometry.js";
import type { MarkerComment } from "../core/types.js";
import type { ThreadClient } from "../submit/thread.js";
import {
  makeFakeDom,
  makeRect,
  type FakeDocument,
  type FakeElement,
} from "../test/dom-double.js";

function marker(n: number, x: number, y: number): MarkerInput {
  return { number: n, rect: makeRect(x, y, 0, 0) };
}

describe("clusterMarkers", () => {
  it("collapses two markers within the threshold into a count badge", () => {
    const clusters = clusterMarkers(
      [marker(1, 100, 100), marker(2, 110, 105)],
      DEFAULT_CLUSTER_THRESHOLD_PX,
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.isCluster).toBe(true);
    expect(clusters[0]!.numbers).toEqual([1, 2]);
  });

  it("keeps far-apart markers as separate single pins", () => {
    const clusters = clusterMarkers(
      [marker(1, 0, 0), marker(2, 500, 500)],
      DEFAULT_CLUSTER_THRESHOLD_PX,
    );
    expect(clusters.length).toBe(2);
    expect(clusters.every((c) => !c.isCluster)).toBe(true);
  });
});

describe("partitionByViewport / edgeDirection", () => {
  it("flags an off-screen target and yields a pointing direction", () => {
    const viewport = { width: 1000, height: 800 };
    const { visible, offscreen } = partitionByViewport(
      [marker(1, 500, 400), marker(2, 1200, 400)],
      viewport,
    );
    expect(visible.map((m) => m.number)).toEqual([1]);
    expect(offscreen.map((m) => m.number)).toEqual([2]);
    expect(edgeDirection(offscreen[0]!.point, viewport)).toBe("right");
  });

  it("returns a diagonal direction for a corner-offscreen point", () => {
    expect(
      edgeDirection({ x: -50, y: -50 }, { width: 1000, height: 800 }),
    ).toBe("top-left");
  });
});

describe("MarkerLayer rendering", () => {
  function setup(): { doc: FakeDocument; layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { doc, layer, parent };
  }

  it("tracks the element as the page scrolls (document-space anchors, fixes drift)", () => {
    const { doc, layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 10, 10) });
    layer.render({ width: 1000, height: 800 });
    const pin = () => parent.querySelector(".sc-marker") as any;
    expect(pin().style.top).toBe("105px"); // center at scroll 0
    (doc.defaultView as any).scrollY = 50;
    (doc.defaultView as any).scrollX = 20;
    layer.render({ width: 1000, height: 800 });
    expect(pin().style.top).toBe("55px"); // 105 - 50 scroll
    expect(pin().style.left).toBe("85px"); // 105 - 20 scroll
  });

  it("drops a zero-size marker at the origin (no top-left pins) but keeps point anchors elsewhere", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(0, 0, 0, 0) }); // unplaced -> dropped
    layer.add({ number: 2, rect: makeRect(200, 200, 0, 0) }); // valid point -> kept
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(1);
  });

  it("renders one pin per distinct on-screen marker", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0) });
    layer.add({ number: 2, rect: makeRect(500, 500, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(2);
    expect(layer.renderedEdgeCount()).toBe(0);
  });

  it("renders a single cluster badge for two nearby markers", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0) });
    layer.add({ number: 2, rect: makeRect(108, 104, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(1);
  });

  it("renders an edge indicator for an off-screen marker", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(2000, 100, 0, 0) });
    layer.render({ width: 1000, height: 800 });
    expect(layer.renderedPinCount()).toBe(0);
    expect(layer.renderedEdgeCount()).toBe(1);
  });
});

describe("MarkerLayer existing comments (U12)", () => {
  function setup(): { layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { layer, parent };
  }

  it("addMany renders a pin per existing comment in one paint", () => {
    const { layer } = setup();
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0) },
      { number: 2, rect: makeRect(500, 500, 0, 0), isStale: true },
    ]);
    layer.render({ width: 1000, height: 800 });
    expect(layer.count()).toBe(2);
    expect(layer.renderedPinCount()).toBe(2);
  });

  it("addMany of an empty list paints nothing (clean empty render)", () => {
    const { layer } = setup();
    layer.addMany([]);
    expect(layer.count()).toBe(0);
    expect(layer.renderedPinCount()).toBe(0);
  });

  it("add is idempotent by number: a live re-read that placed the pin first, then the optimistic add, yields ONE pin (no duplicate)", () => {
    const { layer, parent } = setup();
    // A live broadcast/poll re-read placed the reviewer's own comment #1 first,
    // as a template (kind derived from the change-set).
    layer.addMany([
      {
        number: 1,
        rect: makeRect(100, 100, 0, 0),
        content: { note: "n", authorDisplayName: "Alex", kind: "template" },
      },
    ]);
    // The submit's optimistic add then runs for the SAME number — must update in
    // place, not stack a second pin.
    layer.add({
      number: 1,
      rect: makeRect(120, 120, 0, 0),
      content: { note: "n", authorDisplayName: "Alex", kind: "template" },
    });
    layer.render({ width: 1000, height: 800 });
    expect(layer.count()).toBe(1);
    expect(layer.renderedPinCount()).toBe(1);
    expect(parent.querySelectorAll(".sc-marker.sc-template").length).toBe(1);
  });

  it("addMany is idempotent by number (a racing re-add never stacks a duplicate pin)", () => {
    const { layer } = setup();
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0) },
      { number: 2, rect: makeRect(500, 500, 0, 0) },
    ]);
    // Simulate the mount load + a live-sync poll both handing back #1 and #2.
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0) },
      { number: 2, rect: makeRect(500, 500, 0, 0) },
      { number: 3, rect: makeRect(300, 300, 0, 0) },
    ]);
    layer.render({ width: 1000, height: 800 });
    expect(layer.count()).toBe(3); // 1, 2 once each + the genuinely new 3
    expect(layer.renderedPinCount()).toBe(3);
  });

  it("renders a stale existing comment with the sc-stale class", () => {
    const { layer, parent } = setup();
    layer.addMany([
      { number: 1, rect: makeRect(100, 100, 0, 0), isStale: false },
      { number: 2, rect: makeRect(500, 500, 0, 0), isStale: true },
    ]);
    layer.render({ width: 1000, height: 800 });
    const stale = parent.querySelectorAll(".sc-marker.sc-stale");
    expect(stale.length).toBe(1);
    expect(stale[0]!.textContent).toBe("2");
  });
});

describe("MarkerLayer comment popover (U12)", () => {
  function setup(): { layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { layer, parent };
  }

  const content = (over: Partial<MarkerComment> = {}): MarkerComment => ({
    note: "Make the header bigger",
    authorDisplayName: "Ada",
    intent: "change",
    severity: "important",
    status: "open",
    createdAt: "",
    ...over,
  });

  // The delegated click listener lives on the container; in a real DOM a click on
  // a pin bubbles up to it with e.target = the pin. The DOM double does not
  // bubble, so dispatch on the container with the pin as the event target.
  function clickPin(parent: any, pin: any): void {
    parent
      .querySelector(".sc-marker-container")!
      .dispatch("click", { target: pin });
  }

  it("opens a popover with the note + author when a pin is clicked", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });

    expect(layer.hasOpenPopover()).toBe(false);
    clickPin(parent, parent.querySelectorAll(".sc-marker")[0]!);

    const pop = parent.querySelector(".sc-comment-pop");
    expect(pop).not.toBeNull();
    expect(layer.hasOpenPopover()).toBe(true);
    expect(pop!.textContent).toContain("Make the header bigger");
    expect(pop!.textContent).toContain("Ada");
    expect(pop!.textContent).toContain("#1");
  });

  it("clicking the same pin again closes the popover", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });
    const pin = parent.querySelectorAll(".sc-marker")[0]!;

    clickPin(parent, pin);
    expect(layer.hasOpenPopover()).toBe(true);
    clickPin(parent, pin);
    expect(layer.hasOpenPopover()).toBe(false);
    expect(parent.querySelector(".sc-comment-pop")).toBeNull();
  });

  it("closePopover() removes the open popover", () => {
    const { layer, parent } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content: content() });
    layer.render({ width: 1000, height: 800 });
    clickPin(parent, parent.querySelectorAll(".sc-marker")[0]!);
    expect(layer.hasOpenPopover()).toBe(true);

    layer.closePopover();
    expect(layer.hasOpenPopover()).toBe(false);
    expect(parent.querySelector(".sc-comment-pop")).toBeNull();
  });

  it("clicking a second pin switches the popover content", () => {
    const { layer, parent } = setup();
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 0, 0),
      content: content({ note: "First note", authorDisplayName: "Ada" }),
    });
    layer.add({
      number: 2,
      rect: makeRect(600, 500, 0, 0),
      content: content({ note: "Second note", authorDisplayName: "Grace" }),
    });
    layer.render({ width: 1000, height: 800 });

    const pins = parent.querySelectorAll(".sc-marker");
    const pin1 = pins.find((p: any) => p.getAttribute("data-numbers") === "1")!;
    const pin2 = pins.find((p: any) => p.getAttribute("data-numbers") === "2")!;

    clickPin(parent, pin1);
    expect(parent.querySelector(".sc-comment-pop")!.textContent).toContain(
      "First note",
    );

    clickPin(parent, pin2);
    // Exactly one popover, now showing the second comment's content.
    expect(parent.querySelectorAll(".sc-comment-pop").length).toBe(1);
    const pop = parent.querySelector(".sc-comment-pop")!;
    expect(pop.textContent).toContain("Second note");
    expect(pop.textContent).toContain("Grace");
    expect(pop.textContent).not.toContain("First note");
  });
});

describe("MarkerLayer — template treatment (U16/R11)", () => {
  it("renders a distinct template pin and tags its popover", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    const content: MarkerComment = {
      note: "Make the hero bigger",
      authorDisplayName: "Alex",
      kind: "template",
    };
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content });

    expect(parent.querySelector(".sc-marker.sc-template")).not.toBeNull();

    layer.showPopover([1], { x: 100, y: 100 });
    const tag = parent.querySelector(".sc-comment-tag");
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toContain("Template");
  });

  it("notifies onPopoverComments with the popover's comments on open and null on close (U9 live preview)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const seen: Array<MarkerComment[] | null> = [];
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined, // cluster threshold
      undefined, // thread client
      undefined, // current user
      undefined, // uploader
      undefined, // laneClient (U11)
      (comments) => seen.push(comments),
    );
    const content: MarkerComment = {
      id: "c9",
      note: "Make the hero bigger",
      authorDisplayName: "Alex",
      kind: "template",
      changeSet: {
        authoredCommit: "deadbeef",
        ops: [
          {
            opId: "o1",
            type: "setText",
            target: { selector: "h1", anchors: [{ type: "id", value: "hero" }] },
            before: "Welcome",
            after: "Welcome, bigger",
          },
        ],
      },
    };
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0), content });

    layer.showPopover([1], { x: 100, y: 100 });
    expect(seen.at(-1)).toEqual([content]); // opened → fires the popover's comments

    layer.closePopover();
    expect(seen.at(-1)).toBeNull(); // closed → fires null so the preview reverts
  });

  it("keeps the template treatment on a stale template pin (composed classes)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    layer.add({
      number: 3,
      rect: makeRect(100, 100, 0, 0),
      isStale: true,
      content: { note: "edit", authorDisplayName: "A", kind: "template" },
    });
    const pin = parent.querySelector(".sc-marker.sc-template");
    expect(pin).not.toBeNull(); // template treatment not lost to stale
    expect(pin!.className).toContain("sc-stale"); // still marked stale too
  });

  it("keeps an ordinary comment pin plain (no template class/tag)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(doc as unknown as Document, parent as unknown as HTMLElement);
    layer.add({
      number: 2,
      rect: makeRect(100, 100, 0, 0),
      content: { note: "Ordinary", authorDisplayName: "Sam" },
    });
    expect(parent.querySelector(".sc-marker.sc-template")).toBeNull();
    expect(parent.querySelector(".sc-marker")).not.toBeNull();
    layer.showPopover([2], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-comment-tag")).toBeNull();
  });

  function stubThread(): { thread: ThreadClient; listedFor: () => string } {
    let listed = "";
    const thread = {
      listReplies: async (id: string) => {
        listed = id;
        return [];
      },
      createReply: async () => null,
      resolve: async () => true,
      deleteReply: async () => true,
      deleteThread: async () => true,
      editComment: async () => true,
      markRead: async () => true,
      markUnread: async () => true,
      signCapture: async (path: string) => `https://signed.example/${path}`,
    } as unknown as ThreadClient;
    return { thread, listedFor: () => listed };
  }

  it("renders an interactive thread (reply box + actions) for a member", async () => {
    const { thread, listedFor } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role: "member" },
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-reply-input")).not.toBeNull();
    expect(parent.querySelector(".sc-reply-send")).not.toBeNull();
    expect(parent.querySelector(".sc-act-done")).not.toBeNull();
    expect(parent.querySelector(".sc-act-more")).not.toBeNull(); // member: delete menu
    await Promise.resolve();
    expect(listedFor()).toBe("c1"); // replies loaded for the thread
  });

  it("U11: a member with a laneClient gets an interactive lane control", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const laneClient = { setLane: async () => true };
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      undefined, // thread not required for the lane control
      { displayName: "Dev", role: "member" },
      undefined, // uploader
      laneClient,
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Dev", status: "open", lane: "backlog" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-comment-lanes")).not.toBeNull();
    const chips = parent.querySelectorAll(".sc-lane-chip");
    expect(chips.length).toBe(3); // backlog / ready_for_agent / in_review
    // the current lane (backlog) is highlighted + disabled
    expect(parent.querySelector(".sc-lane-chip.is-current")).not.toBeNull();
  });

  it("U11: a reviewer sees the read-only lane chip (audience label), no control", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const laneClient = { setLane: async () => true };
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      undefined,
      { displayName: "Reviewer", role: "guest" },
      undefined,
      laneClient,
    );
    layer.add({
      number: 2,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c2", note: "hi", authorDisplayName: "Reviewer", status: "open", lane: "ready_for_agent" },
    });
    layer.showPopover([2], { x: 100, y: 100 });
    expect(parent.querySelectorAll(".sc-lane-chip").length).toBe(0);
    const chip = parent.querySelector(".sc-comment-lane");
    expect(chip).not.toBeNull();
    // reviewer label for ready_for_agent is "In progress" — never "agent".
    expect(chip!.textContent).toBe("In progress");
  });

  it("shows reviewer reference images as popover thumbnails, signed on open (R19)", async () => {
    const { thread } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role: "member" },
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: {
        id: "c1",
        note: "hi",
        authorDisplayName: "Ada",
        status: "open",
        referenceImages: ["prev/a.png", "prev/b.webp"],
      },
    });
    layer.showPopover([1], { x: 100, y: 100 });

    // Caption is synchronous and shows the count when there is more than one.
    const cap = parent.querySelector(".sc-ref-gallery-cap");
    expect(cap).not.toBeNull();
    expect(cap!.textContent).toContain("2");

    // Thumbnails fill after each ref signs (a macrotask flush covers the awaits).
    await new Promise((r) => setTimeout(r));
    const shots = parent.querySelectorAll(".sc-shot");
    expect(shots.length).toBe(2);
    const img = shots[0]!.children[0] as unknown as { tagName: string; src: string };
    expect(img.tagName).toBe("IMG");
    expect(img.src).toBe("https://signed.example/prev/a.png");
  });

  it("omits the reference gallery when no thread client is wired (no signer)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: {
        note: "hi",
        authorDisplayName: "Ada",
        referenceImages: ["prev/a.png"],
      },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-ref-gallery")).toBeNull();
  });

  it("shows the reply-image attach control when an uploader is wired (R19)", () => {
    const { thread } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role: "member" },
      { uploadDataUrl: async () => "prev/x.png" },
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-reply-attach")).not.toBeNull();
  });

  it("omits the reply-image attach control when no uploader is wired", () => {
    const { thread } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role: "member" },
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-reply-attach")).toBeNull();
  });

  // --- Author edit/delete gate (0050) ---
  function manageLayer(
    content: Record<string, unknown>,
    role: "guest" | "member",
  ) {
    const { thread } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role },
    );
    layer.add({ number: 1, rect: makeRect(100, 100, 10, 10), content: content as never });
    layer.showPopover([1], { x: 100, y: 100 });
    const items = (parent.querySelectorAll(".sc-act-menu-item") as ArrayLike<FakeElement>);
    return { parent, itemText: Array.from(items).map((e) => e.textContent) };
  }

  it("shows Edit + Delete on the author's own untouched comment (0050)", () => {
    const { itemText } = manageLayer(
      { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open", isOwn: true },
      "guest",
    );
    expect(itemText).toContain("Edit comment");
    expect(itemText).toContain("Delete comment");
  });

  it("explains the lock (no edit) on the author's SENT comment", () => {
    const { parent, itemText } = manageLayer(
      { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open", isOwn: true, isSent: true },
      "guest",
    );
    expect(itemText).not.toContain("Edit comment");
    const note = parent.querySelector(".sc-act-menu-note");
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/agent/i);
  });

  it("locks (replied) the author's comment once someone replies", () => {
    const { parent, itemText } = manageLayer(
      { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open", isOwn: true, hasReplies: true },
      "guest",
    );
    expect(itemText).not.toContain("Delete comment");
    expect(parent.querySelector(".sc-act-menu-note")!.textContent).toMatch(/repl/i);
  });

  it("shows no manage menu for a guest viewing someone else's comment", () => {
    const { parent } = manageLayer(
      { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open", isOwn: false },
      "guest",
    );
    expect(parent.querySelector(".sc-act-more")).toBeNull();
  });

  it("keeps the owner delete override for a member on an engaged comment", () => {
    const { itemText } = manageLayer(
      {
        id: "c1",
        note: "hi",
        authorDisplayName: "Ada",
        status: "open",
        isOwn: false,
        isSent: true,
        hasReplies: true,
      },
      "member",
    );
    expect(itemText).toContain("Delete comment"); // owner override survives engagement
    expect(itemText).not.toContain("Edit comment"); // a member never edits another's words
  });

  it("hides the delete-thread menu from a guest, but still allows reply + mark-done", () => {
    const { thread } = stubThread();
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Guest", role: "guest" },
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Guest", status: "open" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-act-more")).toBeNull(); // guest never deletes a thread
    expect(parent.querySelector(".sc-act-done")).not.toBeNull(); // can mark done
    expect(parent.querySelector(".sc-reply-input")).not.toBeNull(); // can reply
  });

  it("stays read-only when no thread client is wired (tunnel / tests)", () => {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
    );
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    expect(parent.querySelector(".sc-reply-input")).toBeNull();
    expect(parent.querySelector(".sc-act-done")).toBeNull();
  });
});

describe("MarkerLayer — live refresh (hasNumber / updateContent)", () => {
  function setup(): { doc: FakeDocument; layer: MarkerLayer; parent: any } {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    doc.body.appendChild(parent);
    const layer = new MarkerLayer(doc as unknown as Document, parent as any);
    return { doc, layer, parent };
  }

  it("hasNumber reflects which comment pins are placed", () => {
    const { layer } = setup();
    layer.add({ number: 7, rect: makeRect(100, 100, 0, 0) });
    expect(layer.hasNumber(7)).toBe(true);
    expect(layer.hasNumber(8)).toBe(false);
  });

  it("updateContent restyles a pin marked done elsewhere (dims to sc-resolved)", () => {
    const { layer, parent } = setup();
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 0, 0),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open" },
    });
    layer.render({ width: 1000, height: 800 });
    expect(parent.querySelector(".sc-marker.sc-resolved")).toBeNull();

    layer.updateContent(1, {
      id: "c1",
      note: "hi",
      authorDisplayName: "Ada",
      status: "resolved",
    });
    expect(parent.querySelector(".sc-marker.sc-resolved")).not.toBeNull();
  });

  it("updateContent refreshes the note shown in the popover", () => {
    const { layer, parent } = setup();
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 0, 0),
      content: { id: "c1", note: "old note", authorDisplayName: "Ada" },
    });
    layer.updateContent(1, { id: "c1", note: "new note", authorDisplayName: "Ada" });
    layer.showPopover([1], { x: 100, y: 100 });
    const pop = parent.querySelector(".sc-comment-pop")!;
    expect(pop.textContent).toContain("new note");
    expect(pop.textContent).not.toContain("old note");
  });

  it("updateContent is a no-op for an unplaced number", () => {
    const { layer } = setup();
    layer.add({ number: 1, rect: makeRect(100, 100, 0, 0) });
    expect(() =>
      layer.updateContent(99, { note: "x", authorDisplayName: "Y" }),
    ).not.toThrow();
    expect(layer.count()).toBe(1);
  });
});

describe("MarkerLayer — live reply refresh (refreshOpenReplies)", () => {
  function countingThread(): { thread: ThreadClient; calls: string[] } {
    const calls: string[] = [];
    const thread = {
      listReplies: async (id: string) => {
        calls.push(id);
        return [];
      },
      createReply: async () => null,
      resolve: async () => true,
      deleteReply: async () => true,
      deleteThread: async () => true,
      markRead: async () => {},
    } as unknown as ThreadClient;
    return { thread, calls };
  }

  function layerWithThread(thread: ThreadClient) {
    const { doc } = makeFakeDom();
    const parent = doc.createElement("div");
    const layer = new MarkerLayer(
      doc as unknown as Document,
      parent as unknown as HTMLElement,
      undefined,
      thread,
      { displayName: "Ada", role: "member" },
    );
    return { layer, parent };
  }

  it("re-fetches replies for the open thread when a reply arrives live", async () => {
    const { thread, calls } = countingThread();
    const { layer } = layerWithThread(thread);
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada", status: "open" },
    });
    layer.showPopover([1], { x: 100, y: 100 });
    await Promise.resolve();
    expect(calls).toEqual(["c1"]); // loaded once on open

    layer.refreshOpenReplies();
    await Promise.resolve();
    expect(calls).toEqual(["c1", "c1"]); // reloaded live, same thread
  });

  it("is a no-op when no popover is open", () => {
    const { thread, calls } = countingThread();
    const { layer } = layerWithThread(thread);
    layer.add({
      number: 1,
      rect: makeRect(100, 100, 10, 10),
      content: { id: "c1", note: "hi", authorDisplayName: "Ada" },
    });
    layer.refreshOpenReplies(); // nothing open
    expect(calls).toEqual([]);
  });
});
