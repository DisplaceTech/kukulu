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
