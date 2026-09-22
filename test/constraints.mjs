// Constraints (F-14): a CLAUDE.md rule expressed as data, with fixtures that
// prove the pattern actually catches what it claims to, checked by
// foundry_verify before any shell command runs. A grep with a blind spot
// fails its own fixture here instead of passing silently for three review
// rounds.

import fs from "node:fs";
import path from "node:path";
import { finish, ok, eq, like, isError, ROOT, plannedRepo, withServer, writeFile, git } from "./harness.mjs";

const RULE = {
  id: "no-console-log",
  description: "console.log has no place outside a debug build",
  paths: ["src/"],
  pattern: "console\\.log\\(",
  shouldMatch: ["console.log('x');"],
  shouldNotMatch: ["logger.debug('x');"],
};

/** A repo with `constraints` set, one tracked file so `src/` exists at all. */
function constraintRepo(constraints, extraConfig = {}) {
  const repo = plannedRepo({ config: { constraints, ...extraConfig } });
  writeFile(repo, "src/.keep", "");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: src/"]);
  return repo;
}

// ---------------------------------------------------------------- config validation

for (const [bad, re, label] of [
  [{ ...RULE, shouldMatch: undefined }, /must have at least one 'shouldMatch'/, "missing shouldMatch"],
  [{ ...RULE, shouldMatch: [] }, /must have at least one 'shouldMatch'/, "empty shouldMatch"],
  [{ ...RULE, shouldNotMatch: undefined }, /must have at least one 'shouldNotMatch'/, "missing shouldNotMatch"],
  [{ ...RULE, paths: undefined }, /must have a non-empty 'paths'/, "missing paths"],
  [{ ...RULE, paths: [] }, /must have a non-empty 'paths'/, "empty paths"],
  [{ ...RULE, pattern: undefined }, /must have a non-empty 'pattern'/, "missing pattern"],
  [{ ...RULE, pattern: "(unclosed" }, /has an invalid pattern/, "unparseable pattern"],
  [{ ...RULE, id: undefined }, /is missing 'id'/, "missing id"],
  [{ ...RULE, nope: true }, /has an unknown key 'nope'/, "unknown key"],
  [{ ...RULE, flags: 5 }, /\.flags must be a string/, "non-string flags"],
]) {
  const repo = constraintRepo([bad]);
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), re, `constraints refuse: ${label}`);
  });
}

{
  const repo = constraintRepo([RULE, { ...RULE, id: "no-console-log" }]);
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), /'no-console-log' is defined more than once/, "a duplicate id is refused");
  });
}

{
  const repo = plannedRepo({ config: { constraints: "not an array" } });
  await withServer(repo, async ({ call }) => {
    isError(await call("foundry_verify"), /'constraints' must be an array/, "a non-array constraints value is refused");
  });
}

// ---------------------------------------------------------------- self-test (fixtures)

{
  const repo = constraintRepo([RULE]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.ok, true, "a rule whose fixtures agree with its pattern self-tests clean");
    eq(v.constraints.results[0].id, "no-console-log", "the result is keyed by the rule's id");
    eq(v.constraints.results[0].fixture, null, "no fixture failure to report");
    eq(v.constraints.results[0].hits.length, 0, "no real hits in an otherwise-empty src/");
    eq(v.ok, true, "a clean constraint set does not fail foundry_verify on its own");
  });
}

{
  // A shouldNotMatch line that actually matches: the rule fails outright and
  // is never trusted to scan anything, even if real hits exist.
  const repo = constraintRepo([{ ...RULE, shouldNotMatch: ["console.log(x);"] }]);
  writeFile(repo, "src/real.js", "console.log('this would be a hit if the rule were trusted');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add a real hit"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.ok, false, "a broken fixture fails the constraint");
    eq(v.ok, false, "...and fails foundry_verify overall");
    like(v.constraints.results[0].fixture, /shouldNotMatch "console\.log\(x\);" matched/, "the fixture failure names the offending line");
    eq(v.constraints.results[0].hits.length, 0, "no hits are reported for a rule that failed its own self-test");
  });
}

{
  const repo = constraintRepo([{ ...RULE, shouldMatch: ["logger.debug(x);"] }]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.results[0].fixture, 'shouldMatch "logger.debug(x);" did not match', "a shouldMatch fixture that does not match names itself in the failure");
    eq(v.constraints.results[0].ok, false, "...and the rule is not ok");
  });
}

// ---------------------------------------------------------------- scanning real files

{
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/a.js", "const x = 1;\nconsole.log('debug', x);\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add a hit"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.ok, false, "a real hit fails the constraint");
    eq(v.ok, false, "...and fails foundry_verify overall, even if every shell command passes");
    const hit = v.constraints.results[0].hits[0];
    eq(hit.file, "src/a.js", "the hit names the file");
    eq(hit.line, 2, "...and the 1-indexed line number");
    eq(hit.text, "console.log('debug', x);", "...and the exact line text");
  });
}

{
  const repo = constraintRepo([{ ...RULE, exclude: ["src/legacy/"] }]);
  writeFile(repo, "src/a.js", "console.log('caught');\n");
  writeFile(repo, "src/legacy/old.js", "console.log('excluded');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "one excluded, one not"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.results[0].hits.length, 1, "exclude removes the whole directory from the scan");
    eq(v.constraints.results[0].hits[0].file, "src/a.js", "only the non-excluded file is reported");
  });
}

{
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/untracked.js", "console.log('never committed');\n");
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.ok, true, "an untracked file is never scanned, even though it sits under paths");
  });
}

{
  // files touched by the task never narrows a constraint scan.
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/a.js", "console.log('hit');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add a hit"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify", { files: ["docs/unrelated.md"] });
    eq(v.constraints.ok, false, "the constraint scan runs whole-repo regardless of which files the call names");
  });
}

// ---------------------------------------------------------------- the shipped template

{
  const template = JSON.parse(fs.readFileSync(path.join(ROOT, "templates/constraints.example.json"), "utf8"));
  ok(Array.isArray(template) && template.length >= 3, "the template ships at least three worked rules");
  const repo = constraintRepo(template);
  await withServer(repo, async ({ call }) => {
    const v = await call("foundry_verify");
    eq(v.constraints.ok, true, "the shipped template passes its own self-test");
    for (const r of v.constraints.results) eq(r.fixture, null, `${r.id}'s fixtures agree with its pattern`);
  });
}

finish();
