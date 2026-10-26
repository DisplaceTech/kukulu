// kukulu_status and kukulu_next: the decision table that decides which agent
// runs next. Every branch of `next()` gets a case here, because a wrong answer
// sends an unattended flight down the wrong stage.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  ROOT, finish, ok, eq, like, isError,
  mkDir, mkFakeGpg, specRepo, plannedRepo, withServer, useLegacyLayout, mkBareRemote, mkFakeGhBin,
  writeFile, readFile, hasFile, setState, markTasks, git, subject, planDoc, progressDoc,
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
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ verify: ["true"], roles: { planner: { model: "Ollama/x" } } }, null, 2) + "\n");
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
  const cfgPath = path.join(repo, "docs/kukulu.json");
  const c = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ ...c, roles: { reviewer: { model } } }, null, 2) + "\n");
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
for (const missing of ["docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json"]) {
  const repo = plannedRepo();
  fs.rmSync(path.join(repo, missing));
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "plan", `missing ${missing} → back to plan`);
  });
}

// -------------------------------------------------------------- the plan-stage signing probe (B-04)

function archivedSpecRepo(policy) {
  const repo = specRepo("# Spec 2\n");
  writeFile(repo, "docs/flights/x/SPEC.md", "# Spec 1\n");
  writeFile(repo, "docs/flights/x/kukulu.json", JSON.stringify({ verify: ["true"], policies: { signing: policy } }) + "\n");
  setState(repo, { archived: { slug: "x", dir: "docs/flights/x", at: "2026-01-01T00:00:00Z" } });
  git(repo, ["config", "--local", "--unset", "commit.gpgsign"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: archived"]);
  return repo;
}

/** The operator's own signing in a temp global config; `failing` makes the fake gpg refuse to sign. */
function operatorSigning(failing) {
  const gpg = mkFakeGpg(failing ? { failAfter: 0 } : {});
  const file = path.join(path.dirname(gpg), "gitconfig");
  fs.writeFileSync(file, `[commit]\n\tgpgsign = true\n[gpg]\n\tformat = openpgp\n\tprogram = ${gpg}\n[user]\n\tsigningkey = 0123456789ABCDEF\n`);
  return { env: { GIT_CONFIG_GLOBAL: file } };
}

const PROBE_PREFIX = /^policies\.signing is 'required' and the signing probe failed: /;

for (const [label, policy, failing, probeReason] of [
  ["a required policy with a failing signer stops before planning", "required", true, true],
  ["a required policy with a working signer gives the plan reason", "required", false, false],
  ["an auto policy with a failing signer gives the plan reason", "auto", true, false],
]) {
  const repo = archivedSpecRepo(policy);
  const cfgBefore = readFile(repo, ".git/config");
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    eq(n.stage, "plan", `${label}: the stage is plan`);
    if (probeReason) like(n.reason, PROBE_PREFIX, "...with the probe failure as the reason");
    else like(n.reason, /^no plan on disk/, "...with today's reason");
    eq(git(repo, ["status", "--porcelain"]), "", "...and no file changed");
    eq(readFile(repo, ".git/config"), cfgBefore, "...nor the local git config");
  }, operatorSigning(failing));
}

// -------------------------------------------------------------- implement stage

{
  const note = "Commits in this run are unsigned and kukulu_pr_finalize will not wait for signatures.";
  const repo = plannedRepo();
  setState(repo, { signing: "none" });
  await withServer(repo, async ({ call }) => {
    const n = await call("kukulu_next");
    ok(n.prompt.trimEnd().endsWith(note), "the Run policies sentence carries the signing note");
  });
  const on = plannedRepo();
  setState(on, { signing: "on" });
  await withServer(on, async ({ call }) => {
    const n = await call("kukulu_next");
    ok(!n.prompt.includes("kukulu_pr_finalize will"), "...and not when signing is on");
  });
}

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
  writeFile(repo, ".kukulu/implement.lock", "3\n");
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lockCounter, 3, "a legacy bare-number lock still reads back its count");
  });
}
{
  const repo = plannedRepo();
  writeFile(repo, ".kukulu/implement.lock", '{"count":7,"round":1}\n');
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_status")).lockCounter, 7, "a JSON lock's count is read directly");
  });
}

