// Shared test harness: temp git repos, an MCP client over stdio, TAP-ish
// assertions. Every suite in test/ is a standalone Node program that imports
// this, asserts, and calls finish(); test/run.mjs runs them all as children so
// one suite's crash can't take the rest down.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, sign } from "node:crypto";
import * as CR from "../mcp/cleanroom.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const SERVER = path.join(ROOT, "mcp", "server.mjs");
export const GUARD = path.join(ROOT, "scripts", "implement-guard.mjs");

const KEEP = Boolean(process.env.KEEP_REPO);
const RPC_TIMEOUT_MS = Number(process.env.KUKULU_TEST_TIMEOUT_MS || 60_000);

// ---------------------------------------------------------------- assertions

let count = 0;
const failures = [];

export function ok(cond, msg) {
  count++;
  if (cond) {
    console.log(`ok ${count} - ${msg}`);
  } else {
    failures.push(msg);
    console.log(`not ok ${count} - ${msg}`);
  }
  return Boolean(cond);
}

export function eq(actual, expected, msg) {
  const good = Object.is(actual, expected);
  ok(good, msg);
  if (!good) console.log(`  #   expected: ${JSON.stringify(expected)}\n  #   actual:   ${JSON.stringify(actual)}`);
  return good;
}

export function like(actual, re, msg) {
  const s = typeof actual === "string" ? actual : JSON.stringify(actual);
  const good = re.test(s);
  ok(good, msg);
  if (!good) console.log(`  #   expected match: ${re}\n  #   actual:         ${JSON.stringify(s)}`);
  return good;
}

/** Assert a tool call came back as an error, and that its message matches. */
export function isError(res, re, msg) {
  const good = Boolean(res && res.error) && re.test(res.error);
  ok(good, msg);
  if (!good) console.log(`  #   expected error matching ${re}\n  #   got: ${JSON.stringify(res)}`);
  return good;
}

/** Print the plan line and exit non-zero if anything failed. */
export function finish() {
  console.log(`1..${count}`);
  if (failures.length) {
    console.log(`# FAILED ${failures.length}/${count}`);
    for (const f of failures) console.log(`#   - ${f}`);
  } else {
    console.log(`# passed ${count}/${count}`);
  }
  process.exit(failures.length ? 1 : 0);
}

// ---------------------------------------------------------------- temp repos

const madeRepos = [];
process.on("exit", () => {
  if (KEEP) return;
  for (const d of madeRepos) fs.rmSync(d, { recursive: true, force: true });
});

const gitIn = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

