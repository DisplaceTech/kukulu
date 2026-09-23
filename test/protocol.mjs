// MCP wire protocol: handshake, tool discovery, framing, and error mapping.
// The server speaks newline-delimited JSON-RPC 2.0 by hand, so the framing is
// worth testing as carefully as the tools it carries.

import { finish, ok, eq, like, mkRepo, startServer } from "./harness.mjs";

const EXPECTED_TOOLS = [
  "foundry_status",
  "foundry_next",
  "foundry_run_start",
  "foundry_task_next",
  "foundry_task_done",
  "foundry_task_block",
  "foundry_verify",
  "foundry_stream_finish",
  "foundry_run_finish",
  "foundry_run_halt",
  "foundry_feedback_log",
  "foundry_mutate",
  "foundry_review_submit",
  "foundry_summary_commit",
  "foundry_agents_sync",
  "foundry_config_show",
];

const repo = mkRepo();
const s = startServer(repo);

// -------------------------------------------------------------- handshake

const init = await s.rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "protocol-suite", version: "0" },
});
eq(init.jsonrpc, "2.0", "initialize reply is JSON-RPC 2.0");
eq(init.result.serverInfo.name, "foundry", "serverInfo.name is foundry");
like(init.result.serverInfo.version, /^\d+\.\d+\.\d+$/, "serverInfo.version is semver");
eq(init.result.protocolVersion, "2025-06-18", "initialize echoes the client's protocol version");
ok(init.result.capabilities && init.result.capabilities.tools, "server advertises the tools capability");

const initDefault = await s.rpc("initialize", { capabilities: {} });
eq(initDefault.result.protocolVersion, "2025-06-18", "initialize falls back to a default protocol version");

eq(Object.keys((await s.rpc("ping", {})).result).length, 0, "ping returns an empty result");

// -------------------------------------------------------------- notifications

const before = s.messages.length;
s.notify("notifications/initialized", {});
s.notify("notifications/cancelled", { requestId: 1 });
await s.settle();
eq(s.messages.length, before, "notifications draw no reply");

// -------------------------------------------------------------- tools/list

const list = (await s.rpc("tools/list", {})).result.tools;
eq(list.length, EXPECTED_TOOLS.length, `tools/list exposes ${EXPECTED_TOOLS.length} tools`);
eq(list.map((t) => t.name).join(","), EXPECTED_TOOLS.join(","), "tools are listed in pipeline order");

let schemasOk = true;
let describedOk = true;
let leakedOk = true;
for (const t of list) {
  if (t.inputSchema?.type !== "object" || t.inputSchema.additionalProperties !== false) schemasOk = false;
  if (!t.description || t.description.length < 40) describedOk = false;
  if ("fn" in t) leakedOk = false;
}
ok(schemasOk, "every tool has a closed object input schema");
ok(describedOk, "every tool carries a description the model can act on");
ok(leakedOk, "tools/list does not leak the server-side handler");

const byName = Object.fromEntries(list.map((t) => [t.name, t]));
eq(byName.foundry_status.inputSchema.required, undefined, "read-only tools take no required arguments");
eq(byName.foundry_task_done.inputSchema.required.join(","), "id,log", "task_done requires id and log");
eq(byName.foundry_task_block.inputSchema.required.join(","), "id,reason", "task_block requires id and reason");
eq(byName.foundry_review_submit.inputSchema.required.join(","), "verdict", "review_submit requires a verdict");
eq(
  byName.foundry_review_submit.inputSchema.properties.verdict.enum.join("|"),
  "APPROVED|CHANGES REQUESTED",
  "review_submit constrains the verdict to the two legal values",
);
eq(
  byName.foundry_review_submit.inputSchema.properties.tasks.items.required.join(","),
  "title,goal,files,tests",
  "fix tasks require title, goal, files and tests",
);

// -------------------------------------------------------------- error mapping

const unknownTool = await s.rpc("tools/call", { name: "foundry_nope", arguments: {} });
eq(unknownTool.error.code, -32602, "unknown tool is an invalid-params error");
like(unknownTool.error.message, /foundry_nope/, "unknown tool error names the tool");

const unknownMethod = await s.rpc("resources/list", {});
eq(unknownMethod.error.code, -32601, "unknown method is a method-not-found error");

// A tool that throws a ToolError is a *result* with isError, not a transport
// error: the model is supposed to read the message and correct itself.
const toolFailure = await s.rpc("tools/call", { name: "foundry_task_next", arguments: {} });
ok(!toolFailure.error, "a failing tool is not reported as a transport error");
eq(toolFailure.result.isError, true, "a failing tool sets isError on the result");
like(toolFailure.result.content[0].text, /PROGRESS\.md/, "the tool error explains what is missing");
ok(!/\bat \S+:\d+:\d+/.test(toolFailure.result.content[0].text), "an expected tool error carries no stack trace");

// -------------------------------------------------------------- framing

const badLine = await new Promise((resolve) => {
  const seen = s.messages.length;
  s.raw("{not json}\n");
  const iv = setInterval(() => {
    if (s.messages.length > seen) {
      clearInterval(iv);
      resolve(s.messages[seen]);
    }
  }, 10);
});
eq(badLine.error.code, -32700, "a malformed line is a parse error");
eq(badLine.id, null, "a parse error replies with a null id");

s.raw("\n   \n");
await s.settle();
ok(true, "blank lines are ignored");

// Two requests in one write, and one request split across two writes.
const batched = Promise.all([s.rpc("ping", {}), s.rpc("ping", {})]);
ok((await batched).every((m) => m.result), "two frames in flight are both answered");

const splitId = 9001;
const splitReply = new Promise((resolve) => {
  const iv = setInterval(() => {
    const m = s.messages.find((x) => x.id === splitId);
    if (m) {
      clearInterval(iv);
      resolve(m);
    }
  }, 10);
});
s.raw('{"jsonrpc":"2.0","id":9001,"me');
await s.settle();
s.raw('thod":"ping","params":{}}\n');
ok((await splitReply).result, "a frame split across two writes is reassembled");

await s.stop();
eq(s.proc.exitCode, 0, "the server exits cleanly when stdin closes");

finish();
