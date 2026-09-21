// foundry_status and foundry_next: the decision table that decides which agent
// runs next. Every branch of `next()` gets a case here, because a wrong answer
// sends an unattended flight down the wrong stage.

import fs from "node:fs";
import path from "node:path";
import {
  finish, ok, eq, like, isError,
  mkDir, specRepo, plannedRepo, withServer,
  writeFile, setState, markTasks, git,
} from "./harness.mjs";

const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };

// -------------------------------------------------------------- outside a repo

await withServer(mkDir(), async ({ call }) => {
  const s = await call("foundry_status");
  eq(s.git.inRepo, false, "status reports a non-repository honestly");
  eq(s.specPresent, false, "status reports a missing SPEC");
  eq(s.counts, null, "status has no counts without PROGRESS.md");
  const n = await call("foundry_next");
  eq(n.stage, "halt", "no SPEC anywhere → halt");
  like(n.reason, /SPEC\.md/, "the halt reason names the missing SPEC");
  eq(n.agent, null, "a halt has no agent to delegate to");
});

// -------------------------------------------------------------- plan stage

await withServer(specRepo(), async ({ call }) => {
  let n = await call("foundry_next");
  eq(n.stage, "plan", "SPEC alone → plan");
  eq(n.agent, "foundry:planner", "the plan stage delegates to the planner");
  eq(n.agentFallback, true, "with nothing generated yet, the stage falls back to the plugin agent");
  eq(n.fallbackAgent, "foundry:planner", "the fallback agent is always named");
  eq(n.restartRequired, false, "an Anthropic-routed role never needs a restart");
  eq(n.round, 0, "a fresh flight is round 0");
  like(n.prompt, /docs\/SPEC\.md/, "the planner prompt points at the spec");
  like(n.prompt, /Do not write implementation code/, "the planner prompt forbids coding");

  await call("foundry_agents_sync");
  n = await call("foundry_next");
  eq(n.agent, "foundry-planner", "once the file is on disk, next names the generated agent");
  eq(n.agentFallback, true, "but this process created the agents directory itself, so fallback stays in effect");
  eq(n.restartRequired, false, "still no restart needed for an Anthropic-routed role");
});

// A role routed to a model the Agent tool cannot name, with nothing generated yet.
{
  const repo = specRepo();
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["true"], roles: { planner: { model: "Ollama/x" } } }, null, 2) + "\n");
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.agent, null, "a router-routed role with nothing generated has no agent to spawn");
    eq(n.agentFallback, true, "the file is absent, so fallback would apply if it could");
    eq(n.restartRequired, true, "but the Agent tool cannot name the model directly, so a restart is required");
  });
}

// A half-written plan is not a plan.
for (const missing of ["docs/PLAN.md", "docs/PROGRESS.md", "docs/foundry.json"]) {
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, missing));
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "plan", `missing ${missing} → back to plan`);
  });
}

// -------------------------------------------------------------- implement stage

await withServer(plannedRepo(), async ({ call }) => {
  const s = await call("foundry_status");
  eq(s.counts.total, 3, "status counts every task");
  eq(s.counts.open, 3, "open counts todo plus in-progress");
  eq(s.branch, "(set by implement)", "status reads the Branch header verbatim");
  eq(s.reviewRoundsInPlan, 0, "a fresh plan has no review-fix sections");

  const n = await call("foundry_next");
  eq(n.stage, "implement", "open tasks → implement");
  eq(n.agent, "foundry:implementer", "the implement stage delegates to the implementer");
  like(n.reason, /3 open task/, "the reason counts the open tasks");
  like(n.prompt, /initial build/, "round 0's prompt says this is the initial build");
  like(n.prompt, /never ask a question/i, "the implementer prompt states the unattended contract");
});

// Round > 0 changes the prompt's framing.
{
  const repo = plannedRepo();
  setState(repo, { round: 2 });
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.round, 2, "next reports the current round");
    like(n.prompt, /review-fix round 2/, "a fix round's prompt names the round");
    like(n.prompt, /R2-\*/, "a fix round's prompt names the R-task pattern");
  });
}

// status reads the lock's counter, in either format, or reports null.
{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_status")).lockCounter, null, "no lock means no counter to report");
  });
}
{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/implement.lock", "3\n");
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_status")).lockCounter, 3, "a legacy bare-number lock still reads back its count");
  });
}
{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/implement.lock", '{"count":7,"round":1}\n');
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_status")).lockCounter, 7, "a JSON lock's count is read directly");
  });
}

// A lock with no open tasks means a run died before its handoff.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  writeFile(repo, ".foundry/implement.lock", "3\n");
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "implement", "a stale lock sends the flight back to implement");
    like(n.reason, /before foundry_run_finish/, "the reason explains the stale lock");
  });
}

// No lock, no open tasks, nothing recorded: the handoff still has to happen.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "implement", "zero open tasks but no handoff → implement");
    like(n.reason, /no handoff recorded/, "the reason names the missing handoff");
  });
}

// -------------------------------------------------------------- review, summary, done

