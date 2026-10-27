# The sandbox

`node scripts/sandbox.mjs` runs the harness inside a container that has no network of its own, with the controller and the signing key outside it. This page grows with the tasks that build the launcher; today it describes the sockets.

## The sockets

The container reaches the outside through three Unix sockets, all in a runtime directory that is mounted into it. Nothing else crosses the boundary.

| Socket | Carries | Served by |
|---|---|---|
| `controller.sock` | The MCP protocol. The server process inside the container is only `mcp/relay.mjs`, which pipes its stdio to this socket; the real server runs outside, once per connection, with the project's `.kukulu/` and the signing key | `startControllerSocket` |
| `log.sock` | Log entries. The two clean-room hooks inside send each entry here instead of appending it; the entry is appended to the chain outside, with `data.source` set to `box` | `startLogSocket` |
| `proxy.sock` | HTTP `CONNECT` requests, through a loopback bridge, for the egress proxy | the proxy (added later) |

What an agent inside can do with them: call the same tools it would call without a sandbox, and have every tool call logged. What it cannot do: read the signing key, edit or truncate the log, change a clean-room hook (the policy, the hooks and `.kukulu/` are mounted read-only), or reach any host the proxy does not allow. A hook that cannot reach the log socket fails closed: the guard denies the call and the logger exits 1, both saying `the log socket is unreachable, so this call cannot be logged; restart the session with node scripts/sandbox.mjs run`.

## Egress

The container starts with `--network none`, so the only way out is `proxy.sock`. Inside, `scripts/sandbox-entry.mjs` listens on `127.0.0.1:3128` and forwards each connection to that socket; the harness gets `HTTPS_PROXY` and `HTTP_PROXY` pointing at it. The proxy accepts `CONNECT host:port` and absolute-form `http://` requests and nothing else (anything else gets `400`). It never intercepts TLS: a tunnel is opaque to it, which is a non-goal to change.

A request is allowed when its `host:port` is one of:

- a runner endpoint of any role (the reason is `runner endpoint <name>`; the port defaults to 443 for `https` and 80 for `http`). The model router runs inside the container, so the model requests are what the proxy sees and logs;
- an entry of `sandbox.egress`, or the host and port of an `allow.urls` entry, but only until lockdown (`lockdown.after` done). After lockdown they are denied with `lockdown is active`.

A literal IP address is denied (`literal IP addresses are not allowed`) unless one of those lists names that literal, so a name cannot be dodged by resolving it elsewhere. Everything else is denied with `not allowed by this flight's policy`. The proxy resolves names itself; the container has no resolver.

