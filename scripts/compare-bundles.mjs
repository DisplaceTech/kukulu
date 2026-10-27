// Compare two attestation bundles side by side, and optionally score their
// result trees against each other (SPEC D-03). It runs each bundle's own
// verifier first, reads files and prints; it never writes a file.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scorePair } from "../mcp/cleanroom.mjs";

const USAGE = "usage: node scripts/compare-bundles.mjs <bundle-a> <bundle-b> [--key-a sha256:<fp>] [--key-b sha256:<fp>] [--trees <dir-a> <dir-b>] [--json]\n";
const DASH = "—";
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const SKIP_DIRS = new Set([".git", "node_modules"]);
const PARAMETERS = ["ngram", "minIdentLen", "commentNgram", "languages"];
const ROLES = ["planner", "implementer", "reviewer", "summarizer"];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fixed = (x) => (typeof x === "number" ? x.toFixed(4) : DASH);
const counts = (list) => {
  const out = {};
  for (const k of list) out[k] = (out[k] ?? 0) + 1;
  return out;
};
const byKey = (o) => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Run the bundle's own verifier; returns the first reason when it neither passes nor is a passing control bundle. */
function verifyOwn(dir, key) {
  const verifier = path.join(dir, "verify.mjs");
  if (!fs.existsSync(verifier)) return { reason: "verify.mjs is missing from it" };
  const run = spawnSync(process.execPath, [verifier, dir, ...(key ? ["--key", key] : []), "--json"], { encoding: "utf8" });
  let verdict = null;
  try {
    verdict = JSON.parse(run.stdout);
  } catch {
    verdict = null;
  }
  if (verdict?.ok === true && (run.status === 0 || run.status === 3)) return { reason: null };
  const first = verdict?.reasons?.[0];
  return { reason: first ? `${first.check}: ${first.reason}` : (run.stderr || "").trim().split("\n")[0] || `exit ${run.status}` };
}