/** A throwaway git repo with an identity configured and one empty commit. */
export function mkRepo(prefix = "kukulu-test-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  madeRepos.push(dir);
  gitIn(dir, ["init", "-q", "-b", "main"]);
  gitIn(dir, ["config", "user.email", "test@kukulu.invalid"]);
  gitIn(dir, ["config", "user.name", "kukulu test"]);
  gitIn(dir, ["config", "commit.gpgsign", "false"]);
  gitIn(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  if (KEEP) console.log(`# repo: ${dir}`);
  return dir;
}

/** A throwaway directory that is deliberately *not* a git repo. */
export function mkDir(prefix = "kukulu-plain-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  madeRepos.push(dir);
  return dir;
}

/** A bare repo usable as an `origin` for push tests. */
export function mkBareRemote() {
  const dir = mkDir("kukulu-remote-");
  execFileSync("git", ["init", "-q", "--bare", dir], { encoding: "utf8" });
  return dir;
}

/**
 * A directory holding a `gh` stub that always fails, so run_finish's optional
 * pull-request path stays local and deterministic. Prepend it to PATH.
 */
export function mkFailingGhBin() {
  const dir = mkDir("kukulu-bin-");
  const gh = path.join(dir, "gh");
  fs.writeFileSync(gh, "#!/bin/sh\nexit 1\n");
  fs.chmodSync(gh, 0o755);
  return dir;
}

/**
 * A directory holding a `gh` stub that behaves like a GitHub with no pull
 * request until `gh pr create` makes one: `pr view` then reports it, with
 * the `--base` it was created against. Every invocation is appended to
 * `<dir>/calls.log`. Prepend the directory to PATH.
 */
export function mkFakeGhBin() {
  const dir = mkDir("kukulu-gh-");
  const gh = path.join(dir, "gh");
  fs.writeFileSync(
    gh,
    `#!/bin/sh
dir=$(dirname "$0")
printf '%s\\n' "$*" >> "$dir/calls.log"
case "$1" in --version) exit 0 ;; esac
if [ "$1 $2" = "pr view" ]; then
  if [ ! -f "$dir/pr.json" ]; then echo "no pull requests found for branch" >&2; exit 1; fi
  case " $* " in
    *" title"*) if [ -f "$dir/view-title-fails" ]; then cat "$dir/view-title-fails" >&2; exit 1; fi ;;
  esac
  case " $* " in
    *" -q "*) sed -n 's/.*"url":"\\([^"]*\\)".*/\\1/p' "$dir/pr.json" ;;
    *) cat "$dir/pr.json" ;;
  esac
  exit 0
fi
if [ "$1 $2" = "pr create" ]; then
  base=main
  title=
  while [ $# -gt 0 ]; do
    if [ "$1" = "--base" ]; then base=$2; fi
    if [ "$1" = "--title" ]; then title=$2; fi
    shift
  done
  esc=$(printf '%s' "$title" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
  printf '{"number":1,"url":"https://github.invalid/pull/1","state":"OPEN","isDraft":true,"baseRefName":"%s","headRefOid":"0123456789abcdef0123456789abcdef01234567","title":"%s"}\\n' "$base" "$esc" > "$dir/pr.json"
  echo https://github.invalid/pull/1
  exit 0
fi
if [ "$1 $2" = "pr checks" ]; then
  if [ -f "$dir/checks-stderr" ]; then cat "$dir/checks-stderr" >&2; fi
  if [ -f "$dir/checks.json" ]; then cat "$dir/checks.json"; else echo "[]"; fi
  if [ -f "$dir/checks-exit" ]; then exit "$(cat "$dir/checks-exit")"; fi
  exit 0
fi
if [ "$1 $2" = "pr ready" ]; then
  if [ -f "$dir/pr.json" ]; then sed 's/"isDraft":true/"isDraft":false/' "$dir/pr.json" > "$dir/pr.json.tmp" && mv "$dir/pr.json.tmp" "$dir/pr.json"; fi
  exit 0
fi
if [ "$1" = "api" ]; then
  if [ -f "$dir/api-fails" ]; then cat "$dir/api-fails" >&2; exit 1; fi
  case "$2" in
    *check-runs*) cat "$dir/api-check-runs.json" ;;
    */status) cat "$dir/api-status.json" ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [ "$1 $2" = "pr merge" ]; then
  if [ -f "$dir/merge-fails" ]; then cat "$dir/merge-fails" >&2; exit 1; fi
  exit 0
fi
exit 1
`,
  );
  fs.chmodSync(gh, 0o755);
  return dir;
}

/**
 * A fake gpg program that signs anything; its verify result comes from
 * FAKE_GPG_VERIFY (good | bad | err), which git reads as %G? of U, B or E.
 * With `failAfter`, signing starts failing once that many signatures have
 * been made. Returns the program's absolute path.
 */
export function mkFakeGpg({ failAfter } = {}) {
  const dir = mkDir("kukulu-gpg-");
  const gpg = path.join(dir, "gpg");
  fs.writeFileSync(
    gpg,
    `#!/bin/sh
# Fake gpg for tests: signs anything; verify result from FAKE_GPG_VERIFY (good|bad|err).
dir=$(dirname "$0")
for a in "$@"; do
  if [ "$a" = "--verify" ]; then
    echo "[GNUPG:] NEWSIG"
    case "\${FAKE_GPG_VERIFY:-good}" in
      bad) echo "[GNUPG:] BADSIG 0123456789ABCDEF kukulu test" ;;
      err) echo "[GNUPG:] ERRSIG 0123456789ABCDEF 1 10 00 1700000000 9 -"; echo "[GNUPG:] NO_PUBKEY 0123456789ABCDEF" ;;
      *) echo "[GNUPG:] GOODSIG 0123456789ABCDEF kukulu test" ;;
    esac
    exit 0
  fi
done
n=$(cat "$dir/sign-count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$dir/sign-count"
if [ -f "$dir/fail-after" ] && [ "$n" -gt "$(cat "$dir/fail-after")" ]; then echo "gpg: signing failed: fake" >&2; exit 2; fi
cat >/dev/null
echo "[GNUPG:] SIG_CREATED D 1 10 00 1700000000 0123456789ABCDEF0123456789ABCDEF01234567" >&2
printf -- '-----BEGIN PGP SIGNATURE-----\\n\\nZmFrZQ==\\n-----END PGP SIGNATURE-----\\n'
`,
  );
  fs.chmodSync(gpg, 0o755);
  if (failAfter !== undefined) fs.writeFileSync(path.join(dir, "fail-after"), String(failAfter));
  return gpg;
}

/** Point `repo`'s local git config at a fake gpg so every commit is signed. */
export function useFakeSigner(repo, gpgPath) {
  gitIn(repo, ["config", "--local", "gpg.format", "openpgp"]);
  gitIn(repo, ["config", "--local", "gpg.program", gpgPath]);
  gitIn(repo, ["config", "--local", "user.signingkey", "0123456789ABCDEF"]);
  gitIn(repo, ["config", "--local", "commit.gpgsign", "true"]);
}

export const sh = (dir, cmd) => execFileSync("/bin/sh", ["-c", cmd], { cwd: dir, encoding: "utf8" }).trim();
export const git = gitIn;
export const readFile = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
export const writeFile = (dir, rel, body) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
export const hasFile = (dir, rel) => fs.existsSync(path.join(dir, rel));
export const subject = (dir) => gitIn(dir, ["log", "-1", "--format=%s"]);

// ---------------------------------------------------------------- fixtures

/** One PLAN.md task block in the exact shape the server's parser expects. */
export function planTask(t, { legacy = false } = {}) {
  return [
    `### ${t.id}: ${t.title}`,
    ...(legacy ? [] : [""]),
    `**Goal:** ${t.goal || t.title}`,
    `**Files touched:** ${t.files || "src/x"}`,
    `**Design constraints:** ${t.constraints || "none"}`,
    `**Acceptance tests:** ${t.tests || "none"}`,
    `**Out of scope:** ${t.outOfScope || "none"}`,
    `**Verification:** ${t.verification || "none"}`,
    `**Depends on:** ${t.depends && t.depends.length ? t.depends.join(", ") : "none"}`,
    // `planStream` overrides `stream` for PLAN.md only, to build a plan whose two files disagree.
    ...((t.planStream ?? t.stream) ? [`**Stream:** ${t.planStream ?? t.stream}`] : []),
    "",
  ].join("\n");
}

export const DEFAULT_TASKS = [
  { id: "P0-01", title: "Create hello", goal: "write hello.txt", files: "hello.txt", tests: "test.sh", verification: "./test.sh" },
  { id: "P0-02", title: "Impossible task", goal: "fail", files: "nope.txt", depends: ["P0-01"] },
  { id: "P0-03", title: "Depends on the impossible one", goal: "skip me", files: "x", depends: ["P0-02"] },
];

export function planDoc(tasks, { legacy = false } = {}) {
  return [
    "# Test build plan",
    ...(legacy ? [] : [""]),
    "Derived from docs/SPEC.md v0.1.",
    "",
    "## Decisions",
    ...(legacy ? [] : [""]),
    "- none",
    "",
    "## Phase 0 — Scaffold",
    "",
    ...tasks.map((t) => planTask(t, { legacy })),
  ].join("\n");
}

export function progressDoc(tasks, { legacy = false } = {}) {
  return [
    "# Test build progress",
    ...(legacy ? [] : [""]),
    "Branch: (set by implement)",
    "Started: (set by implement)",
    "",
    "## Tasks",
    ...(legacy ? [] : [""]),
    // `progressStream` overrides `stream` for PROGRESS.md only (`null` drops the tag).
    ...tasks.map((t) => {
      const tag = t.progressStream !== undefined ? t.progressStream : t.stream;
      return `- [${t.state || " "}] ${t.id} ${t.title}${tag ? ` {stream: ${tag}}` : ""}`;
    }),
    "",
    "## Log",
    ...(legacy ? [] : [""]),
    "(one entry per task, appended by implement)",
    "",
  ].join("\n");
}

/** A repo with only docs/SPEC.md committed — the state the planner starts in. */
export function specRepo(spec = "# Spec\n") {
  const repo = mkRepo();
  writeFile(repo, "docs/SPEC.md", spec);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "spec"]);
  return repo;
}

