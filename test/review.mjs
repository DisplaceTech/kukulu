// The review and summarize stages: kukulu_review_submit and
// kukulu_summary_commit. This is where a judgment call becomes queued work,
// so the tool is strict about what a finding must carry before it counts.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  finish, ok, eq, like, isError,
  mkDir, plannedRepo, withServer, readFile, writeFile, subject, hasFile,
  markTasks, setState, git, mkBareRemote, mkFakeGhBin, mkFakeGpg, useFakeSigner,
} from "./harness.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };

/**
 * A repo parked exactly where the reviewer picks it up, `round` fix rounds
 * already queued (so this review is stamped `round + 1`, matching what
 * kukulu_status would call `reviewRound`).
 */
function reviewableRepo({ config, verdict = "CHANGES REQUESTED", states = ALL_DONE, round = 0 } = {}) {
  const repo = plannedRepo({ config });
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  markTasks(repo, states);
  setState(repo, { round, implemented: true });
  writeFile(repo, "docs/REVIEW.md", `# Review\nRound: ${round + 1}\n**Verdict**: ${verdict}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", `chore: round ${round} implemented`]);
  return repo;
}

const FIX = {
  title: "Fix hello",
  goal: "hello must actually greet",
  files: ["hello.txt"],
  constraints: "no new dependencies",
  tests: "test/hello.test.js",
  outOfScope: "the rest of phase 0",
  verification: "npm test",
  dependsOn: [],
};

// ---------------------------------------------------------------- refusals

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_review_submit", { verdict: "APPROVED" }), /docs\/REVIEW\.md does not exist/, "a verdict needs a written review");
    writeFile(repo, "docs/REVIEW.md", "# Review\n**Verdict**: APPROVED\n");
    isError(await call("kukulu_review_submit", { verdict: "APPROVED" }), /no implementation handoff recorded/, "there is nothing to review before a handoff");
    isError(await call("kukulu_review_submit", { verdict: "LGTM" }), /verdict must be APPROVED or CHANGES REQUESTED/, "a freeform verdict is rejected");
    isError(await call("kukulu_review_submit", {}), /verdict must be APPROVED or CHANGES REQUESTED/, "a missing verdict is rejected");
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    isError(
      await call("kukulu_review_submit", { verdict: "APPROVED", tasks: [FIX] }),
      /an APPROVED verdict cannot carry fix tasks/,
      "approval and fix tasks are mutually exclusive",
    );
    isError(
      await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED" }),
      /requires at least one fix task or unblock/,
      "changes requested must say what changes",
    );
    for (const field of ["title", "goal", "files", "tests"]) {
      const broken = { ...FIX, [field]: Array.isArray(FIX[field]) ? [] : "" };
      isError(
        await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [broken] }),
        new RegExp(`missing '${field}'`),
        `a fix task without ${field} is rejected`,
      );
    }
    isError(
      await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", unblock: [{ id: "P9-99" }] }),
      /cannot unblock P9-99: not in PROGRESS\.md/,
      "an unknown id cannot be unblocked",
    );
    isError(
      await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", unblock: [{ id: "P0-01" }] }),
      /cannot unblock P0-01: it is 'done'/,
      "a finished task cannot be unblocked",
    );
    eq(subject(repo), "chore: round 0 implemented", "no refusal left a commit behind");
    eq(git(repo, ["status", "--porcelain"]), "", "no refusal left the tree dirty");
  });
}

// ---------------------------------------------------------------- the Round: line (F-10, F-11)

{
  const repo = reviewableRepo();
  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 0\n**Verdict**: APPROVED\n");
  await withServer(repo, async ({ call }) => {
    isError(
      await call("kukulu_review_submit", { verdict: "APPROVED" }),
      /'Round:' line is '0'; this review must be stamped 'Round: 1'/,
      "a review stamped with the current round, not the next one, is refused",
    );
  });
}

{
  const repo = reviewableRepo();
  writeFile(repo, "docs/REVIEW.md", "# Review\n**Verdict**: APPROVED\n");
  await withServer(repo, async ({ call }) => {
    isError(
      await call("kukulu_review_submit", { verdict: "APPROVED" }),
      /'Round:' line is missing; this review must be stamped 'Round: 1'/,
      "a review with no Round: line at all names the expected value",
    );
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    isError(
      await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [{ ...FIX, dependsOn: ["R1-03"] }, FIX] }),
      /depends on 'R1-03', which is neither an existing task[\s\S]*\(R1-01, R1-02\)/,
      "a dependsOn one past the end of this submission is refused",
    );
    isError(
      await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [{ ...FIX, dependsOn: ["R2-01"] }] }),
      /depends on 'R2-01', which is neither an existing task/,
      "a dependsOn naming a future round's id is refused",
    );
  });
}

// ---------------------------------------------------------------- changes requested

// F-03: the returned counts come from PROGRESS.md as the call left it.
{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", {
      verdict: "CHANGES REQUESTED",
      tasks: [FIX, { ...FIX, title: "Second fix" }, { ...FIX, title: "Third fix" }],
    });
    eq(r.counts.todo, 3, "three fix tasks against an all-done plan return todo 3, not the pre-append 0");
    eq(r.counts.open, 3, "...and open 3");
    eq(r.counts.total, 6, "...and a total that includes them");
    const s = await call("kukulu_status");
    eq(JSON.stringify(s.counts), JSON.stringify(r.counts), "the submit's counts match what kukulu_status reads straight afterwards");
  });
}

{
  const repo = reviewableRepo({ states: { "P0-01": "x", "P0-02": "!", "P0-03": "-" } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", {
      verdict: "CHANGES REQUESTED",
      tasks: [FIX, { ...FIX, title: "Second fix", files: ["a.txt", "b.txt"], dependsOn: ["R1-01"] }],
      unblock: [{ id: "P0-02", reason: "the API does exist; see SPEC §6" }],
    });
    eq(r.round, 1, "changes requested opens the next round");
    eq(r.fixTasks.join(","), "R1-01,R1-02", "fix tasks are numbered and zero-padded");
    eq(r.unblocked.join(","), "P0-02", "unblocked tasks are reported");
    eq(r.reopenedDependents.join(","), "P0-03", "the task skipped because of it is reopened with it (cleanflate F-05)");
    eq(r.halted, null, "a round inside the cap does not halt the flight");
    // F-03: the returned counts describe PROGRESS.md as this call left it —
    // two new fix tasks, one unblocked task and its reopened dependent — not
    // as it was before.
    eq(r.counts.todo, 4, "the returned counts include the unblocked task, its dependent and both new fix tasks");
    eq(r.counts.open, 4, "...as open");
    eq(r.counts.skipped, 0, "...and nothing is left skipped");
    eq(r.counts.blocked, 0, "...and the unblocked task is no longer blocked");
    eq(r.counts.total, 5, "...and total includes the new tasks");
    eq(subject(repo), "review: round 1", "the round is one commit");
    eq(git(repo, ["status", "--porcelain"]), "", "review_submit leaves a clean tree");

    const plan = readFile(repo, "docs/PLAN.md");
    like(plan, /## Review fixes \(round 1\)\n\n### R1-01: Fix hello/, "PLAN.md gains a review-fixes section");
    like(plan, /\*\*Goal:\*\* hello must actually greet/, "the fix task keeps the plan's task format");
    like(plan, /\*\*Files touched:\*\* a\.txt, b\.txt/, "a file list is rendered as prose the implementer can read");
    like(plan, /### R1-02[\s\S]*\*\*Depends on:\*\* R1-01/, "dependencies between fix tasks survive");
    like(plan, /### R1-01[\s\S]*\*\*Depends on:\*\* none/, "a fix task with no dependencies says none");

    const prog = readFile(repo, "docs/PROGRESS.md");
    like(prog, /- \[ \] P0-02 Impossible task\n- \[ \] P0-03[^\n]*\n- \[ \] R1-01 Fix hello\n- \[ \] R1-02 Second fix\n\n## Log/, "fix tasks are appended to Tasks, above the Log");
    like(prog, /### P0-02 — unblocked \(round 1\)\nthe API does exist; see SPEC §6/, "the unblock reason is logged");
    like(prog, /### P0-03 — unblocked \(round 1\)\nreopened: it was skipped because of P0-02, which is open again/, "the dependent's reopening is logged with its cause");

    const s = await call("kukulu_status");
    eq(s.counts.open, 4, "the unblocked task, its dependent and both fixes are open");
    eq(s.reviewRoundsInPlan, 1, "status counts the review sections in PLAN.md");
    eq(s.state.verdict, "CHANGES REQUESTED", "the verdict is persisted");

    // The round-trip that matters: what the reviewer wrote, the implementer reads.
    const n = await call("kukulu_next");
    eq(n.stage, "implement", "changes requested sends the flight back to implement");
    eq(n.round, 1, "the implementer is told which round it is on");
    await call("kukulu_run_start");
    const first = await call("kukulu_task_next");
    eq(first.id, "P0-02", "the unblocked task is picked up again");
    await call("kukulu_task_block", { id: "P0-02", reason: "still blocked / same error / needs a spec change" });
    const fix = await call("kukulu_task_next");
    eq(fix.skipped.map((x) => x.id).join(","), "P0-03", "a reopened dependent whose blocker blocks again is skipped again");
    eq(fix.id, "R1-01", "the fix task is next");
    like(fix.text, /hello must actually greet/, "the fix task's text is readable from PLAN.md");
    eq(fix.files, "hello.txt", "the fix task's files parse back out");
  });
}

// An unblock on its own is a legitimate round: no new tasks, one reopened.
{
  const repo = reviewableRepo({ states: { "P0-01": "x", "P0-02": "!", "P0-03": "-" } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", unblock: ["P0-03"] });
    eq(r.fixTasks.length, 0, "a round can be an unblock with no new tasks");
    eq(r.unblocked.join(","), "P0-03", "a bare string id is accepted");
    like(readFile(repo, "docs/PROGRESS.md"), /### P0-03 — unblocked \(round 1\)\nunblocked by reviewer/, "a bare id gets a default reason");
    ok(!/## Review fixes/.test(readFile(repo, "docs/PLAN.md")), "no empty review section is added to PLAN.md");
  });
}

// Ten findings in one round: the ids stay sortable.
{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ ...FIX, title: `Fix ${i + 1}` }));
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks });
    eq(r.fixTasks[0], "R1-01", "the first of ten is R1-01");
    eq(r.fixTasks[9], "R1-10", "the tenth is R1-10");
  });
}

// ---------------------------------------------------------------- convergence (F-13, F-15)

/** `n` fix tasks, distinct titles, otherwise shaped like FIX. */
const manyTasks = (n) => Array.from({ length: n }, (_, i) => ({ ...FIX, title: `Fix ${i + 1}` }));

/**
 * Drive a sequence of CHANGES REQUESTED rounds on `repo`, one call per entry
 * in `counts` (the number of fix tasks that round). Stands in for a whole
 * implement/review cycle between rounds: review_submit itself only requires
 * `implemented: true` and a matching `Round:` line, not real task work.
 */
async function driveRounds(call, repo, counts) {
  let last;
  for (const [i, n] of counts.entries()) {
    const round = i + 1;
    writeFile(repo, "docs/REVIEW.md", `# Review\nRound: ${round}\n**Verdict**: CHANGES REQUESTED\n`);
    setState(repo, { implemented: true });
    last = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: manyTasks(n) });
  }
  return last;
}