/** What a bundle says about itself, in the nine items the comparison prints; a missing item is null. */
function collect(dir) {
  const manifest = readJson(path.join(dir, "manifest.json"));
  const entries = fs.readFileSync(path.join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const similarityFile = path.join(dir, "similarity.json");
  const similarity = fs.existsSync(similarityFile) ? readJson(similarityFile) : null;

  const gates = entries.filter((e) => e.kind === "gate");
  const stageSeconds = {};
  const open = {};
  for (const e of entries) {
    if (e.kind !== "stage") continue;
    if (e.data?.event === "start") open[e.data.stage] = e.at;
    else if (e.data?.event === "end" && open[e.data.stage]) {
      stageSeconds[e.data.stage] = (stageSeconds[e.data.stage] ?? 0) + Math.round((Date.parse(e.at) - Date.parse(open[e.data.stage])) / 1000);
      delete open[e.data.stage];
    }
  }
  const tokens = {};
  for (const e of entries) {
    if (e.kind !== "usage" || e.data?.error) continue;
    const role = String(e.role ?? "").replace(/^kukulu[-:]/, "");
    for (const [model, m] of Object.entries(e.data?.models ?? {})) {
      const t = ((tokens[role] ??= {})[model] ??= { input: 0, output: 0 });
      t.input += m.input ?? 0;
      t.output += m.output ?? 0;
    }
  }
  const scores = (role) => Object.fromEntries((similarity?.rows ?? []).filter((r) => r.role === role).map((r) => [r.metric, r.score]));
  return {
    modeAndEnforcement: { mode: manifest.mode, level: manifest.enforcement?.level ?? "hook", ...(manifest.enforcement?.egress ? { egress: manifest.enforcement.egress } : {}) },
    gates: { run: gates.length, failed: gates.filter((g) => g.data?.failed).length },
    humanRecords: manifest.human ? { instructions: manifest.human.instructions ?? 0, interventions: manifest.human.interventions ?? 0, verdicts: manifest.human.verdicts ?? 0 } : null,
    denialsByReason: manifest.denials?.byReason ?? null,
    coverageGapsByKind: manifest.coverage?.gaps ? counts(manifest.coverage.gaps.map((g) => g.kind)) : null,
    similarity: similarity ? { verdict: similarity.verdict, negative: scores("negative"), positive: scores("positive") } : null,
    roles: manifest.roles ? Object.fromEntries(ROLES.filter((r) => manifest.roles[r]).map((r) => [r, { model: manifest.roles[r].model, runner: manifest.roles[r].runner, identity: manifest.roles[r].identity?.source ?? "none", family: manifest.roles[r].family }])) : null,
    wallTimePerStage: Object.keys(stageSeconds).length ? stageSeconds : null,
    tokensPerRoleAndModel: Object.keys(tokens).length ? tokens : null,
    _similarityConfig: similarity?.config ?? null,
    _negative: scores("negative"),
  };
}

const ITEMS = [
  ["modeAndEnforcement", "mode and enforcement"],
  ["gates", "gates"],
  ["humanRecords", "human records"],
  ["denialsByReason", "denials by reason"],
  ["coverageGapsByKind", "coverage gaps by kind"],
  ["similarity", "similarity"],
  ["roles", "roles"],
  ["wallTimePerStage", "wall time per stage"],
  ["tokensPerRoleAndModel", "tokens per role and model"],
];

/** The lines (without the `  A: ` prefix handling) that one bundle contributes to one item. */
function linesOf(key, v) {
  if (v === null || v === undefined) return [DASH];
  const joined = (o) => (Object.keys(o).length ? byKey(o).map(([k, n]) => `${k}: ${n}`).join("; ") : "none");
  switch (key) {
    case "modeAndEnforcement": {
      const egress = v.egress ? `; egress: ${byKey(v.egress).map(([hp, c]) => `${hp} ${c.allowed}/${c.denied}`).join(", ")}` : "";
      return [`${v.mode}, ${v.level}${egress}`];
    }
    case "gates": return [`${v.run} run, ${v.failed} failed`];
    case "humanRecords": return [`${v.instructions} instructions, ${v.interventions} interventions, ${v.verdicts} verdicts`];
    case "denialsByReason":
    case "coverageGapsByKind": return [joined(v)];
    case "similarity": return [v.verdict ?? DASH, ...Object.keys(v.negative).map((metric) => `  ${metric}: negative ${fixed(v.negative[metric])} positive ${fixed(v.positive[metric])}`)];
    case "roles": return Object.entries(v).map(([role, r]) => `${role}: ${r.model} on ${r.runner ?? "none"} (${r.identity}, ${r.family})`);
    case "wallTimePerStage": return [byKey(v).map(([stage, s]) => `${stage} ${s} s`).join(", ")];
    case "tokensPerRoleAndModel": return Object.entries(v).map(([role, models]) => `${role}: ${byKey(models).map(([m, t]) => `${m} ${t.input} in / ${t.output} out`).join(", ")}`);
    default: return [DASH];
  }
}

function render(a, b) {
  const out = [];
  for (const [key, title] of ITEMS) {
    out.push(title);
    for (const [label, side] of [["A", a], ["B", b]]) {
      const lines = linesOf(key, side[key]);
      out.push(`  ${label}: ${lines[0]}`);
      for (const extra of lines.slice(1)) out.push(extra.startsWith("  ") ? `  ${extra}` : `  ${label}: ${extra}`);
    }
    out.push("");
  }
  return out;
}

/** Every mapped, text file under a tree, the way kukulu_similarity reads a side. */
function readTree(dir, languages) {
  const files = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const language = languages[path.extname(full)];
        const bytes = fs.readFileSync(full);
        if (language && !bytes.includes(0)) files.push({ path: full, text: bytes.toString("utf8"), language });
      }
    }
  };
  walk(dir);
  return files;
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const positional = [];
  let keyA = null;
  let keyB = null;
  let trees = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") json = true;
    else if (t === "--key-a") keyA = argv[++i] ?? "";
    else if (t === "--key-b") keyB = argv[++i] ?? "";
    else if (t === "--trees") {
      trees = [argv[++i], argv[++i]];
      if (!trees[0] || !trees[1]) trees = [];
    } else if (t.startsWith("--")) {
      io.err(`compare-bundles: unknown option ${t}\n${USAGE}`);
      return 2;
    } else positional.push(t);
  }
  if (positional.length !== 2 || (trees !== null && trees.length !== 2) || [keyA, keyB].some((k) => k !== null && !FINGERPRINT.test(k))) {
    io.err(USAGE);
    return 2;
  }
  const [dirA, dirB] = positional.map((p) => path.resolve(p));
  for (const [dir, key] of [[dirA, keyA], [dirB, keyB]]) {
    const v = verifyOwn(dir, key);
    if (v.reason) {
      io.err(`compare-bundles: ${dir} does not verify: ${v.reason}\n`);
      return 1;
    }
  }
  const a = collect(dirA);
  const b = collect(dirB);

  let cross = null;
  if (trees) {
    const config = a._similarityConfig ?? b._similarityConfig;
    if (!config) {
      io.err("compare-bundles: neither bundle has a similarity.json, so --trees has no scoring parameters\n");
      return 1;
    }
    if (a._similarityConfig && b._similarityConfig) {
      const differs = PARAMETERS.find((k) => JSON.stringify(a._similarityConfig[k]) !== JSON.stringify(b._similarityConfig[k]));
      if (differs) {
        io.err(`compare-bundles: bundle B's similarity parameters differ from A's (${differs})\n`);
        return 1;
      }
    }
    const [treeA, treeB] = trees.map((t) => path.resolve(t));
    for (const t of [treeA, treeB]) {
      if (!fs.existsSync(t) || !fs.statSync(t).isDirectory()) {
        io.err(`compare-bundles: ${t} is not a directory\n`);
        return 1;
      }
    }
    const opts = { ngram: config.ngram, minIdentLen: config.minIdentLen, commentNgram: config.commentNgram };
    const left = readTree(treeA, config.languages);
    const right = readTree(treeB, config.languages);
    if (!left.length || !right.length) {
      io.err("compare-bundles: a tree has no file with an extension in the similarity languages, so there is nothing to score\n");
      return 1;
    }
    cross = scorePair(left, right, opts);
  }

  if (json) {
    const strip = ({ _similarityConfig, _negative, ...rest }) => rest;
    io.out(`${JSON.stringify({ a: strip(a), b: strip(b), ...(cross ? { cross: Object.fromEntries(Object.keys(cross).map((m) => [m, { cross: cross[m], aNegative: a._negative[m] ?? null, bNegative: b._negative[m] ?? null }])) } : {}) }, null, 2)}\n`);
    return 0;
  }
  const lines = render(a, b);
  if (cross) {
    lines.push("cross score");
    for (const metric of Object.keys(cross)) lines.push(`  ${metric}: cross ${fixed(cross[metric])}; A negative ${fixed(a._negative[metric])}; B negative ${fixed(b._negative[metric])}`);
    lines.push("Two independent clean-room builds should score at or near their negative controls.", "");
  }
  io.out(`${lines.join("\n")}${lines.at(-1) === "" ? "" : "\n"}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