// A lock with no open tasks means a run died before its handoff.
{
  const repo = plannedRepo();
  markTasks(repo, ALL_DONE);
  writeFile(repo, ".kukulu/implement.lock", "3\n");
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
    eq(n.reason, `stopped by hand — once the cause is fixed, call kukulu_run_resume({ reason: "<what you fixed>" })`, "the recorded halt reason is passed through, followed by the resume instruction");
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
  const today = new Date().toISOString().slice(0, 10);
  const line = (k, n, was) => `- ${today}: ${k} set to ${n} (was ${was}) by the operator through kukulu_flight_options.`;
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_flight_options", { maxRounds: 5, maxRoundsHard: 8 });
    const plan = readFile(repo, "docs/PLAN.md");
    ok(plan.includes(`## Decisions\n\n- none\n${line("maxRounds", 5, 3)}\n${line("maxRoundsHard", 8, 6)}\n\n## Phase 0`), "a raised cap is recorded in PLAN.md's Decisions, before the next heading");
    eq(git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort().join(","), "docs/PLAN.md,docs/kukulu.json", "...and PLAN.md is in the same commit as docs/kukulu.json");
    const before = readFile(repo, "docs/PLAN.md");
    await call("kukulu_flight_options", { maxRounds: 5 });
    eq(readFile(repo, "docs/PLAN.md"), before, "an unchanged cap writes nothing to PLAN.md");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/PLAN.md", readFile(repo, "docs/PLAN.md").replace("## Decisions\n\n- none\n\n", ""));
  git(repo, ["commit", "-qam", "plan without decisions"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_flight_options", { maxRounds: 4 });
    const plan = readFile(repo, "docs/PLAN.md");
    ok(plan.endsWith(`\n\n## Decisions\n\n- ${new Date().toISOString().slice(0, 10)}: maxRounds set to 4 (was 3) by the operator through kukulu_flight_options.\n`), "a missing Decisions section is created");
  });
}