/** Write and commit the planner's four deliverables into an existing repo. */
export function addPlan(repo, { tasks = DEFAULT_TASKS, config = {}, claude = "# rules\n" } = {}) {
  writeFile(repo, "docs/PLAN.md", planDoc(tasks));
  writeFile(repo, "docs/PROGRESS.md", progressDoc(tasks));
  writeFile(repo, "docs/kukulu.json", JSON.stringify({ verify: ["true"], maxRounds: 3, ...config }, null, 2) + "\n");
  writeFile(repo, "CLAUDE.md", claude);
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "plan: derive build plan from SPEC"]);
  return repo;
}

/** A repo with the planner's four deliverables committed on `main`. */
export function plannedRepo(opts = {}) {
  return addPlan(specRepo(), opts);
}

/**
 * A repo in clean-room mode: `docs/cleanroom.json` is the shipped example,
 * committed on `main`. By default only the spec exists (the state a flight is
 * in at its first kukulu_next); `planned: true` adds the plan as well.
 */
export function cleanroomRepo({ planned = false, policy = null, ...planOpts } = {}) {
  const repo = specRepo();
  writeFile(repo, "docs/cleanroom.json", policy ?? fs.readFileSync(path.join(ROOT, "templates", "cleanroom.example.json"), "utf8"));
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, ["commit", "-qm", "clean-room policy"]);
  return planned ? addPlan(repo, planOpts) : repo;
}