{
  const repo = reviewableRepo({ config: { maxRounds: 3 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [15, 3, 2, 1]);
    eq(r.halted, null, "findings shrinking every round never halts, even across four rounds with a maxRounds of 3");
    eq(r.round, 4, "the round still counts up normally");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "a round that never halts logs no feedback entry");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 2 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [4, 4, 4]);
    like(r.halted, /non-converging/, "three rounds that never shrink halt on the third");
    like(r.halted, /reaching maxRounds=2/, "the message names the exceeded cap");
    like(r.halted, /the 3rd non-converging round|the 2nd non-converging round/, "the message uses a correct ordinal");
    like(r.halted, /kukulu_flight_options\(\{ maxRounds: 3, resume: true \}\)/, "...and names the call that resumes the flight");
    ok(!r.halted.includes("edit .kukulu/state.json"), "...and no longer tells the operator to edit state by hand");
    eq(JSON.stringify(JSON.parse(readFile(repo, ".kukulu/state.json")).haltCap), JSON.stringify({ cap: "maxRounds", round: 3, nonConverging: 2 }), "...and state.haltCap records the cap");
    like(r.halted, /findings per round: 4 → 4 → 4/, "the message shows the trail of counts");
    const n = await call("kukulu_next");
    eq(n.stage, "halt", "the flight now halts");
    eq(n.reason, r.halted, "the halt reason is the one review_submit recorded");

    like(subject(repo), /^review: round 3/, "the feedback entry lands in the same commit as the round's own review: commit");
    const changed = git(repo, ["show", "--stat", "--format=", "HEAD"]);
    like(changed, /\.kukulu\/feedback\.jsonl/, "...the commit touches the feedback file");
    const lines = readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n");
    eq(lines.length, 1, "exactly one feedback entry for the one round that halted");
    const entry = JSON.parse(lines[0]);
    eq(entry.stage, "review", "logged from the review stage");
    eq(entry.category, "round-cap", "tagged as a round-cap halt");
    eq(entry.source, "auto", "recorded as an auto entry");
    eq(entry.message, r.halted, "the message matches the halt reason verbatim");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 100, maxRoundsHard: 2 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [10, 5, 2]);
    like(r.halted, /hard cap maxRoundsHard=2/, "the hard cap fires on round 3 even while every round is converging, since maxRounds=100 would never trip");
    like(r.halted, /kukulu_flight_options\(\{ maxRoundsHard: 3, resume: true \}\)/, "the hard-cap halt names its resume call");
    eq(JSON.stringify(JSON.parse(readFile(repo, ".kukulu/state.json")).haltCap), JSON.stringify({ cap: "maxRoundsHard", round: 3 }), "...and records haltCap");
    const entry = JSON.parse(readFile(repo, ".kukulu/feedback.jsonl").trim());
    eq(entry.category, "round-cap", "the hard-cap halt is logged the same way as a non-converging one");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 2, policies: { feedback: false } } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [4, 4, 4]);
    like(r.halted, /non-converging/, "the halt itself is unaffected by policies.feedback");
    ok(!hasFile(repo, ".kukulu/feedback.jsonl"), "...but policies.feedback: false suppresses the auto entry");
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    const r1 = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: manyTasks(2) });
    eq(r1.halted, null, "round 1 is always allowed; there is nothing to compare it against yet");
    let s = await call("kukulu_status");
    eq(s.state.rounds.length, 1, "state.rounds records the submission");
    eq(s.state.rounds[0].fixTasks, 2, "...with its fix-task count");
    eq(s.state.rounds[0].verdict, "CHANGES REQUESTED", "...and its verdict");
    eq(s.state.rounds[0].nonConverging, false, "round 1 is never marked non-converging");
    ok(s.state.rounds[0].at, "...and a timestamp");

    writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 2\n**Verdict**: APPROVED\n");
    setState(repo, { implemented: true });
    await call("kukulu_review_submit", { verdict: "APPROVED" });
    s = await call("kukulu_status");
    eq(s.state.rounds.length, 2, "an approval is recorded in the history too");
    eq(s.state.rounds[1].verdict, "APPROVED", "...with its own verdict");
    eq(s.state.rounds[1].fixTasks, 0, "...and no fix tasks, since an approval can carry none");
  });
}

