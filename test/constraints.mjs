// Constraints (F-14): a CLAUDE.md rule expressed as data, with fixtures that
// prove the pattern actually catches what it claims to, checked by
// kukulu_verify before any shell command runs. A grep with a blind spot
// fails its own fixture here instead of passing silently for three review
// rounds.

import fs from "node:fs";
import path from "node:path";
import { finish, ok, eq, like, isError, ROOT, plannedRepo, withServer, writeFile, git, setState, markTasks, mkFailingGhBin } from "./harness.mjs";

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
    isError(await call("kukulu_verify"), re, `constraints refuse: ${label}`);
  });
}

{
  const repo = constraintRepo([RULE, { ...RULE, id: "no-console-log" }]);
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), /'no-console-log' is defined more than once/, "a duplicate id is refused");
  });
}

{
  const repo = plannedRepo({ config: { constraints: "not an array" } });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), /'constraints' must be an array/, "a non-array constraints value is refused");
  });
}

// ---------------------------------------------------------------- self-test (fixtures)

{
  const repo = constraintRepo([RULE]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.constraints.ok, true, "a rule whose fixtures agree with its pattern self-tests clean");
    eq(v.constraints.results[0].id, "no-console-log", "the result is keyed by the rule's id");
    eq(v.constraints.results[0].fixture, null, "no fixture failure to report");
    eq(v.constraints.results[0].hits.length, 0, "no real hits in an otherwise-empty src/");
    eq(v.ok, true, "a clean constraint set does not fail kukulu_verify on its own");
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
    const v = await call("kukulu_verify");
    eq(v.constraints.ok, false, "a broken fixture fails the constraint");
    eq(v.ok, false, "...and fails kukulu_verify overall");
    like(v.constraints.results[0].fixture, /shouldNotMatch "console\.log\(x\);" matched/, "the fixture failure names the offending line");
    eq(v.constraints.results[0].hits.length, 0, "no hits are reported for a rule that failed its own self-test");
  });
}

{
  const repo = constraintRepo([{ ...RULE, shouldMatch: ["logger.debug(x);"] }]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.constraints.results[0].fixture, 'shouldMatch "logger.debug(x);" did not match', "a shouldMatch fixture that does not match names itself in the failure");
    eq(v.constraints.results[0].ok, false, "...and the rule is not ok");
  });
}

// ---------------------------------------------------------------- scanning real files

{
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "kukulu-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "console.log('top-secret');\n");
  const repo = constraintRepo([RULE]);
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(repo, "src", "link.js"));
  fs.writeFileSync(path.join(repo, "src", "real.js"), "console.log('inside');\n");
  fs.symlinkSync("real.js", path.join(repo, "src", "inner.js"));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "links"]);
  await withServer(repo, async ({ call }) => {
    const r = (await call("kukulu_verify")).constraints.results[0];
    ok(!JSON.stringify(r).includes("top-secret"), "a tracked symlink to a file outside the project is not scanned: its content is in no hit");
    eq(JSON.stringify(r.skipped), JSON.stringify(["src/link.js"]), "...and the rule lists the symlink under skipped");
    ok(r.hits.some((h) => h.file === "src/inner.js"), "a symlink inside the project is still scanned");
  });
}

{
  const outside = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "kukulu-outdir-"));
  fs.writeFileSync(path.join(outside, "secret.js"), "console.log('top-secret');\n");
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/keys/secret.js", "const x = 1;\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "keys"]);
  fs.rmSync(path.join(repo, "src", "keys"), { recursive: true });
  fs.symlinkSync(outside, path.join(repo, "src", "keys"));
  await withServer(repo, async ({ call }) => {
    const r = (await call("kukulu_verify")).constraints.results[0];
    ok(!JSON.stringify(r.hits).includes("top-secret"), "a tracked file reached through a symlinked directory that leaves the project is not scanned: its content is in no hit");
    ok((r.skipped || []).includes("src/keys/secret.js"), "...and the rule lists the file under skipped");
  });
}

{
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/a.js", "const x = 1;\nconsole.log('debug', x);\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add a hit"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.constraints.ok, false, "a real hit fails the constraint");
    eq(v.ok, false, "...and fails kukulu_verify overall, even if every shell command passes");
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
    const v = await call("kukulu_verify");
    eq(v.constraints.results[0].hits.length, 1, "exclude removes the whole directory from the scan");
    eq(v.constraints.results[0].hits[0].file, "src/a.js", "only the non-excluded file is reported");
  });
}

{
  // A new file not yet committed is scanned (2026-09-30 cleanflate F-26); a
  // file already untracked when the run started, or an ignored one, is not.
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/operator.js", "console.log('was here before the run');\n");
  writeFile(repo, ".gitignore", "src/generated/\n");
  git(repo, ["add", ".gitignore"]);
  git(repo, ["commit", "-qm", "ignore generated"]);
  setState(repo, { preexistingUntracked: ["src/operator.js"] });
  writeFile(repo, "src/generated/out.js", "console.log('ignored');\n");
  await withServer(repo, async ({ call }) => {
    const clean = await call("kukulu_verify");
    eq(clean.constraints.ok, true, "a pre-existing untracked file and an ignored file are never scanned");
    writeFile(repo, "src/new.js", "console.log('not committed yet');\n");
    const v = await call("kukulu_verify");
    eq(v.constraints.ok, false, "a new, uncommitted file under paths is scanned");
    eq(v.constraints.results[0].hits.map((h) => h.file).join(","), "src/new.js", "...and only it is reported");
  });
}

