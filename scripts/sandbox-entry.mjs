// The container's entrypoint (SPEC C-03): bridge 127.0.0.1:3128 to the egress
// proxy's Unix socket, then start the harness. It runs inside the boundary and
// imports node: modules only. It never reads a key or writes .kukulu/.

import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROXY_PORT = 3128;
const PROXY_SOCKET = "/run/kukulu/proxy.sock";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Forward connections on 127.0.0.1:<port> to the Unix socket, both ways. */
export function startBridge({ port = PROXY_PORT, socketPath = PROXY_SOCKET } = {}) {
  const server = net.createServer((conn) => {
    const upstream = net.connect(socketPath);
    conn.on("error", () => upstream.destroy());
    upstream.on("error", () => conn.destroy());
    conn.pipe(upstream);
    upstream.pipe(conn);
  });
  server.listen(port, "127.0.0.1");
  return {
    listening: new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    }),
    port: () => server.address()?.port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function main(argv) {
  const bridge = startBridge({});
  await bridge.listening;
  const [command, args] = argv[0] === "--exec" ? [argv[1], argv.slice(2)] : ["claude", ["--plugin-dir", PLUGIN_ROOT, ...argv]];
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    bridge.close();
    process.exit(code ?? (signal ? 1 : 0));
  });
  child.on("error", (e) => {
    process.stderr.write(`sandbox-entry: cannot start ${command}: ${e.message}\n`);
    process.exit(127);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