// ---------------------------------------------------------------- approval

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_summary_commit"), /docs\/SUMMARY\.md does not exist/, "a summary must be written before it is committed");
    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    isError(await call("kukulu_summary_commit"), /only be committed after an APPROVED review/, "a summary cannot outrun the review");

    const r = await call("kukulu_review_submit", { verdict: "APPROVED" });
    eq(r.verdict, "APPROVED", "the approval is recorded");
    eq(r.round, 1, "an approval reports the round it was stamped with, like a change request (cleanflate F-21)");
    eq(r.fixRounds, 0, "...and separately, that no fix round was opened");
    eq(subject(repo), "review: round 1 approved", "approval is its own commit");

    const n = await call("kukulu_next");
    eq(n.stage, "summarize", "approval hands off to the summarizer");

    const sum = await call("kukulu_summary_commit");
    eq(sum.reviews, 1, "the summary reports how many reviews it took");
    eq(sum.fixRounds, 0, "...and how many fix rounds");
    eq(subject(repo), "chore: build summary", "the summary is committed");
    like(sum.branch, /^build\//, "the summary reports the branch a human has to merge");
    eq(git(repo, ["status", "--porcelain"]), "", "the flight ends with a clean tree");

    eq((await call("kukulu_next")).stage, "done", "and the flight is done");
  });
}

// A lowercase verdict from a model is still a verdict.
{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_review_submit", { verdict: " approved " })).verdict, "APPROVED", "the verdict is normalised before it is trusted");
  });
}

// ---------------------------------------------------------------- pushing (F-18)

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", { verdict: "APPROVED" });
    eq(r.push, "pushed", "an APPROVED review pushes the branch");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote branch head matches the local head");

    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    const sum = await call("kukulu_summary_commit");
    eq(sum.push, "pushed", "the summary commit pushes too");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "...and the remote catches up again");
  });
}

{
  const repo = reviewableRepo();
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.push, "pushed", "a CHANGES REQUESTED review pushes the branch too");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote branch head matches the local head");
  });
}

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    eq((await call("kukulu_review_submit", { verdict: "APPROVED" })).push, "skipped: no origin remote", "without a remote, review_submit says so");
  });
}

{
  // reviewableRepo bypasses kukulu_run_start, which is what would normally
  // copy docs/kukulu.json's policies into state; set state directly to
  // simulate what a real run_start earlier in the round would have recorded.
  const repo = reviewableRepo({ config: { policies: { push: false } } });
  setState(repo, { policies: { signing: "auto", push: false, pr: "draft" } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.push, "skipped: policy", "push: false skips review_submit's push even with a remote present");

    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    setState(repo, { verdict: "APPROVED" }); // shortcut past the fix round, for summary_commit's own push check
    const sum = await call("kukulu_summary_commit");
    eq(sum.push, "skipped: policy", "and summary_commit's push, too");
  });
}

// ---------------------------------------------------------------- kukulu_mutate (F-04)
//
// The reviewer's mutation check: one exact find/replace, the file's own
// verify commands, an unconditional restore, and no commit.

const ADD_SRC = "export const add = (a, b) => a + b;\nexport const unused = () => 1;\n";
const ADD_TEST = 'import { add } from "../src/add.mjs";\nif (add(2, 3) !== 5) { console.error("add is broken"); process.exit(1); }\n';

/** A committed project whose verify command really tests src/add.mjs. */
function mutationRepo({ config = {} } = {}) {
  const repo = plannedRepo({ config: { verify: ["node test/add.test.mjs"], ...config } });
  writeFile(repo, "src/add.mjs", ADD_SRC);
  writeFile(repo, "src/special/thing.mjs", "export const thing = 1;\n");
  writeFile(repo, "test/add.test.mjs", ADD_TEST);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add the fixture sources"]);
  return repo;
}

const untouched = (repo, head) => {
  eq(git(repo, ["status", "--porcelain"]), "", "the tree is clean afterwards");
  eq(git(repo, ["rev-parse", "HEAD"]), head, "no commit was made");
  ok(!hasFile(repo, ".kukulu/mutation.json"), "no sentinel is left behind");
};

{
  const repo = mutationRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
    eq(r.killed, true, "mutating the tested line is killed");
    like(r.verdict, /^killed/, "the verdict says so");
    eq(r.file, "src/add.mjs", "the repo-relative file is echoed");
    eq(r.results.length, 1, "the one verify command ran");
    eq(r.results[0].ok, false, "...and failed against the mutation");
    eq(r.recoveredMutation, null, "nothing needed recovering");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is byte-identical to what was committed");
    untouched(repo, head);

    const s = await call("kukulu_mutate", { file: "src/add.mjs", find: "() => 1", replace: "() => 2" });
    eq(s.killed, false, "mutating a line no test covers survives");
    like(s.verdict, /^survived/, "the verdict says the mechanic is untested");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is restored after a surviving mutation too");
    untouched(repo, head);

    const v = await call("kukulu_verify");
    eq(v.ok, true, "and the real tree still verifies clean afterwards");
  });
}

// A timed-out command still restores the file.
{
  const repo = mutationRepo({ config: { verify: [{ cmd: "exec sleep 5", timeoutMs: 300 }] } });
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a * b" });
    eq(r.results[0].timedOut, true, "the command timed out");
    eq(r.killed, true, "a timeout counts as the mutation being noticed");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is restored after a timeout");
    untouched(repo, head);
  });
}