{
  // files touched by the task never narrows a constraint scan.
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/a.js", "console.log('hit');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "add a hit"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify", { files: ["docs/unrelated.md"] });
    eq(v.constraints.ok, false, "the constraint scan runs whole-repo regardless of which files the call names");
  });
}

// run_finish reports a whole-tree scan at handoff, without refusing on it.
{
  const repo = constraintRepo([RULE]);
  writeFile(repo, "src/a.js", "console.log('slipped through');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "a regression"]);
  await withServer(repo, async ({ call }) => {
    await call("kukulu_run_start");
    markTasks(repo, { "P0-01": "x", "P0-02": "x", "P0-03": "x" });
    git(repo, ["commit", "-qam", "progress: by hand"]);
    writeFile(repo, "docs/HANDOFF.md", "# handoff\n");
    const r = await call("kukulu_run_finish");
    eq(JSON.stringify(r.constraints), JSON.stringify({ ok: false, failing: ["no-console-log"] }), "run_finish reports the failing constraint");
    like(r.readyLine, /; constraints failing: no-console-log$/, "...in the ready line too");
    ok(r.head, "...but still hands off");
  }, { env: { PATH: `${mkFailingGhBin()}:${process.env.PATH}` } });
}

// ---------------------------------------------------------------- the shipped template

{
  // every template rule validates and passes its own fixtures
  const template = JSON.parse(fs.readFileSync(path.join(ROOT, "templates/constraints.example.json"), "utf8"));
  ok(Array.isArray(template) && template.length >= 4, "the template ships at least four worked rules");
  ok(template.some((r) => r.from), "...one of them gated with from");
  const needed = [...new Set(template.map((r) => r.from).filter(Boolean))];
  const tasks = [
    { id: "P0-01", title: "One" },
    ...needed.map((id) => ({ id, title: `Task ${id}` })),
  ];
  const repo = plannedRepo({ config: { constraints: template }, tasks });
  writeFile(repo, "src/.keep", "");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: src/"]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.constraints.ok, true, "every template rule validates and passes its own fixtures");
    for (const r of v.constraints.results) eq(r.fixture, null, `${r.id}'s fixtures agree with its pattern`);
  });
}

// ---------------------------------------------------------------- from

{
  // from gates a constraint on its task
  const repo = constraintRepo([{ ...RULE, from: "P0-02" }]);
  writeFile(repo, "src/a.js", "console.log('x');\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "chore: a hit"]);
  await withServer(repo, async ({ call }) => {
    for (const st of [" ", "!", "-"]) {
      markTasks(repo, { "P0-01": "x", "P0-02": st, "P0-03": " " });
      const v = await call("kukulu_verify");
      eq(v.ok, true, `from: P0-02 is inactive while the task is [${st}]`);
      eq(v.constraints.results[0].inactive, "until P0-02", "...and the result says why");
    }
    for (const st of ["~", "x"]) {
      markTasks(repo, { "P0-01": "x", "P0-02": st, "P0-03": " " });
      const v = await call("kukulu_verify");
      eq(v.ok, false, `from: P0-02 is active while the task is [${st}]`);
      eq(v.constraints.results[0].hits.length, 1, "...and reports the hit");
    }
    markTasks(repo, { "P0-01": "x", "P0-02": "!", "P0-03": "x" });
    eq((await call("kukulu_verify")).ok, false, "from is active once no task is open");
  });
}

{
  // an inactive rule still self-tests
  const repo = constraintRepo([{ ...RULE, from: "P0-02", shouldMatch: ["nothing here"] }]);
  await withServer(repo, async ({ call }) => {
    const v = await call("kukulu_verify");
    eq(v.ok, false, "an inactive rule with a broken fixture fails");
    like(v.constraints.results[0].fixture, /shouldMatch/, "...with the fixture set");
  });
}

for (const [config, re, label] of [
  [{ constraints: [{ ...RULE, from: "P9-09" }] }, /constraint 'no-console-log'\.from names P9-09, which is not a task in docs\/PLAN\.md/, "a from naming a task not in PLAN.md"],
  [{ constraints: [{ ...RULE, from: "step 2" }] }, /from must be a task id such as P1-03/, "a malformed from"],
  [{ build: [{ cmd: "true", from: "P0-01" }] }, /build\[0\]\.from is only valid on verify and extraVerify entries/, "from on a build entry"],
  [{ parallel: { setup: [{ cmd: "true", from: "P0-01" }] } }, /parallel\.setup\[0\]\.from is only valid on verify and extraVerify entries/, "from on a parallel.setup entry"],
]) {
  const repo = plannedRepo({ config });
  await withServer(repo, async ({ call }) => {
    isError(await call("kukulu_verify"), re, `refuses ${label}`);
  });
}

finish();
