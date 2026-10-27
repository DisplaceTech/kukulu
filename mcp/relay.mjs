// Inside the sandbox: pipe the MCP server's stdio to the controller socket.
// The server reaches this file only through spawnSync, so the server itself
// never imports node:net. Imports node: modules only.

import net from "node:net";
import process from "node:process";

const socketPath = process.env.KUKULU_CONTROLLER_SOCKET;
const socket = net.createConnection(socketPath);

socket.once("connect", () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on("end", () => process.exit(0));
  socket.on("close", () => process.exit(0));
});

socket.once("error", () => {
  // Nobody is listening, so answer the first request ourselves: a client that
  // hears nothing would wait forever. The id is the request's, or null.
  let buffered = "";
  const answer = (line) => {
    let id = null;
    try {
      id = JSON.parse(line).id ?? null;
    } catch {
      id = null;
    }
    const message = `kukulu: cannot reach the controller at ${socketPath}; the sandbox's controller is not running. Restart the session with node scripts/sandbox.mjs run`;
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`, () => process.exit(1));
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    const nl = buffered.indexOf("\n");
    if (nl >= 0) answer(buffered.slice(0, nl));
  });
  process.stdin.on("end", () => answer(buffered));
});
