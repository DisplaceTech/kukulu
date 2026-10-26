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
| `deny.network` | no, `true` | Deny `WebFetch` not in `allow.urls`, `WebSearch`, and Bash segments whose command word is `curl`, `wget`, `gh`, `ssh`, `scp`, `nc`, `git clone`, `git fetch`, `git pull`, `pip download`, `cargo vendor`, `cargo download`, `npm install`/`npm i`/`npm ci`, `go get` or `composer install`, and an `rsync` with a remote operand (`host:path`, `user@host:path` or `rsync://...`), unless the URL is allowed and lockdown is off |
| `deny.paths` | no, `[]` | Prefixes. `~` expands to the home directory; a relative entry is repo-relative. A target under one is denied for every tool |
| `deny.pathPatterns` | no, `[]` | `{ id, pattern, flags?, shouldMatch, shouldNotMatch }`, a regular expression over the resolved absolute path |
| `deny.words` | no, `[]` | Case-insensitive substrings. A target path, Glob or Grep pattern that contains one is denied unless it is under `allow.paths`; a read-family Bash command with an operand that contains one is denied by the same rule, with or without a `/` (`cat zlib.txt` like `cat ./zlib.txt`), except a pattern, script or program operand, which is text |
| `deny.commandPatterns` | no, `[]` | Same shape as `pathPatterns`, over each top-level Bash segment |
| `allow.paths` | no, `[]` | Prefixes exempt from `deny.words` (the project's own tree). Never exempt from `deny.paths` or `pathPatterns` |
| `allow.urls` | no, `[]` | Exact URLs allowed for `WebFetch`, `curl` and `wget` until lockdown |
| `lockdown.after` | no | A task id. Once that task is `[x]` in `PROGRESS.md`, or when no open task remains, `allow.urls` is treated as empty. Absent means no lockdown |
| `runners.allow` | no, any runner | Non-empty array of runner names. A role resolving to a runner not in the list fails gate check 8 |
| `runners.locality` | no, `"any"` | `"local"` or `"any"`. `"local"` fails gate check 8 for any role whose runner is not `local` |
| `roles.distinct` | no, `"none"` | `"none"`, `"model"` or `"family"`: how far apart the implementer's and reviewer's models must be. `family` compares `familyOf` of the normalized model strings |
| `mode` | no, `"clean-room"` | `"clean-room"` or `"control-positive"`. A control flight is given the prior art on purpose; its bundle can never pass as a clean-room one (see [Control mode](#control-mode)) |
| `control.priorArt` | with `mode` `"control-positive"` only | Non-empty array of prefixes, resolved like `deny.paths`. Refused in clean-room mode, required in control mode |
| `enforcement` | no, `"hook"` | `"hook"` or `"container+proxy"`: the level the flight must run under. `"container+proxy+audit"` is refused as the next release's level |
| `sandbox.image` | with `container+proxy` only | `<name>@sha256:<64 hex>`. Required under `container+proxy`, refused under `hook`; a tag alone is refused. The all-zero digest in `templates/cleanroom.local-only.example.json` is a placeholder that `doctor` replaces |
| `sandbox.mounts` | no, `[]` | `{ path, mode }` with `mode` exactly `"ro"`; the project is the only read-write mount |
| `sandbox.egress` | no, `[]` | `host:port` strings the proxy allows besides the flight's runner endpoints, until lockdown |
| `deny.packages` | no, `{}` | Prior-art package names per ecosystem (`cargo`, `npm`, `pypi`), each a non-empty array |
| `protected` | no, `[]` | Extra prefixes that no write tool or write-family Bash command may touch, in addition to the always-protected set |

### What the guard decides

The guard is a tripwire, not a sandbox. It judges a command by its text, so its wrapper and option parsing is best-effort. That covers the wrapper list, the options that take a value for wrappers and write-family commands, bundled short options, abbreviated long options, and operands that come after options. It follows the GNU coreutils, findutils and sudo on the CI images, and BSD/macOS forms where their manual pages differ. Neither the wrapper list nor the option tables can be proved complete across tool versions, so a spelling they do not model is a known gap, not a defect. What makes a bypass visible afterwards is [the chain](#the-log), [the signed checkpoints](#checkpoints-and-the-key) and [the gate](#genesis-sticky-mode-and-the-gate), not the guard.

Every path (`file_path`, `path`, `notebook_path`, a path-like Bash token) is expanded, made absolute against the call's working directory, normalized, and resolved through symlinks; both forms are checked. A Bash command is split into top-level segments on unquoted `;`, `&&`, `||`, `|`, `&` and newlines, and each segment's command word is the first token that is not an assignment or a wrapper (`sudo`, `env`, `time`, `command`, `xargs`, `nice`). The first rule that matches denies:

1. `deny.tools`.
2. `WebSearch` under `deny.network`.
3. `WebFetch`: denied during lockdown, allowed when the URL is in `allow.urls`, denied otherwise.
4. Write tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) whose target is protected.
5. `Read`, `Glob`, `Grep` and the write tools: a target under `deny.paths` or matching a `pathPatterns` entry, or containing a `deny.words` entry outside `allow.paths`.
6. Bash, per segment (leading `(`, `{`, `!` and the reserved words `if then elif else while until do` are dropped before the command word, `exec nohup timeout stdbuf setsid` are skipped like the other wrappers, a `cd` inside a subshell ends at its `)`, a bare `cd` or `cd --` moves to HOME and `cd -` back to the directory before the last `cd`, the values of the valued options of `sudo`, `env`, `timeout`, `nice`, `xargs`, `stdbuf` and `time` (short and long, such as `sudo -u|--user`, `env -u|-C|--unset|--chdir`, `timeout -s|-k|--signal|--kill-after`, `nice -n|--adjustment`, `xargs -n|-I|-P|-a` and their long forms (plus `--process-slot-var` and BSD `-J|-R|-S`), `stdbuf -o|--output`, `time -o|-f`) are skipped with their flags (option tokens are scanned like getopt: a bundle such as `sudo -iu root` or `xargs -tn 1` is read letter by letter, the first valued letter taking the rest of the token or the next token, `--name=value` is one token, and a long option may be abbreviated to any prefix that names exactly one valued option, such as `sudo --us root`; `xargs -i|-l|-e` and `--replace|--max-lines|--eof` take an optional argument that is only ever attached, so the next token is the command; `sudo -R|--chroot|-T|--command-timeout` and BSD `env -P` are valued; in `env -S` a `\_` separates words, and inside double quotes a backslash stays unless it precedes `$`, a backtick, `"`, `\` or a newline), except `env -S|--split-string` (also in a bundle such as `-vS`, attached, or abbreviated), whose value is split into words that are parsed as further arguments of env, options included, and then start the command, a function header (`f()`, `function f`, with or without a space before `{`), `case <word> in`, a case arm's `pattern)` or `(pattern)` (with or without a space after it) and `esac` are dropped so the commands inside are judged, `>|` is a redirection, and a git `-C dir` moves the operands after the subcommand; a `cd` or `pushd` segment is judged like any other, and the directory it moves to is the base for every later relative token and for the outside-the-repository clause): a network command (git's global options such as `-C dir` and `-c k=v` are skipped before the subcommand is matched); `$HOME` and `${HOME}` expand like `~`; the bodies of `$(...)`, backticks and `<(...)`, the string of `sh|bash|zsh -c` and the argument of `eval` are judged as further commands; a token under `deny.paths` or matching a pattern (every non-option operand of `cd`/`pushd` and of a read-family command that is not a pattern counts as a path here, with or without a `/`, resolved against the directory an earlier `cd` moved to), a glob token (or a bare operand of `cd`, `pushd` or a read-family command, such as `cd r*` or `head -n 5 r*`, or any such operand after a `cd` into a glob such as `cd ~/.carg?`) whose wildcard components match a `deny.paths` entry, and the operand (default `.`) of a recursive form (`grep -r`, `rg`, `ag`, `ack`, `find`, `ls -R`, `tree`, `cp -r`, `tar` (also `bsdtar` and `gtar`), `rsync`) that equals or contains one; for read-family commands (`cat`, `grep`, `find`, `sed`, `ls` and the rest of the fixed list) a denied word in any operand outside `allow.paths`, with or without a `/` (`cat zlib.txt` is judged like `cat ./zlib.txt`; the pattern of grep/rg/ag/ack, the script of sed, the program of awk and the value of find's `-name`/`-path`/`-regex` are text, not paths, and only the outside-the-repository clause judges them), or in a non-path argument while a path lies outside the repository; for write-family commands (`cp`, `mv`, `rm`, `tee`, `sed`, `git` (except the pathspecs of `add`, `commit`, `diff`, `status`, `log`, `show`, `blame`, `ls-files` and `grep`, which write only `.git/` or nothing; `--output` of `diff`, `log` and `show` is still a target) and the rest) or a `>` / `>>` redirection, with braces expanded first (`rm -rf {docs,src}` is `rm -rf docs src`), a protected target, or an operand or target whose wildcard (`*`, `?`, `[..]`, matched component by component; a leading wildcard does not match a dotfile) can name a protected path or one under it (`cp x docs/cleanroom.js??`, `echo x > .kukulu/*/log.jsonl`) (for `cp`, `mv`, `ln` and `install` the path each source lands at, `<destination directory>/<basename>`, is judged too (with `-T`/`--no-target-directory`, read from a bundle such as `-rT` or by unique prefix such as `--no-t`, the last operand is the destination itself and every source stands for it; `cp --recursive` and `--archive` are likewise read by unique prefix, such as `--rec` and `--arch`; for `cp` every long option is resolved against cp's own list, so `--o` is `--one-file-system` and takes no value, and only `--target-directory`, `--suffix`, `--sparse` and `--no-preserve` take one (`mv`, `ln` and `install` resolve their long options against their own full lists too, so install's own `--strip` is a flag and not an abbreviation of `--strip-program`, and an unresolved or ambiguous prefix such as `install --stri` takes no value; `mv` and `ln` read `-t -S` and the first two; `install` reads `-g -m -o -S -t` and `--group --mode --owner --suffix --target-directory --strip-program`, and since `-S` is a suffix in GNU install but a flag in BSD install, both readings are judged and either one writing a protected path denies, naming the destination directory of the reading that did); `-T` is read from the letters before a valued letter, as in `-rTS .bak`), the destination being the `-t`/`--target-directory` value (read by the same getopt-style scanner: `-vt docs`, `-tdocs`, `--target=docs`, `--target docs`) or the last operand, and only a source whose basename is `.` or `..` standing for the destination itself, so `cp -r src/ .` is allowed, and a recursive `cp` whose destination equals or contains a protected path is denied; `rsync` is judged like `cp`: its last operand is the destination, each source lands at `<destination>/<basename>` (a source ending in `/`, or `.`, stands for the destination), and a recursive `rsync` (`-r`, `-a`, in a bundle such as `-av`) whose destination equals or contains a protected path is denied, a call with `--delete`, `--del` or `--delete-*` is denied when its destination equals or contains a protected path, recursive or not, and `--remove-source-files` makes each source a write target, while its sources are otherwise only read; a `tar` (also `bsdtar` and `gtar`) extraction (`-x`, `--extract`, `--get`, `x` in a bundle or an old-style first argument) is denied when its directory (`-C` or `--directory`, else the current directory after an earlier `cd`) equals, contains or lies under a protected path, because the archive's contents cannot be known, so an extraction at the repository root is denied too; `tar` create, append and update (`c`, `r`, `u`) deny a protected `-f` archive file, and listing writes nothing; every non-option operand counts as a path, a redirection glued to the word before it counts, and a relative operand resolves against the directory an earlier `cd` or `pushd` of the same command moved to), a destructive form (`rm`, the source of `mv`, recursive `chmod` or `chown`, `git rm`, `mv`, `checkout`, `restore`, `clean`) whose operand contains a protected path (`rm -rf .kukulu`, `mv docs docs2`), and `git config core.hooksPath`; a glob operand of a destructive form whose wildcard component matches the next component of a protected path below it (`rm -rf docs/*`, `rm -rf *`); `chmod` or `chown` of a path that equals or contains a protected path, recursive or not; and a git form that restores the worktree to the last commit and so erases the log's uncommitted entries (`git stash` except `list`/`show`/`apply`/`pop`, `git reset --hard|--merge|--keep`, `git checkout -f`, `git switch -f|--discard-changes`, `git read-tree -u` with `--reset` or `-m`; a bare-option `git stash -m msg` is a push, since the message is not a subcommand) unless every pathspec lies outside the protected paths; a `commandPatterns` match.
7. Everything else, `Agent`, `Task`, `Skill` and every `mcp__` tool included, is allowed.

A denial writes `kukulu clean-room guard: <reason>` to the model on stderr and appends a `denied` entry to the log. The guard fails closed: any exception ends in a denial with the reason `guard internal error: <message>`.

### What is always protected

The policy file; `.kukulu/cleanroom/`; `.kukulu/state.json`; `docs/kukulu.json` from the moment `docs/PLAN.md` exists (the planner writes it before that); `.claude/settings.json`, `.claude/settings.local.json`, `.claude/hooks/`; `.mcp.json`; the installed plugin and `~/.claude/plugins/`; `~/.claude/settings.json`; the signing key and its `.pub`; and `.git/hooks/`, `.git/config` and `.git/info/`. The policy, the settings and `.mcp.json` can be read; the signing key cannot.

### When a guard gap is a defect

A review finding against the guard becomes a fix task only when:

- it is a regression: a form denied at an earlier commit of the flight is allowed now;
- it writes a protected path, or reads under `deny.paths`, with a command word and option spelling these rules or the fixture set already name; or
- a rule above is missing for a whole command word it lists.

Any other unmodelled spelling is a review note, not a task. The reviewer lists its class under `Known-gap candidates` in REVIEW.md's `## Spec issues`; the summary carries it, and the owner decides whether a later release adds it to the known gaps.

### Testing a policy

`node scripts/cleanroom-guard.mjs --self-test docs/cleanroom.json` loads the policy, runs the plugin's fixture cases (every rule, allow and deny, including calls recorded from a real clean-room build) and one case per fixture line of the policy's own patterns, then prints `guard self-test: ok (<n> cases)` or one line per failure. It never writes the project's log.

## Control mode

A positive-control flight (`"mode": "control-positive"`) is the same flight with the prior art handed over, so its score is the high end of the scale a real clean-room score is read against. In the guard:

- **What stays the same.** The protected set, every write rule, `deny.tools`, the network rules and `commandPatterns` apply exactly as in a clean-room flight, and a write to a prior-art path is still denied by `deny.paths`.
- **What differs.** A read-family tool or a path-like Bash read operand that equals or lies under a `control.priorArt` path is exempt from `deny.paths`, `deny.pathPatterns` and `deny.words`. In clean-room mode the list is empty and nothing changes.

- **The record.** The genesis entry's `mode` is `control-positive` and its `control.priorArt` repeats the policy's list; the manifest's `mode` equals it. Gate check 1 (`mode`) passes a control flight.
- **The verdict.** The offline verifier never reports a control bundle as a clean-room pass. A passing control bundle prints `verify-attestation: CONTROL (positive)` as its last line and exits 3. `--expect control-positive` says the caller wants a control bundle, and then the same bundle prints `PASS` and exits 0; `--expect clean-room` makes a control bundle fail check 7 (`mode: the bundle is control-positive, expected clean-room`). `kukulu_attest` runs its own verifier with `--expect` set to the genesis's mode, so a control bundle's own check exits 0.

## The log

`.kukulu/cleanroom/log.jsonl` has one JSON object per line, with these keys in exactly this order:

| Key | Value |
|---|---|
| `seq` | 1-based, dense |
| `prev` | the previous entry's `hash`; 64 zeros for `seq` 1 |
| `at` | UTC ISO-8601 with milliseconds |
| `kind` | `genesis`, `allowed`, `denied`, `human`, `gate`, `checkpoint`, `score`, `attest`, `resume`, `egress`, `stage` or `usage` (the last three are recorded by the sandbox's proxy, `kukulu_next` and the subagent hook respectively) |
| `stage` | `plan`, `implement`, `fix`, `review`, `summarize`, `controller` or `null` |
| `task` | the first in-progress task, else `null` |
| `role` | the agent type, `session` for the main session, `operator` for a person |
| `model`, `session` | from the hook payload, else `null` |
| `tool`, `target` | the tool and what it acted on (a path, a URL, the Bash command cut to 4,000 characters), or `null` |
| `decision`, `reason` | `allowed` or `denied` and why, else `null` |
| `data` | present only on entries that carry a body |
| `hash` | SHA-256 of `prev`, a newline, and the entry without `hash` as compact JSON with the keys in this order |

An `egress` entry is written by the sandbox's proxy, not by a hook: `tool` is `null`, `target` is `host:port`, `decision` is `allowed` or `denied`, `reason` says why, and an allowed connection carries `data: { bytesUp, bytesDown, ms }` once it closes. See [sandbox.md](./sandbox.md#egress).

An entry reported from inside the sandbox's boundary, through the log socket, carries `data.source: "box"`; entries appended by the hooks directly carry no `source`.

Every writer takes a directory lock on the log, so parallel streams, the hooks and the server cannot fork the chain. The log lives in the repository and is committed by the checkpoint of each bookkeeping tool; the hooks append between commits, so an uncommitted log is normal and never makes the tree dirty.

### Checkpoints and the key

The key is an Ed25519 key pair. `kukulu_run_start` creates the private key (PEM, mode 0600, at `cleanroom.signingKey` or `~/.config/kukulu/cleanroom/ed25519.pem`; `KUKULU_CLEANROOM_KEY` wins) and a `.pub` beside it. Its fingerprint is `sha256:` over the public key's DER.

A checkpoint is an entry of kind `checkpoint` whose `data` holds `chainTip`, `git` (the commit it was written at), `policyHash`, `guardHash`, `loggerHash`, `hooksHash`, `keyFingerprint`, `event` and a base64 `signature` over those fields. `kukulu_run_start`, `kukulu_task_done`, `kukulu_task_block`, `kukulu_run_finish`, `kukulu_review_submit`, `kukulu_summary_commit` and `kukulu_flight_archive` each write one before their final commit, and commit the log with their own files. Every commit the server makes in clean-room mode ends with `Kukulu-Stage:` and `Kukulu-Task:` trailers.

## Genesis, sticky mode and the gate

The first `kukulu_next` of a flight with a policy appends the genesis entry (mode, the hashes of the policy, the guard, the logger, `hooks.json` and `mcp/cleanroom.mjs`, the plugin version, the key fingerprint, the base branch and the head, then `roles`, each role's model, runner, endpoint, locality, identity source and family, `distinct`, the policy's `roles.distinct`, `enforcement`, and under `container+proxy` the `boundary`: the engine, the container's image id, its network mode and its mounts with each one's `rw`) and records the same hashes in `state.json`. A project without a policy records itself as a general flight and writes no log.

The mode is sticky. A policy that appears after the flight started in general mode, one first seen after the plan exists, or one removed after genesis makes `kukulu_next` halt with "clean-room coverage is broken"; `kukulu_run_resume` cannot clear it, so archive the flight and start another.

Before a stage starts, `kukulu_next` (always, once the flight has a genesis) and `kukulu_run_start`, `kukulu_task_next`, `kukulu_review_submit` and `kukulu_summary_commit` (before any write) run the gate:

1. **mode**: the policy file exists and the flight was not recorded as general.
2. **policy**: the file's SHA-256 is the one recorded at genesis.
3. **guard**: the two hook scripts, `hooks.json` and `mcp/cleanroom.mjs` (the module the guard decides with) are byte-identical to the recorded ones, and `hooks.json` still registers the scripts. A flight that began on 0.7.0 recorded no hash for `mcp/cleanroom.mjs`: that one comparison is skipped and the passing gate entry carries `unpinned: ["mcp/cleanroom.mjs"]`.
4. **self-test**: `--self-test` on the policy passes.
5. **lockdown**: once the lockdown task is done, a `WebFetch` of an allowed URL is denied.
6. **chain**: every hash recomputes, the first entry is the genesis, and the newest checkpoint verifies with the signing key.
7. **liveness**: at least one `allowed` entry has been logged since the last gate; otherwise the hooks are not running in this session and you must start a new one.
8. **routing**: in this order, the first failing part stops it. (1) Every role's resolved `model` and `runner` equal the ones genesis recorded (skipped for a flight whose genesis has no `roles`). (2) With `runners.allow`, every role's runner is in the list. (3) With `runners.locality` `"local"`, every role's locality is `local`. (4) With `roles.distinct` `"model"` or `"family"`, the implementer and the reviewer differ in normalized model or in family. Genesis runs parts 2 to 4 before it writes anything and refuses with `clean-room genesis refused: routing: <reason>`.
9. **boundary** (only when the policy's `enforcement` is `container+proxy`): the server is behind a sandbox (`KUKULU_SANDBOX` is set); `<engine> inspect` reports the container running with the policy's pinned image id and network `none`; the only writable mounts are the project, the home volume and the socket directory; every required read-only mount (the policy file, `.kukulu`, `.claude`, `.git/config`, `.git/hooks`, `.git/info`, `docs/SPEC.md`, the plugin root, each `sandbox.mounts` and `control.priorArt` path) is present; the engine, image, network and mounts equal what genesis recorded; and every `egress` entry after genesis whose decision is `allowed` names a runner endpoint, a `sandbox.egress` entry or an `allow.urls` host (lockdown is ignored: the audit asks whether the proxy could ever have allowed it). Genesis runs the first parts before it writes anything and refuses with `clean-room genesis refused: boundary: <reason>`. A passing gate entry then records `container`, the container's id.

A failing gate appends its own entry first, so the refusal is in the chain, and then halts the flight. `/kukulu:go-flight` prints `gate: ok (8 checks)` (9 under `container+proxy`) or the halt.

## Recording what you did

`/kukulu:go-flight` maps three phrasings to `kukulu_cleanroom_record`, which appends a `human` entry and commits the log as `chore: clean-room record`:

- `record: <text>` for an instruction;
- `record intervention: <text>` for something done outside the pipeline, such as a file supplied, a fix made by hand or a tool installed;
- `record verdict: #<seq>: prior-art attempt|false positive|offline test — <note>` for a classification of a denied entry, whose seq must be a denial in the log.

Every prompt typed into a session, and every `kukulu_flight_options`, `kukulu_run_resume` and re-signing `kukulu_pr_finalize`, is logged as a `human` entry too.

## Reading a bundle

`kukulu_attest` writes `docs/attestation/` at the end of a clean-room flight, after the summary (and the contamination score, when configured) and before the archive moves the flight. Everything in it is a plain file, and a person with only Node can check it. `manifest.json` is the index; the other files are the evidence it names.

| File | What it is |
|---|---|
| `manifest.json`, `manifest.sig` | the index, and a base64 Ed25519 signature over its exact bytes |
| `publisher.pub` | the public key that signed the manifest and every checkpoint |
| `log.jsonl` | the whole chain, as it stood when the bundle was made |
| `policy.json` | the policy in force at the end |
| `similarity.json` | the contamination score, when one was run |
| `SUMMARY.md`, `REVIEW.md`, `PROGRESS.md`, `kukulu.json`, `state.json` | the flight's documents and configuration |
| `commits.txt` | one line per commit since the base: sha, signature code (`%G?`), subject, `Kukulu-Stage` and `Kukulu-Task`, separated by U+001F |
| `evidence/<path>` | any extra files the operator named, at their own paths |
| `verify.mjs` | a byte copy of `scripts/verify-attestation.mjs` |

The bundle's `SUMMARY.md` is the summary as attested; the Attestation section added afterwards cites the manifest's SHA-256 and lives only in the repository's copy.

The manifest's fields, in the order it writes them:

- `version` (1), `flight`, `mode` (`clean-room`) and `at`.
- `plugin`: the plugin `version` and the hashes of the guard, the logger, `hooks.json`, `mcp/cleanroom.mjs` (`cleanroomHash`) and the verifier. The verifier compares `plugin.cleanroomHash` with the genesis entry's; a bundle from 0.7.0 has neither, and it verifies with the note `plugin.cleanroomHash absent (bundle from 0.7.0 or earlier)` (or `genesis has no cleanroomHash (flight started on 0.7.0 or earlier); plugin.cleanroomHash not compared`).
- `repo`: `baseBranch`, `base`, `head` and `branch`.
- `enforcement`: `{ level }`, the level from the genesis (`hook` when a 0.7.x genesis records none); under `container+proxy` also `boundary`, the genesis's, and `egress`, an object keyed by `host:port` with `{ allowed, denied }` counts from the `egress` entries.
- `genesis`: the first log entry, repeated.
- `roles`: each role's `model`, `runner`, `endpoint`, `locality`, `identity` and `family` from the genesis entry, each with `assurance`: `"configuration"` (the roles are what the routing said, not what a runner reported or the proxy saw) or, under `container+proxy`, `"egress"` (the proxy also saw the traffic to the runner), or `null` for a flight that began on 0.7.x, whose genesis has no `roles`.
- `policy`: its `path`, every distinct `hashes` value seen in the checkpoints in order, and the `current` one.
- `chain`: the number of `entries`, the `first` hash and the `tip`.
- `checkpoints`: each one's `seq`, `event`, `git`, `signature` and whether it verifies (`ok`).
- `denials`: the `total`, the count `byReason`, and the `verdicts` you recorded (`prior-art attempt`, `false positive`, `offline test`, and `unclassified` for the rest).
- `calls`: the `total`, counts `byTool` and `byStage`, and how many could read something (`readCapable`: `Read`, `Glob`, `Grep`, `Bash`, `WebFetch`).
- `human`: how many instructions, interventions and verdicts you recorded; prompts count as instructions.
- `selfTest`: whether the guard's self-test passed when the bundle was made, with its case count.
- `coverage`: the `gaps`, the `knownLimits` and the `idleGapHours` used.
- `similarity`: the SHA-256 of `similarity.json`, or `null`.
- `files`: every file but `manifest.json`, `manifest.sig` and `verify.mjs`, each with its SHA-256 and size.
- `signer`: the key's `fingerprint` and the file that holds it.

**Coverage gaps** are the places where the log does not vouch for the work. They are recomputed by the verifier from `log.jsonl` and `commits.txt`, so a manifest cannot leave one out. Each is printed, and none is a failure:

- `silent-gates`: two gate entries with nothing logged between them, so the hooks may not have been running.
- `untrailed-commit`: a commit without a `Kukulu-Stage` trailer, which is work done outside the pipeline. The commits a base-branch sync merges in (`policies.syncBase`) carry no trailer either, so they are listed here; that is the honest record of work that came from outside the flight.
- `intervention`: a `human` entry you recorded as something done by hand.
- `idle`: two consecutive entries of one stage more than `cleanroom.idleGapHours` apart.
- `unsigned-commit`: a commit whose signature code is `N` (none) or `B` (bad).

`coverage.knownLimits` is the list under [Known gaps](#known-gaps) for the bundle's enforcement level: what no log of tool calls can show.

## Verifying offline

```text
node docs/attestation/verify.mjs docs/attestation --key sha256:<fingerprint> [--expect clean-room|control-positive] [--require-enforcement <level>]
```

`--key` is the signer's fingerprint, which you got from the publisher by some other route than the bundle (the bundle can carry any key it likes). Without it the bundle is only self-consistent, and the report says so with `verify-attestation: note: signer: self-consistent, fingerprint not checked against an out-of-band value`. `--json` prints the result as one object (`ok`, `mode`, `enforcement`, `reasons`, `notes`, `checks`) instead of text. `--expect` names the mode the bundle must have, and `--require-enforcement` the lowest enforcement level (`hook`, `container+proxy` or `container+proxy+audit`) it may have been built under. Exit status is 0 for a pass, 1 for a failure, 2 for a usage error and 3 for a passing control bundle (`CONTROL (positive)`, see [Control mode](#control-mode)) when `--expect control-positive` was not given. The verifier needs Node 22 or later, nothing else: no network, no git, no packages. The copy in the bundle and `scripts/verify-attestation.mjs` are the same file.

It runs eleven checks in order and reports every failure, not only the first:

1. `manifest`: `manifest.json` parses, its `version` is 1, and every listed file exists with the listed SHA-256 and size.
2. `signature`: `manifest.sig` verifies over `manifest.json` with `publisher.pub`, and the key's fingerprint is the one you asked for.
3. `chain`: the log's sequence numbers are dense, each `prev` is the previous hash, every hash recomputes, and the manifest's count, first hash and tip match.
4. `checkpoints`: every checkpoint verifies with `publisher.pub`, those the manifest names exist with that signature, and the genesis equals `manifest.genesis`.
5. `policy`: every checkpoint's policy hash is in `policy.hashes`, `policy.json` hashes to `policy.current`, and a change of policy between checkpoints is reported as `policy changed at seq <n>` (a note, not a failure).
6. `guard`: every checkpoint saw the guard, logger and hooks that the manifest names.
7. `mode`: the genesis records `clean-room` or `control-positive`, the manifest's `mode` equals it, no gate failed the mode check, and with `--expect` the mode is the expected one.
8. `denials`: the denial and verdict counts, recounted from the log.
9. `coverage`: the gaps, recomputed and printed.
10. `similarity`: `similarity.json` hashes to the manifest's value, when there is one.
11. `enforcement`: the manifest's level is `hook`, `container+proxy` or `container+proxy+audit`; under `container+proxy` the genesis has a `boundary` and the manifest's equals it, the `egress` summary equals a recount from the log's `egress` entries, and no gate failed the boundary check; and `coverage.knownLimits` is the list for the level. With `--require-enforcement <level>`, a bundle built below that level fails with `enforcement: the bundle was built under <level>, below the required <level>`. A manifest with no `enforcement` field, as every 0.7.x bundle, reads as `hook` with the note `enforcement absent (bundle from 0.7.x); read as hook`.

A passing bundle prints its notes and then one line:

```text
verify-attestation: note: coverage gap: {"kind":"unsigned-commit","sha":"4d922369b48a4587da974db1d3758521e2f1ffe8"}
verify-attestation: PASS
```

A failing one names the check, the entry or file, and what to do about it:

```text
verify-attestation: manifest: SUMMARY.md: the SHA-256 differs from the manifest's; the file was changed
verify-attestation: chain: entry 3 (line 3): the hash does not match the entry's content; the entry was edited
verify-attestation: FAIL (2 reasons)
```

A check that cannot run because an earlier one broke its input says `not checked` and why. A failing check never makes a later one pass.

### Logs from before 0.6.0

The tool log that earlier clean-room work kept has no hash chain and no signatures, so it cannot be verified, only read:

```text
node scripts/verify-attestation.mjs --legacy-log <file> --roots <a,b> --words <a,b> [--repo <path>] [--json]
```

It parses every line (a line it cannot parse is counted and named, never dropped, and the exit status is 1), then prints the calls by tool and stage, the denials with their reasons, the number of read-capable calls, and the forbidden-read candidates: a read-capable call with a path-like token under a root, or naming a word while outside `--repo`. There are no defaults: `--roots` and `--words` are the paths and names that belong to the project whose log you read, and leaving either out is a usage error. `--repo` defaults to the git repository the log file sits in, and is required when it sits in none. It always ends with `legacy log: no hash chain or signatures; integrity rests on the git history that holds it`, which is the honest limit: the log is only as good as the commits that hold it. For the 20-line excerpt of that build's log kept under `test/fixtures/`, read with the roots, words and repository root that build used:

```text
legacy log: test/fixtures/<excerpt>.jsonl
lines: 20 parsed, 0 failed
calls by tool: Bash 13, Write 2, Edit 1, ...
calls by stage: implement 20
denials: 1
  line 9 (2026-09-29T14:54:47.458Z) Bash: forbidden word in path argument: */libz-sys-*/src/lib.rs
read-capable calls: 13
forbidden-read candidates: 1
  line 9 (2026-09-29T14:54:47.458Z) Bash denied: */libz-sys-*/src/lib.rs (names libz-sys outside the repository)
legacy log: no hash chain or signatures; integrity rests on the git history that holds it
```

## Known gaps

The guard sees tool calls, not what a command does. Each of these is a limit of the method, not a bug. `coverage.knownLimits` in a bundle's manifest lists the texts that apply at the bundle's enforcement level, so the list is shorter under `container+proxy`:

| id | Limit | hook | container+proxy |
|---|---|---|---|
| `interpreter` | Interpreter escapes (`python3 -c`, `node -e`) are not parsed, so a path or word inside the quoted program is not seen. | yes | no |
| `expansion` | Shell expansion beyond `~` and `$HOME` is not evaluated: other variables, and strings assembled at run time (a base64 decode, a variable holding a command), so a path or command built that way is not seen. | yes | no |
| `spellings` | Option and wrapper spellings the tables do not model are not recognized: the guard judges a command by its text, its wrapper and option parsing follows GNU coreutils, findutils and sudo (and BSD/macOS forms where their manual pages differ), and no table can be proved complete across tool versions. | yes | no |
| `indirect` | Commands that run a command from their arguments (`find -exec`, `watch`, `parallel`, `busybox`) and programs outside the fixed network and write lists (`unlink`, `shred`, `perl -i`, `cargo fetch`) are not recognized. | yes | no |
| `patterns` | `pathPatterns` regexes are matched on the paths a call names, not on the files a recursive read or a glob reaches below a directory. | yes | no |
| `make` | Subprocesses of a `make` target are not individual tool calls, so what they read is not logged. | yes | no |
| `mcp` | MCP server internals are not tool calls, so what a server reads on its own is not logged. | yes | no |
| `session` | Hooks load at session start, so a session that writes the policy is not covered until the next one; the gate's liveness check catches a session with no hooks at all. | yes | yes |
| `training` | What a model learned in training is outside every boundary; the similarity score, not the log, measures it. | yes | yes |
| `packages` | Packages named in a lockfile are outside the claim; `deny.packages` and the gate keep named prior-art packages out of the lockfiles and the cache, and the manifest lists what the lockfiles name. | yes | yes |
| `config-writable` | Inside the boundary `docs/kukulu.json` stays writable, because the planner writes it; only the guard protects it after the plan exists. | no | yes |
| `tls` | The proxy sees host and port, not paths or content inside TLS; whatever an allowed host serves is reachable. | no | yes |