{
  const repo = plannedRepo();
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, "#!/bin/sh\nif head -n1 \"$1\" | grep -q '^chore: flight options'; then echo rejected >&2; exit 1; fi\n");
  fs.chmodSync(hook, 0o755);
  const plan = readFile(repo, "docs/PLAN.md");
  const cfgText = readFile(repo, "docs/kukulu.json");
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", { maxRounds: 9 }), /commit failed/, "a failed flight-options commit is an error");
    eq(readFile(repo, "docs/PLAN.md") + "|" + readFile(repo, "docs/kukulu.json"), plan + "|" + cfgText, "...PLAN.md and kukulu.json are byte-identical");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_options", {}), /pass at least one of maxRounds, maxRoundsHard/, "an empty options call is refused");
    isError(await call("kukulu_flight_options", { maxRounds: 0 }), /maxRounds must be a positive integer/, "a non-positive bound is refused");
    const r = await call("kukulu_flight_options", { maxRounds: 6, maxRoundsHard: 6 });
    eq(JSON.stringify(r.before), JSON.stringify({ maxRounds: 3, maxRoundsHard: 6 }), "the previous bounds are reported");
    eq(JSON.stringify(r.after), JSON.stringify({ maxRounds: 6, maxRoundsHard: 6 }), "...and the new ones");
    eq(git(repo, ["log", "-1", "--format=%s"]), "chore: flight options (maxRounds=6, maxRoundsHard=6)", "the change is one commit");
    const c = JSON.parse(readFile(repo, "docs/kukulu.json"));
    eq(c.maxRounds, 6, "docs/kukulu.json carries the new bound");
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
    const cfgBefore = readFile(repo, "docs/kukulu.json");
    const stateBefore = readFile(repo, ".kukulu/state.json");
    isError(await call("kukulu_flight_options", { maxRounds: 3, resume: true }), /pass maxRounds: 4 or more/, "resume with a bound that does not lift the cap is refused, naming 4");
    eq(readFile(repo, "docs/kukulu.json"), cfgBefore, "...docs/kukulu.json is unchanged");
    eq(readFile(repo, ".kukulu/state.json"), stateBefore, "...and so is state");
    isError(await call("kukulu_flight_options", { resume: true }), /pass at least one of/, "resume alone is refused");
    isError(await call("kukulu_flight_options", { maxRounds: 4, resume: "yes" }), /resume must be a boolean/, "a non-boolean resume is refused");
    const head = git(repo, ["rev-list", "--count", "HEAD"]);
    const r = await call("kukulu_flight_options", { maxRounds: 4, resume: true });
    eq(r.resumed, true, "a lifting resume succeeds");
    eq(Number(git(repo, ["rev-list", "--count", "HEAD"])) - Number(head), 1, "...in one commit");
    eq(subject(repo), "chore: flight options (maxRounds=4, resume)", "...with the resume subject");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
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
  writeFile(repo, "docs/kukulu.json", "{ this is not json }");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), /not valid JSON/, "a corrupt kukulu.json is reported, not swallowed");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, ".kukulu/state.json", "{ truncated");
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
  // an untracked kukulu.json with no plan is a stray artifact (project-c F-04)
  const repo = specRepo();
  writeFile(repo, "docs/kukulu.json", "{}\n");
  await withServer(repo, async ({ call }) => {
    const s = await call("kukulu_status");
    eq(s.artifacts["kukulu.json"], "untracked", "an unstaged kukulu.json is untracked");
    eq(s.artifacts["PLAN.md"], "absent", "...PLAN.md is absent");
    eq(s.artifacts["SPEC.md"], "tracked", "...SPEC.md is tracked");
    eq(Object.keys(s.artifacts).join(","), "SPEC.md,PLAN.md,PROGRESS.md,HANDOFF.md,REVIEW.md,SUMMARY.md,kukulu.json", "...and the keys are exactly the seven artifacts");
    eq(s.strayArtifacts.join(","), "kukulu.json", "...so it is a stray artifact");
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

// ---------------------------------------------------------------- prChecks

{
  const withOrigin = () => {
    const repo = plannedRepo();
    git(repo, ["remote", "add", "origin", mkBareRemote()]);
    return repo;
  };
  const ghEnv = (dir) => ({ env: { PATH: `${dir}:${process.env.PATH}` } });
  // A PATH holding git and nothing else, so no gh on the developer's machine can answer.
  const noGhPath = () => {
    const bin = mkDir("kukulu-nogh-");
    const gitBin = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    fs.symlinkSync(gitBin, path.join(bin, "git"));
    return bin;
  };
  const checks = async (repo, opts) => {
    let out;
    await withServer(repo, async ({ call }) => { out = (await call("kukulu_status")).prChecks; }, opts);
    return out;
  };
  const ghWith = (list, exit) => {
    const dir = mkFakeGhBin();
    writeFile(dir, "pr.json", '{"url":"https://github.invalid/pull/1","state":"OPEN","isDraft":true,"baseRefName":"main","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\n');
    if (list !== undefined) writeFile(dir, "checks.json", typeof list === "string" ? list : JSON.stringify(list));
    if (exit !== undefined) writeFile(dir, "checks-exit", String(exit));
    return dir;
  };

  eq(await checks(withOrigin(), { env: { PATH: noGhPath() } }), null, "prChecks is null without gh");
  eq(await checks(plannedRepo(), ghEnv(ghWith([]))), null, "...null without an origin remote");
  const noPr = mkFakeGhBin();
  eq(await checks(withOrigin(), ghEnv(noPr)), null, "...null when the branch has no pull request");
  eq(JSON.stringify(await checks(withOrigin(), ghEnv(ghWith([{ name: "lint", state: "SUCCESS", link: "u1" }, { name: "test", state: "SKIPPED", link: "u2" }])))), JSON.stringify({ state: "pass", failing: [] }), "...pass");
  const fail = await checks(withOrigin(), ghEnv(ghWith([{ name: "lint", state: "SUCCESS", link: "u1" }, { name: "test", state: "FAILURE", link: "https://ci.invalid/test" }, { name: "slow", state: "PENDING", link: "u3" }], 1)));
  eq(JSON.stringify(fail), JSON.stringify({ state: "fail", failing: [{ name: "test", link: "https://ci.invalid/test" }] }), "...fail lists the failing check with its link, though gh exited non-zero");
  eq((await checks(withOrigin(), ghEnv(ghWith([{ name: "slow", state: "IN_PROGRESS", link: "u" }], 8)))).state, "pending", "...pending");
  eq(JSON.stringify(await checks(withOrigin(), ghEnv(ghWith([])))), JSON.stringify({ state: "none", failing: [] }), "...none for an empty list");
  like(await checks(withOrigin(), ghEnv(ghWith("no checks reported", 1))), /^unknown: /, "...unknown when gh pr checks prints no JSON");

  {
    // An older gh (2.45.0) has no `pr checks --json`; the REST API answers instead (D-01). Bodies come from recorded fixtures.
    const fx = (name) => fs.readFileSync(path.join(ROOT, "test", "fixtures", "gh", name), "utf8");
    const runsAll = JSON.parse(fx("check-runs.json"));
    const statusAll = JSON.parse(fx("status.json"));
    const apiGh = (runs, statuses) => {
      const dir = ghWith(undefined, 1);
      writeFile(dir, "checks-stderr", fx("pr-checks-unknown-flag.txt"));
      writeFile(dir, "api-check-runs.json", JSON.stringify({ ...runsAll, check_runs: runs }));
      writeFile(dir, "api-status.json", JSON.stringify({ ...statusAll, statuses }));
      return dir;
    };
    const named = (list, names) => list.filter((x) => names.includes(x.name ?? x.context));
    const fail = await checks(withOrigin(), ghEnv(apiGh(runsAll.check_runs, statusAll.statuses)));
    eq(fail.state + "|" + fail.via, "fail|gh api", "prChecks falls back to gh api and reports a failure");
    eq(fail.failing.map((f) => `${f.name} ${f.link}`).sort().join(","), ["failure", "cancelled", "timed_out", "action_required", "startup_failure"].map((c) => `run-${c} https://ci.invalid/run-${c}`).concat(["failure", "error"].map((c) => `status-${c} https://ci.invalid/status-${c}`)).sort().join(","), "...failing names and links exactly the failing runs and statuses");
    const pass = await checks(withOrigin(), ghEnv(apiGh(named(runsAll.check_runs, ["run-success", "run-neutral", "run-skipped"]), named(statusAll.statuses, ["status-success"]))));
    eq(JSON.stringify(pass), JSON.stringify({ state: "pass", failing: [], via: "gh api" }), "...reports pass");
    const pending = await checks(withOrigin(), ghEnv(apiGh(named(runsAll.check_runs, ["run-success", "run-in_progress"]), named(statusAll.statuses, ["status-success", "status-pending"]))));
    eq(pending.state, "pending", "...reports pending");
    eq((await checks(withOrigin(), ghEnv(apiGh([], [])))).state, "none", "...reports none");
    const broken = apiGh(runsAll.check_runs, statusAll.statuses);
    writeFile(broken, "api-fails", "HTTP 502: bad gateway\nsecond line\n");
    eq(await checks(withOrigin(), ghEnv(broken)), "unknown: HTTP 502: bad gateway", "a failing gh api call is unknown");
  }

  {
    // A gh that never answers `pr view` must not hang the synchronous server: the 30 s bound turns it into unknown.
    const hung = mkDir("kukulu-hung-gh-");
    writeFile(hung, "gh", '#!/bin/sh\ncase "$1" in --version) echo gh version 0;; pr) exec sleep 120;; esac\n');
    fs.chmodSync(path.join(hung, "gh"), 0o755);
    const started = Date.now();
    const out = await checks(withOrigin(), ghEnv(hung));
    like(out, /^unknown: .*timed out/, "prChecks is unknown when gh pr view hangs");
    ok(Date.now() - started < 60000, "...and kukulu_status returned within the bound");
  }

  {
    // `exec sleep` so no child keeps the pipe open past spawnSync's timeout; a hung --version reads as no gh.
    const hung = mkDir("kukulu-hung-version-gh-");
    writeFile(hung, "gh", '#!/bin/sh\ncase "$1" in --version) exec sleep 120;; esac\n');
    fs.chmodSync(path.join(hung, "gh"), 0o755);
    const started = Date.now();
    eq(await checks(withOrigin(), ghEnv(hung)), null, "prChecks is null when gh --version hangs");
    ok(Date.now() - started < 60000, "...and kukulu_status returned within the bound");
  }

  {
    const statusReview = async (config) => {
      let out;
      await withServer(plannedRepo(config ? { config } : {}), async ({ call }) => { out = (await call("kukulu_status")).review; });
      return out;
    };
    eq(JSON.stringify(await statusReview()), JSON.stringify({ mutationFixRounds: 2 }), "kukulu_status reports review.mutationFixRounds (the default)");
    eq(JSON.stringify(await statusReview({ review: { mutationFixRounds: 5 } })), JSON.stringify({ mutationFixRounds: 5 }), "...and a configured value");
  }

  const repo = withOrigin();
  const dir = ghWith([{ name: "t", state: "FAILURE", link: "u" }]);
  await withServer(repo, async ({ call }) => {
    const calls = () => (hasFile(dir, "calls.log") ? readFile(dir, "calls.log") : "");
    await call("kukulu_next");
    ok(!calls().includes("pr checks"), "kukulu_next does not call gh pr checks");
    await call("kukulu_status");
    ok(calls().includes("pr checks"), "...while kukulu_status does");
  }, ghEnv(dir));
}

// ---------------------------------------------------------------- plan_commit slug note

for (const [slug, expectNote, label] of [
  ["kukulu-tech-specification", "kukulu-tech", "plan_commit notes a flight slug ending in -specification"],
  ["kukulu-tech-spec", "kukulu-tech", "plan_commit notes a flight slug ending in -spec"],
  ["v0-7-0", null, "plan_commit has no notes for v0-7-0"],
]) {
  const repo = specRepo();
  const plan = plannedRepo({ config: { flight: slug } });
  writeFile(repo, "docs/PLAN.md", readFile(plan, "docs/PLAN.md"));
  writeFile(repo, "docs/PROGRESS.md", readFile(plan, "docs/PROGRESS.md"));
  writeFile(repo, "docs/kukulu.json", readFile(plan, "docs/kukulu.json"));
  writeFile(repo, "CLAUDE.md", "# rules\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit");
    if (expectNote) like(r.notes.join("\n"), new RegExp(`flight '${slug}' ends in a spec suffix; derive it from the text before the title's dash \\(plan-build\\), e\\.g\\. '${expectNote}'`), label);
    else eq(r.notes.length, 0, label);
    ok(Boolean(r.commit), "...and still commits");
  });
}

