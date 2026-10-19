// SPEC section 3 rule 15 through Chrome's DevTools protocol: at every width in
// docs/site/checks.json and in both color schemes the page must not overflow,
// must load without console errors or CSP violations, must show its copy
// buttons (the script ran) and must have loaded the font that carries the
// kahako. Node built-ins only: Node's global WebSocket, no Playwright.
//
//   node scripts/check-site-browser.mjs [--shots]
//   node scripts/check-site-browser.mjs --self-test
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
const CLOSE_TIMEOUT_MS = 5000;
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
  url.catch(() => {});
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const ready = withTimeout(url, LAUNCH_TIMEOUT_MS, "Chrome to print its DevTools URL");
  return { child, ready, exited };
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

// Starts Chrome with a throwaway profile, hands fn a session, and always ends with the
// browser gone and the profile removed. Call it after the page server is up.
async function withBrowser(fn) {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "check-site-browser-"));
  let child = null;
  let exited = null;
  let conn = null;
  try {
    const l = launch(chrome, profile);
    child = l.child;
    exited = l.exited;
    conn = connect(await l.ready);
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

    // One page load at one width and scheme; returns the failures it found.
    const visit = async (url, width, scheme, { shots = false } = {}) => {
      const label = `${width} ${scheme}`;
      const failures = [];
      events = [];
      await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      const loaded = new Promise((resolve) => loadWaiters.push(resolve));
      await page("Page.navigate", { url });
      await withTimeout(loaded, COMMAND_TIMEOUT_MS, `the load event at ${label}`);
      const evaluated = await page("Runtime.evaluate", { expression: PAGE_PROBE, awaitPromise: true, returnByValue: true });
      await new Promise((r) => setTimeout(r, SETTLE_MS));
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
      return failures;
    };
    return await fn({ visit, profile });
  } finally {
    // Ask Chrome to quit, then insist: a profile removed under a live browser is recreated.
    if (conn) {
      conn.send("Browser.close").catch(() => {});
    }
    if (child && exited) {
      const timer = setTimeout(() => child.kill("SIGKILL"), CLOSE_TIMEOUT_MS);
      if (child.exitCode === null && child.signalCode === null) await exited;
      clearTimeout(timer);
    }
    try {
      conn?.ws.close();
    } catch {
      // The browser has already exited.
    }
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function run({ shots }) {
  const config = loadConfig(path.join(ROOT, "docs/site/checks.json"));
  const server = await start({});
  const failures = [];
  let runs = 0;
  try {
    await withBrowser(async ({ visit }) => {
      for (const width of config.viewports) {
        for (const scheme of SCHEMES) {
          const found = await visit(server.url, width, scheme, { shots });
          runs++;
          failures.push(...found);
          if (found.length === 0) process.stdout.write(`check-site-browser: ${width} ${scheme} ok\n`);
        }
      }
    });
  } finally {
    await server.close();
  }
  return { failures, runs };
}

// ---------------------------------------------------------------- self-test

function replaceIn(dir, file, from, to) {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`check-site-browser: self-test case cannot find ${JSON.stringify(from)} in ${file}`);
  fs.writeFileSync(p, text.replace(from, () => to));
}

const CASES = [
  {
    name: "overflow is caught",
    expect: "the page scrolls sideways",
    // The page's CSP blocks inline styles, so the wide element gets its width from the stylesheet.
    inject: (dir) => {
      replaceIn(dir, "index.html", "</main>", '<div class="self-test-wide">x</div></main>');
      fs.appendFileSync(path.join(dir, "styles.css"), "\n.self-test-wide{width:5000px;height:4px}\n");
    },
  },
  {
    name: "a CSP violation is caught",
    expect: "console log error",
    inject: (dir) => replaceIn(dir, "index.html", "</main>", '<img src="https://example.com/x.png" alt=""></main>'),
  },
  {
    name: "hidden copy buttons are caught",
    expect: "is not shown",
    inject: (dir) => replaceIn(dir, "index.html", '<script src="/copy.js" defer></script>', ""),
  },
  {
    name: "a missing latin-ext font is caught",
    expect: "latin-ext subset did not load",
    inject: (dir) => replaceIn(dir, "styles.css", "/fonts/hanken-grotesk-latin-ext-wght-normal.woff2", "/fonts/missing.woff2"),
  },
];

async function selfTest() {
  const config = loadConfig(path.join(ROOT, "docs/site/checks.json"));
  const width = config.viewports[0];
  const problems = [];
  let count = 0;
  const temps = [];
  const report = (name, ok, detail) => {
    count++;
    process.stdout.write(`check-site-browser self-test: ${name}${ok ? "" : " FAILED"}\n`);
    if (!ok) problems.push(`${name}: ${detail}`);
  };
  const copyOfSite = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-site-browser-case-"));
    temps.push(dir);
    fs.cpSync(path.join(ROOT, "site"), dir, { recursive: true });
    return dir;
  };
  let profile = null;
  try {
    // One browser serves every case, each against its own server and site copy.
    await withBrowser(async (session) => {
      profile = session.profile;
      const probe = async (dir) => {
        const server = await start({ port: 0, siteDir: dir });
        try {
          return await session.visit(server.url, width, "dark");
        } finally {
          await server.close();
        }
      };
      const clean = await probe(copyOfSite());
      report("baseline passes", clean.length === 0, clean.join("; "));
      for (const c of CASES) {
        const dir = copyOfSite();
        c.inject(dir);
        const found = await probe(dir);
        report(c.name, found.some((f) => f.includes(c.expect)), `expected a failure containing ${JSON.stringify(c.expect)}, got ${found.length ? found.join("; ") : "none"}`);
      }
    });
    report("the Chrome profile is removed", profile !== null && !fs.existsSync(profile), `${profile} still exists`);
  } finally {
    for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const p of problems) process.stderr.write(`check-site-browser self-test: FAILED ${p}\n`);
  if (problems.length === 0) process.stdout.write(`check-site-browser self-test: ok (${count} cases)\n`);
  return problems.length === 0 ? 0 : 1;
}

const flags = process.argv.slice(2);
try {
  if (flags.length === 1 && flags[0] === "--self-test") process.exit(await selfTest());
  if (flags.some((f) => f !== "--shots")) {
    process.stderr.write("usage: node scripts/check-site-browser.mjs [--shots | --self-test]\n");
    process.exit(2);
  }
  const { failures, runs } = await run({ shots: flags.includes("--shots") });
  for (const f of failures) process.stderr.write(`check-site-browser: ${f}\n`);
  if (failures.length === 0) process.stdout.write(`check-site-browser: ok (${runs} runs)\n`);
  process.exit(failures.length === 0 ? 0 : 1);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