// Residue (2026-09-30 cleanflate F-10, F-14): a killed mutant's suite may
// rewrite a tracked file or leave a new untracked one; mutate undoes both,
// and never touches what was already dirty or untracked before it ran.
{
  const repo = mutationRepo({ config: { verify: ["echo seed >> tests/regressions.txt; echo seed > tests/new.regressions; node test/add.test.mjs"] } });
  writeFile(repo, "tests/regressions.txt", "# seeds\n");
  writeFile(repo, "notes.md", "tracked note\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "regressions file"]);
  writeFile(repo, "notes.md", "a reviewer's uncommitted edit\n");
  writeFile(repo, "scratch.txt", "already untracked\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
    eq(r.killed, true, "the mutant is killed");
    eq(JSON.stringify(r.restored), JSON.stringify(["tests/regressions.txt"]), "the tracked file the suite rewrote is reported restored");
    eq(JSON.stringify(r.removed), JSON.stringify(["tests/new.regressions"]), "the untracked file the suite created is reported removed");
    eq(readFile(repo, "tests/regressions.txt"), "# seeds\n", "the tracked file is back to HEAD");
    ok(!hasFile(repo, "tests/new.regressions"), "the new untracked file is gone");
    eq(readFile(repo, "notes.md"), "a reviewer's uncommitted edit\n", "a tracked file that was already dirty is left alone");
    eq(readFile(repo, "scratch.txt"), "already untracked\n", "a file that was already untracked is left alone");
  });
}

// A per-call timeout only ever shortens the configured one (cleanflate F-06).
{
  const repo = mutationRepo({ config: { verify: [{ cmd: "sleep 30", timeoutMs: 600000 }] } });
  await withServer(repo, async ({ call }) => {
    const t0 = Date.now();
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a * b", timeoutMs: 400 });
    ok(Date.now() - t0 < 15_000, "timeoutMs cuts a hanging mutant short");
    eq(r.results[0].timedOut, true, "...reported as a timeout");
    eq(r.results[0].timeoutMs, 400, "...with the shortened timeout");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "...and the file is restored");
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a * b", timeoutMs: 0 }), /timeoutMs must be a positive integer/, "a non-positive timeoutMs is refused");
  });
}
{
  const repo = mutationRepo({ config: { verify: [{ cmd: "node test/add.test.mjs", timeoutMs: 1000 }] } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", timeoutMs: 999999 });
    eq(r.results[0].timeoutMs, 1000, "timeoutMs never raises a configured timeout");
  });
}

// Every refusal leaves the file exactly as it was.
{
  const repo = mutationRepo();
  writeFile(repo, "untracked.mjs", "export const x = 1;\n");
  writeFile(repo, "src/twice.mjs", "const a = 1;\nconst b = 1;\n");
  git(repo, ["add", "src/twice.mjs"]);
  git(repo, ["commit", "-qm", "twice"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "no such text", replace: "x" }), /does not appear in src\/add\.mjs/, "find matching zero times is refused");
    isError(await call("kukulu_mutate", { file: "src/twice.mjs", find: " = 1;", replace: " = 2;" }), /appears 2 times[\s\S]*more surrounding context/, "find matching twice is refused, asking for more context");
    isError(await call("kukulu_mutate", { file: "untracked.mjs", find: "1", replace: "2" }), /not tracked/, "an untracked file is refused");
    isError(await call("kukulu_mutate", { file: "../outside.txt", find: "a", replace: "b" }), /outside the project/, "a path outside the repo is refused");
    isError(await call("kukulu_mutate", { file: "/etc/hosts", find: "a", replace: "b" }), /outside the project/, "an absolute path outside the repo is refused");
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", commands: ["rm -rf /"] }), /unknown: "rm -rf \/"[\s\S]*Legal: "node test\/add\.test\.mjs"/, "a command that is not configured is refused, listing the legal ones");
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "", replace: "x" }), /find is required/, "an empty find is refused");
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a + b" }), /identical/, "a no-op mutation is refused");
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b" }), /replace is required/, "a missing replace is refused");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "no refusal touched the file");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "no refusal committed anything");
    ok(!hasFile(repo, ".kukulu/mutation.json"), "no refusal left a sentinel");
  });
}

// A file with a pre-existing uncommitted edit survives exactly as it was.
{
  const repo = mutationRepo();
  const edited = ADD_SRC + "// a reviewer's own note\n";
  writeFile(repo, "src/add.mjs", edited);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" }), /has uncommitted changes/, "a file with uncommitted edits is refused");
    eq(readFile(repo, "src/add.mjs"), edited, "...and the pre-existing edit is untouched");
  });
}

// Mutation testing is a review-stage tool, not something to run mid-implement.
{
  const repo = mutationRepo();
  writeFile(repo, ".kukulu/implement.lock", "0\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" }), /implementation run is in progress/, "a present implement lock refuses");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "...and leaves the file alone");
  });
}

// extraVerify selection mirrors kukulu_verify: the suites a file's own change would trigger.
{
  const repo = mutationRepo({ config: { verify: ["true"], extraVerify: { "src/special/": ["false"] } } });
  await withServer(repo, async ({ call }) => {
    const special = await call("kukulu_mutate", { file: "src/special/thing.mjs", find: "= 1", replace: "= 2" });
    eq(special.results.map((r) => r.command).join("|"), "true|false", "a file under an extraVerify prefix runs verify plus that prefix's commands");
    eq(special.killed, true, "...and the failing extra command kills the mutation");
    const plain = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
    eq(plain.results.map((r) => r.command).join("|"), "true", "a file elsewhere runs only verify");
    eq(plain.killed, false, "...so this mutation survives");

    const only = await call("kukulu_mutate", { file: "src/special/thing.mjs", find: "= 1", replace: "= 2", commands: ["false"] });
    eq(only.results.map((r) => r.command).join("|"), "false", "an explicit commands list runs only those");
  });
}

// Crash recovery: a sentinel left by a mutate that never restored is repaired by the next call.
{
  const repo = mutationRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  writeFile(repo, "src/add.mjs", ADD_SRC.replace("a + b", "a - b"));
  writeFile(repo, ".kukulu/mutation.json", JSON.stringify({ file: "src/add.mjs", at: new Date().toISOString(), original: "0".repeat(40) }) + "\n");
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.recoveredMutation, "src/add.mjs", "verify names the file it restored");
    eq(v.ok, true, "and verifies the restored tree, not the mutated one");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is back to HEAD");
    ok(!hasFile(repo, ".kukulu/mutation.json"), "the sentinel is gone");
    eq(git(repo, ["status", "--porcelain"]), "", "recovery leaves the tree clean, so a later kukulu_task_done is not refused");
    eq(subject(repo), "chore: pipeline friction (review)", "the only commit is the recovery's own feedback entry");
    eq(git(repo, ["rev-parse", "HEAD~1"]), head, "...directly on top of the previous HEAD");
  });
}

{
  const repo = reviewableRepo();
  writeFile(repo, "hello.txt", "hello\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "hello"]);
  writeFile(repo, "hello.txt", "goodbye\n");
  writeFile(repo, ".kukulu/mutation.json", JSON.stringify({ file: "hello.txt", at: new Date().toISOString(), original: "0".repeat(40) }) + "\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.recoveredMutation, "hello.txt", "review_submit also recovers a crashed mutation and says so");
    eq(readFile(repo, "hello.txt"), "hello\n", "the file under review is restored");
  });
}

