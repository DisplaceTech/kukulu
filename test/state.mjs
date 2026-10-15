// kukulu_status and kukulu_next: the decision table that decides which agent
// runs next. Every branch of `next()` gets a case here, because a wrong answer
// sends an unattended flight down the wrong stage.

import fs from "node:fs";
import path from "node:path";
import {
  finish, ok, eq, like, isError,
  mkDir, specRepo, plannedRepo, withServer,
  writeFile, readFile, setState, markTasks, git, subject, planDoc, progressDoc,
} from "./harness.mjs";

const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };

// -------------------------------------------------------------- outside a repo

await withServer(mkDir(), async ({ call }) => {
  const s = await call("kukulu_status");
  eq(s.git.inRepo, false, "status reports a non-repository honestly");
  eq(s.specPresent, false, "status reports a missing SPEC");
  eq(s.counts, null, "status has no counts without PROGRESS.md");
  const n = await call("kukulu_next");
  eq(n.stage, "halt", "no SPEC anywhere → halt");
  like(n.reason, /SPEC\.md/, "the halt reason names the missing SPEC");
  eq(n.agent, null, "a halt has no agent to delegate to");
});

// -------------------------------------------------------------- plan stage

await withServer(specRepo(), async ({ call }) => {
  let n = await call("kukulu_next");
  eq(n.stage, "plan", "SPEC alone → plan");
  eq(n.agent, "kukulu:planner", "the plan stage delegates to the planner");
  eq(n.agentFallback, true, "with nothing generated yet, the stage falls back to the plugin agent");
  eq(n.fallbackAgent, "kukulu:planner", "the fallback agent is always named");
  eq(n.restartRequired, false, "an Anthropic-routed role never needs a restart");
  eq(n.round, 0, "a fresh flight is round 0");
  like(n.prompt, /docs\/SPEC\.md/, "the planner prompt points at the spec");
  like(n.prompt, /Do not write implementation code/, "the planner prompt forbids coding");

  await call("kukulu_agents_sync");
  n = await call("kukulu_next");
  eq(n.agentFallback, true, "this process created the agents directory itself, so fallback stays in effect");
  eq(n.agent, "kukulu:planner", "...and next names the plugin agent outright, not a generated one that cannot load yet (cleanflate F-22)");
  eq(n.restartRequired, false, "still no restart needed for an Anthropic-routed role");
});

// A role routed to a model the Agent tool cannot name, with nothing generated yet.
{
  const repo = specRepo();
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["true"], roles: { planner: { model: "Ollama/x" } } }, null, 2) + "\n");
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.agent, null, "a router-routed role with nothing generated has no agent to spawn");
    eq(n.agentFallback, true, "the file is absent, so fallback would apply if it could");
    eq(n.restartRequired, true, "but the Agent tool cannot name the model directly, so a restart is required");
  });
}

// F-02 (0.3.1 flight feedback): the Agent tool's `model` parameter takes only
// a family alias, so a fallback spawn for a role routed to a full claude-* id
// must be handed the alias — and told it is an approximation.
const routedReviewRepo = (model) => {
  const repo = plannedRepo();
  const cfgPath = path.join(repo, "docs/foundry.json");
  const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  writeFile(repo, "docs/foundry.json", JSON.stringify({ ...c, roles: { reviewer: { model } } }, null, 2) + "\n");
  markTasks(repo, ALL_DONE);
  setState(repo, { implemented: true });
  return repo;
};

for (const [model, agentModel, exact, label] of [
  ["claude-opus-5-5", "opus", false, "a full claude-* id maps to its family alias and is flagged inexact"],
  ["claude-fable-5-1", "fable", false, "a full fable id maps to fable"],
  ["sonnet", "sonnet", true, "an alias is passed through and exact"],
  ["inherit", null, true, "inherit means pass no model"],
]) {
  await withServer(routedReviewRepo(model), async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "review", `${model}: at the review stage`);
    eq(n.agentFallback, true, `${model}: nothing generated, so fallback applies`);
    eq(n.agentModel, agentModel, `${model}: ${label}`);
    eq(n.agentModelExact, exact, `${model}: agentModelExact`);
    eq(n.restartRequired, false, `${model}: reachable, so no restart`);
    eq(n.model, model, `${model}: model is still the routed value, for display`);
  });
}

