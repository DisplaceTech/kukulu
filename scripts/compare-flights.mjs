// Prints two flights' METRICS.json side by side (SPEC D-01): five sections, or the same data as JSON. It reads two
// files and prints; it never writes one. Imports only node: modules and the pure metrics module.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS_VERSION, compareMetrics } from "../mcp/metrics.mjs";

const USAGE = "usage: node scripts/compare-flights.mjs <a> <b> [--trees <dir-a> <dir-b>] [--json]\n  <a> and <b> are each a METRICS.json file or a directory holding one\n";

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
      trees = [argv[++i], argv[++i]];
    } else if (t.startsWith("--")) {
      io.err(`compare-flights: unknown option ${t}\n${USAGE}`);
      return 2;
    } else positional.push(t);
  }
  if (positional.length !== 2) {
    io.err(`compare-flights: give exactly two flights\n${USAGE}`);
    return 2;
  }
  if (trees !== null) {
    io.err("compare-flights: --trees is not available yet\n");
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
  const c = compareMetrics(a, b);
  io.out(json ? `${JSON.stringify(c, null, 2)}\n` : render(c));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