// ---------------------------------------------------------------- plan_commit (S-06)

{
  const repo = specRepo();
  const plan = plannedRepo(); // only for its generated texts
  writeFile(repo, "docs/PLAN.md", readFile(plan, "docs/PLAN.md"));
  writeFile(repo, "docs/PROGRESS.md", readFile(plan, "docs/PROGRESS.md"));
  writeFile(repo, "docs/kukulu.json", readFile(plan, "docs/kukulu.json"));
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
  // the branch the plan is committed on must be one run_start accepts
  const copyPlan = (repo) => {
    const plan = plannedRepo();
    writeFile(repo, "docs/PLAN.md", readFile(plan, "docs/PLAN.md"));
    writeFile(repo, "docs/PROGRESS.md", readFile(plan, "docs/PROGRESS.md"));
    writeFile(repo, "docs/kukulu.json", readFile(plan, "docs/kukulu.json"));
    writeFile(repo, "CLAUDE.md", "# rules\n");
  };
  const repo = specRepo();
  copyPlan(repo);
  git(repo, ["checkout", "-q", "-b", "feature/x"]);
  await withServer(repo, async ({ rpc }) => {
    const e = (await rpc("tools/call", { name: "kukulu_plan_commit", arguments: {} })).result;
    ok(e.isError, "plan_commit refuses a plan on a branch that is neither baseBranch nor a branchPrefix branch");
    like(e.content[0].text, /\[branch\] on 'feature\/x', but docs\/kukulu\.json baseBranch is 'main'; set baseBranch to 'feature\/x'/, "...with the message naming both fixes");
    eq(e.structuredContent.problems.map((p) => p.check).join(","), "branch", "...as check 'branch' alone");
  });
  git(repo, ["checkout", "-q", "main"]);
  await withServer(repo, async ({ call }) => {
    ok((await call("kukulu_plan_commit")).tasks === 3, "plan_commit accepts baseBranch");
  });
  const repo2 = specRepo();
  copyPlan(repo2);
  git(repo2, ["checkout", "-q", "-b", "build/2026-01-01"]);
  await withServer(repo2, async ({ call }) => {
    ok((await call("kukulu_plan_commit")).tasks === 3, "plan_commit accepts a branchPrefix branch");
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
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ verify: ["true"], constraints: [{ id: "c", paths: ["src/"], pattern: "x", shouldMatch: ["x"], shouldNotMatch: ["y"], from: "P9-01" }] }));
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
function splitPlanRepo(progressPatch = (t) => t, { claude = "# rules\n", flight } = {}) {
  const repo = specRepo();
  const tasks = [
    { id: "P1-01", title: "One" },
    { id: "P1-02", title: "Two" },
    { id: "P1-02a", title: "Two and a half" },
    { id: "P1-03", title: "Three", depends: ["P1-02a"], goal: "see P1-02a, and not P1-02" },
  ];
  writeFile(repo, "docs/PLAN.md", planDoc(tasks));
  writeFile(repo, "docs/PROGRESS.md", progressPatch(progressDoc(tasks)));
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ ...(flight ? { flight } : {}), verify: ["true"], constraints: [{ id: "c", paths: ["src/"], pattern: "x", shouldMatch: ["x"], shouldNotMatch: ["y"], from: "P1-03" }] }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", claude);
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
    like(readFile(repo, "docs/kukulu.json"), /"from": "P1-04"/, "...and the from value follows its task");
    eq(subject(repo), "plan: derive build plan from SPEC", "...in the plan commit");
    ok(plan.includes("### P1-02: Two"), "...P1-02 keeps its heading");
  });
}

