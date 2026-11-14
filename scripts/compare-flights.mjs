// Prints two flights' METRICS.json side by side (SPEC D-01): five sections, or the same data as JSON. It reads two
// files and prints; it never writes one. Imports only node: modules and the pure metrics module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS_VERSION, compareMetrics } from "../mcp/metrics.mjs";
import { scorePair } from "../mcp/cleanroom.mjs";

const USAGE = "usage: node scripts/compare-flights.mjs <a> <b> [--trees <dir-a> <dir-b>] [--json]\n  <a> and <b> are each a METRICS.json file or a directory holding one\n";

// A copy of DEFAULT_SIMILARITY_LANGUAGES in mcp/server.mjs (this script may not import the server); a test keeps the two equal.
const TREE_LANGUAGES = {
  ".rs": "rust", ".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".go": "go", ".py": "python",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript", ".java": "java", ".php": "php",
};
const SKIP_DIRS = new Set([".git", "node_modules", "target"]);

const TITLES = { outcome: "Outcome", wall: "Wall time", rounds: "Rounds", roles: "Roles", friction: "Friction" };

/** One cell: null is n/a, a partial total names the roles it leaves out. */
const cell = (v) => {
  if (v === null || v === undefined) return "n/a";
  if (typeof v === "object" && "partial" in v) return `${cell(v.value)} partial (${v.partial.join(", ")} not recorded)`;
  return String(v);
};
const diffCell = (d) => (d === null ? "" : typeof d === "number" ? (d > 0 ? `+${d}` : String(d)) : d);

function headerLine(tag, h) {
  const harness = Array.isArray(h.harness) && h.harness.length ? h.harness.map((x) => `${x.name} ${x.version ?? "unknown"}`).join(", ") : "n/a";
  return `${tag}: ${h.flight ?? "n/a"}  harness ${harness}  plugin ${h.plugin ?? "n/a"}  ${h.mode ?? "n/a"}  spec ${h.specSha256 ? h.specSha256.slice(0, 12) : "n/a"}`;
}

function render(c) {
  const lines = [headerLine("A", c.header.a), headerLine("B", c.header.b)];
  if (!c.header.sameSpec) lines.push("the two flights were built from different specs; the comparison below is not like for like");
  lines.push("");
  for (const [key, title] of Object.entries(TITLES)) {
    lines.push(title);
    const rows = c.sections[key].map((r) => [r.label, cell(r.a), cell(r.b), diffCell(r.diff)]);
    const widths = [0, 1, 2].map((i) => Math.max(0, ...rows.map((r) => r[i].length)));
    for (const r of rows) lines.push(`  ${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`.trimEnd());
    lines.push("");
  }
  // A blank line follows each section but the last, so the output ends in one newline.
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Every file with a known source extension under a tree, in sorted order, as kukulu_similarity reads a side. */
function readTree(dir) {
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const language = TREE_LANGUAGES[path.extname(full)];
        const bytes = fs.readFileSync(full);
        if (language && !bytes.includes(0)) files.push({ path: full, text: bytes.toString("utf8"), language });
      }
    }
  };
  walk(dir);
  return files;
}

const lineCount = (files) => files.reduce((t, f) => t + f.text.split("\n").filter((l, i, all) => i < all.length - 1 || l !== "").length, 0);

/** The `Trees` section's lines and the `trees` object of --json. Throws an Error whose message is the exit-2 line. */
function compareTrees(pathA, pathB) {
  const sides = [pathA, pathB].map((p) => {
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw new Error(`${p} is not a directory`);
    const files = readTree(path.resolve(p));
    if (!files.length) throw new Error(`${p} has no file with a known source extension`);
    return files;
  });
  const similarity = scorePair(sides[0], sides[1], {});
  return { a: { files: sides[0].length, lines: lineCount(sides[0]) }, b: { files: sides[1].length, lines: lineCount(sides[1]) }, similarity };
}

function renderTrees(t) {
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  const rows = [["files", String(t.a.files), String(t.b.files), sign(t.b.files - t.a.files)], ["lines", String(t.a.lines), String(t.b.lines), sign(t.b.lines - t.a.lines)]];
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = ["Trees", ...rows.map((r) => `  ${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`)];
  const labelWidth = Math.max(...Object.keys(t.similarity).map((k) => k.length));
  for (const [metric, score] of Object.entries(t.similarity)) lines.push(`  ${metric.padEnd(labelWidth)}  ${score.toFixed(4)}`);
  return lines.join("\n");
}

/** The metrics object at `p` (a file, or a directory holding METRICS.json); throws an Error whose message is the exit-2 line. */
function load(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`${p} does not exist`);
  const file = fs.statSync(abs).isDirectory() ? path.join(abs, "METRICS.json") : abs;
  if (!fs.existsSync(file)) throw new Error(`${p} has no METRICS.json; pass the file, or a directory that holds one`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not JSON (${e.message.split("\n")[0]})`);
  }
  if (parsed === null || typeof parsed !== "object" || parsed.v !== METRICS_VERSION) {
    throw new Error(`${file} is metrics version ${parsed?.v ?? "unknown"}; this script reads version ${METRICS_VERSION}`);
  }
  return parsed;
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const positional = [];
  let json = false;
  let trees = null;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--trees") {
      trees = [];
      while (trees.length < 2 && i + 1 < argv.length && !argv[i + 1].startsWith("--")) trees.push(argv[++i]);
    } else if (t.startsWith("--")) {
      io.err(`compare-flights: unknown option ${t}\n${USAGE}`);
      return 2;
    } else positional.push(t);
  }
  if (positional.length !== 2) {
    io.err(`compare-flights: give exactly two flights\n${USAGE}`);
    return 2;
  }
  if (trees !== null && trees.length !== 2) {
    io.err(`compare-flights: --trees takes two directories\n${USAGE}`);
    return 2;
  }
  let a;
  let b;
  try {
    a = load(positional[0]);
    b = load(positional[1]);
  } catch (e) {
    io.err(`compare-flights: ${e.message}\n`);
    return 2;
  }
  let measured = null;
  if (trees !== null) {
    try {
      measured = compareTrees(trees[0], trees[1]);
    } catch (e) {
      io.err(`compare-flights: ${e.message}\n`);
      return 2;
    }
  }
  const c = compareMetrics(a, b);
  if (json) io.out(`${JSON.stringify(measured ? { ...c, trees: measured } : c, null, 2)}\n`);
  else io.out(measured ? `${render(c)}\n${renderTrees(measured)}\n` : render(c));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
