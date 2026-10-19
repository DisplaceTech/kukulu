// SPEC section 3 rule 15 through Chrome's DevTools protocol: at every width in
// docs/site/checks.json and in both color schemes the page must not overflow,
// must load without console errors or CSP violations, must show its copy
// buttons (the script ran) and must have loaded the font that carries the
// kahako. Node built-ins only: Node's global WebSocket, no Playwright.
//
//   node scripts/check-site-browser.mjs [--shots]
//
// --shots writes full-page PNGs to .site-shots/<width>-<scheme>.png and nothing else.
// The macron letter is written as an escape so that check-names stays quiet.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./check-site.mjs";
import { start } from "./serve-site.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMES = ["dark", "light"];
const COMMAND_TIMEOUT_MS = 30000;
const LAUNCH_TIMEOUT_MS = 30000;
const SETTLE_MS = 150;
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!isExecutable(process.env.CHROME_PATH)) {
      throw new Error(`check-site-browser: CHROME_PATH ${process.env.CHROME_PATH} is not an executable file; set CHROME_PATH to Chrome or Chromium`);
    }
    return process.env.CHROME_PATH;
  }
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  if (isExecutable(MAC_CHROME)) return MAC_CHROME;
  throw new Error("check-site-browser: no Chrome or Chromium found; set CHROME_PATH to its executable");
}

const withTimeout = (promise, ms, what) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`check-site-browser: timed out after ${ms} ms waiting for ${what}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

function launch(chrome, profile) {
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const url = new Promise((resolve, reject) => {
    let seen = "";
    child.stderr.on("data", (d) => {
      seen += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
      if (m) resolve(m[1]);
    });
    child.on("exit", (code) => reject(new Error(`check-site-browser: Chrome exited with ${code} before it was ready; stderr so far:\n${seen}`)));
  });
  const ready = withTimeout(url, LAUNCH_TIMEOUT_MS, "Chrome to print its DevTools URL");
  return { child, ready };
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`check-site-browser: ${p.method} failed: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else {
      for (const l of listeners) l(msg);
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("check-site-browser: could not open the DevTools WebSocket")));
  });
  const send = (method, params = {}, sessionId) =>
    withTimeout(
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
      COMMAND_TIMEOUT_MS,
      method,
    );
  return { ws, opened, send, on: (fn) => listeners.push(fn) };
}

const PAGE_PROBE = `(async () => {
  await document.fonts.ready;
  const root = document.documentElement;
  return {
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    buttons: [...document.querySelectorAll("[data-copy-for]")].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.copyFor, hidden: b.hidden, w: r.width, h: r.height };
    }),
    font: document.fonts.check('16px "Hanken Grotesk"', "\\u016b"),
    light: matchMedia("(prefers-color-scheme: light)").matches,
  };
})()`;

async function run({ shots }) {
  const config = loadConfig(path.join(ROOT, "docs/site/checks.json"));
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "check-site-browser-"));
  const server = await start({});
  const { child, ready } = launch(chrome, profile);
  let conn = null;
  const failures = [];
  let runs = 0;
  try {
    conn = connect(await ready);
    await withTimeout(conn.opened, COMMAND_TIMEOUT_MS, "the DevTools WebSocket to open");
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => conn.send(method, params, sessionId);
    let events = [];
    let loadWaiters = [];
    conn.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Page.loadEventFired") {
        loadWaiters.forEach((w) => w());
        loadWaiters = [];
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        events.push(`console log error: ${msg.params.entry.text} ${msg.params.entry.url || ""}`.trim());
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        events.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        events.push(`uncaught exception: ${d.exception?.description || d.text}`);
      }
    });
    for (const domain of ["Runtime", "Log", "Page"]) await page(`${domain}.enable`);

    for (const width of config.viewports) {
      for (const scheme of SCHEMES) {
        const label = `${width} ${scheme}`;
        events = [];
        await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
        const loaded = new Promise((resolve) => loadWaiters.push(resolve));
        await page("Page.navigate", { url: server.url });
        await withTimeout(loaded, COMMAND_TIMEOUT_MS, `the load event at ${label}`);
        const evaluated = await page("Runtime.evaluate", { expression: PAGE_PROBE, awaitPromise: true, returnByValue: true });
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        runs++;
        const before = failures.length;
        if (evaluated.exceptionDetails) {
          failures.push(`${label}: the page probe threw: ${evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text}`);
        } else {
          const r = evaluated.result.value;
          if (r.scrollWidth > r.clientWidth) failures.push(`${label}: the page scrolls sideways (scrollWidth ${r.scrollWidth} > clientWidth ${r.clientWidth}); find the element wider than the viewport and constrain it`);
          if (r.buttons.length === 0) failures.push(`${label}: no [data-copy-for] buttons were found`);
          for (const b of r.buttons) {
            if (b.hidden || b.w === 0 || b.h === 0) failures.push(`${label}: copy button for ${b.id} is not shown (hidden ${b.hidden}, ${b.w}x${b.h}); copy.js did not run or navigator.clipboard is missing`);
          }
          if (!r.font) failures.push(`${label}: the Hanken Grotesk latin-ext subset did not load, so the kahako has no font; check the @font-face url and the CSP`);
          if (r.light !== (scheme === "light")) failures.push(`${label}: prefers-color-scheme emulation did not take effect`);
        }
        for (const e of events) failures.push(`${label}: ${e}`);
        if (shots) {
          const m = await page("Page.getLayoutMetrics");
          const size = m.cssContentSize || m.contentSize;
          const shot = await page("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
          });
          const dir = path.join(ROOT, ".site-shots");
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${width}-${scheme}.png`), Buffer.from(shot.data, "base64"));
        }
        if (failures.length === before) process.stdout.write(`check-site-browser: ${label} ok\n`);
      }
    }
  } finally {
    try {
      conn?.ws.close();
    } catch {
      // The browser is killed next either way.
    }
    child.kill("SIGKILL");
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return { failures, runs };
}

const flags = process.argv.slice(2);
if (flags.some((f) => f !== "--shots")) {
  process.stderr.write("usage: node scripts/check-site-browser.mjs [--shots]\n");
  process.exit(2);
}
try {
  const { failures, runs } = await run({ shots: flags.includes("--shots") });
  for (const f of failures) process.stderr.write(`check-site-browser: ${f}\n`);
  if (failures.length === 0) process.stdout.write(`check-site-browser: ok (${runs} runs)\n`);
  process.exit(failures.length === 0 ? 0 : 1);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
