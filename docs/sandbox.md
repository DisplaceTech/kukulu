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

Two more mounts are not the project's: the runtime directory, which holds the three sockets and is mounted at `/run/kukulu`, and a named volume for the container's home, `kukulu-<id>-home`, so the harness's login and caches survive a restart without touching the host.
