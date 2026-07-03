// QA gate: scan the rendered text of every route for banned characters.
// Bans em/en/figure/horizontal dashes, exclamation marks, and emoji in text
// nodes. Intentional glyphs are allowed: the arrow (→), the footer heart (♡),
// and the comparison check (✓). Requires the built site to be served; pass BASE
// (default http://localhost:4311). Exits non-zero if anything is found.
const BASE = process.env.BASE || "http://localhost:4311";

const DASH = /[‒–—―]/; // figure, en, em, horizontal bar
const ALLOW_SYMBOLS = new Set(["♡", "✓"]); // ♡ heart, ✓ check

function isEmoji(cp) {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    cp === 0xfe0f ||
    cp === 0x20e3
  );
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#8211;/g, "–")
    .replace(/&#x2014;/gi, "—")
    .replace(/&#x2013;/gi, "–")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function context(text, index) {
  return text.slice(Math.max(0, index - 40), index + 40).replace(/\s+/g, " ").trim();
}

function scan(text) {
  const problems = [];
  const dm = text.match(DASH);
  if (dm) problems.push({ kind: "dash", char: dm[0], ctx: context(text, text.indexOf(dm[0])) });
  const ex = text.indexOf("!");
  if (ex !== -1) problems.push({ kind: "exclamation", char: "!", ctx: context(text, ex) });
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (!ALLOW_SYMBOLS.has(ch) && isEmoji(cp)) {
      problems.push({ kind: "emoji", char: `U+${cp.toString(16).toUpperCase()}`, ctx: context(text, i) });
      break;
    }
    i += ch.length;
  }
  return problems;
}

async function routeList() {
  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const paths = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  paths.push("/preview/home-v1", "/preview/home-v2", "/docs", "/__qa_missing_route__");
  return [...new Set(paths)];
}

const routes = await routeList();
let failures = 0;
for (const path of routes) {
  const res = await fetch(`${BASE}${path}`);
  const html = await res.text();
  const problems = scan(visibleText(html));
  if (problems.length) {
    failures += problems.length;
    for (const p of problems) {
      console.error(`FAIL ${path} [${p.kind} ${p.char}] …${p.ctx}…`);
    }
  }
}

if (failures) {
  console.error(`\nQA gate failed: ${failures} banned character(s) across ${routes.length} routes.`);
  process.exit(1);
}
console.log(`QA gate passed: ${routes.length} routes clean (no dashes, exclamations, or emoji in text).`);
