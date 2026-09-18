// The review and summarize stages: foundry_review_submit and
// foundry_summary_commit. This is where a judgment call becomes queued work,
// so the tool is strict about what a finding must carry before it counts.

import {
  finish, ok, eq, like, isError,
  plannedRepo, withServer, readFile, writeFile, subject,
  markTasks, setState, git,
} from "./harness.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const ALL_DONE = { "P0-01": "x", "P0-02": "x", "P0-03": "x" };

/** A repo parked exactly where the reviewer picks it up. */
function reviewableRepo({ config, verdict = "CHANGES REQUESTED", states = ALL_DONE } = {}) {
  const repo = plannedRepo({ config });
  git(repo, ["checkout", "-q", "-b", `build/${TODAY}`]);
  markTasks(repo, states);
  setState(repo, { round: 0, implemented: true });
  writeFile(repo, "docs/REVIEW.md", `# Review\nRound: 0\n**Verdict**: ${verdict}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: round 0 implemented"]);
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

// ---------------------------------------------------------------- changes requested

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

// ---------------------------------------------------------------- round cap

{
  const repo = reviewableRepo({ config: { maxRounds: 1 } });
  setState(repo, { round: 1 });
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_review_submit", { verdict: "CHANGES REQUESTED", tasks: [FIX] });
    eq(r.round, 2, "the round still increments past the cap");
    like(r.halted, /exceeds maxRounds=1/, "the flight records why it halted");
    like(r.halted, /edit \.foundry\/state\.json/, "the halt message says how to resume");
    const n = await call("foundry_next");
    eq(n.stage, "halt", "the next stage is a halt, not another implement");
    eq(n.reason, r.halted, "the halt reason is the one review_submit recorded");
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
    eq(subject(repo), "review: approved", "approval is its own commit");

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

finish();