await withServer(routedReviewRepo("claude-mystery-9"), async ({ call }) => {
  const n = await call("kukulu_next");
  eq(n.restartRequired, true, "a claude-* id of an unknown family is unreachable under fallback, like a non-Anthropic model");
  eq(n.agent, null, "...and has no agent to spawn");
});

await withServer(plannedRepo(), async ({ call }) => {
  await call("kukulu_agents_sync");
  const done = await call("kukulu_next");
  ok("agentModel" in done && "agentModelExact" in done, "every stage result carries agentModel and agentModelExact");
});

// A half-written plan is not a plan.
for (const missing of ["docs/PLAN.md", "docs/PROGRESS.md", "docs/foundry.json"]) {
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, missing));
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "plan", `missing ${missing} → back to plan`);
  });
}

// -------------------------------------------------------------- implement stage

await withServer(plannedRepo(), async ({ call }) => {
  const s = await call("kukulu_status");
  eq(s.counts.total, 3, "status counts every task");
  eq(s.counts.open, 3, "open counts todo plus in-progress");
  eq(s.branch, "(set by implement)", "status reads the Branch header verbatim");
  eq(s.reviewRoundsInPlan, 0, "a fresh plan has no review-fix sections");

  const n = await call("kukulu_next");
  eq(n.stage, "implement", "open tasks → implement");
  eq(n.agent, "kukulu:implementer", "the implement stage delegates to the implementer");
  like(n.reason, /3 open task/, "the reason counts the open tasks");
  like(n.prompt, /initial build/, "round 0's prompt says this is the initial build");
  like(n.prompt, /never ask a question/i, "the implementer prompt states the unattended contract");
});

// Round > 0 changes the prompt's framing.
{
  const repo = plannedRepo();
  setState(repo, { round: 2 });
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.round, 2, "next reports the current round");
    eq(n.reviewRound, 3, "reviewRound is always round + 1");
    like(n.prompt, /review-fix round 2/, "a fix round's prompt names the round");
    like(n.prompt, /R2-\*/, "a fix round's prompt names the R-task pattern");
  });
}

// reviewRound tracks round + 1 everywhere in the decision table, including
// kukulu_status, not only the implement-stage prompt above.
for (const round of [0, 1, 5]) {
  const repo = plannedRepo();
  setState(repo, { round });
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).reviewRound, round + 1, `status reports reviewRound as round + 1 at round ${round}`);
    eq((await call("kukulu_next")).reviewRound, round + 1, `next reports reviewRound as round + 1 at round ${round}`);
  });
}

// The review stage's own prompt states the round it must be stamped with.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  setState(repo, { implemented: true });
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "review", "implemented and unreviewed → review");
    eq(n.reviewRound, 1, "the first review is round 1");
    like(n.prompt, /This review is round 1/, "the review prompt states its own round");
    like(n.prompt, /Round: 1.*docs\/REVIEW\.md/, "...and exactly what to write in REVIEW.md");
    like(n.prompt, /R1-<nn>/, "...and the id prefix for any same-round dependsOn");
  });
}

// status reads the lock's counter, in either format, or reports null.
{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lockCounter, null, "no lock means no counter to report");
  });
}
{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/implement.lock", "3\n");
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lockCounter, 3, "a legacy bare-number lock still reads back its count");
  });
}
{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/implement.lock", '{"count":7,"round":1}\n');
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lockCounter, 7, "a JSON lock's count is read directly");
  });
}

// A lock with no open tasks means a run died before its handoff.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  writeFile(repo, ".foundry/implement.lock", "3\n");
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "implement", "a stale lock sends the flight back to implement");
    like(n.reason, /before kukulu_run_finish/, "the reason explains the stale lock");
  });
}

// No lock, no open tasks, nothing recorded: the handoff still has to happen.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
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
    let n = await call("kukulu_next");
    eq(n.stage, "review", "implemented and unreviewed → review");
    eq(n.agent, "kukulu:reviewer", "the review stage delegates to the reviewer");
    like(n.prompt, /exactly once/, "the reviewer prompt caps the verdict at one submission");

    setState(repo, { reviewed: true, verdict: "APPROVED" });
    n = await call("kukulu_next");
    eq(n.stage, "summarize", "approved and unsummarized → summarize");
    eq(n.agent, "kukulu:summarizer", "the summarize stage delegates to the summarizer");

    setState(repo, { summarized: true });
    n = await call("kukulu_next");
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
    const n = await call("kukulu_next");
    eq(n.stage, "halt", "changes requested with no fix tasks → halt");
    like(n.reason, /kukulu_review_submit should have queued them/, "the halt reason names the culprit");
  });
}