{
  // CLAUDE.md: only the flight's own notes section is rewritten.
  const claude = [
    "# rules", "", "Top of the file cites P1-03 and P1-02a as history.", "",
    "## Flight old-flight notes", "", "An earlier flight used P1-03 too.", "",
    "## Flight my-flight notes", "", "- P1-02a is split; P1-03 follows it.", "",
    "### A subsection", "", "Still the notes: P1-03.", "",
    "## Commit template", "", "Tail section cites P1-03 and P1-02a.", "",
  ].join("\n");
  const repo = splitPlanRepo((t) => t, { claude, flight: "my-flight" });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit", { renumber: true });
    eq(JSON.stringify(r.notes), "[]", "(setup) renumber with the notes section present adds no note");
    const out = readFile(repo, "CLAUDE.md");
    like(out, /- P1-03 is split; P1-04 follows it\./, "renumber rewrites a split id inside the flight's CLAUDE.md notes");
    like(out, /### A subsection\n\nStill the notes: P1-04\./, "...a subsection of the notes is still the notes");
    like(out, /Top of the file cites P1-03 and P1-02a as history\./, "renumber leaves the same id outside the notes section unchanged: the top of the file");
    like(out, /An earlier flight used P1-03 too\./, "...and an earlier flight's section");
    like(out, /Tail section cites P1-03 and P1-02a\./, "the notes section ends at the next level-2 heading");
    eq(git(repo, ["show", "--name-only", "--format=", "HEAD"]).split("\n").includes("CLAUDE.md"), true, "...and CLAUDE.md is in the plan commit");
  });
}