{
  const repo = mutationRepo();
  writeFile(repo, ".kukulu/mutation.json", "{not json");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), /unreadable[\s\S]*git checkout HEAD -- <file>/, "an unreadable sentinel is loud, and says how to recover by hand");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 3 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [4, 4, 4, 4]);
    like(r.halted, /the 3rd non-converging round/, "a soft cap reached on the third non-converging round reads 3rd, not 3th");
  });
}

{
  // mutant (a): {filter} substituted without its single quotes
  const repo = mutationRepo({ config: { mutation: { targeted: { unit: { cmd: "printf '%s\\n' {filter}" } } } } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", targeted: "unit", filter: "tests\\Unit\\FooTest" });
    like(r.results[0].stdoutTail, /tests\\Unit\\FooTest/, "a targeted filter is passed as one single-quoted word (backslashes arrive verbatim)");
  });
}

{
  // mutant (c): the 11th-13th ordinal special case
  const repo = reviewableRepo({ config: { maxRounds: 11, maxRoundsHard: 100 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, Array(12).fill(4));
    like(r.halted, /the 11th non-converging round/, "an 11th non-converging round reads 11th");
    ok(!String(r.halted).includes("11st"), "...not 11st");
  });
}

// ---------------------------------------------------------------- failedCommands and confirmKill

{
  const repo = mutationRepo();
  await withServer(repo, async ({ call }) => {
    const base = { file: "src/add.mjs", find: "a + b", replace: "a - b" };
    let r = await call("kukulu_mutate", base);
    eq(r.failedCommands.join("|"), "node test/add.test.mjs", "failedCommands names what failed");
    ok(r.confirm === undefined, "...and nothing is re-run without confirmKill");
    r = await call("kukulu_mutate", { ...base, confirmKill: true });
    eq(r.killed, true, "a confirmed kill stands");
    ok(r.confirm.length === 1 && r.confirm.every((c) => c.ok), "...with every confirm re-run ok");
    r = await call("kukulu_mutate", { ...base, find: "() => 1", replace: "() => 2", confirmKill: true });
    eq(r.killed, false, "a survivor stays a survivor");
    ok(r.confirm === undefined && r.failedCommands.length === 0, "confirmKill on a survivor re-runs nothing");
    isError(await call("kukulu_mutate", { ...base, confirmKill: "yes" }), /confirmKill must be a boolean/, "a non-boolean confirmKill is refused");
  });
}

{
  const repo = mutationRepo({ config: { verify: ["false"] } });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", confirmKill: true });
    eq(r.killed, false, "a kill by a command that always fails is not a kill");
    eq(r.inconclusive, true, "...it is inconclusive");
    like(r.verdict, /^inconclusive: false also fails without the mutation/, "...and the verdict names the command");
  });
}

// ---------------------------------------------------------------- targeted mutation commands

{
  const repo = mutationRepo({ config: { verify: ["false"], mutation: { targeted: { unit: { cmd: "echo FILTER={filter}" } } } } });
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const base = { file: "src/add.mjs", find: "a + b", replace: "a - b" };
    const r = await call("kukulu_mutate", { ...base, targeted: "unit", filter: "tests/Unit/FooTest.php" });
    eq(r.killed, false, "a targeted command runs instead of verify (verify's false never ran)");
    like(r.results[0].stdoutTail, /FILTER=tests\/Unit\/FooTest\.php/, "...and its stdout carries the substituted filter");
    for (const [args, re, label] of [
      [{ targeted: "unit" }, /targeted and filter must be passed together/, "targeted without filter"],
      [{ filter: "x" }, /targeted and filter must be passed together/, "filter without targeted"],
      [{ targeted: "unit", filter: "x", commands: ["false"] }, /cannot be combined with commands/, "targeted with commands"],
      [{ targeted: "nope", filter: "x" }, /unknown targeted command "nope".*unit/, "an unknown name"],
      [{ targeted: "unit", filter: "a;rm -rf x" }, /filter must be 1 to 200 characters/, "a shell-metacharacter filter"],
    ]) {
      isError(await call("kukulu_mutate", { ...base, ...args }), re, `targeted: ${label} is refused`);
      eq(readFile(repo, "src/add.mjs"), ADD_SRC, "...and the file is unchanged");
    }
    untouched(repo, head);
  });
}

{
  const repo = mutationRepo();
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", targeted: "unit", filter: "x" }), /No targeted commands are configured/, "targeted with nothing configured says so");
  });
}

for (const [mutation, re, label] of [
  [{ targeted: { php: { cmd: "phpunit" } } }, /mutation\.targeted\.php\.cmd must contain \{filter\} exactly once/, "{filter} absent"],
  [{ targeted: { php: { cmd: "phpunit {filter} {filter}" } } }, /exactly once/, "{filter} twice"],
  [{ other: {} }, /mutation has an unknown key 'other'/, "an unknown key under mutation"],
  [{ targeted: { php: { cmd: "x {filter}", extra: 1 } } }, /mutation\.targeted\.php has an unknown key 'extra'/, "an unknown key in an entry"],
  [{ targeted: { php: { cmd: "x {filter}", timeoutMs: 1.5 } } }, /mutation\.targeted\.php\.timeoutMs must be a positive integer/, "a non-integer timeoutMs"],
]) {
  const repo = mutationRepo({ config: { mutation } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" }), re, `mutation config refuses ${label}`);
  });
}

// ---------------------------------------------------------------- flight_archive (S-07)

const ARCHIVE_FILES = ["docs/PLAN.md", "docs/PROGRESS.md", "docs/HANDOFF.md", "docs/REVIEW.md", "docs/SUMMARY.md", "docs/kukulu.json", ".kukulu/state.json", ".kukulu/feedback.jsonl"];

/** A summarized flight on a build branch, every artifact committed. */
function summarizedRepo({ config = { flight: "w1-share" }, state = {} } = {}) {
  const repo = plannedRepo({ config });
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  markTasks(repo, ALL_DONE);
  writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
  writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: APPROVED\n");
  writeFile(repo, "docs/SUMMARY.md", "# summary\n");
  writeFile(repo, ".kukulu/feedback.jsonl", '{"at":"x","stage":"implement","round":0,"category":"other","message":"m","source":"agent"}\n');
  setState(repo, { round: 0, implemented: true, reviewed: true, verdict: "APPROVED", summarized: true, ...state });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: build summary"]);
  return repo;
}

const snapshot = (repo) => Object.fromEntries(ARCHIVE_FILES.map((f) => [f, hasFile(repo, f) ? readFile(repo, f) : null]));

{
  const repo = summarizedRepo({ config: {} });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_archive"), /pass slug, or set "flight" in docs\/kukulu\.json/, "archive refuses with no slug and no flight key");
    isError(await call("kukulu_flight_archive", { slug: "Bad_Slug" }), /slug must match/, "...and a malformed slug");
    ok(hasFile(repo, "docs/PLAN.md") && !hasFile(repo, "docs/flights"), "...and nothing moved");
  });
}

