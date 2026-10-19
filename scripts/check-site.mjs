// Static checks for the kukulu.tech site (docs/SPEC.md section 3). Node built-ins only.
// `node scripts/check-site.mjs` runs the rules, `--self-test` proves each one
// catches an injected violation. It reads site/ and never writes into it.
//
// The macron letter is written as an escape in this file, as in scripts/check-names.mjs.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Rules this file implements, for the "ok" line. Each task that adds a rule extends it.
const IMPLEMENTED_RULES = [1, 2, 8];

// Files the site is made of besides the seeded assets (SPEC section 4).
const SITE_FILES = ["index.html", "404.html", "styles.css", "copy.js", "_headers", "robots.txt"];

const CONFIG_KEYS = ["budget", "viewports", "contrastMin", "contrastPairs", "copyFeedbackMs", "servePort"];
const BUDGET_KEYS = ["textBytes", "fontBytes", "scriptBytes"];

const MARKETPLACE_SOURCE = { source: "url", url: "https://github.com/DisplaceTech/kukulu.git" };

// ---------------------------------------------------------------- config

function configError(file, problem, fix) {
  return new Error(`check-site: config: ${file}: ${problem}; ${fix}`);
}

const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function loadConfig(file) {
  const name = path.relative(ROOT, file) || file;
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw configError(name, `cannot be read (${e.code || e.message})`, "restore the file from git");
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw configError(name, `is not valid JSON (${e.message})`, "fix the syntax");
  }
  if (!isPlainObject(cfg)) throw configError(name, "must be a JSON object", "restore the file from git");
  for (const key of Object.keys(cfg)) {
    if (!CONFIG_KEYS.includes(key)) {
      throw configError(name, `unknown key "${key}"`, `remove it; the known keys are ${CONFIG_KEYS.join(", ")}`);
    }
  }
  for (const key of CONFIG_KEYS) {
    if (!(key in cfg)) throw configError(name, `missing key "${key}"`, "add it; no default is ever filled in");
  }
  if (!isPlainObject(cfg.budget)) throw configError(name, '"budget" must be an object', `give it ${BUDGET_KEYS.join(", ")}`);
  for (const key of Object.keys(cfg.budget)) {
    if (!BUDGET_KEYS.includes(key)) {
      throw configError(name, `unknown budget key "${key}"`, `remove it; the known keys are ${BUDGET_KEYS.join(", ")}`);
    }
  }
  for (const key of BUDGET_KEYS) {
    if (!isPosInt(cfg.budget[key])) throw configError(name, `budget.${key} must be a positive integer`, "write a byte count");
  }
  if (!Array.isArray(cfg.viewports) || cfg.viewports.length === 0 || !cfg.viewports.every(isPosInt)) {
    throw configError(name, '"viewports" must be a non-empty array of positive integers', "list widths in pixels");
  }
  if (typeof cfg.contrastMin !== "number" || !(cfg.contrastMin >= 1 && cfg.contrastMin <= 21)) {
    throw configError(name, '"contrastMin" must be a number from 1 to 21', "write a WCAG contrast ratio");
  }
  const pairOk = (p) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === "string" && s.startsWith("--"));
  if (!Array.isArray(cfg.contrastPairs) || cfg.contrastPairs.length === 0 || !cfg.contrastPairs.every(pairOk)) {
    throw configError(name, '"contrastPairs" must be a non-empty array of [foreground, background] token names starting with "--"', "fix the pairs");
  }
  if (!isPosInt(cfg.copyFeedbackMs)) throw configError(name, '"copyFeedbackMs" must be a positive integer', "write milliseconds");
  if (!Number.isInteger(cfg.servePort) || cfg.servePort < 1 || cfg.servePort > 65535) {
    throw configError(name, '"servePort" must be an integer from 1 to 65535', "write a TCP port");
  }
  return cfg;
}

// ---------------------------------------------------------------- helpers

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const go = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) go(r);
      else out.push(r);
    }
  };
  go("");
  return out.sort();
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function defaultOpts() {
  const scriptPaths = ["check-site.mjs", "check-site-browser.mjs", "serve-site.mjs"]
    .map((n) => path.join(ROOT, "scripts", n))
    .filter((p) => fs.existsSync(p));
  return {
    siteDir: path.join(ROOT, "site"),
    configPath: path.join(ROOT, "docs/site/checks.json"),
    mockupPath: path.join(ROOT, "docs/site/mockup.html"),
    assetsDir: path.join(ROOT, "docs/site/assets"),
    pluginMarketplacePath: path.join(ROOT, ".claude-plugin/marketplace.json"),
    packageJsonPath: path.join(ROOT, "package.json"),
    scriptPaths,
    checkNamesPath: path.join(ROOT, "scripts/check-names.mjs"),
  };
}

// ---------------------------------------------------------------- rules