{
  const claude = "# rules\n\nCites P1-02a here.\n";
  const repo = splitPlanRepo((t) => t, { claude, flight: "my-flight" });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_plan_commit", { renumber: true });
    eq(JSON.stringify(r.notes), JSON.stringify(['CLAUDE.md has no "## Flight my-flight notes" section; ids there were not renumbered']), "renumber notes a CLAUDE.md without the flight's notes section");
    eq(readFile(repo, "CLAUDE.md"), claude, "...and leaves CLAUDE.md byte-identical");
  });
  const noSlug = splitPlanRepo((t) => t, { claude });
  await withServer(noSlug, async ({ call }) => {
    const r = await call("kukulu_plan_commit", { renumber: true });
    eq(JSON.stringify(r.notes), JSON.stringify(["docs/kukulu.json has no flight slug; ids in CLAUDE.md were not renumbered"]), "renumber notes a config with no flight slug");
  });
}

{
  const claude = "# rules\n\n## Flight my-flight notes\n\nP1-02a then P1-03.\n";
  const repo = splitPlanRepo((t) => t, { claude, flight: "my-flight" });
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^plan:'; then echo rejected >&2; exit 1; fi\n`);
  fs.chmodSync(hook, 0o755);
  const before = ["docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json", "CLAUDE.md"].map((f) => readFile(repo, f));
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    ok((await call("kukulu_plan_commit", { renumber: true })).error, "a failed renumber commit is an error");
    ["docs/PLAN.md", "docs/PROGRESS.md", "docs/kukulu.json", "CLAUDE.md"].forEach((f, i) => eq(readFile(repo, f), before[i], `a failed renumber commit leaves ${f} byte-identical`));
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD did not move");
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
  const before = { plan: readFile(repo, "docs/PLAN.md"), progress: readFile(repo, "docs/PROGRESS.md"), cfg: readFile(repo, "docs/kukulu.json") };
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_plan_commit", { renumber: true }), /only for a plan no run has touched/, `renumber is refused once a run has started: ${label}`);
    ok(readFile(repo, "docs/PLAN.md") === before.plan && readFile(repo, "docs/PROGRESS.md") === before.progress && readFile(repo, "docs/kukulu.json") === before.cfg, "...and every file is unchanged");
  });
}