{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  setState(repo, { implemented: true });
  await withServer(repo, async ({ call }) => {
    let n = await call("foundry_next");
    eq(n.stage, "review", "implemented and unreviewed → review");
    eq(n.agent, "foundry:reviewer", "the review stage delegates to the reviewer");
    like(n.prompt, /exactly once/, "the reviewer prompt caps the verdict at one submission");

    setState(repo, { reviewed: true, verdict: "APPROVED" });
    n = await call("foundry_next");
    eq(n.stage, "summarize", "approved and unsummarized → summarize");
    eq(n.agent, "foundry:summarizer", "the summarize stage delegates to the summarizer");

    setState(repo, { summarized: true });
    n = await call("foundry_next");
    eq(n.stage, "done", "summarized → done");
    like(n.reason, /ready for a human to merge/, "done tells the human what is theirs to do");
  });
}

// CHANGES REQUESTED with nothing open is an impossible state; say so loudly.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  setState(repo, { implemented: true, reviewed: true, verdict: "CHANGES REQUESTED" });
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "halt", "changes requested with no fix tasks → halt");
    like(n.reason, /foundry_review_submit should have queued them/, "the halt reason names the culprit");
  });
}

// -------------------------------------------------------------- round caps

{
  const repo = plannedRepo({ config: { maxRounds: 2 } });
  setState(repo, { round: 3 });
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "halt", "a round past maxRounds with open tasks → halt");
    like(n.reason, /maxRounds=2/, "the halt reason quotes the configured cap");
    like(n.reason, /human intervention required/, "the halt reason says a human is needed");
  });
}

{
  const repo = plannedRepo();
  setState(repo, { halted: "stopped by hand" });
  await withServer(repo, async ({ call }) => {
    const n = await call("foundry_next");
    eq(n.stage, "halt", "a halted state stays halted");
    eq(n.reason, "stopped by hand", "the recorded halt reason is passed through");
  });
}

// -------------------------------------------------------------- verdict parsing

for (const [body, expected, label] of [
  ["# Review\n**Verdict**: APPROVED\n", "APPROVED", "bold verdict"],
  ["# Review\nVerdict: CHANGES REQUESTED\n", "CHANGES REQUESTED", "plain verdict"],
  ["# Review\n**Verdict**: `APPROVED`\n", "APPROVED", "backticked verdict"],
  ["# Review\n**Verdict**: approved\n", "APPROVED", "lowercase verdict"],
  ["# Review\nno verdict here\n", null, "missing verdict"],
]) {
  const repo = plannedRepo();
  writeFile(repo, "docs/REVIEW.md", body);
  await withServer(repo, async ({ call }) => {
    const s = await call("foundry_status");
    eq(s.reviewVerdictInFile, expected, `status reads the ${label} from REVIEW.md`);
  });
}

// -------------------------------------------------------------- counts and config

{
  const repo = plannedRepo();
  markTasks(repo, { "P0-01": "x", "P0-02": "!", "P0-03": "-" });
  await withServer(repo, async ({ call }) => {
    const s = await call("foundry_status");
    eq(s.counts.done, 1, "done is counted");
    eq(s.counts.blocked, 1, "blocked is counted");
    eq(s.counts.skipped, 1, "skipped is counted");
    eq(s.counts.open, 0, "blocked and skipped are not open");
    eq(s.blocked.join(","), "P0-02", "status lists blocked ids");
    eq(s.skipped.join(","), "P0-03", "status lists skipped ids");
    const n = await call("foundry_next");
    eq(n.stage, "implement", "blocked tasks do not hold the flight open");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/foundry.json", "{ this is not json }");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_status"), /not valid JSON/, "a corrupt foundry.json is reported, not swallowed");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/state.json", "{ truncated");
  await withServer(repo, async ({ call }) => {
    const s = await call("foundry_status");
    eq(s.state.round, 0, "a corrupt state.json falls back to defaults rather than failing");
  });
}

// A PROGRESS.md without the section the parser needs is a hard error, not a guess.
{
  const repo = plannedRepo();
  writeFile(repo, "docs/PROGRESS.md", "# progress\nno sections here\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_status"), /no '## Tasks' section/, "a PROGRESS.md with no Tasks section is rejected");
  });
}

// Log lines that look like tasks must not be counted as tasks.
{
  const repo = plannedRepo();
  const p = path.join(repo, "docs/PROGRESS.md");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n### P0-01 — abc1234\n- [ ] P9-99 not a task\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("foundry_status");
    eq(s.counts.total, 3, "checkbox lines under ## Log are not tasks");
  });
}

// -------------------------------------------------------------- git facts

{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", "build/2020-01-01"]);
  writeFile(repo, "dirty.txt", "x");
  await withServer(repo, async ({ call }) => {
    const s = await call("foundry_status");
    eq(s.git.branch, "build/2020-01-01", "status reports the current branch");
    eq(s.git.dirty, true, "status notices an unclean tree");
    eq(s.git.hasOrigin, false, "status notices there is no origin");
    like(s.git.head, /^[0-9a-f]{7,}$/, "status reports a short head sha");
  });
}

finish();
