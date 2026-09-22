// foundry_feedback_log and .foundry/feedback.jsonl (v0.3.1): durable,
// MCP-owned friction capture that survives a flight regardless of how it
// ends, since it commits immediately rather than waiting for some later
// stage to notice and transcribe it.

import {
  finish, ok, eq, like, isError,
  plannedRepo, withServer, readFile, writeFile, hasFile, subject, git,
} from "./harness.mjs";

// ---------------------------------------------------------------- basic logging

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_feedback_log", { stage: "implement", message: "the Write tool was refused; fell back to a heredoc.", category: "tool-refusal" });
    eq(r.logged, true, "a call with policies.feedback at its default logs successfully");
    eq(r.count, 1, "the reported count matches what was just written");
    ok(hasFile(repo, ".foundry/feedback.jsonl"), "the file is created");

    const lines = readFile(repo, ".foundry/feedback.jsonl").trim().split("\n");
    eq(lines.length, 1, "exactly one line was written");
    const entry = JSON.parse(lines[0]);
    eq(entry.stage, "implement", "the stage is recorded");
    eq(entry.message, "the Write tool was refused; fell back to a heredoc.", "the message is recorded verbatim");
    eq(entry.category, "tool-refusal", "the category is recorded");
    eq(entry.round, 0, "round is filled in from state");
    eq(entry.source, "agent", "an entry logged through the tool is source: agent");
    ok(!Number.isNaN(Date.parse(entry.at)), "at parses as a valid date");

    eq(subject(repo), "chore: pipeline friction (implement)", "the call commits on its own");
    const changed = git(repo, ["show", "--stat", "--format=", "HEAD"]);
    like(changed, /\.foundry\/feedback\.jsonl/, "the commit touches the feedback file");
    ok(!/docs\/PROGRESS\.md|state\.json/.test(changed), "...and nothing else");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_feedback_log", { stage: "review", message: "first entry" });
    const firstCommit = git(repo, ["rev-parse", "HEAD"]);
    const r = await call("foundry_feedback_log", { stage: "review", message: "second entry" });
    eq(r.count, 2, "a second call appends rather than overwriting");
    const lines = readFile(repo, ".foundry/feedback.jsonl").trim().split("\n");
    eq(lines.length, 2, "two lines on disk");
    eq(JSON.parse(lines[1]).message, "second entry", "the second line is the second entry");
    ok(git(repo, ["rev-parse", "HEAD"]) !== firstCommit, "a second, separate commit was made");
  });
}

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    await call("foundry_feedback_log", { stage: "plan", message: "no category given" });
    const entry = JSON.parse(readFile(repo, ".foundry/feedback.jsonl").trim());
    eq(entry.category, "other", "category defaults to 'other' when omitted");
  });
}

// ---------------------------------------------------------------- refusals

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    isError(
      await call("foundry_feedback_log", { stage: "nonsense", message: "x" }),
      /stage must be one of plan, implement, review, summarize, controller/,
      "an unknown stage is refused, naming the legal ones",
    );
    isError(await call("foundry_feedback_log", { stage: "implement", message: "" }), /message is required/, "an empty message is refused");
    isError(await call("foundry_feedback_log", { stage: "implement" }), /message is required/, "a missing message is refused");
    ok(!hasFile(repo, ".foundry/feedback.jsonl"), "no refusal creates the file");
  });
}

// ---------------------------------------------------------------- foundry_status

{
  const repo = plannedRepo();
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_status")).feedbackCount, 0, "feedbackCount is 0 before any entry");
    await call("foundry_feedback_log", { stage: "implement", message: "one" });
    eq((await call("foundry_status")).feedbackCount, 1, "...1 after one");
    await call("foundry_feedback_log", { stage: "implement", message: "two" });
    eq((await call("foundry_status")).feedbackCount, 2, "...2 after two");
  });
}

{
  const repo = plannedRepo();
  writeFile(repo, ".foundry/feedback.jsonl", '{"stage":"implement","message":"ok"}\n{not json\n');
  await withServer(repo, async ({ call }) => {
    eq((await call("foundry_status")).feedbackCount, 1, "a corrupt line is skipped, not fatal, like a corrupt state.json degrading to defaults");
  });
}

// ---------------------------------------------------------------- policies.feedback

{
  const repo = plannedRepo({ config: { policies: { feedback: false } } });
  await withServer(repo, async ({ call }) => {
    const r = await call("foundry_feedback_log", { stage: "implement", message: "should not be written" });
    eq(r.logged, false, "policies.feedback: false disables logging");
    eq(r.reason, "disabled by policy", "...and says why, rather than throwing");
    ok(!hasFile(repo, ".foundry/feedback.jsonl"), "no file is created");
    eq(git(repo, ["status", "--porcelain"]), "", "no commit is made");
  });
}

{
  const repo = plannedRepo({ config: { policies: { feedback: "sometimes" } } });
  await withServer(repo, async ({ call }) => {
    isError(
      await call("foundry_feedback_log", { stage: "implement", message: "x" }),
      /policies\.feedback must be a boolean/,
      "a non-boolean policies.feedback refuses, the same way policies.push already does",
    );
  });
}

finish();