A denied request gets `HTTP/1.1 403 Forbidden`, `Content-Type: text/plain`, `Connection: close` and the body `kukulu egress: <host:port> is not allowed by this flight's policy`. Every decision becomes an `egress` entry in the chain (see [cleanroom.md](./cleanroom.md#the-log)): a denial at once, an allowed connection when it closes, with `data.bytesUp`, `data.bytesDown` and `data.ms`.

## Building the image

The sandbox runs a prebuilt image that the owner builds once and pins by digest in the policy (`sandbox.image`, as `<name>@sha256:<digest>`). The template is `templates/sandbox/Containerfile`: a Node base, `git` and `ca-certificates`, Claude Code, and a `kukulu` user. Nothing of the plugin is copied in; the plugin is mounted read-only at run time.

```text
docker build -t kukulu-sandbox --build-arg NODE_IMAGE=node:22-bookworm-slim --build-arg CLAUDE_CODE_VERSION=latest -f templates/sandbox/Containerfile templates/sandbox
docker image inspect --format '{{.Id}}' kukulu-sandbox
```

The `kukulu` user in the image has the uid of the build argument `KUKULU_UID` (default 1000, replacing the base image's `node` user), because the project is bind-mounted and the container can write it only as the user who owns it: pass `--build-arg KUKULU_UID=$(id -u)` when yours is not 1000.

Paste the second command's output into the policy as `"image": "kukulu-sandbox@<that id>"`. The all-zero digest in `templates/cleanroom.local-only.example.json` is a placeholder; `node scripts/sandbox.mjs doctor` prints the build command and the line to paste when the image is missing. An image that needs a model router derives from this one in two lines:

```text
FROM kukulu-sandbox
RUN npm install -g @musistudio/claude-code-router
```

(Use `USER root` before the install and `USER kukulu` after it if the installer needs it, then pin the new image the same way.)

## doctor

`node scripts/sandbox.mjs doctor [--engine docker|podman]` checks the setup and writes nothing. It picks the engine (the first of `docker`, `podman` whose `--version` works, or the one you name), loads the policy, asks the engine whether the pinned image exists, and reads each role's runner from the server. The output below was produced against the test fixtures (a fake `docker`), not a real engine:

```text
engine: docker (Docker version 27.0.0, build test)
image: kukulu-sandbox present (sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
mounts:
  /work/proj/docs/cleanroom.json (ro)
  /work/proj/.kukulu (ro)
  /work/proj/.claude (ro)
  /work/proj/.git/config (ro)
  /work/proj/.git/hooks (ro)
  /work/proj/.git/info (ro)
  /work/proj/docs/SPEC.md (ro)
  /opt/kukulu (ro)
  /work/proj/tools/oracle (ro)
  /work/proj (rw)
egress:
  pypi.org:443
  api.anthropic.com:443
runners:
  planner: opus on anthropic (https://api.anthropic.com, remote)
  implementer: sonnet on anthropic (https://api.anthropic.com, remote)
  reviewer: opus on anthropic (https://api.anthropic.com, remote)
  summarizer: opus on anthropic (https://api.anthropic.com, remote)
sandbox doctor: ok
```

It ends with `sandbox doctor: ok` (exit 0), or one `problem: <text>` line per problem and `sandbox doctor: <n> problem(s)` (exit 1).

## The mount list

The project is the only read-write mount. Everything else the container sees of the host is read-only, in this order:

| Path | Why it is read-only |
|---|---|
| the policy file | the rules cannot be edited from inside |
| `<root>/.kukulu` | the state and the chain's directory; the log is appended outside, over the log socket |
| `<root>/.claude` | the harness's own settings and hooks wiring |
| `<root>/.git/config`, `.git/hooks`, `.git/info` | a git config or hook is code that runs outside the boundary |
| `<root>/docs/SPEC.md` | the spec is the owner's |
| the plugin root | the hooks and the server cannot be edited from inside |
| each `sandbox.mounts` path | extra tools, such as a prebuilt oracle binary |
| each `control.priorArt` path | the prior art a control flight is given |

Two more mounts are not the project's: the runtime directory, which holds `hooks-empty/`, `run.json` and the three sockets and is mounted read-only at `/run/kukulu` (a socket connects through a read-only bind mount, so nothing in the box can plant a hook the host's git would run), and a named volume for the container's home, `kukulu-<id>-home`, so the harness's login and caches survive a restart without touching the host.

## Running a flight

1. `node scripts/sandbox.mjs doctor` until it says `sandbox doctor: ok`.
2. Commit the policy (with `"enforcement": "container+proxy"` and the pinned `sandbox.image`) on the base branch, as for any clean-room flight.
3. Put the git identity in the repository's own `.git/config` (`git config user.name`, `git config user.email`) before the flight. Inside the container there is no global git config, and the flight's commits need an author.
4. `node scripts/sandbox.mjs run [-- <harness arguments>]` starts the three listeners and the container in the foreground. Everything after `--` goes to the harness. It refuses, with nothing started, under hook enforcement, with no container engine, when the pinned image is not present (the image's id must equal the digest in the policy), when a mount source is missing on the host, and when a container for this project is already running. When the container exits, the listeners stop and `run` returns its exit status.
5. `node scripts/sandbox.mjs stop` stops the container and the `run` serving it.

The runtime directory is `$XDG_RUNTIME_DIR/kukulu/<id>/` (else `~/.cache/kukulu/run/<id>/`), mode 0700, with the three sockets, an empty `hooks-empty/` directory that git's hooks are pointed at, and `run.json` (`pid`, `name`, `startedAt`). `<id>` is the first 16 hex characters of the SHA-256 of the project's real path, so two checkouts never share a container.

A sandboxed flight is serial: the container is the one place work happens, so a parallel wave does not apply.

## macOS

The launcher refuses on macOS: its sockets and its mounts assume a Linux kernel. Run it inside a Linux machine that holds both the project and the checkpoint key (a Lima, OrbStack or colima machine), and drive the flight from there. Keeping the key in the machine, outside the container, is the point; do not mount the key into the container.

## What an agent inside can and cannot do

Can: read and write the project, run the tools the image carries, call every Kūkulu tool through the relay, and reach the runner endpoints the proxy allows. Cannot: reach any other host or any literal IP, read the signing key, change the policy, the plugin, `.kukulu/`, `.claude/`, `.git/config`, `.git/hooks` or `.git/info`, or append to the log except through the log socket. It is a boundary around the flight, not a proof of clean-room work: [cleanroom.md](./cleanroom.md#what-the-guard-decides) lists what is still only a tripwire.

## A worked local-only flight

Profile B: the Mac plans and reviews, the Spark implements. The global file `~/.config/kukulu/config.json` names both runners and routes the roles:

```json
{
  "runners": {
    "spark": { "endpoint": "http://spark.tailnet.ts.net:8000", "locality": "local", "match": ["spark/"] },
    "mac": { "endpoint": "http://mac.tailnet.ts.net:11434", "locality": "local", "match": ["mac/"] }
  },
  "roles": {
    "planner": { "model": "mac/qwen3.8-27b" },
    "implementer": { "model": "spark/nemotron-3.5-super-nvfp4" },
    "reviewer": { "model": "mac/qwen3.8-27b" },
    "summarizer": { "model": "mac/qwen3.8-27b" }
  }
}
```

The policy is `templates/cleanroom.local-only.example.json` with the image digest replaced by `doctor`'s line. `runners.locality: "local"` makes the gate refuse a role that resolves to a remote runner, `roles.distinct: "family"` makes it refuse an implementer and reviewer from one model family, and `enforcement: "container+proxy"` makes `run` the only way to start the flight. Run `doctor`, then `run`.

## What runs where

The server runs outside the container, with the key and the project's `.kukulu/`. Behind the sandbox:

- **Inside the container:** every `verify`, `extraVerify` and build command, and every `kukulu_mutate` run, through `<engine> exec -w <directory> <container> timeout -k 5 <seconds> sh -c <command>`. The `timeout` runs inside, because the supervisor outside can only kill the engine's client, not the process it started.
- **Outside, on the host:** git (every call the server makes, with the repository's hooks switched off by pointing `core.hooksPath` at the empty `hooks-empty/` directory and `core.fsmonitor` off, because a repository hook is project code and would run outside the boundary), the contamination scorer, the attestation bundle and the guard self-test. The verifier that checks a bundle (the self-check of `kukulu_attest`, and a positive pair's control bundle in `kukulu_similarity`) is the plugin's own `scripts/verify-attestation.mjs` here, never a `verify.mjs` found in the project tree, because the box can write that and the host would run it.

A parallel stream cannot run inside, so `kukulu_run_start` with `stream` refuses there; a sandboxed flight is serial.

## Dependencies

The container's home volume (`kukulu-<id>-home`) holds every package cache: cargo's registry, npm's cache, pip's. Nothing of the host's `~/.cargo`, `~/.npm` or `~/.cache/pip` is mounted, so a prior-art crate the owner once downloaded is not there to be read. The policy's `deny.packages` names the packages that must never be dependencies; the gate refuses a tracked lockfile that names one and, for cargo, a cache that holds one (see [cleanroom.md](./cleanroom.md)).

An oracle that must link prior art, such as cleanflate's zlib oracle, is built outside the container and mounted read-only through `sandbox.mounts`; the agent calls the binary and never sees the library's source. The packages a lockfile names are outside the claim: the attestation lists them, but the log cannot show what their source contained.

## The integration step

Everything in `test/sandbox.mjs` runs against a fake container engine, so `npm test` needs no engine, GPU or second machine. One opt-in step uses a real one: `KUKULU_SANDBOX_IT=1 node test/sandbox.mjs` (Linux, docker on `PATH`, never part of `kukulu_verify`) builds `test/fixtures/docker/Containerfile.it`, runs `node scripts/sandbox.mjs run -- --exec sh -c '<script>'` in a temporary project, and checks the boundary from inside: a request to the internet fails, a write under `.kukulu/` fails, and a write to the project succeeds and is visible outside. Without the variable, or without `docker`, the suite prints `sandbox integration: skipped (set KUKULU_SANDBOX_IT=1 with docker on PATH)` and passes.