function rule1(ctx) {
  const allowed = new Set([...SITE_FILES, ...ctx.assetFiles]);
  for (const rel of ctx.siteFiles) {
    if (allowed.has(rel)) continue;
    const base = path.basename(rel);
    let what = "is not in the closed file set";
    if (base.startsWith(".")) what = "is a dotfile";
    else if (base.endsWith(".map")) what = "is a source map";
    else if (/^readme/i.test(base)) what = "is a README";
    else if (base.startsWith("_")) what = 'starts with "_" (only _headers may)';
    ctx.fail(1, `site/${rel}`, `${rel} ${what}`, "delete it; site/ holds only the files listed in SPEC section 4");
  }
}

function rule2(ctx) {
  for (const rel of ctx.assetFiles) {
    const src = path.join(ctx.opts.assetsDir, rel);
    const dst = path.join(ctx.opts.siteDir, rel);
    if (!fs.existsSync(dst)) {
      ctx.fail(2, `site/${rel}`, "is missing", `copy docs/site/assets/${rel} here byte for byte`);
      continue;
    }
    const a = sha256(src);
    const b = sha256(dst);
    if (a !== b) {
      ctx.fail(2, `site/${rel}`, `differs from docs/site/assets/${rel} (source sha256 ${a}, site sha256 ${b})`, "copy the seeded file again; never edit it");
    }
  }
}

