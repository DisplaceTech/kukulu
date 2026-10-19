# Clean-room mode

Clean-room mode is for a build that must be able to show it did not look at something. A project that has a policy file turns it on, and from then on every tool call is checked against the policy before it runs, every call that is allowed is logged after it runs, and the log is a hash chain with signed checkpoints that nobody can quietly rewrite. The pipeline refuses to start a stage if any of that machinery has changed since the flight began.

The clean-room method is the subject of U.S. Provisional Application No. 64/178,095 (Displace Technologies LLC); the application is patent pending.

## Turning it on

Write a policy at `docs/cleanroom.json` and commit it on the base branch before the flight. There is no flag: the mode is on when the file exists, and `docs/kukulu.json`'s `cleanroom.policy` can point somewhere else. `templates/cleanroom.example.json` is a worked policy. The first `kukulu_next` of a flight validates it, generates the signing key if there is none, and writes the genesis entry of the log. From then on:

- the plugin's `PreToolUse` hook (`scripts/cleanroom-guard.mjs`) decides every tool call, and a denied call never runs;
- its `PostToolUse` hook (`scripts/cleanroom-log.mjs`) logs every call that did run, and its `UserPromptSubmit` hook logs every prompt a person types into a session in the project;
- the tools that start a stage run a gate first.

A project without the policy file pays nothing: both hooks exit at once, before loading any clean-room code. Hooks load when a Claude Code session starts, so a session that began before the policy existed is not covered; the gate's liveness check catches a session with no hooks at all.

## The policy

`docs/cleanroom.json` is validated on load, and every unknown key and every bad shape is a refusal that names the key. Each `pathPatterns` and `commandPatterns` entry carries fixtures (`shouldMatch`, `shouldNotMatch`) that are tested against its own pattern on load, the way constraints are.

| Key | Required | Meaning |
|---|---|---|
| `version` | yes, `1` | Schema version |
| `deny.tools` | no, `[]` | Tool names denied outright |
| `deny.network` | no, `true` | Deny `WebFetch` not in `allow.urls`, `WebSearch`, and Bash segments whose command word is `curl`, `wget`, `gh`, `ssh`, `scp`, `nc`, `git clone`, `git fetch`, `git pull`, `pip download`, `cargo vendor`, `cargo download`, `npm install`/`npm i`/`npm ci`, `go get` or `composer install`, unless the URL is allowed and lockdown is off |
| `deny.paths` | no, `[]` | Prefixes. `~` expands to the home directory; a relative entry is repo-relative. A target under one is denied for every tool |
| `deny.pathPatterns` | no, `[]` | `{ id, pattern, flags?, shouldMatch, shouldNotMatch }`, a regular expression over the resolved absolute path |
| `deny.words` | no, `[]` | Case-insensitive substrings. A target path, Glob or Grep pattern that contains one is denied unless it is under `allow.paths`; a read-family Bash command whose path-like arguments, or non-path arguments, contain one is denied by the same rule |
| `deny.commandPatterns` | no, `[]` | Same shape as `pathPatterns`, over each top-level Bash segment |
| `allow.paths` | no, `[]` | Prefixes exempt from `deny.words` (the project's own tree). Never exempt from `deny.paths` or `pathPatterns` |
| `allow.urls` | no, `[]` | Exact URLs allowed for `WebFetch`, `curl` and `wget` until lockdown |
| `lockdown.after` | no | A task id. Once that task is `[x]` in `PROGRESS.md`, or when no open task remains, `allow.urls` is treated as empty. Absent means no lockdown |
| `protected` | no, `[]` | Extra prefixes that no write tool or write-family Bash command may touch, in addition to the always-protected set |

### What the guard decides

Every path (`file_path`, `path`, `notebook_path`, a path-like Bash token) is expanded, made absolute against the call's working directory, normalized, and resolved through symlinks; both forms are checked. A Bash command is split into top-level segments on unquoted `;`, `&&`, `||`, `|`, `&` and newlines, and each segment's command word is the first token that is not an assignment or a wrapper (`sudo`, `env`, `time`, `command`, `xargs`, `nice`). The first rule that matches denies:

1. `deny.tools`.
2. `WebSearch` under `deny.network`.
3. `WebFetch`: denied during lockdown, allowed when the URL is in `allow.urls`, denied otherwise.
4. Write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) whose target is protected.
5. `Read`, `Glob`, `Grep` and the write tools: a target under `deny.paths` or matching a `pathPatterns` entry, or containing a `deny.words` entry outside `allow.paths`.
6. Bash, per segment: a network command; a token under `deny.paths` or matching a pattern; for read-family commands (`cat`, `grep`, `find`, `sed`, `ls` and the rest of the fixed list) a denied word in a path-like argument outside `allow.paths`, or in a non-path argument while a path lies outside the repository; for write-family commands (`cp`, `mv`, `rm`, `tee`, `sed`, `git` and the rest) or a `>` / `>>` redirection, a protected target, and `git config core.hooksPath`; a `commandPatterns` match.
7. Everything else, `Agent`, `Task`, `Skill` and every `mcp__` tool included, is allowed.

A denial writes `kukulu clean-room guard: <reason>` to the model on stderr and appends a `denied` entry to the log. The guard fails closed: any exception ends in a denial with the reason `guard internal error: <message>`.

### What is always protected