/**
 * Rewrite a repo into the pre-0.6.0 layout (`.foundry/`, `docs/foundry.json`)
 * and commit it, so a suite can prove the compatibility fallback. Whatever the
 * repo holds of the new names is moved; nothing is invented.
 */
export function useLegacyLayout(repo) {
  const move = (from, to) => {
    const abs = path.join(repo, from);
    if (!fs.existsSync(abs)) return;
    fs.mkdirSync(path.dirname(path.join(repo, to)), { recursive: true });
    fs.renameSync(abs, path.join(repo, to));
  };
  move("docs/kukulu.json", "docs/foundry.json");
  move(".kukulu", ".foundry");
  gitIn(repo, ["add", "-A"]);
  if (gitIn(repo, ["status", "--porcelain"])) gitIn(repo, ["commit", "-qm", "chore: pre-0.6.0 layout"]);
  return repo;
}

/**
 * Run a hook script the way Claude Code does: `node <script>` with the payload as
 * JSON on stdin. Returns `{ status, stdout, stderr, ms }`. The environment is
 * the caller's, plus PATH and HOME, so a stray CLAUDE_* variable of the
 * developer's session cannot leak in.
 */
export function runHook(script, payload, env = {}) {
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}),
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

/**
 * Log one tool call the way a live session's PostToolUse hook does, by running the logger hook once.
 * The gate's liveness check wants an `allowed` entry between two gates, and a test has no session.
 */
