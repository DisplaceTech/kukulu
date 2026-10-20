// Name check: the display name carries a macron over the first u in prose and the
// identifier is `kukulu` (ASCII) everywhere a machine reads it. Neither rule
// can be a line pattern in docs/kukulu.json's constraints, because they depend
// on whether the text is code or prose, so they live here. scripts/lint.sh runs
// it, which puts it in `npm run lint`, pre-commit and CI.
//
// Usage: node scripts/check-names.mjs [root]
//
// The macron letter and the okina are written as escapes in this file so
// that the check does not trip over its own source.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const U = "\u016b";
const OKINA = "\u02bb";
const DISPLAY = `K${U}kulu`;

// History is not rewritten: archived flights, earlier plans, feedback and the
// 0.5.0 spec keep the names they were written with. CHANGELOG.md is history
// below its newest entry. The rename plan itself quotes
// the rules it describes, including a bare macron letter.
const HISTORY = [/^docs\/flights\//, /^docs\/plans\//, /^docs\/feedback\//, /^docs\/SPEC\.md$/];
const PLAN_EXEMPT = /^docs\/plans\/rename-kukulu\.md$/;

const problems = [];
const fail = (file, line, message) => problems.push(`check-names: ${file}${line ? `:${line}` : ""}: ${message}`);

function listFiles() {
  if (fs.existsSync(path.join(root, ".git"))) {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
    return out.split("\0").filter(Boolean).filter((f) => fs.existsSync(path.join(root, f)));
  }
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk("");
  return files;
}

/** Drop what is code or a link, so only prose is left to judge. Line count is preserved. */
function proseOf(text) {
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
    .replace(/\]\([^)\n]*\)/g, "]()")
    .replace(/https?:\/\/\S+/g, " ");
}

// Another project's real name is private: docs/feedback/.private-names (gitignored,
// one `<label> <real name>` line each) lists them, and no tracked file outside the
// recorded history may contain one. A failure cites the entry's number, never the name.
const DENYLIST = path.join(root, "docs", "feedback", ".private-names");
const NAMES_EXEMPT = [/^docs\/feedback\//, /^test\/fixtures\//];
const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let denied = [];
if (fs.existsSync(DENYLIST)) {
  denied = fs.readFileSync(DENYLIST, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l, i) => {
      const at = l.search(/\s/);
      return { n: i + 1, name: at < 0 ? "" : l.slice(at).trim() };
    })
    .filter((e) => e.name)
    .map((e) => ({ n: e.n, re: new RegExp(`\\b${escapeRegExp(e.name)}\\b`, "i") }));
} else {
  process.stdout.write("check-names: private-name check skipped (no docs/feedback/.private-names)\n");
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// The macron letter belongs only to the standalone word, never to an identifier, path, key
// or URL. Touching an identifier character, or a file extension, makes it one.
const STANDALONE = new RegExp(`(?<![A-Za-z0-9_/:@])${DISPLAY}(?![A-Za-z0-9_/:@]|\\.[A-Za-z0-9])`, "g");
const NFD = new RegExp(`[uU]\u0304`);
const ASCII_PROSE = /\bKukulu\b/g;
const APOSTROPHE_FORMS = [/Hawai['\u2019\u2018]i/g, /['\u2019\u2018]\u014dlelo/g];

for (const file of listFiles()) {
  if (/[^\x00-\x7f]/.test(file)) fail(file, 0, "path contains non-ASCII characters; paths use the ASCII identifier `kukulu`, never the macron");
  if (PLAN_EXEMPT.test(file)) continue;

  let text;
  try {
    text = fs.readFileSync(path.join(root, file), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;

  if (NFD.test(text)) fail(file, 0, "contains a decomposed u + U+0304; store the macron letter as the single NFC character U+016B");

  const spans = [...text.matchAll(STANDALONE)].map((m) => [m.index, m.index + m[0].length]);
  for (const m of text.matchAll(new RegExp(U, "g"))) {
    if (spans.some(([from, to]) => m.index >= from && m.index < to)) continue;
    fail(file, lineOf(text, m.index), `a ${U} outside the standalone word ${DISPLAY}; identifiers, paths, keys, env vars and URLs are ASCII (kukulu, KUKULU_)`);
    break;
  }

  if (denied.length && !NAMES_EXEMPT.some((x) => x.test(file))) {
    for (const entry of denied) {
      const hit = text.split("\n").findIndex((l) => entry.re.test(l));
      if (hit >= 0) fail(file, hit + 1, `contains private project name #${entry.n} (see docs/feedback/.private-names); replace it with its label`);
    }
  }

  if (!file.endsWith(".md")) continue;
  let prose = proseOf(text);
  if (file === "CHANGELOG.md") {
    const cut = prose.search(/^## \[0\.5\.0\]/m);
    if (cut !== -1) prose = prose.slice(0, cut);
  } else if (HISTORY.some((h) => h.test(file))) {
    continue;
  }
  for (const m of prose.matchAll(ASCII_PROSE)) {
    fail(file, lineOf(prose, m.index), `the display name is written ${DISPLAY} in prose, with the macron; ASCII spellings belong in code spans only`);
  }
  for (const re of APOSTROPHE_FORMS) {
    for (const m of prose.matchAll(re)) {
      fail(file, lineOf(prose, m.index), `write ${m[0].replace(/[\u2018\u2019']/, OKINA)} with the ${OKINA}okina (U+02BB), not an apostrophe`);
    }
  }
}

if (problems.length) {
  for (const p of problems) process.stderr.write(`${p}\n`);
  process.exit(1);
}
process.stdout.write("check-names: ok\n");