// -------------------------------------------------------------- round caps

// The round-cap decision belongs solely to kukulu_review_submit (V3-10);
// next() never re-derives it from round/maxRounds — open tasks past a round
// review_submit did *not* itself halt are still just the next implement
// stage, exactly like any other round. See test/review.mjs for the actual
// convergence and hard-cap halting behaviour.
{
  const repo = plannedRepo({ config: { maxRounds: 2 } });
  setState(repo, { round: 3 });
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "implement", "open tasks send the flight to implement regardless of round or maxRounds; only state.halted can stop it");
  });
}

{
  const repo = plannedRepo();
  setState(repo, { halted: "stopped by hand" });
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
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
  ["# Review\nRound: 4\n**Verdict:** APPROVED\n", "APPROVED", "verdict with the colon inside the bold"],
  ["# Review\n## Verdict\n\n**CHANGES REQUESTED**\n", "CHANGES REQUESTED", "verdict under its own heading"],
  ["# Review\n- **Verdict:** `approved`\n", "APPROVED", "verdict in a list item"],
  ["# Review\nThe verdict is pending; nothing is APPROVED yet.\n", null, "verdict word in prose"],
  ["# Review\nno verdict here\n", null, "missing verdict"],
]) {
  const repo = plannedRepo();
  writeFile(repo, "docs/REVIEW.md", body);
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.reviewVerdictInFile, expected, `status reads the ${label} from REVIEW.md`);
  });
}

// -------------------------------------------------------------- flight options (2026-09-30 cleanflate F-20)

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", {}), /pass at least one of maxRounds, maxRoundsHard/, "an empty options call is refused");
    isError(await call("kukulu_flight_options", { maxRounds: 0 }), /maxRounds must be a positive integer/, "a non-positive bound is refused");
    const r = await call("kukulu_flight_options", { maxRounds: 6, maxRoundsHard: 6 });
    eq(JSON.stringify(r.before), JSON.stringify({ maxRounds: 3, maxRoundsHard: 6 }), "the previous bounds are reported");
    eq(JSON.stringify(r.after), JSON.stringify({ maxRounds: 6, maxRoundsHard: 6 }), "...and the new ones");
    eq(git(repo, ["log", "-1", "--format=%s"]), "chore: flight options (maxRounds=6, maxRoundsHard=6)", "the change is one commit");
    const c = JSON.parse(readFile(repo, "docs/foundry.json"));
    eq(c.maxRounds, 6, "docs/foundry.json carries the new bound");
    eq(JSON.stringify(c.verify), JSON.stringify(["true"]), "...and keeps everything else");
    const again = await call("kukulu_flight_options", { maxRounds: 6 });
    eq(again.commit, null, "applying the same options twice commits nothing");
  });
}

// ---------------------------------------------------------------- resume (S-09)

{
  const repo = plannedRepo();
  const halted = "round 4 is non-converging, the 3rd non-converging round";
  setState(repo, { halted, haltCap: { cap: "maxRounds", round: 4, nonConverging: 3 } });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: halted"]);
  await withServer(repo, async ({ call }) => {
    const cfgBefore = readFile(repo, "docs/foundry.json");
    const stateBefore = readFile(repo, ".foundry/state.json");
    isError(await call("kukulu_flight_options", { maxRounds: 3, resume: true }), /pass maxRounds: 4 or more/, "resume with a bound that does not lift the cap is refused, naming 4");
    eq(readFile(repo, "docs/foundry.json"), cfgBefore, "...docs/foundry.json is unchanged");
    eq(readFile(repo, ".foundry/state.json"), stateBefore, "...and so is state");
    isError(await call("kukulu_flight_options", { resume: true }), /pass at least one of/, "resume alone is refused");
    isError(await call("kukulu_flight_options", { maxRounds: 4, resume: "yes" }), /resume must be a boolean/, "a non-boolean resume is refused");
    const head = git(repo, ["rev-list", "--count", "HEAD"]);
    const r = await call("kukulu_flight_options", { maxRounds: 4, resume: true });
    eq(r.resumed, true, "a lifting resume succeeds");
    eq(Number(git(repo, ["rev-list", "--count", "HEAD"])) - Number(head), 1, "...in one commit");
    eq(subject(repo), "chore: flight options (maxRounds=4, resume)", "...with the resume subject");
    const st = JSON.parse(readFile(repo, ".foundry/state.json"));
    ok(st.halted === null && st.haltCap === undefined, "...and halted and haltCap are cleared");
    eq((await call("kukulu_next")).stage, "implement", "the flight goes on to implement");
    isError(await call("kukulu_flight_options", { maxRounds: 5, resume: true }), /not halted; there is nothing to resume/, "resume when not halted is refused");
  });
}