{
  const repo = summarizedRepo({ state: { summarized: false } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_archive"), /not summarized yet/, "archive refuses before the summary");
    writeFile(repo, ".kukulu/implement.lock", "0\n");
    setState(repo, { summarized: true });
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "state"]);
    isError(await call("kukulu_flight_archive"), /implement\.lock exists/, "...and while the lock is armed");
    fs.rmSync(path.join(repo, ".kukulu/implement.lock"));
    writeFile(repo, "docs/PLAN.md", readFile(repo, "docs/PLAN.md") + "edit\n");
    isError(await call("kukulu_flight_archive"), /working tree is not clean/, "...and with a modified tracked file");
    git(repo, ["checkout", "--", "docs/PLAN.md"]);
    writeFile(repo, "docs/flights/w1-share/x.txt", "x");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "occupied"]);
    isError(await call("kukulu_flight_archive"), /docs\/flights\/w1-share already exists/, "...and when the destination exists");
    ok(hasFile(repo, "docs/PLAN.md"), "...nothing moved in any refusal");
  });
}

{
  const repo = summarizedRepo({ state: { signingOverride: true } });
  const before = snapshot(repo);
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_flight_archive");
    eq(r.dir, "docs/flights/w1-share", "archive moves the flight: the directory");
    eq(r.moved.length, 8, "...all eight files are moved");
    for (const f of ARCHIVE_FILES) eq(readFile(repo, `docs/flights/w1-share/${path.basename(f)}`), before[f], `...${f} arrived byte-identical`);
    eq(subject(repo), "chore: archive flight w1-share", "...in one commit");
    ok(!hasFile(repo, "docs/PLAN.md") && !hasFile(repo, "docs/kukulu.json"), "...docs/PLAN.md and kukulu.json are gone");
    eq(readFile(repo, "docs/SPEC.md"), readFile(repo, "docs/flights/w1-share/SPEC.md"), "...and docs/SPEC.md stays, with an identical copy");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
    eq(st.archived.slug, "w1-share", "...the fresh state records the archive");
    ok(st.summarized === false && st.round === 0 && st.verdict === null && st.rounds.length === 0, "...and is otherwise the default state");
    eq(st.signingOverride, true, "signingOverride is carried over");
    eq(git(repo, ["status", "--porcelain"]), "", "...the tree is clean");
    eq(r.push, "pushed", "push follows policy");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "...and the remote has the archive commit");
  });
}

{
  const repo = summarizedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_flight_archive", { slug: "other" });
    eq(r.dir, "docs/flights/other", "a slug argument wins over flight");
    like(subject(repo), /archive flight other/, "...and names the commit");
  });
}

{
  const repo = summarizedRepo();
  git(repo, ["rm", "-q", "--cached", "docs/HANDOFF.md"]);
  git(repo, ["commit", "-qm", "untrack handoff"]);
  setState(repo, { preexistingUntracked: ["docs/HANDOFF.md"] });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "state"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_flight_archive");
    ok(!r.error && hasFile(repo, "docs/flights/w1-share/HANDOFF.md") && !hasFile(repo, "docs/HANDOFF.md"), "a pre-existing untracked artifact is moved with mv");
    eq(git(repo, ["status", "--porcelain"]), "", "...and the tree ends clean");
  });
}

{
  // a failed archive commit restores everything
  const repo = summarizedRepo();
  const hook = path.join(repo, ".git", "hooks", "commit-msg");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, `#!/bin/sh\nif head -n1 "$1" | grep -q '^chore: archive'; then echo rejected >&2; exit 1; fi\n`);
  fs.chmodSync(hook, 0o755);
  const before = snapshot(repo);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_flight_archive"), /commit failed/, "a failed archive commit is an error");
    const after = snapshot(repo);
    ok(ARCHIVE_FILES.every((f) => after[f] === before[f]), "...and every source is back, byte-identical");
    ok(!hasFile(repo, "docs/flights/w1-share"), "...the archive directory does not exist");
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
  });
}

for (const [archive, want] of [[undefined, false], [true, true]]) {
  const repo = reviewableRepo({ verdict: "APPROVED", config: archive === undefined ? {} : { policies: { archive } } });
  await withServer(repo, async ({ call }) => {
    await call("kukulu_review_submit", { verdict: "APPROVED" });
    const r = await call("kukulu_summary_commit", { content: "# s\n" });
    eq(r.archive, want, `summary_commit returns archive: ${want}`);
  });
}

// ---------------------------------------------------------------- pr_finalize (S-14)

const DRAFT_PR = '{"url":"https://github.invalid/pull/1","state":"OPEN","isDraft":true,"baseRefName":"main"}\n';

/** A summarized build branch with a bare origin and a fake gh holding a draft PR. `signed` signs every commit on it. */
function finalizeRepo({ signed = false, policies = {}, summarized = true } = {}) {
  const repo = plannedRepo({ config: { policies } });
  git(repo, ["checkout", "-q", "-b", "build/x"]);
  if (signed) useFakeSigner(repo, mkFakeGpg());
  writeFile(repo, "docs/SUMMARY.md", "# summary\n");
  writeFile(repo, "hello.txt", "hi\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "P0-01: hello"]);
  setState(repo, { summarized, verdict: "APPROVED" });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: build summary"]);
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  const ghDir = mkFakeGhBin();
  writeFile(ghDir, "pr.json", DRAFT_PR);
  return { repo, ghDir, opts: { env: { PATH: `${ghDir}:${process.env.PATH}` } } };
}

const ghCalls = (ghDir) => readFile(ghDir, "calls.log").split("\n").filter(Boolean);

{
  const { repo, opts } = finalizeRepo({ summarized: false });
  const before = readFile(repo, ".kukulu/state.json");
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_pr_finalize", { breaking: false }), /summary is not committed yet/, "finalize is refused before the summary is committed");
    setState(repo, { summarized: true });
    isError(await call("kukulu_pr_finalize", {}), /breaking is required on the first call/, "the first call without breaking is refused");
    isError(await call("kukulu_pr_finalize", { breaking: "no" }), /breaking must be a boolean/, "a non-boolean breaking is refused");
    eq(JSON.parse(readFile(repo, ".kukulu/state.json")).breaking, undefined, "...and state records no breaking");
    ok(before.length > 0, "...state existed");
  }, opts);
}