export function logCall(repo, payload = {}) {
  return runHook(path.join(ROOT, "scripts", "cleanroom-log.mjs"), { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: path.join(repo, "docs", "SPEC.md") }, cwd: repo, ...payload }, { CLAUDE_PROJECT_DIR: repo });
}

const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Write a small, valid attestation bundle into `dir` the way kukulu_attest lays one out:
 * a chain (genesis, a gate, calls, a denial, a human entry, two checkpoints) built with
 * mcp/cleanroom.mjs and a temp key, the files a manifest lists, `publisher.pub`, a
 * `verify.mjs` copy, the manifest and its signature. `opts.key` is the publisher key,
 * `opts.checkpointKey` signs the second checkpoint instead (to build a bad one),
 * `opts.policyText` is the policy. `opts.clock()` replaces the time entries are stamped with,
 * `opts.extra(log)` appends more entries (after the first checkpoint), `opts.commits` is commits.txt,
 * `opts.gaps` and `opts.idleGapHours` are the manifest's coverage, `opts.cleanroomHash` (default none, the 0.7.0 shape) is pinned in the genesis entry and the manifest's plugin object, `opts.similarity` is a similarity.json's text.
 * The manifest's denials are counted from the entries here, independently of the verifier. Returns `{ dir, key, fingerprint, manifest, entries }`.
 */
