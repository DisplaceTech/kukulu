#!/usr/bin/env node
// Kūkulu clean-room guard: the PreToolUse hook (SPEC D-02, D-03).
//
// Every project pays for this hook on every tool call, so the first thing it
// does is the cheapest check there is: does the project have a clean-room
// policy at all? If not it exits 0 without output, having imported nothing
// but node: built-ins. mcp/cleanroom.mjs is loaded only after that check,
// with a dynamic import (constraint hooks-lazy-cleanroom).
//
// With a policy, the guard fails closed (SPEC principle 11): every path that
// throws ends in a denial, and no error path exits 0.
//
//   node scripts/cleanroom-guard.mjs                       the hook: payload on stdin
//   node scripts/cleanroom-guard.mjs --self-test <policy>  fixture cases plus the policy's own

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const parseInput = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** The policy path docs/kukulu.json names, else the default; an unreadable config means the default. */
function policyFile(root) {
  let rel = "docs/cleanroom.json";
  try {
    const named = JSON.parse(fs.readFileSync(path.join(root, "docs", "kukulu.json"), "utf8"))?.cleanroom?.policy;
    if (typeof named === "string" && named) rel = named;
  } catch {
    // no config, or not JSON: the default applies
  }
  return path.resolve(root, rel);
}

// ---------------------------------------------------------------- the self-test

/** Run the shipped fixture cases plus one case per fixture line of the given policy's patterns. Returns the failure lines and the case count. */
async function selfTest(policyArg) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kukulu-guard-selftest-"));
  // The self-test must never touch the project's log, whatever the evaluator does.
  process.env.KUKULU_CLEANROOM_LOG = path.join(tmp, "log.jsonl");
  const root = path.join(tmp, "root");
  const home = path.join(tmp, "home");
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  const cr = await import("../mcp/cleanroom.mjs");
  const failures = [];
  let count = 0;
  try {
    const policyText = fs.readFileSync(path.resolve(policyArg), "utf8");
    const given = cr.loadPolicy(policyText);
    const template = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "cleanroom.example.json"), "utf8");
    const sub = (v) => JSON.parse(JSON.stringify(v).replaceAll("__ROOT__", root).replaceAll("__HOME__", home));
    const cases = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "test", "fixtures", "guard-cases.json"), "utf8"));
    for (const c of cases) {
      count++;
      const policy = cr.loadPolicy(c.policy === "template" ? template : JSON.stringify(c.policy));
      const r = cr.evaluate(policy, sub(c.input), { root, home, progressText: c.progress ?? null });
      const reasonOk = !c.reason || (r.reason && new RegExp(c.reason).test(r.reason));
      if (r.decision !== c.expect || !reasonOk) failures.push(`guard self-test: ${c.name}: expected ${c.expect}${c.reason ? ` (${c.reason})` : ""}, got ${r.decision}${r.reason ? `: ${r.reason}` : ""}`);
    }
    const patternCases = [
      ...given.deny.pathPatterns.map((p) => ({ kind: "pathPatterns", p, input: (line) => ({ tool_name: "Read", tool_input: { file_path: line }, cwd: root }) })),
      ...given.deny.commandPatterns.map((p) => ({ kind: "commandPatterns", p, input: (line) => ({ tool_name: "Bash", tool_input: { command: line }, cwd: root }) })),
    ];
    for (const { kind, p, input } of patternCases) {
      // Only this pattern is in the policy, so a denial can only be its doing.
      const alone = cr.loadPolicy(JSON.stringify({ version: 1, deny: { network: false, [kind]: [p] } }));
      for (const [lines, want] of [[p.shouldMatch, "denied"], [p.shouldNotMatch, "allowed"]]) {
        for (const line of lines) {
          count++;
          const r = cr.evaluate(alone, input(line), { root, home, progressText: null });
          if (r.decision !== want || (want === "denied" && !(r.reason ?? "").includes(p.id))) {
            failures.push(`guard self-test: ${kind} '${p.id}': ${JSON.stringify(line)} should be ${want}, got ${r.decision}${r.reason ? `: ${r.reason}` : ""}`);
          }
        }
      }
    }
  } catch (e) {
    failures.push(`guard self-test: ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { failures, count };
}

if (process.argv[2] === "--self-test") {
  if (!process.argv[3]) {
    process.stderr.write("guard self-test: pass the policy to test: node scripts/cleanroom-guard.mjs --self-test <policy>\n");
    process.exit(2);
  }
  const { failures, count } = await selfTest(process.argv[3]);
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`guard self-test: ok (${count} cases)\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- the hook

const raw = readStdin();
const input = parseInput(raw);
const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
if (!fs.existsSync(policyFile(root))) process.exit(0);

let cr = null;
let fields = {};

/** Log the denial where the log can be written, tell the model why on stderr, and stop the call. Never returns. */
function deny(reason) {
  try {
    if (cr) {
      const logPath = cr.logPathFor(root, process.env);
      if (cr.loggingActive(cr.projectContext(root), logPath)) cr.appendEntry(logPath, { kind: "denied", ...fields, decision: "denied", reason });
    }
  } catch {
    // an unwritable log must not turn a denial into an allowance
  }
  process.stderr.write(`kukulu clean-room guard: ${reason}\n`);
  process.exit(2);
}

try {
  cr = await import("../mcp/cleanroom.mjs");
  if (!input) throw new Error("the hook input is empty or not a JSON object");
  const ctx = cr.projectContext(root);
  fields = cr.entryFields(input, ctx);
  const policy = cr.loadPolicy(fs.readFileSync(policyFile(root), "utf8"));
  const verdict = cr.evaluate(policy, input, { root, home: process.env.HOME || os.homedir(), progressText: ctx.progress });
  if (verdict.decision === "allowed") process.exit(0);
  deny(verdict.reason);
} catch (e) {
  deny(`guard internal error: ${e instanceof Error ? e.message : String(e)}`);
}