{
  const { repo, opts } = finalizeRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_pr_finalize", { breaking: false });
    ok(r.awaitingSigning && r.awaitingSigning.unsigned >= 1, "an unsigned commit keeps the PR draft: awaitingSigning counts it");
    eq(r.ready, false, "...ready is false");
    eq(r.merge, "skipped: awaiting signing", "...and merge is skipped");
    like(r.next, /kukulu_pr_finalize\(\{ resign: true \}\)/, "...next names the resign call");
    like(r.next, /git rebase -f --rebase-merges --gpg-sign/, "...and the by-hand rebase");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
    ok(st.awaitingSigning && st.breaking === false, "...state records awaitingSigning and breaking");
    const signing = readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.category === "signing");
    eq(signing.length, 1, "...exactly one signing feedback entry");
    eq(readFile(repo, "docs/SUMMARY.md").split("## Awaiting signing").length - 1, 1, "...SUMMARY.md has the awaiting section once");
    const n = await call("kukulu_next");
    eq(n.stage, "done", "kukulu_next is done");
    like(n.reason, /^awaiting signing:/, "...with an awaiting signing reason");
    const since = st.awaitingSigning.since;
    await call("kukulu_pr_finalize", { breaking: false });
    const again = JSON.parse(readFile(repo, ".kukulu/state.json"));
    eq(again.awaitingSigning.since, since, "a second call keeps since");
    eq(readFile(repo, ".kukulu/feedback.jsonl").trim().split("\n").length, 1, "...and adds no feedback entry");
    eq(readFile(repo, "docs/SUMMARY.md").split("## Awaiting signing").length - 1, 1, "...nor a second section");
    eq(ghCalls(opts.env.PATH.split(":")[0]).filter((c) => c.startsWith("pr ready") || c.startsWith("pr merge")).length, 0, "gh never marked it ready or merged");
  }, opts);
}

for (const [label, args, policies, expect, mergeFails] of [
  ["auto, not breaking", { breaking: false }, {}, { calls: ["pr ready", "pr merge --auto --merge"], merge: "enabled", ready: true }],
  ["squash", { breaking: false }, { mergeMethod: "squash" }, { calls: ["pr ready", "pr merge --auto --squash"], merge: "enabled", ready: true }],
  ["breaking", { breaking: true }, {}, { calls: ["pr ready"], merge: "skipped: breaking", ready: true }],
  ["finalize ready", { breaking: false }, { finalize: "ready" }, { calls: ["pr ready"], merge: "skipped: policy", ready: true }],
  ["finalize draft", { breaking: false }, { finalize: "draft" }, { calls: [], merge: "skipped: policy", ready: false }],
  ["merge unavailable", { breaking: false }, {}, { calls: ["pr ready", "pr merge --auto --merge"], merge: "unavailable: auto-merge is not allowed", ready: true }, "auto-merge is not allowed\nsecond line\n"],
]) {
  const { repo, ghDir, opts } = finalizeRepo({ signed: true, policies });
  if (mergeFails) writeFile(ghDir, "merge-fails", mergeFails);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_pr_finalize", args);
    eq(r.unsigned, 0, `all signed, ${label}: no unsigned commits`);
    eq(r.merge, expect.merge, `...merge is ${expect.merge}`);
    eq(r.ready, expect.ready, `...ready is ${expect.ready}`);
    const calls = ghCalls(ghDir).filter((c) => c.startsWith("pr ready") || c.startsWith("pr merge"));
    eq(calls.join("|"), expect.calls.join("|"), "...and the gh calls are exactly those");
    ok(calls.every((c) => !c.startsWith("pr merge") || c.includes("--auto")), "...no merge without --auto");
  }, opts);
}

for (const [verify, want] of [["err", 0], ["bad", 2]]) {
  const { repo, opts } = finalizeRepo({ signed: true });
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_pr_finalize", { breaking: false });
    if (want === 0) eq(r.unsigned, 0, "E counts as signed");
    else ok(r.unsigned >= want, "B does not: every signed commit counts as unsigned");
  }, { env: { ...opts.env, FAKE_GPG_VERIFY: verify } });
}

{
  // mutant (d): the all-signed branch clearing the signing override
  const { repo, opts } = finalizeRepo({ signed: true });
  const gpg = mkFakeGpg();
  setState(repo, { signingOverride: true, signing: "off (probe failed: x)" });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: override recorded"]);
  git(repo, ["config", "--local", "commit.gpgsign", "false"]);
  const env = { ...opts.env, GIT_CONFIG_GLOBAL: fakeSignerGlobal(gpg) };
  await withServer(repo, async ({ call }) => {
    await call("kukulu_pr_finalize", { breaking: false });
    const cfgv = spawnSync("git", ["config", "--local", "--get", "commit.gpgsign"], { cwd: repo, encoding: "utf8" });
    eq(cfgv.stdout.trim(), "", "a manual re-sign then finalize clears the override: local commit.gpgsign is unset");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
    eq(st.signing, "on", "...state.signing is 'on'");
    eq(st.signingOverride, undefined, "...and signingOverride is gone");
  }, { env });
}

/** Global git config holding a working fake signer, so the server (and nothing else) sees signing on. */
function fakeSignerGlobal(gpg) {
  const file = path.join(path.dirname(gpg), "gitconfig");
  fs.writeFileSync(file, `[commit]\n\tgpgsign = true\n[gpg]\n\tformat = openpgp\n\tprogram = ${gpg}\n[user]\n\tsigningkey = 0123456789ABCDEF\n`);
  return file;
}

