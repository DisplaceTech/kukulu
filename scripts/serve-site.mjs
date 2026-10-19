// Local server for site/ that applies site/_headers the way Cloudflare Pages
// does, minus the two things that break plain-HTTP localhost. For humans and for
// scripts/check-site-browser.mjs. It only reads site/.
//
//   node scripts/serve-site.mjs [--port N]
//   node scripts/serve-site.mjs --self-test

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./check-site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.join(ROOT, "site");
const CONFIG_PATH = path.join(ROOT, "docs/site/checks.json");

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
const TEXT_TYPES = new Set([".html", ".css", ".js", ".json", ".txt"]);

// An unindented line is a path pattern; the indented "Name: value" lines under it are its headers.
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
    } else if (rules.length) {
      const at = line.indexOf(":");
      if (at > 0) rules[rules.length - 1].headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]);
    }
  }
  return rules.filter((r) => !r.pattern.startsWith("https://"));
}

function headersFor(rules, urlPath) {
  const out = new Map();
  for (const r of rules) {
    if (r.pattern !== "/*" && r.pattern !== urlPath) continue;
    for (const [name, value] of r.headers) out.set(name.toLowerCase(), [name, value]);
  }
  // Both would break http://127.0.0.1: the browser would upgrade every request to https.
  out.delete("strict-transport-security");
  const csp = out.get("content-security-policy");
  if (csp) {
    const kept = csp[1].split(";").map((d) => d.trim()).filter((d) => d && d !== "upgrade-insecure-requests");
    out.set("content-security-policy", [csp[0], kept.join("; ")]);
  }
  return out;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  return TEXT_TYPES.has(ext) ? `${type}; charset=utf-8` : type;
}

// The port argument, then SITE_PORT, then servePort from checks.json. A SITE_PORT that is set but
// unusable is refused rather than ignored, so a typo cannot silently bind the default port.
function choosePort(port) {
  if (port !== undefined && port !== null) return port;
  const env = process.env.SITE_PORT;
  if (env === undefined || env === "") return loadConfig(CONFIG_PATH).servePort;
  const n = Number(env);
  if (!/^\d+$/.test(env) || n > 65535) {
    throw new Error(`SITE_PORT is ${JSON.stringify(env)}, not an integer from 0 to 65535; set it to a TCP port, or unset it to use servePort from docs/site/checks.json`);
  }
  return n;
}

