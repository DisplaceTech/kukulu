// The review and summarize stages: foundry_review_submit and
// foundry_summary_commit. This is where a judgment call becomes queued work,
// so the tool is strict about what a finding must carry before it counts.

import {
  finish, ok, eq, like, isError,
  plannedRepo, withServer, readFile, writeFile, subject, hasFile,
  markTasks, setState, git, mkBareRemote,
} from "./harness.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };

/**
 * A repo parked exactly where the reviewer picks it up, `round` fix rounds
 * already queued (so this review is stamped `round + 1`, matching what
 * foundry_status would call `reviewRound`).
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
    isError(await call("foundry_review_submit", { verdict: "APPROVED" }), /docs\/REVIEW\.md does not exist/, "a verdict needs a written review");
    writeFile(repo, "docs/REVIEW.md", "# Review\n**Verdict**: APPROVED\n");
    isError(await call("foundry_review_submit", { verdict: "APPROVED" }), /no implementation handoff recorded/, "there is nothing to review before a handoff");
    isError(await call("foundry_review_submit", { verdict: "LGTM" }), /verdict must be APPROVED or CHANGES REQUESTED/, "a freeform verdict is rejected");
    isError(await call("foundry_review_submit", {}), /verdict must be APPROVED or CHANGES REQUESTED/, "a missing verdict is rejected");
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    isError(
      await call("foundry_review_submit", { verdict: "APPROVED", tasks: [FIX] }),
      /an APPROVED verdict cannot carry fix tasks/,
      "approval and fix tasks are mutually exclusive",
    );
    isError(
      await call("foundry_review_submit", { verdict: "CHANGES REQUESTED" }),
      /requires at least one fix task or unblock/,
      "changes requested must say what changes",
    );
    for (const field of ["title", "goal", "files", "tests"]) {
      const broken = { ...FIX, [field]: Array.isArray(FIX[field]) ? [] : "" };
      isError(
        await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [broken] }),
        new RegExp(`missing '${field}'`),
        `a fix task without ${field} is rejected`,
      );
    }
    isError(
      await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", unblock: [{ id: "P9-99" }] }),
      /cannot unblock P9-99: not in PROGRESS\.md/,
      "an unknown id cannot be unblocked",
    );
    isError(
      await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", unblock: [{ id: "P0-01" }] }),
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
      await call("foundry_review_submit", { verdict: "APPROVED" }),
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
      await call("foundry_review_submit", { verdict: "APPROVED" }),
      /'Round:' line is missing; this review must be stamped 'Round: 1'/,
      "a review with no Round: line at all names the expected value",
    );
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    isError(
      await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [{ ...FIX, dependsOn: ["R1-03"] }, FIX] }),
      /depends on 'R1-03', which is neither an existing task[\s\S]*\(R1-01, R1-02\)/,
      "a dependsOn one past the end of this submission is refused",
    );
    isError(
      await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [{ ...FIX, dependsOn: ["R2-01"] }] }),
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
    const r = await call("foundry_review_submit", {
      verdict: "CHANGES REQUESTED",
      tasks: [FIX, { ...FIX, title: "Second fix" }, { ...FIX, title: "Third fix" }],
    });
    eq(r.counts.todo, 3, "three fix tasks against an all-done plan return todo 3, not the pre-append 0");
    eq(r.counts.open, 3, "...and open 3");
    eq(r.counts.total, 6, "...and a total that includes them");
    const s = await call("foundry_status");
    eq(JSON.stringify(s.counts), JSON.stringify(r.counts), "the submit's counts match what foundry_status reads straight afterwards");
  });
}

{
  const repo = reviewableRepo({ states: { "P0-01": "x", "P0-02": "!", "P0-03": "-" } });
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", {
      verdict: "CHANGES REQUESTED",
      tasks: [FIX, { ...FIX, title: "Second fix", files: ["a.txt", "b.txt"], dependsOn: ["R1-01"] }],
      unblock: [{ id: "P0-02", reason: "the API does exist; see SPEC §6" }],
    });
    eq(r.round, 1, "changes requested opens the next round");
    eq(r.fixTasks.join(","), "R1-01,R1-02", "fix tasks are numbered and zero-padded");
    eq(r.unblocked.join(","), "P0-02", "unblocked tasks are reported");
    eq(r.halted, null, "a round inside the cap does not halt the flight");
    // F-03: the returned counts describe PROGRESS.md as this call left it —
    // two new fix tasks and one unblocked task — not as it was before.
    eq(r.counts.todo, 3, "the returned counts include the unblocked task and both new fix tasks");
    eq(r.counts.open, 3, "...as open");
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
    like(prog, /- \[ \] P0-02 Impossible task\n- \[-\] P0-03[^\n]*\n- \[ \] R1-01 Fix hello\n- \[ \] R1-02 Second fix\n\n## Log/, "fix tasks are appended to Tasks, above the Log");
    like(prog, /### P0-02 — unblocked \(round 1\)\nthe API does exist; see SPEC §6/, "the unblock reason is logged");

    const s = await call("foundry_status");
    eq(s.counts.open, 3, "the unblocked task and both fixes are open");
    eq(s.reviewRoundsInPlan, 1, "status counts the review sections in PLAN.md");
    eq(s.state.verdict, "CHANGES REQUESTED", "the verdict is persisted");

    // The round-trip that matters: what the reviewer wrote, the implementer reads.
    const n = await call("foundry_next");
    eq(n.stage, "implement", "changes requested sends the flight back to implement");
    eq(n.round, 1, "the implementer is told which round it is on");
    await call("foundry_run_start");
    const first = await call("foundry_task_next");
    eq(first.id, "P0-02", "the unblocked task is picked up again");
    await call("foundry_task_block", { id: "P0-02", reason: "still blocked / same error / needs a spec change" });
    const fix = await call("foundry_task_next");
    eq(fix.id, "R1-01", "the fix task is next");
    like(fix.text, /hello must actually greet/, "the fix task's text is readable from PLAN.md");
    eq(fix.files, "hello.txt", "the fix task's files parse back out");
  });
}

// An unblock on its own is a legitimate round: no new tasks, one reopened.
{
  const repo = reviewableRepo({ states: { "P0-01": "x", "P0-02": "!", "P0-03": "-" } });
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", unblock: ["P0-03"] });
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
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks });
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
    last = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: manyTasks(n) });
  }
  return last;
}

{
  const repo = reviewableRepo({ config: { maxRounds: 3 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [15, 3, 2, 1]);
    eq(r.halted, null, "findings shrinking every round never halts, even across four rounds with a maxRounds of 3");
    eq(r.round, 4, "the round still counts up normally");
    ok(!hasFile(repo, ".foundry/feedback.jsonl"), "a round that never halts logs no feedback entry");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 2 } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [4, 4, 4]);
    like(r.halted, /non-converging/, "three rounds that never shrink halt on the third");
    like(r.halted, /reaching maxRounds=2/, "the message names the exceeded cap");
    like(r.halted, /findings per round: 4 → 4 → 4/, "the message shows the trail of counts");
    const n = await call("foundry_next");
    eq(n.stage, "halt", "the flight now halts");
    eq(n.reason, r.halted, "the halt reason is the one review_submit recorded");

    like(subject(repo), /^review: round 3/, "the feedback entry lands in the same commit as the round's own review: commit");
    const changed = git(repo, ["show", "--stat", "--format=", "HEAD"]);
    like(changed, /\.foundry\/feedback\.jsonl/, "...the commit touches the feedback file");
    const lines = readFile(repo, ".foundry/feedback.jsonl").trim().split("\n");
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
    const entry = JSON.parse(readFile(repo, ".foundry/feedback.jsonl").trim());
    eq(entry.category, "round-cap", "the hard-cap halt is logged the same way as a non-converging one");
  });
}

{
  const repo = reviewableRepo({ config: { maxRounds: 2, policies: { feedback: false } } });
  await withServer(repo, async ({ call }) => {
    const r = await driveRounds(call, repo, [4, 4, 4]);
    like(r.halted, /non-converging/, "the halt itself is unaffected by policies.feedback");
    ok(!hasFile(repo, ".foundry/feedback.jsonl"), "...but policies.feedback: false suppresses the auto entry");
  });
}

{
  const repo = reviewableRepo();
  await withServer(repo, async ({ call }) => {
    const r1 = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: manyTasks(2) });
    eq(r1.halted, null, "round 1 is always allowed; there is nothing to compare it against yet");
    let s = await call("foundry_status");
    eq(s.state.rounds.length, 1, "state.rounds records the submission");
    eq(s.state.rounds[0].fixTasks, 2, "...with its fix-task count");
    eq(s.state.rounds[0].verdict, "CHANGES REQUESTED", "...and its verdict");
    eq(s.state.rounds[0].nonConverging, false, "round 1 is never marked non-converging");
    ok(s.state.rounds[0].at, "...and a timestamp");

    writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 2\n**Verdict**: APPROVED\n");
    setState(repo, { implemented: true });
    await call("foundry_review_submit", { verdict: "APPROVED" });
    s = await call("foundry_status");
    eq(s.state.rounds.length, 2, "an approval is recorded in the history too");
    eq(s.state.rounds[1].verdict, "APPROVED", "...with its own verdict");
    eq(s.state.rounds[1].fixTasks, 0, "...and no fix tasks, since an approval can carry none");
  });
}

// ---------------------------------------------------------------- approval

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_summary_commit"), /docs\/SUMMARY\.md does not exist/, "a summary must be written before it is committed");
    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    isError(await call("foundry_summary_commit"), /only be committed after an APPROVED review/, "a summary cannot outrun the review");

    const r = await call("foundry_review_submit", { verdict: "APPROVED" });
    eq(r.verdict, "APPROVED", "the approval is recorded");
    eq(r.round, 0, "approving does not open a new round");
    eq(subject(repo), "review: round 1 approved", "approval is its own commit");

    const n = await call("foundry_next");
    eq(n.stage, "summarize", "approval hands off to the summarizer");

    const sum = await call("foundry_summary_commit");
    eq(sum.rounds, 0, "the summary reports how many rounds it took");
    eq(subject(repo), "chore: build summary", "the summary is committed");
    like(sum.branch, /^build\//, "the summary reports the branch a human has to merge");
    eq(git(repo, ["status", "--porcelain"]), "", "the flight ends with a clean tree");

    eq((await call("foundry_next")).stage, "done", "and the flight is done");
  });
}

// A lowercase verdict from a model is still a verdict.
{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_review_submit", { verdict: " approved " })).verdict, "APPROVED", "the verdict is normalised before it is trusted");
  });
}

// ---------------------------------------------------------------- pushing (F-18)

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "APPROVED" });
    eq(r.push, "pushed", "an APPROVED review pushes the branch");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote branch head matches the local head");

    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    const sum = await call("foundry_summary_commit");
    eq(sum.push, "pushed", "the summary commit pushes too");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "...and the remote catches up again");
  });
}

{
  const repo = reviewableRepo();
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.push, "pushed", "a CHANGES REQUESTED review pushes the branch too");
    eq(git(repo, ["rev-parse", `origin/build/${TODAY}`]), git(repo, ["rev-parse", "HEAD"]), "the remote branch head matches the local head");
  });
}

{
  const repo = reviewableRepo({ verdict: "APPROVED" });
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_review_submit", { verdict: "APPROVED" })).push, "skipped: no origin remote", "without a remote, review_submit says so");
  });
}

{
  // reviewableRepo bypasses foundry_run_start, which is what would normally
  // copy docs/foundry.json's policies into state; set state directly to
  // simulate what a real run_start earlier in the round would have recorded.
  const repo = reviewableRepo({ config: { policies: { push: false } } });
  setState(repo, { policies: { signing: "auto", push: false, pr: "draft" } });
  git(repo, ["remote", "add", "origin", mkBareRemote()]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.push, "skipped: policy", "push: false skips review_submit's push even with a remote present");

    writeFile(repo, "docs/SUMMARY.md", "# summary\n");
    setState(repo, { verdict: "APPROVED" }); // shortcut past the fix round, for summary_commit's own push check
    const sum = await call("foundry_summary_commit");
    eq(sum.push, "skipped: policy", "and summary_commit's push, too");
  });
}

// ---------------------------------------------------------------- foundry_mutate (F-04)
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
  ok(!hasFile(repo, ".foundry/mutation.json"), "no sentinel is left behind");
};

{
  const repo = mutationRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
    eq(r.killed, true, "mutating the tested line is killed");
    like(r.verdict, /^killed/, "the verdict says so");
    eq(r.file, "src/add.mjs", "the repo-relative file is echoed");
    eq(r.results.length, 1, "the one verify command ran");
    eq(r.results[0].ok, false, "...and failed against the mutation");
    eq(r.recoveredMutation, null, "nothing needed recovering");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is byte-identical to what was committed");
    untouched(repo, head);

    const s = await call("foundry_mutate", { file: "src/add.mjs", find: "() => 1", replace: "() => 2" });
    eq(s.killed, false, "mutating a line no test covers survives");
    like(s.verdict, /^survived/, "the verdict says the mechanic is untested");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is restored after a surviving mutation too");
    untouched(repo, head);

    const v = await call("foundry_verify");
    eq(v.ok, true, "and the real tree still verifies clean afterwards");
  });
}

// A timed-out command still restores the file.
{
  const repo = mutationRepo({ config: { verify: [{ cmd: "exec sleep 5", timeoutMs: 300 }] } });
  const head = git(repo, ["rev-parse", "HEAD"]);
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a * b" });
    eq(r.results[0].timedOut, true, "the command timed out");
    eq(r.killed, true, "a timeout counts as the mutation being noticed");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is restored after a timeout");
    untouched(repo, head);
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
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "no such text", replace: "x" }), /does not appear in src\/add\.mjs/, "find matching zero times is refused");
    isError(await call("foundry_mutate", { file: "src/twice.mjs", find: " = 1;", replace: " = 2;" }), /appears 2 times[\s\S]*more surrounding context/, "find matching twice is refused, asking for more context");
    isError(await call("foundry_mutate", { file: "untracked.mjs", find: "1", replace: "2" }), /not tracked/, "an untracked file is refused");
    isError(await call("foundry_mutate", { file: "../outside.txt", find: "a", replace: "b" }), /outside the project/, "a path outside the repo is refused");
    isError(await call("foundry_mutate", { file: "/etc/hosts", find: "a", replace: "b" }), /outside the project/, "an absolute path outside the repo is refused");
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b", commands: ["rm -rf /"] }), /unknown: "rm -rf \/"[\s\S]*Legal: "node test\/add\.test\.mjs"/, "a command that is not configured is refused, listing the legal ones");
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "", replace: "x" }), /find is required/, "an empty find is refused");
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a + b" }), /identical/, "a no-op mutation is refused");
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "a + b" }), /replace is required/, "a missing replace is refused");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "no refusal touched the file");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "no refusal committed anything");
    ok(!hasFile(repo, ".foundry/mutation.json"), "no refusal left a sentinel");
  });
}

// A file with a pre-existing uncommitted edit survives exactly as it was.
{
  const repo = mutationRepo();
  const edited = ADD_SRC + "// a reviewer's own note\n";
  writeFile(repo, "src/add.mjs", edited);
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" }), /has uncommitted changes/, "a file with uncommitted edits is refused");
    eq(readFile(repo, "src/add.mjs"), edited, "...and the pre-existing edit is untouched");
  });
}

// Mutation testing is a review-stage tool, not something to run mid-implement.
{
  const repo = mutationRepo();
  writeFile(repo, ".foundry/implement.lock", "0\n");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" }), /implementation run is in progress/, "a present implement lock refuses");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "...and leaves the file alone");
  });
}

// extraVerify selection mirrors foundry_verify: the suites a file's own change would trigger.
{
  const repo = mutationRepo({ config: { verify: ["true"], extraVerify: { "src/special/": ["false"] } } });
  await withServer(repo, async ({ call }) => {
    const special = await call("foundry_mutate", { file: "src/special/thing.mjs", find: "= 1", replace: "= 2" });
    eq(special.results.map((r) => r.command).join("|"), "true|false", "a file under an extraVerify prefix runs verify plus that prefix's commands");
    eq(special.killed, true, "...and the failing extra command kills the mutation");
    const plain = await call("foundry_mutate", { file: "src/add.mjs", find: "a + b", replace: "a - b" });
    eq(plain.results.map((r) => r.command).join("|"), "true", "a file elsewhere runs only verify");
    eq(plain.killed, false, "...so this mutation survives");

    const only = await call("foundry_mutate", { file: "src/special/thing.mjs", find: "= 1", replace: "= 2", commands: ["false"] });
    eq(only.results.map((r) => r.command).join("|"), "false", "an explicit commands list runs only those");
  });
}

// Crash recovery: a sentinel left by a mutate that never restored is repaired by the next call.
{
  const repo = mutationRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  writeFile(repo, "src/add.mjs", ADD_SRC.replace("a + b", "a - b"));
  writeFile(repo, ".foundry/mutation.json", JSON.stringify({ file: "src/add.mjs", at: new Date().toISOString(), original: "0".repeat(40) }) + "\n");
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.recoveredMutation, "src/add.mjs", "verify names the file it restored");
    eq(v.ok, true, "and verifies the restored tree, not the mutated one");
    eq(readFile(repo, "src/add.mjs"), ADD_SRC, "the file is back to HEAD");
    ok(!hasFile(repo, ".foundry/mutation.json"), "the sentinel is gone");
    eq(git(repo, ["rev-parse", "HEAD"]), head, "recovery commits nothing");
  });
}

{
  const repo = reviewableRepo();
  writeFile(repo, "hello.txt", "hello\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "hello"]);
  writeFile(repo, "hello.txt", "goodbye\n");
  writeFile(repo, ".foundry/mutation.json", JSON.stringify({ file: "hello.txt", at: new Date().toISOString(), original: "0".repeat(40) }) + "\n");
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.recoveredMutation, "hello.txt", "review_submit also recovers a crashed mutation and says so");
    eq(readFile(repo, "hello.txt"), "hello\n", "the file under review is restored");
  });
}

{
  const repo = mutationRepo();
  writeFile(repo, ".foundry/mutation.json", "{not json");
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), /unreadable[\s\S]*git checkout HEAD -- <file>/, "an unreadable sentinel is loud, and says how to recover by hand");
  });
}

finish();