/** An unsigned build/x branch with a --no-ff merge in it, summarized, awaiting signing. */
function resignRepo({ extraState = {} } = {}) {
  const f = finalizeRepo({ signed: false });
  const { repo } = f;
  git(repo, ["config", "--local", "commit.gpgsign", "false"]);
  git(repo, ["checkout", "-q", "-b", "side"]);
  writeFile(repo, "side.txt", "s\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "P0-02: side"]);
  git(repo, ["checkout", "-q", "build/x"]);
  writeFile(repo, "main.txt", "m\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "P0-03: main"]);
  git(repo, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
  setState(repo, { awaitingSigning: { unsigned: 3, first: "abc1234", since: "2026-01-01T00:00:00Z" }, signingOverride: true, signing: "off (probe failed: x)", breaking: false, ...extraState });
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: awaiting signing"]);
  git(repo, ["push", "-q", "-u", "origin", "build/x"]);
  return f;
}

{
  // resign re-signs the branch and finalizes
  const { repo, ghDir, opts } = resignRepo();
  const gpg = mkFakeGpg();
  const globalCfg = fakeSignerGlobal(gpg);
  const mb = git(repo, ["merge-base", "main", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("kukulu_pr_finalize", { breaking: false, resign: true });
    eq(r.resigned, true, "resign re-signs the branch and finalizes");
    const log = git(repo, ["-c", `gpg.program=${gpg}`, "log", "--format=%G?", `${mb}..HEAD`]).split("\n").filter(Boolean);
    ok(log.length > 0 && log.every((x) => x !== "N" && x !== "B"), "...every commit since the merge base is signed");
    const merges = git(repo, ["log", "--merges", "--format=%P", `${mb}..HEAD`]).split("\n").filter(Boolean);
    ok(merges.length === 1 && merges[0].split(" ").length === 2, "...the merge commit still has two parents");
    eq(spawnSync("git", ["config", "--local", "commit.gpgsign"], { cwd: repo, encoding: "utf8" }).stdout.trim(), "", "...the local commit.gpgsign override is unset");
    const st = JSON.parse(readFile(repo, ".kukulu/state.json"));
    ok(st.signing === "on" && st.awaitingSigning === undefined && st.signingOverride === undefined, "...state is signing on, with no awaiting or override");
    eq(git(repo, ["rev-parse", "origin/build/x"]), git(repo, ["rev-parse", "HEAD"]), "...origin's branch equals local HEAD");
    ok(ghCalls(ghDir).some((c) => c.startsWith("pr ready")), "...and the pull request was marked ready");
  }, { env: { ...opts.env, GIT_CONFIG_GLOBAL: globalCfg } });
}

{
  const { repo, opts } = resignRepo();
  const gpg = mkFakeGpg();
  const env = { ...opts.env, GIT_CONFIG_GLOBAL: fakeSignerGlobal(gpg) };
  const head = git(repo, ["rev-parse", "HEAD"]);
  const localCfg = () => spawnSync("git", ["config", "--local", "commit.gpgsign"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  await withServer(repo, async ({ call }) => {
    writeFile(repo, "dirty.txt", "x");
    isError(await call("kukulu_pr_finalize", { breaking: false, resign: true }), /working tree is not clean/, "resign refuses a dirty tree");
    fs.rmSync(path.join(repo, "dirty.txt"));
    isError(await call("kukulu_pr_finalize", { breaking: false, resign: "yes" }), /resign must be a boolean/, "...and a non-boolean resign");
    git(repo, ["checkout", "-q", "-B", "main"]);
    isError(await call("kukulu_pr_finalize", { breaking: false, resign: true }), /on the base branch/, "...and the base branch");
    git(repo, ["checkout", "-q", "build/x"]);
    eq(git(repo, ["rev-parse", "HEAD"]), head, "refusals leave HEAD unchanged");
    eq(localCfg(), "false", "...and the local config unchanged");
  }, { env });
}

{
  // a failing probe puts the override back
  const { repo, opts } = resignRepo();
  const gpg = mkFakeGpg();
  const globalCfg = fakeSignerGlobal(gpg);
  git(repo, ["config", "--local", "gpg.program", "/nonexistent-signing-agent"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_pr_finalize", { breaking: false, resign: true }), /signing probe failed/, "a failing probe refuses resign");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and puts the local override back");
  }, { env: { ...opts.env, GIT_CONFIG_GLOBAL: globalCfg } });
}

{
  // a failing rebase is aborted
  const { repo, opts } = resignRepo();
  const gpg = mkFakeGpg({ failAfter: 1 });
  const globalCfg = fakeSignerGlobal(gpg);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_pr_finalize", { breaking: false, resign: true }), /re-signing failed/, "a failing rebase refuses resign");
    ok(!hasFile(repo, ".git/rebase-merge") && !hasFile(repo, ".git/rebase-apply"), "...the rebase is aborted");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...HEAD is unchanged");
    eq(git(repo, ["config", "--local", "commit.gpgsign"]), "false", "...and the override is back");
  }, { env: { ...opts.env, GIT_CONFIG_GLOBAL: globalCfg } });
}

{
  // after an archive
  const repo = summarizedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_flight_archive");
    const r = await call("kukulu_pr_finalize", { breaking: false });
    ok(r.awaitingSigning, "after an archive, finalize reads the archived summarized state");
    like(readFile(repo, "docs/flights/w1-share/SUMMARY.md"), /## Awaiting signing/, "...and appends the awaiting section to the archived SUMMARY.md");
  });
}

{
  // A flight archived before 0.6.0 holds foundry.json, not kukulu.json; finalize
  // still reads it. The archived config names a base branch that does not exist,
  // so a finalize that really loaded it refuses; one that fell back to the
  // defaults would not.
  const repo = summarizedRepo();
  await withServer(repo, async ({ call }) => {
    await call("kukulu_flight_archive");
  });
  const archived = JSON.parse(readFile(repo, "docs/flights/w1-share/kukulu.json"));
  writeFile(repo, "docs/flights/w1-share/kukulu.json", JSON.stringify({ ...archived, baseBranch: "no-such-base" }, null, 2) + "\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: archived config names a missing base"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_pr_finalize", { breaking: false }), /merge base with baseBranch 'no-such-base'/, "finalize reads the archived kukulu.json");
  });
  git(repo, ["mv", "docs/flights/w1-share/kukulu.json", "docs/flights/w1-share/foundry.json"]);
  git(repo, ["commit", "-qm", "chore: pre-0.6.0 archive"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_pr_finalize", { breaking: false }), /merge base with baseBranch 'no-such-base'/, "finalize reads the config of a flight archived as foundry.json");
  });
}

// ---------------------------------------------------------------- summary from content

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_summary_commit", { content: "# Summary\n" }), /only be committed after an APPROVED review/, "content is refused before APPROVED, and nothing is written");
    ok(!hasFile(repo, "docs/SUMMARY.md"), "...no SUMMARY.md exists afterwards");
    await call("kukulu_review_submit", { verdict: "APPROVED" });
    isError(await call("kukulu_summary_commit", { content: "  \n" }), /content is empty/, "empty content is refused");
    isError(await call("kukulu_summary_commit", { content: "x".repeat(1024 * 1024) }), /bytes or more/, "content of 1 MiB or more is refused");
    isError(await call("kukulu_summary_commit", { content: 42 }), /content must be a string/, "non-string content is refused");
    ok(!hasFile(repo, "docs/SUMMARY.md"), "...none of them wrote a file");
    const r = await call("kukulu_summary_commit", { content: "# Summary\nAll done." });
    eq(subject(repo), "chore: build summary", "summary_commit writes SUMMARY.md from content and commits it");
    eq(git(repo, ["show", "HEAD:docs/SUMMARY.md"]), "# Summary\nAll done.", "...with exactly that text");
    eq(readFile(repo, "docs/SUMMARY.md"), "# Summary\nAll done.\n", "...plus a final newline on disk");
    eq(r.reviews, 1, "the return shape is unchanged");
  });
}

// ---------------------------------------------------------------- rollback

{
  // review_submit rolls back when its commit fails (project-d F-04)
  const repo = reviewableRepo({ config: { policies: { signing: "required" } } });
  git(repo, ["config", "--local", "commit.gpgsign", "true"]);
  git(repo, ["config", "--local", "gpg.format", "openpgp"]);
  git(repo, ["config", "--local", "gpg.program", "/nonexistent-signing-agent"]);
  const before = {};
  for (const f of ["docs/PLAN.md", "docs/PROGRESS.md", ".kukulu/state.json", "docs/REVIEW.md"]) before[f] = readFile(repo, f);
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] }), /could not be signed/, "review_submit rolls back when its commit fails: the call is an error");
    for (const f of ["docs/PLAN.md", "docs/PROGRESS.md", ".kukulu/state.json", "docs/REVIEW.md"]) eq(readFile(repo, f), before[f], `...${f} is byte-identical afterwards`);
    eq(git(repo, ["diff", "--cached", "--name-only"]), "", "...nothing is staged");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "...and HEAD did not move");
    git(repo, ["config", "commit.gpgsign", "false"]);
    const r = await call("kukulu_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.verdict, "CHANGES REQUESTED", "the same submission then succeeds");
    eq(readFile(repo, "docs/PLAN.md").split("## Review fixes (round 1)").length - 1, 1, "...PLAN.md holds the fix section exactly once");
    eq(readFile(repo, "docs/PROGRESS.md").split("R1-01").length - 1, 1, "...and PROGRESS.md names R1-01 exactly once");
  });
}

finish();