export function buildBundle(dir, opts = {}) {
  const keyDir = mkDir("kukulu-bundle-key-");
  const key = opts.key ?? CR.generateKey(path.join(keyDir, "publisher.pem"));
  const cpKey = opts.checkpointKey ?? key;
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "log.jsonl");
  const policyText = opts.policyText ?? fs.readFileSync(path.join(ROOT, "templates", "cleanroom.example.json"), "utf8");
  const policyHash = CR.policyHash(policyText);
  const guardHash = sha256Of(fs.readFileSync(path.join(ROOT, "scripts", "cleanroom-guard.mjs")));
  const loggerHash = sha256Of(fs.readFileSync(path.join(ROOT, "scripts", "cleanroom-log.mjs")));
  const hooksHash = sha256Of(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json")));
  const base = { role: "session", model: "claude-test", session: "s-1" };
  const RealDate = Date;
  if (opts.clock) {
    globalThis.Date = class extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(opts.clock()); }
      static now() { return opts.clock(); }
    };
  }
  const checkpoint = (event, signer) => {
    const entries = CR.readEntries(log);
    const data = CR.signCheckpoint(
      { chainTip: entries.at(-1).hash, git: "b".repeat(40), policyHash, guardHash, loggerHash, hooksHash, keyFingerprint: key.fingerprint, event },
      signer.privateKey,
    );
    return CR.appendEntry(log, { kind: "checkpoint", stage: "implement", ...base, data });
  };
  CR.appendEntry(log, { kind: "genesis", stage: "controller", ...base, data: { mode: opts.mode ?? "clean-room", policyHash, guardHash, loggerHash, hooksHash, ...(opts.cleanroomHash ? { cleanroomHash: opts.cleanroomHash } : {}), pluginVersion: "0.7.0", keyFingerprint: key.fingerprint, baseBranch: "main", head: "a".repeat(40) } });
  CR.appendEntry(log, { kind: "gate", stage: "controller", ...base, data: { checks: 7, ok: true } });
  CR.appendEntry(log, { kind: "allowed", stage: "implement", task: "P0-01", ...base, tool: "Read", target: "/p/a.rs", decision: "allowed" });
  CR.appendEntry(log, { kind: "denied", stage: "implement", task: "P0-01", ...base, tool: "Read", target: "/usr/include/zlib.h", decision: "denied", reason: "denied path: /usr/include/zlib.h (deny.paths)" });
  CR.appendEntry(log, { kind: "human", stage: "controller", role: "operator", target: "go on", data: { kind: "instruction", via: "kukulu_cleanroom_record" } });
  checkpoint("run-start", key);
  if (opts.extra) opts.extra(log);
  CR.appendEntry(log, { kind: "allowed", stage: "implement", task: "P0-02", ...base, tool: "Bash", target: "ls", decision: "allowed" });
  checkpoint("kukulu_run_finish", cpKey);
  globalThis.Date = RealDate;
  const entries = CR.readEntries(log);
  const denied = entries.filter((e) => e.kind === "denied");
  const byReason = {};
  for (const e of denied) byReason[e.reason] = (byReason[e.reason] ?? 0) + 1;
  const verdicts = { "prior-art attempt": 0, "false positive": 0, "offline test": 0, unclassified: 0 };
  const classified = new Map();
  for (const e of entries) {
    const m = e.kind === "human" && e.data?.kind === "verdict" && /^#(\d+): (prior-art attempt|false positive|offline test)/.exec(e.target);
    if (m) classified.set(Number(m[1]), m[2]);
  }
  for (const d of denied) verdicts[classified.get(d.seq) ?? "unclassified"] += 1;

  const sources = {
    "policy.json": policyText,
    "SUMMARY.md": "# Summary\n",
    "REVIEW.md": "# Review\nRound: 1\n**Verdict**: APPROVED\n",
    "PROGRESS.md": "# Progress\n",
    "kukulu.json": "{}\n",
    "state.json": "{}\n",
    "commits.txt": opts.commits ?? `${"b".repeat(40)}\x1fG\x1fP0-01: first\x1fimplement\x1fP0-01\n`,
    ...(opts.similarity === undefined ? {} : { "similarity.json": opts.similarity }),
  };
  for (const [name, text] of Object.entries(sources)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, "publisher.pub"), key.publicKey.export({ type: "spki", format: "pem" }));
  const verifierBytes = fs.readFileSync(path.join(ROOT, "scripts", "verify-attestation.mjs"));
  fs.writeFileSync(path.join(dir, "verify.mjs"), verifierBytes);
  const listed = ["log.jsonl", ...Object.keys(sources), "publisher.pub"];
  const checkpoints = entries.filter((e) => e.kind === "checkpoint");
  const manifest = {
    version: 1,
    flight: "bundle-test",
    plugin: { version: "0.7.0", guardHash, loggerHash, hooksHash, ...(opts.cleanroomHash ? { cleanroomHash: opts.cleanroomHash } : {}), verifierHash: sha256Of(verifierBytes) },
    repo: { baseBranch: "main", base: "a".repeat(40), head: "b".repeat(40), branch: "build/test" },
    mode: "clean-room",
    genesis: entries[0],
    policy: { path: "docs/cleanroom.json", hashes: [policyHash], current: policyHash },
    chain: { entries: entries.length, first: entries[0].hash, tip: entries.at(-1).hash },
    checkpoints: checkpoints.map((e) => ({ seq: e.seq, event: e.data.event, git: e.data.git, signature: e.data.signature, ok: true })),
    denials: { total: denied.length, byReason, verdicts },
    calls: { total: 3, byTool: { Read: 2, Bash: 1 }, byStage: { implement: 3 }, readCapable: 3 },
    human: { instructions: 1, interventions: 0, verdicts: 0 },
    selfTest: { ok: true, cases: 164, at: "2026-01-01T00:00:00.000Z" },
    coverage: { gaps: opts.gaps ?? [], knownLimits: [], idleGapHours: opts.idleGapHours ?? 4 },
    similarity: opts.similarity === undefined ? null : { sha256: sha256Of(opts.similarity) },
    files: listed.map((name) => {
      const bytes = fs.readFileSync(path.join(dir, name));
      return { path: name, sha256: sha256Of(bytes), bytes: bytes.length };
    }),
    signer: { fingerprint: key.fingerprint, publicKey: "publisher.pub" },
    at: "2026-01-01T00:00:00.000Z",
  };
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  signBundleManifest(dir, key);
  return { dir, key, fingerprint: key.fingerprint, manifest, entries };
}