export async function start({ port, siteDir = SITE_DIR } = {}) {
  const root = path.resolve(siteDir);
  const chosen = choosePort(port);
  const rules = parseHeaders(fs.readFileSync(path.join(root, "_headers"), "utf8"));

  const send = (req, res, status, urlPath, type, body, extra) => {
    const headers = headersFor(rules, urlPath);
    const h = {};
    for (const [name, value] of headers.values()) h[name] = value;
    // A Content-Type from _headers (for /marketplace.json) wins over the extension's.
    if (!headers.has("content-type")) h["Content-Type"] = type;
    h["Content-Length"] = body.length;
    Object.assign(h, extra);
    res.writeHead(status, h);
    res.end(req.method === "HEAD" ? undefined : body);
  };

  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(req, res, 405, "/*", "text/plain; charset=utf-8", Buffer.from("Method not allowed\n"), { Allow: "GET, HEAD" });
      return;
    }
    const raw = (req.url || "/").split(/[?#]/)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = null;
    }
    const forbid = () => send(req, res, 403, "/*", "text/plain; charset=utf-8", Buffer.from("Forbidden\n"));
    if (decoded === null || decoded.includes("\0")) return forbid();
    const target = path.resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (target !== root && !target.startsWith(root + path.sep)) return forbid();
    const rel = path.relative(root, target);
    let body = null;
    if (rel !== "_headers") {
      try {
        if (fs.statSync(target).isFile()) body = fs.readFileSync(target);
      } catch {
        body = null;
      }
    }
    if (body === null) {
      const page = fs.readFileSync(path.join(root, "404.html"));
      send(req, res, 404, decoded, "text/html; charset=utf-8", page);
      return;
    }
    send(req, res, 200, decoded === "/" ? "/index.html" : decoded, contentType(target), body);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(chosen, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  return {
    url,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

// ---------------------------------------------------------------- self-test

function request(base, method, urlPath) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: urlPath, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Never binds servePort: it may be in use by a running server.
async function portChecks(check) {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const free = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const saved = process.env.SITE_PORT;
  try {
    process.env.SITE_PORT = String(free);
    const viaEnv = await start({});
    check("start({}) uses SITE_PORT", new URL(viaEnv.url).port === String(free));
    await viaEnv.close();
    const viaArg = await start({ port: 0 });
    check("the port argument beats SITE_PORT", new URL(viaArg.url).port !== String(free) && new URL(viaArg.url).port !== "");
    await viaArg.close();
    process.env.SITE_PORT = "abc";
    let message = "";
    try {
      await (await start({})).close();
    } catch (e) {
      message = e.message;
    }
    check("a bad SITE_PORT is refused naming SITE_PORT", message.includes("SITE_PORT"));
    // choosePort directly: a rejected value must never reach listen(), and an accepted one
    // (the fallthrough) must not bind the real servePort here.
    process.env.SITE_PORT = String(0xffff + 1); // one past the largest TCP port
    let high = "";
    try {
      choosePort(undefined);
    } catch (e) {
      high = e.message;
    }
    check("a SITE_PORT above 65535 is refused naming SITE_PORT", high.includes("SITE_PORT"));
    process.env.SITE_PORT = "";
    let fallthrough = null;
    try {
      fallthrough = choosePort(undefined);
    } catch {
      // fallthrough stays null and the check below fails
    }
    check("an empty SITE_PORT falls through to servePort", fallthrough === loadConfig(CONFIG_PATH).servePort);
  } finally {
    if (saved === undefined) delete process.env.SITE_PORT;
    else process.env.SITE_PORT = saved;
  }
}

async function selfTest() {
  const server = await start({ port: 0 });
  const problems = [];
  let count = 0;
  const check = (name, ok) => {
    count++;
    if (!ok) problems.push(name);
  };
  try {
    const fontFile = fs.readdirSync(path.join(SITE_DIR, "fonts")).find((f) => f.endsWith(".woff2"));
    const home = await request(server.url, "GET", "/");
    check("GET / is 200", home.status === 200);
    check("GET / is text/html; charset=utf-8", home.headers["content-type"] === "text/html; charset=utf-8");
    check("GET / sends X-Content-Type-Options: nosniff", home.headers["x-content-type-options"] === "nosniff");
    const csp = home.headers["content-security-policy"] || "";
    check("GET / CSP has default-src 'none'", csp.includes("default-src 'none'"));
    check("GET / CSP drops upgrade-insecure-requests", !csp.includes("upgrade-insecure-requests") && !csp.endsWith(";"));
    check("GET / drops Strict-Transport-Security", !("strict-transport-security" in home.headers));
    const mp = await request(server.url, "GET", "/marketplace.json");
    check("GET /marketplace.json is application/json; charset=utf-8", mp.headers["content-type"] === "application/json; charset=utf-8");
    check("GET /marketplace.json allows any origin", mp.headers["access-control-allow-origin"] === "*");
    check("GET /marketplace.json parses", (() => { try { return JSON.parse(mp.body).name !== undefined; } catch { return false; } })());
    check("GET /styles.css is text/css; charset=utf-8", (await request(server.url, "GET", "/styles.css")).headers["content-type"] === "text/css; charset=utf-8");
    check("GET /copy.js is text/javascript; charset=utf-8", (await request(server.url, "GET", "/copy.js")).headers["content-type"] === "text/javascript; charset=utf-8");
    check("a font is font/woff2", (await request(server.url, "GET", `/fonts/${fontFile}`)).headers["content-type"] === "font/woff2");
    check("GET /favicon.ico is image/x-icon", (await request(server.url, "GET", "/favicon.ico")).headers["content-type"] === "image/x-icon");
    const missing = await request(server.url, "GET", "/no-such-page");
    check("GET /no-such-page is 404", missing.status === 404);
    check("the 404 body is the not-found page", missing.body.includes("Page not found."));
    check("GET /_headers is 404", (await request(server.url, "GET", "/_headers")).status === 404);
    check("GET /../package.json is 403", (await request(server.url, "GET", "/../package.json")).status === 403);
    check("GET /%2e%2e/package.json is 403", (await request(server.url, "GET", "/%2e%2e/package.json")).status === 403);
    check("GET /%00 is 403", (await request(server.url, "GET", "/%00")).status === 403);
    check("a bad escape is 403", (await request(server.url, "GET", "/%zz")).status === 403);
    check("POST / is 405", (await request(server.url, "POST", "/")).status === 405);
    const head = await request(server.url, "HEAD", "/");
    check("HEAD / is 200 with no body", head.status === 200 && head.body === "");
    await portChecks(check);
    const alt = fs.mkdtempSync(path.join(os.tmpdir(), "serve-site-dir-"));
    try {
      fs.writeFileSync(path.join(alt, "_headers"), "/*\n  X-Alt: yes\n");
      fs.writeFileSync(path.join(alt, "index.html"), "alt home\n");
      fs.writeFileSync(path.join(alt, "404.html"), "alt 404\n");
      const other = await start({ port: 0, siteDir: alt });
      try {
        const r = await request(other.url, "GET", "/");
        check("start({ siteDir }) serves that directory", r.body === "alt home\n" && r.headers["x-alt"] === "yes");
      } finally {
        await other.close();
      }
      const otherMissing = await start({ port: 0, siteDir: alt });
      try {
        const r = await request(otherMissing.url, "GET", "/no-such-page");
        check("start({ siteDir }) serves that directory's 404.html", r.status === 404 && r.body === "alt 404\n");
      } finally {
        await otherMissing.close();
      }
    } finally {
      fs.rmSync(alt, { recursive: true, force: true });
    }
  } finally {
    await server.close();
  }
  for (const p of problems) process.stderr.write(`serve-site self-test: FAILED ${p}\n`);
  if (problems.length === 0) process.stdout.write(`serve-site self-test: ok (${count} checks)\n`);
  return problems.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------- CLI

async function main(argv) {
  const flags = argv.slice(2);
  if (flags.length === 1 && flags[0] === "--self-test") return selfTest();
  let port;
  const usage = () => {
    process.stderr.write("usage: node scripts/serve-site.mjs [--port N | --self-test]\n");
    return 2;
  };
  if (flags.length === 2 && flags[0] === "--port") {
    port = Number(flags[1]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) return usage();
  } else if (flags.length !== 0) {
    return usage();
  }
  const server = await start({ port });
  process.stdout.write(`serve-site: ${server.url}\n`);
  process.on("SIGINT", () => server.close().then(() => process.exit(0)));
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => {
      if (code !== null) process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`serve-site: ${e.message}\n`);
      process.exitCode = 1;
    },
  );
}