function rule8(ctx) {
  const file = "site/marketplace.json";
  const target = path.join(ctx.opts.siteDir, "marketplace.json");
  let site;
  try {
    site = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (e) {
    ctx.fail(8, file, `cannot be read as JSON (${e.code || e.message})`, "copy docs/site/assets/marketplace.json here");
    return;
  }
  let repo;
  try {
    repo = JSON.parse(fs.readFileSync(ctx.opts.pluginMarketplacePath, "utf8"));
  } catch (e) {
    ctx.fail(8, ".claude-plugin/marketplace.json", `cannot be read as JSON (${e.code || e.message})`, "restore it from git");
    return;
  }
  const same = (label, a, b) => {
    if (a !== b) ctx.fail(8, file, `${label} is ${JSON.stringify(a)} but .claude-plugin/marketplace.json has ${JSON.stringify(b)}`, "make them equal");
  };
  same("name", site?.name, repo?.name);
  same("owner.name", site?.owner?.name, repo?.owner?.name);
  if (!Array.isArray(site?.plugins) || site.plugins.length !== 1) {
    ctx.fail(8, file, "must have exactly one entry in plugins", "list only the kukulu plugin");
    return;
  }
  const entry = site.plugins[0];
  const repoEntry = repo?.plugins?.[0];
  same("plugins[0].name", entry?.name, repoEntry?.name);
  same("plugins[0].description", entry?.description, repoEntry?.description);
  same("plugins[0].license", entry?.license, repoEntry?.license);
  if (typeof entry?.source === "string") {
    ctx.fail(8, file, `plugins[0].source is the relative path ${JSON.stringify(entry.source)}`, "a URL-hosted marketplace cannot resolve relative paths; use the url source object");
  } else if (JSON.stringify(entry?.source) !== JSON.stringify(MARKETPLACE_SOURCE)) {
    ctx.fail(8, file, `plugins[0].source is ${JSON.stringify(entry?.source)}`, `set it to ${JSON.stringify(MARKETPLACE_SOURCE)}`);
  }
  for (const [i, p] of site.plugins.entries()) {
    if (p && "version" in p) ctx.fail(8, file, `plugins[${i}] has a version key`, "remove it; the marketplace entry carries no version");
  }
}

export function checkSite(overrides = {}) {
  const opts = { ...defaultOpts(), ...overrides };
  const failures = [];
  const ctx = {
    opts,
    config: loadConfig(opts.configPath),
    assetFiles: walk(opts.assetsDir),
    siteFiles: walk(opts.siteDir),
    fail(rule, file, what, fix) {
      failures.push({ rule, file, message: `${what}; ${fix}` });
    },
  };
  rule1(ctx);
  rule2(ctx);
  rule8(ctx);
  return failures;
}

export const formatFailure = (f) => `check-site: rule ${f.rule}: ${f.file}: ${f.message}`;

// ---------------------------------------------------------------- self-test

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function editConfig(t, fn) {
  const cfg = readJson(t.config);
  fn(cfg);
  writeJson(t.config, cfg);
}

function editMarketplace(t, fn) {
  const p = path.join(t.site, "marketplace.json");
  const m = readJson(p);
  fn(m);
  writeJson(p, m);
}

export const CASES = [
  { rule: 1, name: "rule 1: a .DS_Store", expect: ".DS_Store", inject: (t) => fs.writeFileSync(path.join(t.site, ".DS_Store"), "x") },
  { rule: 1, name: "rule 1: a source map", expect: "index.js.map", inject: (t) => fs.writeFileSync(path.join(t.site, "index.js.map"), "{}") },
  { rule: 1, name: "rule 1: a _redirects file", expect: "_redirects", inject: (t) => fs.writeFileSync(path.join(t.site, "_redirects"), "/a /b\n") },
  { rule: 2, name: "rule 2: a changed favicon.svg", expect: "favicon.svg", inject: (t) => fs.appendFileSync(path.join(t.site, "favicon.svg"), " ") },
  { rule: 2, name: "rule 2: a deleted og.png", expect: "og.png", inject: (t) => fs.rmSync(path.join(t.site, "og.png")) },
  { rule: 8, name: "rule 8: a relative source", expect: "relative path", inject: (t) => editMarketplace(t, (m) => { m.plugins[0].source = "./"; }) },
  { rule: 8, name: "rule 8: a version key", expect: "version", inject: (t) => editMarketplace(t, (m) => { m.plugins[0].version = "1.0.0"; }) },
  { rule: 8, name: "rule 8: a changed description", expect: "description", inject: (t) => editMarketplace(t, (m) => { m.plugins[0].description = "other"; }) },
  { rule: "config", name: "config: an unknown top-level key", expect: 'unknown key "extra"', inject: (t) => editConfig(t, (c) => { c.extra = 1; }) },
  { rule: "config", name: "config: an unknown budget key", expect: 'unknown budget key "extra"', inject: (t) => editConfig(t, (c) => { c.budget.extra = 1; }) },
  { rule: "config", name: "config: viewports as a string", expect: '"viewports" must be', inject: (t) => editConfig(t, (c) => { c.viewports = "360"; }) },
  { rule: "config", name: "config: servePort 0", expect: '"servePort" must be', inject: (t) => editConfig(t, (c) => { c.servePort = 0; }) },
  { rule: "config", name: "config: copyFeedbackMs removed", expect: 'missing key "copyFeedbackMs"', inject: (t) => editConfig(t, (c) => { delete c.copyFeedbackMs; }) },
];

function makeTemp(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-site-"));
  const t = {
    dir,
    site: path.join(dir, "site"),
    config: path.join(dir, "checks.json"),
    pkg: path.join(dir, "package.json"),
    scripts: path.join(dir, "scripts"),
  };
  fs.cpSync(opts.siteDir, t.site, { recursive: true });
  fs.copyFileSync(opts.configPath, t.config);
  fs.copyFileSync(opts.packageJsonPath, t.pkg);
  fs.mkdirSync(t.scripts);
  for (const p of opts.scriptPaths) fs.copyFileSync(p, path.join(t.scripts, path.basename(p)));
  return t;
}

function optsFor(t, base) {
  return {
    ...base,
    siteDir: t.site,
    configPath: t.config,
    packageJsonPath: t.pkg,
    scriptPaths: fs.readdirSync(t.scripts).map((n) => path.join(t.scripts, n)),
  };
}

export function selfTest() {
  const base = defaultOpts();
  const problems = [];
  const baseline = makeTemp(base);
  try {
    for (const f of checkSite(optsFor(baseline, base))) {
      problems.push(`the clean copy fails rule ${f.rule}: ${f.message}; fix site/ first`);
    }
  } finally {
    fs.rmSync(baseline.dir, { recursive: true, force: true });
  }
  if (problems.length) return { ok: false, problems, count: CASES.length };
  for (const c of CASES) {
    const t = makeTemp(base);
    try {
      c.inject(t);
      if (c.rule === "config") {
        try {
          loadConfig(t.config);
          problems.push(`${c.name}: loadConfig accepted the bad config`);
        } catch (e) {
          if (!e.message.includes(c.expect)) problems.push(`${c.name}: message "${e.message}" does not include "${c.expect}"`);
        }
      } else {
        const hit = checkSite(optsFor(t, base)).filter((f) => f.rule === c.rule && f.message.includes(c.expect));
        if (hit.length === 0) problems.push(`${c.name}: no rule ${c.rule} failure including "${c.expect}"`);
      }
    } finally {
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  return { ok: problems.length === 0, problems, count: CASES.length };
}

// ---------------------------------------------------------------- CLI

function main(argv) {
  const flags = argv.slice(2);
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--self-test")) {
    process.stderr.write("usage: node scripts/check-site.mjs [--self-test]\n");
    return 2;
  }
  try {
    if (flags[0] === "--self-test") {
      const r = selfTest();
      for (const p of r.problems) process.stderr.write(`check-site self-test: ${p}\n`);
      if (r.ok) process.stdout.write(`check-site self-test: ok (${r.count} cases)\n`);
      return r.ok ? 0 : 1;
    }
    const failures = checkSite();
    for (const f of failures) process.stderr.write(`${formatFailure(f)}\n`);
    if (failures.length) return 1;
    process.stdout.write(`check-site: ok (rules ${IMPLEMENTED_RULES.join(", ")})\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