{
  const repo = plannedRepo({ config: { policies: { signing: "sometimes" } } });
  await withServer(repo, async ({ rpc }) => {
    const e = (await rpc("tools/call", { name: "kukulu_plan_commit", arguments: {} })).result;
    eq(e.structuredContent.problems.filter((p) => p.check === "config").length, 1, "a broken config is one config problem");
  });
}

// ---------------------------------------------------------------- pre-0.6.0 layout and recorded flights (RN-06)

{
  // The 0.5.0 flight archive is recorded evidence. Its hashes are computed at
  // the start of the test, so the test never needs re-pinning, and the tools
  // must leave every byte of a copy of it alone.
  const FLIGHT = "docs/flights/v0-5-0";
  const NAMES = ["HANDOFF.md", "PLAN.md", "PROGRESS.md", "REVIEW.md", "SPEC.md", "SUMMARY.md", "feedback.jsonl", "foundry.json", "state.json"];
  const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const before = Object.fromEntries(NAMES.map((name) => [name, sha(path.join(ROOT, FLIGHT, name))]));
  eq(fs.readdirSync(path.join(ROOT, FLIGHT)).sort().join(","), [...NAMES].sort().join(","), "docs/flights/v0-5-0 holds exactly the nine recorded files");

  // A project that archived that flight under the old config name is still understood.
  const repo = specRepo();
  fs.mkdirSync(path.join(repo, FLIGHT), { recursive: true });
  for (const name of NAMES) fs.copyFileSync(path.join(ROOT, FLIGHT, name), path.join(repo, FLIGHT, name));
  fs.copyFileSync(path.join(ROOT, FLIGHT, "SPEC.md"), path.join(repo, "docs", "SPEC.md"));
  writeFile(repo, ".kukulu/state.json", JSON.stringify({ ...JSON.parse(readFile(repo, `${FLIGHT}/state.json`)), summarized: false, archived: { slug: "v0-5-0", dir: FLIGHT, at: "2026-10-07T20:54:01.917Z" } }));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: archive flight v0-5-0"]);
  await withServer(repo, async ({ call }) => {
    const st = await call("kukulu_status");
    eq(st.state.archived.slug, "v0-5-0", "status reads the archive record of a flight archived before 0.6.0");
    const n = await call("kukulu_next");
    eq(n.stage, "done", "kukulu_next recognizes the archived flight");
    like(n.reason, /flight v0-5-0 is archived in docs\/flights\/v0-5-0/, "...and names it");
  });
  eq(NAMES.filter((name) => sha(path.join(repo, FLIGHT, name)) !== before[name]).join(","), "", "the tools leave every archived file byte-identical");
}