/** Sign `dir/manifest.json` with `key`, writing `manifest.sig` (base64 Ed25519 over the manifest's bytes). */
export function signBundleManifest(dir, key) {
  fs.writeFileSync(path.join(dir, "manifest.sig"), `${sign(null, fs.readFileSync(path.join(dir, "manifest.json")), key.privateKey).toString("base64")}\n`);
}

/** Edit a bundle's manifest and sign it again, so the only thing wrong with the bundle is what `mutate` changed. */
export function rewriteManifest(dir, key, mutate) {
  const file = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(manifest);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  signBundleManifest(dir, key);
}

/**
 * A throwaway copy of the plugin (server, scripts, hooks, templates, agents, skills and the guard
 * fixtures), so a test can edit "the installed plugin" without touching this checkout. Start a
 * server from it with `startServer(repo, { server: <dir>/mcp/server.mjs })`.
 */
export function tempPlugin() {
  const dir = mkDir("kukulu-plugin-");
  for (const d of ["mcp", "scripts", "hooks", "templates", "agents", "skills", "test/fixtures"]) {
    fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(dir, "package.json"));
  return dir;
}

/** Force `.kukulu/state.json` into a given shape, bypassing the tools. */
export function setState(repo, patch) {
  const p = path.join(repo, ".kukulu", "state.json");
  const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2) + "\n");
}

/** Rewrite PROGRESS.md checkboxes directly: `{ "P0-01": "x" }`. */
export function markTasks(repo, states) {
  const p = path.join(repo, "docs", "PROGRESS.md");
  const out = fs.readFileSync(p, "utf8").split("\n").map((line) => {
    const m = line.match(/^- \[.\] ([PR]\d+-\d+)(.*)$/);
    return m && states[m[1]] ? `- [${states[m[1]]}] ${m[1]}${m[2]}` : line;
  });
  fs.writeFileSync(p, out.join("\n"));
}

/** Commit a task's work the way the implementer is told to: `<ID>: <title>`. */
export function commitTask(repo, id, title, files = {}) {
  const paths = Object.keys(files);
  for (const [rel, body] of Object.entries(files)) writeFile(repo, rel, body);
  // Stage only the task's own files, the way the implement skill requires:
  // docs/PROGRESS.md belongs to the MCP, never to a task commit.
  gitIn(repo, ["add", "--", ...paths]);
  gitIn(repo, ["commit", "-qm", `${id}: ${title}`, "--", ...paths]);
  return gitIn(repo, ["rev-parse", "--short", "HEAD"]);
}

// ---------------------------------------------------------------- MCP client

/**
 * Spawn the server against `repo` and return a small JSON-RPC client.
 * `messages` records every frame the server emits, so suites can assert that
 * notifications produce no reply.
 */
const testKeys = new Map();
/** The signing-key path a server for `repo` uses in tests: stable per repo, in a temp directory that is removed on exit. */
export function testKeyFor(repo) {
  if (!testKeys.has(repo)) testKeys.set(repo, path.join(mkDir("kukulu-key-"), "ed25519.pem"));
  return testKeys.get(repo);
}

