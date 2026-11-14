// One request to one runner, one JSON line out. The server never opens a socket
// itself (SPEC 3, principle 4); it runs this script through spawnSync instead.
// Node built-ins only, no sibling file, so it runs anywhere Node does.

import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

const USAGE = [
  "usage: node scripts/runner-probe.mjs --endpoint <http(s)://host[:port]> --models [--timeout-ms N] [--token-env NAME]",
  "       node scripts/runner-probe.mjs --endpoint <http(s)://host[:port]> --warm <served id> [--timeout-ms N] [--token-env NAME]",
].join("\n");

const MAX_BODY = 1048576;
const ERROR_CUT = 300;

const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

/** Send the request; resolves to { status, body } or { error }. Never rejects. */
function send({ url, method, headers, body, timeoutMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const lib = url.protocol === "https:" ? https : http;
    let timer = null;
    let done = false;
    const finishWith = (r) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ ...r, ms: Date.now() - started });
    };
    const req = lib.request(url, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (d) => {
        if (size >= MAX_BODY) return;
        const room = MAX_BODY - size;
        chunks.push(d.length > room ? d.subarray(0, room) : d);
        size += Math.min(d.length, room);
      });
      res.on("end", () => finishWith({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => finishWith({ status: null, error: `${e.code ?? "ERROR"}: ${e.message}` }));
    });
    req.on("error", (e) => finishWith({ status: null, error: `${e.code ?? "ERROR"}: ${e.message}` }));
    if (timeoutMs) {
      timer = setTimeout(() => {
        finishWith({ status: null, error: `no answer within ${timeoutMs} ms`, timedOut: true });
        req.destroy();
      }, timeoutMs);
    }
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Run one probe. `mode` is "models" or "warm"; `served` is the id `warm` asks for. */
export async function probe({ endpoint, mode, served, timeoutMs, token }) {
  const fail = (status, ms, error) => ({ ok: false, status, ms, error });
  let result;
  try {
    const url = new URL(mode === "models" ? "/v1/models" : "/v1/messages", endpoint);
    const auth = token ? { "x-api-key": token, authorization: `Bearer ${token}` } : {};
    const request = mode === "models"
      ? { method: "GET", headers: { ...auth } }
      : {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: served, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      };
    const r = await send({ url, ...request, timeoutMs });
    if (r.error) result = fail(r.status, r.ms, r.error);
    else if (r.status < 200 || r.status >= 300) {
      const text = oneLine(r.body);
      result = fail(r.status, r.ms, text ? `HTTP ${r.status}: ${text.slice(0, ERROR_CUT)}` : `HTTP ${r.status}`);
    } else if (mode === "models") {
      let list = null;
      try {
        const parsed = JSON.parse(r.body);
        if (Array.isArray(parsed?.data)) list = parsed.data.map((m) => m?.id).filter((id) => typeof id === "string");
      } catch {
        // not JSON: reported below
      }
      result = list ? { ok: true, status: r.status, ms: r.ms, served: list } : fail(r.status, r.ms, "the response is not a JSON model list");
    } else {
      let reported = null;
      try {
        const m = JSON.parse(r.body)?.model;
        if (typeof m === "string") reported = m;
      } catch {
        // a non-JSON body reports null
      }
      result = { ok: true, status: r.status, ms: r.ms, reported };
    }
  } catch (e) {
    result = fail(null, 0, `${e?.code ?? "ERROR"}: ${e?.message ?? e}`);
  }
  return redact(result, token);
}

/** Replace every occurrence of the token in any string of the result. */
function redact(value, token) {
  if (!token) return value;
  const walk = (v) => {
    if (typeof v === "string") return v.split(token).join("<redacted>");
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

function parseArgs(argv) {
  const o = { models: false, warm: null, endpoint: null, timeoutMs: null, tokenEnv: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === "--models") o.models = true;
    else if (a === "--warm") {
      o.warm = value();
      if (!o.warm || o.warm.startsWith("--")) return { error: "--warm needs a served model id" };
    } else if (a === "--endpoint") o.endpoint = value();
    else if (a === "--timeout-ms") {
      const v = value();
      if (!/^[1-9]\d*$/.test(v ?? "")) return { error: "--timeout-ms must be a positive integer" };
      o.timeoutMs = Number(v);
    } else if (a === "--token-env") {
      o.tokenEnv = value();
      if (!/^[A-Z][A-Z0-9_]*$/.test(o.tokenEnv ?? "")) return { error: "--token-env must be an environment variable name such as RUNNER_TOKEN" };
    } else return { error: `unknown option ${a}` };
  }
  if (!o.endpoint) return { error: "--endpoint is required" };
  let u;
  try {
    u = new URL(o.endpoint);
  } catch {
    return { error: "--endpoint must be http(s)://host[:port]" };
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "") || /[?#]/.test(o.endpoint)) {
    return { error: "--endpoint must be http(s)://host[:port] with no path, query or credentials" };
  }
  if (o.models === (o.warm !== null)) return { error: "give exactly one of --models and --warm <served id>" };
  return { options: o };
}

export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    stderr.write(`runner-probe: ${parsed.error}\n${USAGE}\n`);
    return 2;
  }
  const o = parsed.options;
  let token = null;
  if (o.tokenEnv) {
    token = env[o.tokenEnv];
    if (!token) {
      stdout.write(`${JSON.stringify({ ok: false, status: null, ms: 0, error: `the environment variable ${o.tokenEnv} is not set` })}\n`);
      return 1;
    }
  }
  const result = await probe({ endpoint: o.endpoint, mode: o.models ? "models" : "warm", served: o.warm, timeoutMs: o.timeoutMs ?? undefined, token: token ?? undefined });
  let line = JSON.stringify(result);
  // A last look at the serialized line: the token never leaves, whatever the runner echoed.
  if (token && line.includes(token)) line = line.split(token).join("<redacted>");
  stdout.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