/** A project on the pre-0.6.0 layout, built from a planned repo. */
const OLD_LAYOUT = /pre-0\.6\.0 Foundry layout, which 0\.7\.0 no longer reads/;

{
  const repo = plannedRepo();
  setState(repo, { round: 0 });
  useLegacyLayout(repo);
  fs.rmSync(path.join(repo, "docs/foundry.json"));
  git(repo, ["commit", "-qam", "chore: only the state directory"]);
  await withServer(repo, async ({ call }) => {
    const e = await call("kukulu_status");
    isError(e, OLD_LAYOUT, "a project with only .foundry/ is refused with the 0.7.0 layout message");
    isError(await call("kukulu_status"), /docs\/kukulu\.json/, "...which names docs/kukulu.json");
  });
}

{
  const repo = plannedRepo();
  setState(repo, { round: 0 });
  useLegacyLayout(repo);
  fs.rmSync(path.join(repo, ".foundry"), { recursive: true });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: only the config"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), OLD_LAYOUT, "a project with only docs/foundry.json is refused the same way");
  });
}

{
  const repo = useLegacyLayout(plannedRepo());
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), OLD_LAYOUT, "every tool refuses the old layout: kukulu_status");
    isError(await call("kukulu_next"), OLD_LAYOUT, "...kukulu_next");
    isError(await call("kukulu_verify"), OLD_LAYOUT, "...kukulu_verify");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, "docs/foundry.json", "{}");
  setState(repo, { round: 0 });
  writeFile(repo, ".foundry/state.json", "{}");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_status"), /both the pre-0\.6\.0 layout .* and the current one .* exist/, "a project with both layouts is refused, since either would hide the other");
    isError(await call("kukulu_next"), /Keep the one you use and remove the other/, "...for every tool, with what to do");
  });
}

finish();
