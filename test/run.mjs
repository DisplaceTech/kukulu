// Runs every suite as its own process — one suite's crash cannot take the rest
// with it, and each gets a clean set of temp repos. `npm test` calls this;
// `node test/<suite>.mjs` runs one on its own.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ["plugin", "manifests, frontmatter, hook wiring, documentation links"],
  ["protocol", "JSON-RPC framing, handshake, tool discovery"],
  ["state", "foundry_status and the foundry_next decision table"],
  ["implement", "run_start, task_next/done/block, verify, run_finish"],
  ["review", "review_submit and summary_commit"],
  ["routing", "config merge, foundry_agents_sync, foundry_config_show"],
  ["constraints", "docs/foundry.json constraints, their fixtures, and foundry_verify's scan"],
  ["feedback", "foundry_feedback_log, .foundry/feedback.jsonl, and the feedback policy"],
  ["streams", "parallel waves: stream tags, partition validation, worktrees, merge-back"],
  ["guard", "the Stop / SubagentStop guard hook"],
  ["drive", "one whole flight, end to end"],
];

const only = process.argv.slice(2);
const chosen = only.length ? SUITES.filter(([name]) => only.includes(name)) : SUITES;
if (!chosen.length) {
  console.error(`no such suite: ${only.join(", ")}\nknown suites: ${SUITES.map(([n]) => n).join(", ")}`);
  process.exit(2);
}

const run = (name) =>
  new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const proc = spawn(process.execPath, [path.join(HERE, `${name}.mjs`)], { stdio: ["ignore", "pipe", "inherit"] });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    proc.on("exit", (code) => {
      const plan = out.match(/^1\.\.(\d+)$/m);
      const failed = out.match(/^# FAILED (\d+)/m);
      resolve({
        name,
        code: code ?? 1,
        total: plan ? Number(plan[1]) : 0,
        failed: failed ? Number(failed[1]) : code === 0 ? 0 : null,
        ms: Date.now() - started,
      });
    });
  });

const results = [];
for (const [name, blurb] of chosen) {
  console.log(`\n# ── ${name}: ${blurb}`);
  results.push(await run(name));
}

const width = Math.max(...results.map((r) => r.name.length));
const total = results.reduce((n, r) => n + r.total, 0);
console.log("\n# ── summary");
for (const r of results) {
  const state = r.code === 0 ? "pass" : r.failed === null ? "CRASH" : `FAIL ${r.failed}`;
  console.log(`#   ${r.name.padEnd(width)}  ${String(r.total).padStart(4)} assertions  ${String(r.ms).padStart(6)}ms  ${state}`);
}
const bad = results.filter((r) => r.code !== 0);
console.log(bad.length ? `#\n# ${bad.length} suite(s) failed` : `#\n# ${total} assertions passed`);
process.exit(bad.length ? 1 : 0);