{
  const repo = plannedRepo();
  setState(repo, { halted: "stopped by hand" });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 9, resume: true }), /not a round-cap halt.*stopped by hand/, "an operator halt is never cleared by resume, and the refusal names the reason");
  });
}

{
  const repo = plannedRepo();
  setState(repo, { halted: "hard", haltCap: { cap: "maxRoundsHard", round: 4 } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRoundsHard: 3, resume: true }), /maxRoundsHard: 4 or more/, "a hard cap needs maxRoundsHard >= the round");
    const r = await call("kukulu_flight_options", { maxRoundsHard: 4, resume: true });
    eq(r.resumed, true, "maxRoundsHard: 4 lifts a hard cap at round 4");
  });
}

await withServer(specRepo(), async ({ call }) => {
  isError(await call("kukulu_flight_options", { maxRoundsHard: 4 }), /does not exist yet[\s\S]*plan stage/, "options are refused before the plan exists");
});

// -------------------------------------------------------------- counts and config

{
  const repo = plannedRepo();
  markTasks(repo, { "P0-01": "x", "P0-02": "!", "P0-03": "-" });
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.counts.done, 1, "done is counted");
    eq(s.counts.blocked, 1, "blocked is counted");
    eq(s.counts.skipped, 1, "skipped is counted");
    eq(s.counts.open, 0, "blocked and skipped are not open");
    eq(s.blocked.join(","), "P0-02", "status lists blocked ids");
    eq(s.skipped.join(","), "P0-03", "status lists skipped ids");
    const n = await call("kukulu_next");
    eq(n.stage, "implement", "blocked tasks do not hold the flight open");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/foundry.json", "{ this is not json }");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), /not valid JSON/, "a corrupt foundry.json is reported, not swallowed");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/state.json", "{ truncated");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.state.round, 0, "a corrupt state.json falls back to defaults rather than failing");
  });
}

// A PROGRESS.md without the section the parser needs is a hard error, not a guess.
{
  const repo = plannedRepo();
  writeFile(repo, "docs/PROGRESS.md", "# progress\nno sections here\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), /no '## Tasks' section/, "a PROGRESS.md with no Tasks section is rejected");
  });
}

// Log lines that look like tasks must not be counted as tasks.
{
  const repo = plannedRepo();
  const p = path.join(repo, "docs/PROGRESS.md");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8") + "\n### P0-01 — abc1234\n- [ ] P9-99 not a task\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.counts.total, 3, "checkbox lines under ## Log are not tasks");
  });
}

// -------------------------------------------------------------- git facts

{
  const repo = plannedRepo();
  git(repo, ["checkout", "-q", "-b", "build/2020-01-01"]);
  writeFile(repo, "dirty.txt", "x");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.git.branch, "build/2020-01-01", "status reports the current branch");
    eq(s.git.dirty, true, "status notices an unclean tree");
    eq(s.git.hasOrigin, false, "status notices there is no origin");
    like(s.git.head, /^[0-9a-f]{7,}$/, "status reports a short head sha");
  });
}

// ---------------------------------------------------------------- artifacts (S-08)

{
  // an untracked foundry.json with no plan is a stray artifact (project-c F-04)
  const repo = specRepo();
  writeFile(repo, "docs/foundry.json", "{}\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.artifacts["foundry.json"], "untracked", "an unstaged foundry.json is untracked");
    eq(s.artifacts["PLAN.md"], "absent", "...PLAN.md is absent");
    eq(s.artifacts["SPEC.md"], "tracked", "...SPEC.md is tracked");
    eq(Object.keys(s.artifacts).join(","), "SPEC.md,PLAN.md,PROGRESS.md,HANDOFF.md,REVIEW.md,SUMMARY.md,foundry.json", "...and the keys are exactly the seven artifacts");
    eq(s.strayArtifacts.join(","), "foundry.json", "...so it is a stray artifact");
  });
}