The policy file; `.kukulu/cleanroom/`; `.kukulu/state.json`; `docs/kukulu.json` from the moment `docs/PLAN.md` exists (the planner writes it before that); `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/`; `.mcp.json`; the installed plugin and `~/.claude/plugins/`; `~/.claude/settings.json`; the signing key and its `.pub`; and `.git/hooks/`, `.git/config` and `.git/info/`. The policy, the settings and `.mcp.json` can be read; the signing key cannot.

### Testing a policy

`node scripts/cleanroom-guard.mjs --self-test docs/cleanroom.json` loads the policy, runs the plugin's fixture cases (every rule, allow and deny, including calls recorded from a real clean-room build) and one case per fixture line of the policy's own patterns, then prints `guard self-test: ok (<n> cases)` or one line per failure. It never writes the project's log.

## The log

`.kukulu/cleanroom/log.jsonl` has one JSON object per line, with these keys in exactly this order:

| Key | Value |
|---|---|
| `seq` | 1-based, dense |
| `prev` | the previous entry's `hash`; 64 zeros for `seq` 1 |
| `at` | UTC ISO-8601 with milliseconds |
| `kind` | `genesis`, `allowed`, `denied`, `human`, `gate`, `checkpoint`, `score`, `attest` or `resume` |
| `stage` | `plan`, `implement`, `fix`, `review`, `summarize`, `controller` or `null` |
| `task` | the first in-progress task, else `null` |
| `role` | the agent type, `session` for the main session, `operator` for a person |
| `model`, `session` | from the hook payload, else `null` |
| `tool`, `target` | the tool and what it acted on (a path, a URL, the Bash command cut to 4,000 characters), or `null` |
| `decision`, `reason` | `allowed` or `denied` and why, else `null` |
| `data` | present only on entries that carry a body |
| `hash` | SHA-256 of `prev`, a newline, and the entry without `hash` as compact JSON with the keys in this order |

Every writer takes a directory lock on the log, so parallel streams, the hooks and the server cannot fork the chain. The log lives in the repository and is committed by the checkpoint of each bookkeeping tool; the hooks append between commits, so an uncommitted log is normal and never makes the tree dirty.

### Checkpoints and the key

The key is an Ed25519 key pair. `kukulu_run_start` creates the private key (PEM, mode 0600, at `cleanroom.signingKey` or `~/.config/kukulu/cleanroom/ed25519.pem`; `KUKULU_CLEANROOM_KEY` wins) and a `.pub` beside it. Its fingerprint is `sha256:` over the public key's DER.

A checkpoint is an entry of kind `checkpoint` whose `data` holds `chainTip`, `git` (the commit it was written at), `policyHash`, `guardHash`, `loggerHash`, `hooksHash`, `keyFingerprint`, `event` and a base64 `signature` over those fields. `kukulu_run_start`, `kukulu_task_done`, `kukulu_task_block`, `kukulu_run_finish`, `kukulu_review_submit`, `kukulu_summary_commit` and `kukulu_flight_archive` each write one before their final commit, and commit the log with their own files. Every commit the server makes in clean-room mode ends with `Kukulu-Stage:` and `Kukulu-Task:` trailers.

## Genesis, sticky mode and the gate

The first `kukulu_next` of a flight with a policy appends the genesis entry (mode, the hashes of the policy, the guard, the logger and `hooks.json`, the plugin version, the key fingerprint, the base branch and the head) and records the same hashes in `state.json`. A project without a policy records itself as a general flight and writes no log.

The mode is sticky. A policy that appears after the flight started in general mode, one first seen after the plan exists, or one removed after genesis makes `kukulu_next` halt with "clean-room coverage is broken"; `kukulu_run_resume` cannot clear it, so archive the flight and start another.

Before a stage starts, `kukulu_next` (always, once the flight has a genesis) and `kukulu_run_start`, `kukulu_task_next`, `kukulu_review_submit` and `kukulu_summary_commit` (before any write) run the gate:

1. **mode**: the policy file exists and the flight was not recorded as general.
2. **policy**: the file's SHA-256 is the one recorded at genesis.
3. **guard**: the two hook scripts and `hooks.json` are byte-identical to the recorded ones, and `hooks.json` still registers them.
4. **self-test**: `--self-test` on the policy passes.
5. **lockdown**: once the lockdown task is done, a `WebFetch` of an allowed URL is denied.
6. **chain**: every hash recomputes, the first entry is the genesis, and the newest checkpoint verifies with the signing key.
7. **liveness**: at least one `allowed` entry has been logged since the last gate; otherwise the hooks are not running in this session and you must start a new one.

A failing gate appends its own entry first, so the refusal is in the chain, and then halts the flight. `/kukulu:go-flight` prints `gate: ok (7 checks)` or the halt.

## Recording what you did

`/kukulu:go-flight` maps three phrasings to `kukulu_cleanroom_record`, which appends a `human` entry and commits the log as `chore: clean-room record`:

- `record: <text>` for an instruction;
- `record intervention: <text>` for something done outside the pipeline, such as a file supplied, a fix made by hand or a tool installed;
- `record verdict: #<seq>: prior-art attempt|false positive|offline test — <note>` for a classification of a denied entry, whose seq must be a denial in the log.

Every prompt typed into a session, and every `kukulu_flight_options`, `kukulu_run_resume` and re-signing `kukulu_pr_finalize`, is logged as a `human` entry too.

## Known gaps

The guard sees tool calls, not what a command does. Interpreter escapes (`python3 -c`, `node -e`) are not parsed; the subprocesses of a `make` target are not individual tool calls; the insides of an MCP server are not tool calls; and hooks load at session start, so a session that writes the policy is not covered until the next one. Each is a limit of the method, not a bug.