export function startServer(repo, { env = {}, server = SERVER } = {}) {
  // Isolate every suite from the developer's own machine: point KUKULU_CONFIG
  // at a path that does not exist and force KUKULU_PROFILE unset, so a real
  // ~/.config/kukulu/config.json (or an inherited KUKULU_PROFILE) can never
  // leak into a test. The pre-0.6.0 FOUNDRY_* names are blanked too, so a
  // developer's old exports cannot reach a suite. A suite that wants to test
  // the global file passes its own KUKULU_CONFIG/KUKULU_PROFILE via `env`.
  const isolation = {
    KUKULU_CONFIG: path.join(repo, ".kukulu-test-no-global.json"),
    // One throwaway signing key per repo, outside it, so a test never touches the developer's own key.
    KUKULU_CLEANROOM_KEY: testKeyFor(repo),
    KUKULU_PROFILE: "",
    FOUNDRY_CONFIG: "",
    FOUNDRY_PROFILE: "",
    FOUNDRY_PROJECT_DIR: "",
  };
  const proc = spawn(process.execPath, [server], {
    env: { ...process.env, KUKULU_PROJECT_DIR: repo, ...isolation, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map();
  const messages = [];
  let nextId = 1;
  let buf = "";

  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        messages.push({ unparseable: line });
        continue;
      }
      messages.push(msg);
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        waiter(msg);
      }
    }
  });

  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + "\n");

  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`rpc timeout after ${RPC_TIMEOUT_MS}ms: ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  /** Fire-and-forget: no id, so a spec-compliant server must not answer. */
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

  /** Raw bytes, for framing and parse-error tests. */
  const raw = (text) => proc.stdin.write(text);

  /** Call a tool; returns the parsed JSON result, or `{ error: <text> }`. */
  const call = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.error) return { error: r.error.message };
    const text = r.result.content[0].text;
    if (r.result.isError) return { error: text };
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  };

  const stop = () =>
    new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.stdin.end();
      setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });

  const settle = () => new Promise((r) => setTimeout(r, 50));

  return { proc, rpc, notify, raw, call, stop, messages, settle };
}

/** Spawn a server, hand it to `fn`, and always shut it down afterwards. */
export async function withServer(repo, fn, opts) {
  const s = startServer(repo, opts);
  try {
    await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness", version: "0" } });
    return await fn(s);
  } finally {
    await s.stop();
  }
}

// ---------------------------------------------------------------- frontmatter

/** Minimal YAML frontmatter reader: scalars and `- ` lists, which is all we use. */
export function frontmatter(body) {
  const m = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      (out[key] = Array.isArray(out[key]) ? out[key] : []).push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const value = kv[2].trim().replace(/^["'](.*)["']$/, "$1");
    out[key] = value === "" ? [] : value === "true" ? true : value === "false" ? false : value;
  }
  return out;
}

/** Split a file's text into its parsed frontmatter and the body that follows. */
export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: null, body: text };
  return { frontmatter: frontmatter(text), body: m[2] };
}

/** Write a Kūkulu global routing-config fixture; returns its path. */
export function writeGlobalConfig(dir, obj) {
  return writeFile(dir, "global-config.json", JSON.stringify(obj, null, 2) + "\n");
}

// ---------------------------------------------------------------- guard hook

/**
 * Run the guard hook against `repo`, simulating a SubagentStop from the
 * implementer — the common real-world shape of the check — unless `input`
 * overrides fields on it. Returns stdout, trimmed.
 */
export function runGuard(repo, input = {}, env = {}) {
  const payload = JSON.stringify({
    hook_event_name: "SubagentStop",
    agent_type: "kukulu-implementer",
    transcript_path: path.join(repo, ".kukulu-test-transcript.jsonl"),
    cwd: repo,
    ...input,
  });
  return execFileSync(process.execPath, [GUARD], {
    cwd: repo,
    input: payload,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ...env },
  }).trim();
}

/**
 * Every `#` heading in a Markdown text that is not followed by a blank line,
 * or not preceded by one (except on line 1), as `line <n>: <heading> …`
 * (markdownlint MD022). Fenced code blocks are skipped.
 */
export function headingSpacingProblems(text) {
  const lines = text.split("\n");
  const problems = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) fenced = !fenced;
    if (fenced || !/^#{1,6} /.test(l)) return;
    if (i > 0 && lines[i - 1].trim() !== "") problems.push(`line ${i + 1}: ${l} is not preceded by a blank line`);
    if (i < lines.length - 1 && lines[i + 1].trim() !== "") problems.push(`line ${i + 1}: ${l} is not followed by a blank line`);
  });
  return problems;
}