{
  // mutant (b): strayArtifacts only while PLAN.md is absent
  const repo = plannedRepo();
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.artifacts["HANDOFF.md"], "untracked", "an untracked artifact beside a present plan is not stray: it is untracked");
    eq(s.strayArtifacts.length, 0, "...and strayArtifacts is empty");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/PLAN.md", readFile(repo, "docs/PLAN.md") + "\nedit\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.artifacts["PLAN.md"], "modified", "a modified tracked artifact is modified");
    eq(s.strayArtifacts.length, 0, "...and nothing is stray");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/REVIEW.md", "# early\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "review: round 1 (on main)"]);
  git(repo, ["checkout", "-q", "-b", "build/2020-01-01"]);
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lastReviewCommit, null, "lastReviewCommit is null with no review on the branch (main's own review: commit is not reported)");
    writeFile(repo, "docs/REVIEW.md", "# later\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "review: round 1"]);
    eq((await call("kukulu_status")).lastReviewCommit, git(repo, ["rev-parse", "--short", "HEAD"]), "after a review commit on the branch, its short sha");
  });
}

// ---------------------------------------------------------------- archive (S-07)

{
  const repo = plannedRepo({ config: { flight: "w1" } });
  setState(repo, { summarized: true, verdict: "APPROVED", reviewed: true, implemented: true });
  git(repo, ["checkout", "-q", "-b", "build/2020-01-01"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: build summary"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_flight_archive");
    const n = await call("kukulu_next");
    eq(n.stage, "done", "after an archive, kukulu_next is done");
    like(n.reason, /flight w1 is archived in docs\/flights\/w1/, "...and the reason names the slug");
    writeFile(repo, "docs/SPEC.md", "# Next spec\n");
    eq((await call("kukulu_next")).stage, "plan", "once SPEC.md changes, the stage is plan");
  });
}

for (const [config, re, label] of [
  [{ flight: "Bad" }, /flight must be a slug/, "flight: Bad"],
  [{ policies: { archive: "yes" } }, /policies\.archive must be a boolean/, "policies.archive: yes"],
  [{ policies: { finalize: "sometimes" } }, /policies\.finalize must be one of auto, ready, draft/, "policies.finalize: sometimes"],
  [{ policies: { mergeMethod: "ff" } }, /policies\.mergeMethod must be one of merge, squash, rebase/, "policies.mergeMethod: ff"],
]) {
  const repo = plannedRepo({ config });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), re, `${label} is refused`);
  });
}

// ---------------------------------------------------------------- plan_commit (S-06)

{
  const repo = specRepo();
  const plan = plannedRepo(); // only for its generated texts
  writeFile(repo, "docs/PLAN.md", readFile(plan, "docs/PLAN.md"));
  writeFile(repo, "docs/PROGRESS.md", readFile(plan, "docs/PROGRESS.md"));
  writeFile(repo, "docs/foundry.json", readFile(plan, "docs/foundry.json"));
  writeFile(repo, "CLAUDE.md", "# rules\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit");
    eq(r.tasks, 3, "a valid plan commits: three tasks");
    eq(JSON.stringify(r.phases), JSON.stringify([{ phase: 0, tasks: 3 }]), "...in one phase");
    eq(subject(repo), "plan: derive build plan from SPEC", "...as plan: derive build plan from SPEC");
    eq((await call("kukulu_plan_commit")).commit, null, "a second call commits nothing");
  });
}

{
  // every problem at once (project-c F-07)
  const repo = specRepo();
  const planText = [
    "# Plan",
    "",
    "### P0-01: One",
    "**Depends on:** P0-02",
    "",
    "### P0-02 - Title",
    "**Depends on:** none",
    "",
    "### P0-03: Three",
    "**Depends on:** P0-03",
    "",
    "### P0-03: Three again",
    "**Depends on:** none",
    "",
    "### P0-05: Five",
    "**Depends on:** none",
    "",
  ].join("\n");
  writeFile(repo, "docs/PLAN.md", planText);
  writeFile(repo, "docs/PROGRESS.md", ["# P", "Branch: (x)", "Started: (x)", "", "## Tasks", "- [ ] P0-05 Five", "- [ ] P0-03 Three", "- [ ] P0-01 One", "", "## Log", ""].join("\n"));
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["true"], constraints: [{ id: "c", paths: ["src/"], pattern: "x", shouldMatch: ["x"], shouldNotMatch: ["y"], from: "P9-01" }] }));
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ rpc }) => {
    const e = (await rpc("tools/call", { name: "kukulu_plan_commit", arguments: {} })).result;
    eq(e.isError, true, "a broken plan is refused");
    const text = e.content[0].text;
    like(text, /^\d+ problems? in the plan/, "...with a one-line count first");
    const checks = new Set(e.structuredContent.problems.map((p) => p.check));
    for (const c of ["heading", "duplicate", "sequence", "depends", "cycle", "progress", "from", "claude"]) ok(checks.has(c), `...and the list includes a ${c} problem`);
    const numbered = text.split("\n").filter((l) => /^\d+\. /.test(l)).length;
    eq(numbered, e.structuredContent.problems.length, "...with one numbered line per problem");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and nothing was committed");
  });
}

