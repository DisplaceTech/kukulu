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
