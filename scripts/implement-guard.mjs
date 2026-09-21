#!/usr/bin/env node
// Foundry implement guard — Stop / SubagentStop hook.
//
// While .foundry/implement.lock exists, an implementation run is in
// progress. If docs/PROGRESS.md still has open tasks ([ ] or [~]), the run
// is not finished and a stop should be pushed back into the loop — but only
// when the party actually stopping is the implementer.
//
// Through 0.2.0 this hook fired unconditionally on every Stop and
// SubagentStop in the project, which also blocked a controller session that
// was merely *waiting* on a background implementer subagent: its own Stop
// events were indistinguishable from the implementer's. Every blocked stop
// also spent a re-block from the shared counter, eating into the cap the
// implementer itself relies on (F-07).
//
// So this hook reads its JSON stdin input and decides, in order:
//
//   1. No lock, or no open tasks: allow. Nothing to guard.
//   2. `hook_event_name` is `SubagentStop`: block only when `agent_type`
//      names the implementer (`foundry-implementer` or
//      `foundry:implementer`). Any other named agent is allowed outright.
//      A missing `agent_type` falls back to rule 3's transcript check.
//   3. `hook_event_name` is `Stop`: block only when *this session's own
//      transcript* shows it called `foundry_run_start` itself — i.e. the
//      implement stage is running directly in the main session
//      (`/foundry:implement` by hand, or `claude -p`), not a flight this
//      session is merely waiting on in the background.
//   4. Any other event, unreadable or empty input, or an unreadable
//      transcript: allow. A guard that cannot identify the stopping party
//      must never guess block.
//
// A hard cap on re-blocks (default 500, see FOUNDRY_GUARD_CAP) still
// prevents a runaway. Exit 0 with no output = allow the stop.

import fs from "node:fs";
import path from "node:path";

const IMPLEMENTER_AGENT_TYPES = new Set(["foundry-implementer", "foundry:implementer"]);

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseInput(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Does the transcript at `transcriptPath` mention a call to foundry_run_start? */
function transcriptCalledRunStart(transcriptPath) {
  if (!transcriptPath) return false;
  try {
    return fs.readFileSync(transcriptPath, "utf8").includes("foundry_run_start");
  } catch {
    return false;
  }
}

/** Whether this stop belongs to the implementer, per the decision rule above. */
function isImplementerStop(input) {
  if (!input) return false;
  const event = input.hook_event_name;
  if (event === "SubagentStop") {
    if (input.agent_type) return IMPLEMENTER_AGENT_TYPES.has(input.agent_type);
    return transcriptCalledRunStart(input.transcript_path);
  }
  if (event === "Stop") return transcriptCalledRunStart(input.transcript_path);
  return false;
}

const projectRoot = (input) => process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();

/**
 * Read the lock's re-block counter, tolerating both the legacy bare-number
 * form and the JSON object form foundry_run_start writes from 0.3.0. `json`
 * is the parsed object to preserve on rewrite, or null for the legacy form.
 */
function readLock(lockPath) {
  const raw = fs.readFileSync(lockPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return { json: parsed, count: Number.isInteger(parsed.count) ? parsed.count : 0 };
  }
  const digits = raw.replace(/[^0-9]/g, "");
  return { json: null, count: digits ? Number(digits) : 0 };
}

function writeLock(lockPath, lock, count) {
  const text = lock.json ? JSON.stringify({ ...lock.json, count }) : String(count);
  fs.writeFileSync(lockPath, `${text}\n`);
}

/** Open-task count and the id to resume with, scanning only the `## Tasks` section. */
function openTasks(progressPath) {
  let inTasks = false;
  let open = 0;
  let inProgress = null;
  let todo = null;
  for (const line of fs.readFileSync(progressPath, "utf8").split("\n")) {
    if (/^## Tasks/.test(line)) {
      inTasks = true;
      continue;
    }
    if (/^## /.test(line)) {
      inTasks = false;
      continue;
    }
    if (!inTasks) continue;
    const m = line.match(/^- \[([ ~])\] (\S+)/);
    if (!m) continue;
    open++;
    if (m[1] === "~" && inProgress === null) inProgress = m[2];
    if (m[1] === " " && todo === null) todo = m[2];
  }
  return { open, next: inProgress || todo };
}

function main() {
  const input = parseInput(readStdin());
  const root = projectRoot(input);
  const lockPath = path.join(root, ".foundry", "implement.lock");
  const progressPath = path.join(root, "docs", "PROGRESS.md");

  if (!fs.existsSync(lockPath) || !fs.existsSync(progressPath)) return;

  const { open, next } = openTasks(progressPath);
  if (open === 0) return;

  if (!isImplementerStop(input)) return;

  const lock = readLock(lockPath);
  const cap = Number(process.env.FOUNDRY_GUARD_CAP || 500);
  const count = lock.count + 1;
  writeLock(lockPath, lock, count);

  if (count > cap) {
    // Give up rather than loop forever; leave the lock so the orchestrator sees it.
    process.stdout.write(`${JSON.stringify({ systemMessage: `foundry: implement guard cap (${cap}) reached with ${open} open tasks; run halted` })}\n`);
    return;
  }

  const reason =
    `foundry: implementation run is not finished — ${open} task(s) still open in docs/PROGRESS.md (next: ${next}). ` +
    "Do not stop. Call foundry_task_next and continue; call foundry_run_finish only when foundry_status reports zero open tasks.";
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

main();