/** A spec-only repo with an uncommitted plan whose P1-02 was split into P1-02a. */
function splitPlanRepo(progressPatch = (t) => t) {
  const repo = specRepo();
  const tasks = [
    { id: "P1-01", title: "One" },
    { id: "P1-02", title: "Two" },
    { id: "P1-02a", title: "Two and a half" },
    { id: "P1-03", title: "Three", depends: ["P1-02a"], goal: "see P1-02a, and not P1-02" },
  ];
  writeFile(repo, "docs/PLAN.md", planDoc(tasks));
  writeFile(repo, "docs/PROGRESS.md", progressPatch(progressDoc(tasks)));
  writeFile(repo, "docs/foundry.json", JSON.stringify({ verify: ["true"], constraints: [{ id: "c", paths: ["src/"], pattern: "x", shouldMatch: ["x"], shouldNotMatch: ["y"], from: "P1-03" }] }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", "# rules\n");
  return repo;
}

{
  const repo = splitPlanRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit", { renumber: true });
    eq(JSON.stringify(r.renumbered), JSON.stringify({ "P1-02a": "P1-03", "P1-03": "P1-04" }), "renumber rewrites a split task: the map");
    const plan = readFile(repo, "docs/PLAN.md");
    like(plan, /### P1-03: Two and a half/, "...the split heading takes its clean number");
    like(plan, /### P1-04: Three\n[\s\S]*\*\*Depends on:\*\* P1-03\b/, "...and the Depends on line follows it");
    like(plan, /see P1-03, and not P1-02/, "...prose is rewritten too, and P1-02 is untouched");
    ok(!/P1-02a/.test(plan), "...no suffixed id is left in PLAN.md");
    like(readFile(repo, "docs/PROGRESS.md"), /- \[ \] P1-03 Two and a half\n- \[ \] P1-04 Three/, "...PROGRESS.md's lines are rewritten");
    like(readFile(repo, "docs/foundry.json"), /"from": "P1-04"/, "...and the from value follows its task");
    eq(subject(repo), "plan: derive build plan from SPEC", "...in the plan commit");
    ok(plan.includes("### P1-02: Two"), "...P1-02 keeps its heading");
  });
}

{
  const repo = splitPlanRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_plan_commit"), /renumber: true/, "a suffix without renumber is refused, suggesting renumber");
    isError(await call("kukulu_plan_commit", { renumber: "yes" }), /renumber must be a boolean/, "a non-boolean renumber is refused");
  });
}

for (const [label, patch] of [
  ["a Started stamp", (t) => t.replace("Started: (set by implement)", "Started: 2026-10-07T00:00:00Z")],
  ["a task that is not [ ]", (t) => t.replace("- [ ] P1-01", "- [x] P1-01")],
]) {
  const repo = splitPlanRepo(patch);
  const before = { plan: readFile(repo, "docs/PLAN.md"), progress: readFile(repo, "docs/PROGRESS.md"), cfg: readFile(repo, "docs/foundry.json") };
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_plan_commit", { renumber: true }), /only for a plan no run has touched/, `renumber is refused once a run has started: ${label}`);
    ok(readFile(repo, "docs/PLAN.md") === before.plan && readFile(repo, "docs/PROGRESS.md") === before.progress && readFile(repo, "docs/foundry.json") === before.cfg, "...and every file is unchanged");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "sometimes" } } });
  await withServer(repo, async ({ rpc }) => {
    const e = (await rpc("tools/call", { name: "kukulu_plan_commit", arguments: {} })).result;
    eq(e.structuredContent.problems.filter((p) => p.check === "config").length, 1, "a broken config is one config problem");
  });
}

finish();
