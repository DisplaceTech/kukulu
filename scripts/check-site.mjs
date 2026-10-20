// Static checks for the kukulu.tech site (docs/SPEC.md section 3). Node built-ins only.
// `node scripts/check-site.mjs` runs the rules, `--self-test` proves each one
// catches an injected violation. It reads site/ and never writes into it.
//
// The macron letter is written as an escape in this file, as in scripts/check-names.mjs.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Rules this file implements, for the "ok" line. Each task that adds a rule extends it.
const IMPLEMENTED_RULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];

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
    copyChangesPath: path.join(ROOT, "docs/site/copy-changes.json"),
    assetsDir: path.join(ROOT, "docs/site/assets"),
    pluginMarketplacePath: path.join(ROOT, ".claude-plugin/marketplace.json"),
    packageJsonPath: path.join(ROOT, "package.json"),
    scriptPaths,
    checkNamesPath: path.join(ROOT, "scripts/check-names.mjs"),
  };
}

// ---------------------------------------------------------------- html

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW_TAGS = new Set(["script", "style", "template"]);
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : whole;
  });
}

// A small tolerant parser: enough for the files in site/, not a browser.
// Elements are { tag, attrs, attrSource, children, parent, line }; text is { text }.
// Comments and the doctype are dropped.
export function parseHtml(src) {
  const root = { tag: "#root", attrs: {}, attrSource: "", children: [], parent: null, line: 1 };
  let cur = root;
  let i = 0;
  const lineAt = (pos) => src.slice(0, pos).split("\n").length;
  const addText = (text) => {
    if (text) cur.children.push({ text, parent: cur });
  };
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith("<!", i)) {
      const end = src.indexOf(">", i);
      i = end === -1 ? src.length : end + 1;
    } else if (src.startsWith("</", i) && /[a-zA-Z]/.test(src[i + 2] || "")) {
      const end = src.indexOf(">", i);
      const name = src.slice(i + 2, end === -1 ? src.length : end).trim().toLowerCase();
      let n = cur;
      while (n && n.tag !== name) n = n.parent;
      if (n && n !== root) cur = n.parent;
      i = end === -1 ? src.length : end + 1;
    } else if (src[i] === "<" && /[a-zA-Z]/.test(src[i + 1] || "")) {
      const start = i;
      let j = i + 1;
      while (j < src.length && !/[\s/>]/.test(src[j])) j++;
      const tag = src.slice(i + 1, j).toLowerCase();
      const attrs = {};
      let selfClosing = false;
      while (j < src.length) {
        while (j < src.length && /\s/.test(src[j])) j++;
        if (src[j] === ">") {
          j++;
          break;
        }
        if (src[j] === "/") {
          if (src[j + 1] === ">") selfClosing = true;
          j++;
          continue;
        }
        const nameStart = j;
        while (j < src.length && !/[\s=/>]/.test(src[j])) j++;
        const attr = src.slice(nameStart, j).toLowerCase();
        while (j < src.length && /\s/.test(src[j])) j++;
        let value = "";
        if (src[j] === "=") {
          j++;
          while (j < src.length && /\s/.test(src[j])) j++;
          if (src[j] === '"' || src[j] === "'") {
            const q = src[j];
            const end = src.indexOf(q, j + 1);
            value = src.slice(j + 1, end === -1 ? src.length : end);
            j = end === -1 ? src.length : end + 1;
          } else {
            const vs = j;
            while (j < src.length && !/[\s>]/.test(src[j])) j++;
            value = src.slice(vs, j);
          }
        }
        if (attr && !(attr in attrs)) attrs[attr] = decodeEntities(value);
      }
      const el = { tag, attrs, attrSource: src.slice(start, j), children: [], parent: cur, line: lineAt(start) };
      cur.children.push(el);
      if (RAW_TAGS.has(tag)) {
        const close = src.toLowerCase().indexOf(`</${tag}`, j);
        const end = close === -1 ? src.length : close;
        if (end > j) el.children.push({ text: src.slice(j, end), parent: el });
        const gt = close === -1 ? -1 : src.indexOf(">", close);
        i = gt === -1 ? src.length : gt + 1;
      } else {
        i = j;
        if (!VOID_TAGS.has(tag) && !selfClosing) cur = el;
      }
    } else {
      let end = i + 1;
      while (end < src.length && !(src[end] === "<" && /[a-zA-Z!/]/.test(src[end + 1] || ""))) end++;
      addText(decodeEntities(src.slice(i, end)));
      i = end;
    }
  }
  return root;
}

export function textContent(node) {
  if (node.text !== undefined) return node.text;
  return node.children.map(textContent).join("");
}

const collapse = (t) => t.replace(/\s+/g, " ").trim();

export function findAll(node, pred, out = []) {
  if (node.tag && pred(node)) out.push(node);
  for (const c of node.children || []) findAll(c, pred, out);
  return out;
}
const byTag = (root, tag) => findAll(root, (n) => n.tag === tag);
const byId = (root, id) => findAll(root, (n) => n.attrs.id === id)[0];
const hasClass = (n, c) => (n.attrs.class || "").split(/\s+/).includes(c);

// Section 3 rule 6: body content without script, style, template, comments and
// aria-hidden subtrees; tags become spaces; entities decoded; whitespace collapsed.
export function visibleText(html) {
  const tree = typeof html === "string" ? parseHtml(html) : html;
  const body = byTag(tree, "body")[0] || tree;
  const walk = (n) => {
    if (n.text !== undefined) return n.text;
    if (RAW_TAGS.has(n.tag) || n.attrs["aria-hidden"] === "true") return " ";
    return ` ${n.children.map(walk).join("")} `;
  };
  return collapse(body.children.map(walk).join(""));
}

// ---------------------------------------------------------------- rules

function rule1(ctx) {
  const allowed = new Set([...SITE_FILES, ...ctx.assetFiles]);
  const present = new Set(ctx.siteFiles);
  for (const rel of allowed) {
    if (!present.has(rel)) ctx.fail(1, `site/${rel}`, `${rel} is missing from the closed file set`, "add it; SPEC section 4 lists every file site/ must hold");
  }
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

// Reads a site file for a rule; a missing file is the rule's failure, once.
function need(ctx, rule, rel) {
  const p = path.join(ctx.opts.siteDir, rel);
  if (!fs.existsSync(p)) {
    ctx.fail(rule, `site/${rel}`, "is missing", "restore it; SPEC section 4 lists it");
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

const HTML_FILES = ["index.html", "404.html"];

function rule3(ctx) {
  for (const rel of HTML_FILES) {
    const src = need(ctx, 3, rel);
    if (src === null) continue;
    for (const el of findAll(parseHtml(src), (n) => "style" in n.attrs || n.tag === "style")) {
      const what = el.tag === "style" ? "has a <style> element" : `<${el.tag}> has a style attribute`;
      ctx.fail(3, `site/${rel}`, `line ${el.line}: ${what}`, "move the declaration into site/styles.css as a class rule");
    }
  }
}

const COPY_IDS = ["install-session", "install-shell", "spec-template", "flight-cmd"];
const SCRIPT_TAG = '<script src="/copy.js" defer></script>';

function rule4(ctx) {
  const index = need(ctx, 4, "index.html");
  const notFound = need(ctx, 4, "404.html");
  const css = need(ctx, 4, "styles.css");
  const js = need(ctx, 4, "copy.js");
  for (const [rel, src] of [["index.html", index], ["404.html", notFound]]) {
    if (src === null) continue;
    const count = (src.match(/<script/gi) || []).length;
    if (rel === "404.html" && count > 0) ctx.fail(4, `site/${rel}`, `has ${count} <script> tag(s)`, "remove them; the 404 page has no script");
    if (rel === "index.html") {
      if (count !== 1) ctx.fail(4, `site/${rel}`, `has ${count} <script> tags`, `keep exactly one: ${SCRIPT_TAG}`);
      else if (!src.includes(SCRIPT_TAG)) ctx.fail(4, `site/${rel}`, "its <script> tag is not the expected one", `write exactly ${SCRIPT_TAG}`);
    }
    for (const el of findAll(parseHtml(src), (n) => /\son[a-z]+\s*=/i.test(n.attrSource))) {
      ctx.fail(4, `site/${rel}`, `line ${el.line}: <${el.tag}> has an inline event handler attribute`, "remove it; copy.js attaches the handlers");
    }
  }
  if (js !== null) {
    const bytes = Buffer.byteLength(js);
    if (bytes > ctx.config.budget.scriptBytes) {
      ctx.fail(4, "site/copy.js", `is ${bytes} bytes, over the script budget of ${ctx.config.budget.scriptBytes}`, "trim it; copy.js only copies to the clipboard");
    }
    const found = js.match(/^\s*const COPY_FEEDBACK_MS = (\d+);$/gm) || [];
    if (found.length !== 1) {
      ctx.fail(4, "site/copy.js", `has ${found.length} COPY_FEEDBACK_MS declarations`, "declare it once as `  const COPY_FEEDBACK_MS = <copyFeedbackMs>;`");
    } else {
      const n = Number(found[0].match(/(\d+);$/)[1]);
      if (n !== ctx.config.copyFeedbackMs) {
        ctx.fail(4, "site/copy.js", `COPY_FEEDBACK_MS is ${n} but docs/site/checks.json copyFeedbackMs is ${ctx.config.copyFeedbackMs}`, "make them equal");
      }
      if (js.split("\n")[1] !== `  const COPY_FEEDBACK_MS = ${n};`) {
        ctx.fail(4, "site/copy.js", "line 2 is not the COPY_FEEDBACK_MS declaration, indented two spaces", "make line 1 the IIFE opener and line 2 the constant");
      }
    }
  }
  if (css !== null && !css.replace(/\s+/g, "").includes("[hidden]{display:none!important}")) {
    ctx.fail(4, "site/styles.css", "has no [hidden]{display:none !important} rule", "add it; without it .copy shows even when the script never ran");
  }
  if (index !== null) {
    const tree = parseHtml(index);
    const buttons = findAll(tree, (n) => n.tag === "button" && "data-copy-for" in n.attrs);
    const ids = buttons.map((b) => b.attrs["data-copy-for"]);
    if (ids.length !== COPY_IDS.length || !COPY_IDS.every((id) => ids.includes(id))) {
      ctx.fail(4, "site/index.html", `has copy buttons for [${ids.join(", ")}]`, `it needs exactly one for each of ${COPY_IDS.join(", ")}`);
    }
    for (const b of buttons) {
      const id = b.attrs["data-copy-for"];
      const bad = (what, fix) => ctx.fail(4, "site/index.html", `copy button for ${id} ${what}`, fix);
      if (b.attrs.type !== "button") bad('lacks type="button"', 'add type="button"');
      if (!("hidden" in b.attrs)) bad("lacks the hidden attribute", "add hidden; copy.js reveals the button when the clipboard API exists");
      const label = findAll(b, (n) => hasClass(n, "copy-label"))[0];
      if (!label || collapse(textContent(label)) !== "Copy") bad('has no .copy-label reading "Copy"', 'add <span class="copy-label">Copy</span>');
      const target = byId(tree, id);
      if (!target || target.tag !== "code") bad("has no <code> target with that id", "add the <code id> block it copies");
      const status = byId(tree, `${id}-status`);
      if (!status || status.tag !== "p" || !hasClass(status, "copy-status") || status.attrs.role !== "status" || status.attrs["aria-live"] !== "polite") {
        bad(`has no <p class="copy-status" id="${id}-status" role="status" aria-live="polite">`, "add the status element after the block");
      } else if (textContent(status) !== "") {
        bad("has a status element that is not empty", "empty it; copy.js fills it");
      }
    }
  }
}

function rule5(ctx) {
  const rootRel = (v) => v.startsWith("/") && !v.startsWith("//");
  for (const rel of HTML_FILES) {
    const src = need(ctx, 5, rel);
    if (src === null) continue;
    const tree = parseHtml(src);
    for (const el of findAll(tree, (n) => "src" in n.attrs)) {
      if (!rootRel(el.attrs.src)) ctx.fail(5, `site/${rel}`, `line ${el.line}: <${el.tag}> src "${el.attrs.src}" is not root-relative`, "serve it from site/ and write /path");
    }
    for (const el of findAll(tree, (n) => n.tag === "link" && "href" in n.attrs)) {
      if ((el.attrs.rel || "").split(/\s+/).includes("canonical")) {
        if (el.attrs.href !== CANONICAL) ctx.fail(5, `site/${rel}`, `line ${el.line}: canonical is "${el.attrs.href}"`, `set it to exactly ${CANONICAL}`);
      } else if (!rootRel(el.attrs.href)) {
        ctx.fail(5, `site/${rel}`, `line ${el.line}: <link> href "${el.attrs.href}" is not root-relative`, "serve it from site/ and write /path");
      }
    }
    if (rel === "index.html") {
      const og = findAll(tree, (n) => n.tag === "meta" && n.attrs.property === "og:image")[0];
      if (!og || og.attrs.content !== OG_IMAGE) ctx.fail(5, `site/${rel}`, `og:image is ${JSON.stringify(og?.attrs.content)}`, `set it to exactly ${OG_IMAGE}`);
    }
  }
  const css = need(ctx, 5, "styles.css");
  if (css !== null) {
    for (const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) {
      if (!rootRel(m[2])) ctx.fail(5, "site/styles.css", `url(${m[2]}) is not root-relative`, "self-host the file in site/ and write /path");
    }
    if (/@import/i.test(css)) ctx.fail(5, "site/styles.css", "uses @import", "remove it; link /styles.css once and keep every rule in it");
  }
}

const CANONICAL = "https://kukulu.tech/";
const OG_IMAGE = "https://kukulu.tech/og.png";

const numberTokens = (text) => (text.match(/\d[\d,.]*/g) || []).map((t) => t.replace(/[.,]+$/, ""));

function rule6(ctx) {
  const src = need(ctx, 6, "index.html");
  if (src === null) return;
  let mockupSrc;
  try {
    mockupSrc = fs.readFileSync(ctx.opts.mockupPath, "utf8");
  } catch (e) {
    ctx.fail(6, "docs/site/mockup.html", `cannot be read (${e.code || e.message})`, "restore it from git");
    return;
  }
  const page = parseHtml(src);
  const mock = parseHtml(mockupSrc);
  const diff = (label, a, b) => {
    const n = Math.max(a.length, b.length);
    for (let k = 0; k < n; k++) {
      if (a[k] !== b[k]) {
        ctx.fail(6, "site/index.html", `${label} differs from the mockup at index ${k}: page has ${JSON.stringify(a[k])}, mockup has ${JSON.stringify(b[k])}`, "copy the mockup's text exactly");
        return;
      }
    }
  };
  const headings = (tree) => findAll(tree, (n) => /^h[1-4]$/.test(n.tag)).map((h) => `${h.tag}: ${collapse(textContent(h))}`);
  diff("heading", headings(page), headings(mock));
  const cells = (tree) => {
    const table = byTag(tree, "table")[0];
    return table ? findAll(table, (n) => n.tag === "th" || n.tag === "td").map((c) => collapse(textContent(c))) : [];
  };
  diff("proof table cell", cells(page), cells(mock));
  const a = numberTokens(visibleText(page));
  const b = numberTokens(visibleText(mock));
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    if (a[k] !== b[k]) {
      const ctxOf = (arr) => arr.slice(Math.max(0, k - 3), k + 4).join(" ");
      ctx.fail(6, "site/index.html", `number token ${k} is ${JSON.stringify(a[k])} but the mockup has ${JSON.stringify(b[k])} (page: ... ${ctxOf(a)} ...; mockup: ... ${ctxOf(b)} ...)`, "copy the mockup's numbers exactly");
      break;
    }
  }
  if (/\bKukulu\b/.test(visibleText(page))) {
    ctx.fail(6, "site/index.html", "visible text contains the ASCII spelling Kukulu", "write the display name with the macron letter U+016B");
  }
}

const HERO_COMMANDS = "/plugin marketplace add https://kukulu.tech/marketplace.json\n/plugin install kukulu@displacetech";
const SHELL_COMMANDS = "claude plugin marketplace add https://kukulu.tech/marketplace.json\nclaude plugin install kukulu@displacetech";

function rule7(ctx) {
  const src = need(ctx, 7, "index.html");
  if (src === null) return;
  const tree = parseHtml(src);
  let name = null;
  try {
    name = JSON.parse(fs.readFileSync(path.join(ctx.opts.siteDir, "marketplace.json"), "utf8")).name;
  } catch {
    // rule 8 reports an unreadable marketplace.json.
  }
  for (const [id, want] of [["install-session", HERO_COMMANDS], ["install-shell", SHELL_COMMANDS]]) {
    const el = byId(tree, id);
    if (!el) {
      ctx.fail(7, "site/index.html", `has no #${id} block`, "restore the install commands from the mockup");
      continue;
    }
    const got = textContent(el).replace(/\n$/, "");
    if (got !== want) {
      ctx.fail(7, "site/index.html", `#${id} reads ${JSON.stringify(got)}`, `make it exactly ${JSON.stringify(want)}`);
    } else if (name !== null && !got.endsWith(`@${name}`)) {
      ctx.fail(7, "site/index.html", `#${id} does not end in @${name}, the name in site/marketplace.json`, "make the install id match the marketplace name");
    }
  }
}

// ---- rule 9: tokens and contrast

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Top-level blocks of a stylesheet (or of a block body): [{ prelude, body }].
function cssBlocks(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) open = i;
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        out.push({ prelude: css.slice(start, open).trim(), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

function customProps(body) {
  const props = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) props[m[1]] = m[2].trim().replace(/\s+/g, " ");
  return props;
}

const squash = (t) => t.replace(/\s+/g, "");
const LIGHT_QUERY = "@media(prefers-color-scheme:light)";

// Returns { dark, light, print, problems }; light is only the overrides.
function readTokens(css, label, { strictPrint }) {
  const problems = [];
  const blocks = cssBlocks(stripComments(css));
  const roots = blocks.filter((b) => b.prelude === ":root");
  if (roots.length !== 1) problems.push(`${label} has ${roots.length} top-level :root rules, not one`);
  const lights = blocks.filter((b) => squash(b.prelude) === LIGHT_QUERY);
  if (lights.length !== 1) problems.push(`${label} has ${lights.length} @media (prefers-color-scheme: light) blocks, not one`);
  const innerRoot = (blk, what) => {
    const inner = cssBlocks(blk.body);
    if (inner.length !== 1 || (strictPrint && inner[0].prelude !== ":root")) {
      problems.push(`${label}'s ${what} block must hold exactly one :root rule`);
      return {};
    }
    return customProps(inner[0].body);
  };
  const dark = roots[0] ? customProps(roots[0].body) : {};
  const light = lights[0] ? innerRoot(lights[0], "light") : {};
  let print = null;
  if (strictPrint) {
    const prints = blocks.filter((b) => squash(b.prelude) === "@mediaprint");
    if (prints.length !== 1) problems.push(`${label} has ${prints.length} @media print blocks, not one`);
    else print = innerRoot(prints[0], "print");
  }
  return { dark, light, print, problems };
}

const sameProps = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => (a[k] || "").toLowerCase() !== (b[k] || "").toLowerCase());
};

function hexRgb(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v || "");
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function pairRatios(tokens, pairs) {
  return pairs.map(([fg, bg]) => {
    const fv = tokens[fg];
    const bv = tokens[bg];
    const f = hexRgb(fv);
    const b = hexRgb(bv);
    return { fg, bg, fgValue: fv, bgValue: bv, ratio: f && b ? contrastRatio(f, b) : null };
  });
}

// Per scheme, every configured pair with its ratio. Throws when styles.css has no usable tokens.
export function contrastReport(overrides = {}) {
  const opts = { ...defaultOpts(), ...overrides };
  const config = loadConfig(opts.configPath);
  const t = readTokens(fs.readFileSync(path.join(opts.siteDir, "styles.css"), "utf8"), "site/styles.css", { strictPrint: true });
  if (t.problems.length) throw new Error(`check-site: rule 9: site/styles.css: ${t.problems.join("; ")}; fix the token rules`);
  return {
    contrastMin: config.contrastMin,
    dark: pairRatios(t.dark, config.contrastPairs),
    light: pairRatios({ ...t.dark, ...t.light }, config.contrastPairs),
  };
}

function rule9(ctx) {
  const css = need(ctx, 9, "styles.css");
  if (css === null) return;
  const file = "site/styles.css";
  const t = readTokens(css, file, { strictPrint: true });
  for (const p of t.problems) ctx.fail(9, file, p, "keep one :root rule, one light media rule and one print media rule");
  if (t.problems.length) return;
  const bad = sameProps(t.light, t.print || {});
  if (bad.length) ctx.fail(9, file, `the @media print tokens differ from the light tokens (${bad.join(", ")})`, "make the print rule repeat the light rule");
  let mock;
  try {
    const tree = parseHtml(fs.readFileSync(ctx.opts.mockupPath, "utf8"));
    mock = readTokens(byTag(tree, "style").map(textContent).join("\n"), "docs/site/mockup.html", { strictPrint: false });
  } catch (e) {
    ctx.fail(9, "docs/site/mockup.html", `cannot be read (${e.code || e.message})`, "restore it from git");
    return;
  }
  const dd = sameProps(t.dark, mock.dark);
  if (dd.length) ctx.fail(9, file, `dark tokens differ from the mockup's: ${dd.map((k) => `${k} is ${t.dark[k]} not ${mock.dark[k]}`).join(", ")}`, "use the mockup's names and values");
  const ld = sameProps(t.light, mock.light);
  if (ld.length) ctx.fail(9, file, `light tokens differ from the mockup's: ${ld.map((k) => `${k} is ${t.light[k]} not ${mock.light[k]}`).join(", ")}`, "use the mockup's names and values");
  const schemes = { dark: t.dark, light: { ...t.dark, ...t.light } };
  for (const [scheme, tokens] of Object.entries(schemes)) {
    for (const r of pairRatios(tokens, ctx.config.contrastPairs)) {
      const names = `${r.fg} ${r.fgValue} on ${r.bg} ${r.bgValue}`;
      if (r.ratio === null) ctx.fail(9, file, `${scheme}: ${names} is missing or not a #rgb/#rrggbb colour`, "declare both tokens as hex colours");
      else if (r.ratio < ctx.config.contrastMin) {
        ctx.fail(9, file, `${scheme}: ${names} has contrast ${r.ratio.toFixed(2)}, below ${ctx.config.contrastMin}`, "change the colour; the pairs come from docs/site/checks.json");
      }
    }
  }
}

// ---- rule 10: accessible structure

const FOCUSABLE = (n) =>
  (n.tag === "a" && "href" in n.attrs) ||
  ["button", "input", "select", "textarea", "summary"].includes(n.tag) ||
  (n.attrs.tabindex !== undefined && Number(n.attrs.tabindex) >= 0);

function visibleOf(node) {
  if (node.text !== undefined) return node.text;
  if (node.attrs["aria-hidden"] === "true") return "";
  return node.children.map(visibleOf).join("");
}

const hiddenAncestor = (n) => {
  for (let a = n.parent; a; a = a.parent) if (a.attrs && a.attrs["aria-hidden"] === "true") return true;
  return false;
};

function rule10(ctx) {
  for (const rel of HTML_FILES) {
    const src = need(ctx, 10, rel);
    if (src === null) continue;
    const file = `site/${rel}`;
    const tree = parseHtml(src);
    const bad = (el, what, fix) => ctx.fail(10, file, `line ${el.line}: ${what}`, fix);
    const html = byTag(tree, "html")[0];
    if (!html || html.attrs.lang !== "en") ctx.fail(10, file, '<html> lacks lang="en"', 'write <html lang="en">');
    const heads = findAll(tree, (n) => /^h[1-6]$/.test(n.tag));
    const h1s = heads.filter((h) => h.tag === "h1");
    if (h1s.length !== 1) ctx.fail(10, file, `has ${h1s.length} h1 elements`, "keep exactly one h1");
    let prev = 0;
    for (const h of heads) {
      const level = Number(h.tag[1]);
      if (level > prev + 1) bad(h, `<${h.tag}> follows ${prev ? `an h${prev}` : "no heading"}, skipping a level`, "do not skip heading levels");
      prev = level;
    }
    for (const img of byTag(tree, "img")) if (!("alt" in img.attrs)) bad(img, "<img> has no alt attribute", 'add alt="" for decoration or describe the image');
    for (const svg of byTag(tree, "svg")) {
      const ok = svg.attrs["aria-hidden"] === "true" || hiddenAncestor(svg) || (svg.attrs.role === "img" && (svg.attrs["aria-label"] || "").trim() !== "");
      if (!ok) bad(svg, '<svg> is not aria-hidden="true" and has no role="img" with an aria-label', 'add aria-hidden="true"');
    }
    const ids = new Set(findAll(tree, (n) => "id" in n.attrs).map((n) => n.attrs.id));
    for (const el of findAll(tree, (n) => (n.attrs.href || "").startsWith("#"))) {
      const target = el.attrs.href.slice(1);
      if (!target || !ids.has(target)) bad(el, `href="${el.attrs.href}" has no element with that id`, "point it at an existing id");
    }
    const body = byTag(tree, "body")[0];
    const first = body ? findAll(body, FOCUSABLE)[0] : null;
    if (!first || first.tag !== "a" || !hasClass(first, "skip") || first.attrs.href !== "#main") {
      ctx.fail(10, file, `the first focusable element is ${first ? `<${first.tag}> on line ${first.line}` : "missing"}, not the skip link`, 'make <a class="skip" href="#main"> the first focusable element in <body>');
    }
    for (const b of byTag(tree, "button")) {
      if (b.attrs.type !== "button") bad(b, '<button> lacks type="button"', 'add type="button"');
      if ((b.attrs["aria-label"] || "").trim() === "" && collapse(visibleOf(b)) === "") bad(b, "<button> has no accessible name", "add an aria-label or visible text");
    }
    const main = byTag(tree, "main")[0];
    if (!main || main.attrs.id !== "main") ctx.fail(10, file, 'has no <main id="main">', 'wrap the content in <main id="main">');
  }
}

// ---- rule 11: display name

function rule11(ctx) {
  const r = spawnSync(process.execPath, [ctx.opts.checkNamesPath, ctx.opts.siteDir], { encoding: "utf8" });
  if (r.status === 0) return;
  const lines = (r.stderr || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) lines.push(`check-names exited ${r.status} without a message`);
  for (const l of lines) ctx.fail(11, "site/", l, "do: write the macron as U+016B and only in the standalone word");
}

// ---- rule 12: headers (SPEC section 6, verbatim)

const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000

/marketplace.json
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex
`;

// Cloudflare Pages limits, not tunables.
const HEADERS_MAX_LINE = 2000;
const HEADERS_MAX_RULES = 100;

function rule12(ctx) {
  const text = need(ctx, 12, "_headers");
  if (text === null) return;
  if (text !== HEADERS) ctx.fail(12, "site/_headers", "differs from the block in SPEC section 6", "restore it byte for byte, with one trailing newline");
  const lines = text.split("\n");
  lines.forEach((l, k) => {
    if (l.length > HEADERS_MAX_LINE) ctx.fail(12, "site/_headers", `line ${k + 1} is ${l.length} characters, over ${HEADERS_MAX_LINE}`, "shorten it; Cloudflare ignores longer lines");
  });
  const rules = lines.filter((l) => l.trim() !== "" && !/^\s/.test(l)).length;
  if (rules > HEADERS_MAX_RULES) ctx.fail(12, "site/_headers", `has ${rules} rules, over ${HEADERS_MAX_RULES}`, "remove rules; Cloudflare allows at most that many");
}

// ---- rule 13: size budget

function rule13(ctx) {
  const size = (rel) => {
    const p = path.join(ctx.opts.siteDir, rel);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  };
  const text = ["index.html", "styles.css", "copy.js", "404.html"].reduce((n, f) => n + size(f), 0);
  if (text > ctx.config.budget.textBytes) {
    ctx.fail(13, "site/", `index.html + styles.css + copy.js + 404.html total ${text} bytes, over the budget of ${ctx.config.budget.textBytes}`, "trim the page or raise budget.textBytes in docs/site/checks.json deliberately");
  }
  const fonts = ctx.siteFiles.filter((f) => f.startsWith("fonts/") && f.endsWith(".woff2")).reduce((n, f) => n + size(f), 0);
  if (fonts > ctx.config.budget.fontBytes) {
    ctx.fail(13, "site/fonts/", `the .woff2 files total ${fonts} bytes, over the budget of ${ctx.config.budget.fontBytes}`, "drop a subset or raise budget.fontBytes in docs/site/checks.json deliberately");
  }
}

// ---- rule 14: no dependencies

const DEP_KEYS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

function rule14(ctx) {
  try {
    const pkg = JSON.parse(fs.readFileSync(ctx.opts.packageJsonPath, "utf8"));
    for (const k of DEP_KEYS) if (k in pkg) ctx.fail(14, "package.json", `has a ${k} key`, "remove it; the repo has no dependencies");
  } catch (e) {
    ctx.fail(14, "package.json", `cannot be read as JSON (${e.code || e.message})`, "restore it from git");
  }
  const specs = [
    /\bimport\s+(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const requireCall = new RegExp("\\brequire\\s*\\(");
  for (const p of ctx.opts.scriptPaths) {
    const name = `scripts/${path.basename(p)}`;
    const text = fs.readFileSync(p, "utf8");
    for (const re of specs) {
      for (const m of text.matchAll(re)) {
        if (!m[1].startsWith("node:") && !m[1].startsWith("./")) ctx.fail(14, name, `imports "${m[1]}"`, 'import only "node:" built-ins or "./" files');
      }
    }
    if (requireCall.test(text)) ctx.fail(14, name, "uses CommonJS require", 'use import with a "node:" specifier');
  }
}

// ---- rule 16: approved copy changes stay applied

const COPY_CHANGES_KEYS = ["approved", "approvedAt", "changes"];
const COPY_CHANGE_KEYS = ["old", "new"];
const COPY_CHANGES_NAME = "docs/site/copy-changes.json";

// The owner's file is read, never written. With no file there is nothing to hold the page to.
function rule16(ctx) {
  const file = ctx.opts.copyChangesPath;
  if (!file || !fs.existsSync(file)) return;
  const bad = (what) => ctx.fail(16, COPY_CHANGES_NAME, what, "restore the file from git; it is the owner's approval and no check or task edits it");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    bad(`is not valid JSON (${e.message})`);
    return;
  }
  if (!isPlainObject(data)) {
    bad("must be a JSON object");
    return;
  }
  let shaped = true;
  const flag = (what) => {
    bad(what);
    shaped = false;
  };
  for (const k of Object.keys(data)) if (!COPY_CHANGES_KEYS.includes(k)) flag(`has an unknown key "${k}"`);
  for (const k of ["approved", "approvedAt"]) {
    if (typeof data[k] !== "string" || data[k] === "") flag(`"${k}" must be a non-empty string`);
  }
  if (!Array.isArray(data.changes) || data.changes.length === 0) flag('"changes" must be a non-empty array of { old, new }');
  else {
    data.changes.forEach((c, k) => {
      const n = k + 1;
      if (!isPlainObject(c)) return flag(`change ${n} must be an object with "old" and "new"`);
      for (const key of Object.keys(c)) if (!COPY_CHANGE_KEYS.includes(key)) flag(`change ${n} has an unknown key "${key}"`);
      if (typeof c.old !== "string" || c.old === "") flag(`change ${n}: "old" must be a non-empty string`);
      if (typeof c.new !== "string") flag(`change ${n}: "new" must be a string`);
    });
  }
  if (!shaped) return;
  const targets = [
    ["docs/site/mockup.html", ctx.opts.mockupPath],
    ["site/index.html", path.join(ctx.opts.siteDir, "index.html")],
  ];
  for (const [label, p] of targets) {
    let text;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch (e) {
      ctx.fail(16, label, `cannot be read (${e.code || e.message})`, "restore the file from git");
      continue;
    }
    data.changes.forEach((c, k) => {
      if (text.includes(c.old) || !text.includes(c.new)) ctx.fail(16, label, `approved copy change ${k + 1} not applied`, "apply docs/site/copy-changes.json");
    });
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
  rule3(ctx);
  rule4(ctx);
  rule5(ctx);
  rule6(ctx);
  rule7(ctx);
  rule8(ctx);
  rule9(ctx);
  rule10(ctx);
  rule11(ctx);
  rule12(ctx);
  rule13(ctx);
  rule14(ctx);
  rule16(ctx);
  return failures;
}

export const formatFailure = (f) => `check-site: rule ${f.rule}: ${f.file}: ${f.message}`;

// ---------------------------------------------------------------- report

const round2 = (n) => Math.round(n * 100) / 100;

// Every assumption in docs/site/checks.json beside what the site measures.
export function report(overrides = {}) {
  const opts = { ...defaultOpts(), ...overrides };
  const config = loadConfig(opts.configPath);
  const size = (rel) => {
    const p = path.join(opts.siteDir, rel);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  };
  const files = {};
  for (const f of ["index.html", "styles.css", "copy.js", "404.html"]) files[f] = size(f);
  const fonts = walk(path.join(opts.siteDir, "fonts")).filter((f) => f.endsWith(".woff2")).reduce((n, f) => n + size(`fonts/${f}`), 0);
  const cr = contrastReport(opts);
  const lowest = (rows) => {
    const worst = rows.filter((r) => r.ratio !== null).sort((a, b) => a.ratio - b.ratio)[0];
    return { lowest: round2(worst.ratio), pair: `${worst.fg} on ${worst.bg}` };
  };
  return {
    textBytes: { budget: config.budget.textBytes, measured: Object.values(files).reduce((a, b) => a + b, 0), files },
    fontBytes: { budget: config.budget.fontBytes, measured: fonts },
    scriptBytes: { budget: config.budget.scriptBytes, measured: files["copy.js"] },
    contrast: { min: config.contrastMin, dark: lowest(cr.dark), light: lowest(cr.light) },
    copyFeedbackMs: { value: config.copyFeedbackMs, measured: null },
    servePort: { value: config.servePort, measured: null },
  };
}

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

// Replace text in a copy of a site file; a replacement that matches nothing is a bug in the case.
function sub(t, file, from, to, all = false) {
  const p = path.join(t.site, file);
  const text = fs.readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`self-test case cannot find ${JSON.stringify(from)} in site/${file}`);
  fs.writeFileSync(p, all ? text.split(from).join(to) : text.replace(from, () => to));
}

CASES.push(
  { rule: 3, name: "rule 3: style attribute on the h1", expect: "<h1> has a style attribute", inject: (t) => sub(t, "index.html", '<h1 class="h1">', '<h1 class="h1" style="color:red">') },
  { rule: 3, name: "rule 3: a <style> element in the head", expect: "<style>", inject: (t) => sub(t, "index.html", "</head>", "<style>p{}</style></head>") },
  { rule: 3, name: "rule 3: style attribute on an inline svg", expect: "<svg> has a style attribute", inject: (t) => sub(t, "index.html", '<svg class="brand-mark"', '<svg style="fill:red" class="brand-mark"') },
  { rule: 4, name: "rule 4: an onclick attribute", expect: "inline event handler", inject: (t) => sub(t, "index.html", '<button type="button" class="copy"', '<button onclick="x()" type="button" class="copy"') },
  { rule: 4, name: "rule 4: a second script tag", expect: "2 <script> tags", inject: (t) => sub(t, "index.html", "</head>", '<script src="/copy.js" defer></script></head>') },
  { rule: 4, name: "rule 4: a script in 404.html", expect: "<script> tag", inject: (t) => sub(t, "404.html", "</body>", "<script></script></body>") },
  {
    rule: 4,
    name: "rule 4: copy.js over the script budget",
    expect: "over the script budget",
    inject: (t) => fs.appendFileSync(path.join(t.site, "copy.js"), `/*${"x".repeat(readJson(t.config).budget.scriptBytes)}*/\n`),
  },
  {
    rule: 4,
    name: "rule 4: COPY_FEEDBACK_MS differs from the config",
    expect: "copyFeedbackMs",
    inject: (t) => {
      const n = readJson(t.config).copyFeedbackMs;
      sub(t, "copy.js", `COPY_FEEDBACK_MS = ${n};`, `COPY_FEEDBACK_MS = ${n + 1};`);
    },
  },
  { rule: 4, name: "rule 4: a copy button without hidden", expect: "lacks the hidden attribute", inject: (t) => sub(t, "index.html", ' hidden><', "><") },
  { rule: 4, name: "rule 4: no [hidden] rule", expect: "[hidden]", inject: (t) => sub(t, "styles.css", "[hidden]{display:none !important}", "") },
  { rule: 5, name: "rule 5: a third-party image", expect: "not root-relative", inject: (t) => sub(t, "index.html", "</main>", '<img src="https://example.com/x.png" alt=""></main>') },
  { rule: 5, name: "rule 5: a third-party font url", expect: "is not root-relative", inject: (t) => sub(t, "styles.css", "url(/fonts/jetbrains-mono-latin-wght-normal.woff2)", "url(https://fonts.gstatic.com/x.woff2)") },
  { rule: 5, name: "rule 5: a changed canonical", expect: "canonical is", inject: (t) => sub(t, "index.html", 'href="https://kukulu.tech/"', 'href="https://kukulu.tech/index.html"') },
  { rule: 6, name: "rule 6: a changed h1", expect: "heading differs", inject: (t) => sub(t, "index.html", "Rebuild from the spec. Prove nothing leaked.</h1>", "Rebuild from the spec.</h1>") },
  { rule: 6, name: "rule 6: a changed table number", expect: "proof table cell differs", inject: (t) => sub(t, "index.html", "2,226", "2,227") },
  { rule: 6, name: "rule 6: a changed number in Built by", expect: "number token", inject: (t) => sub(t, "index.html", "spent 20 years", "spent 21 years") },
  { rule: 6, name: "rule 6: the ASCII display name in prose", expect: "ASCII spelling", inject: (t) => sub(t, "index.html", "Kūkulu never merges", "Kukulu never merges") },
  { rule: 7, name: "rule 7: a changed hero install id", expect: "#install-session reads", inject: (t) => sub(t, "index.html", "/plugin install kukulu@displacetech", "/plugin install kukulu@example") },
  { rule: 7, name: "rule 7: the shell install line removed", expect: "#install-shell reads", inject: (t) => sub(t, "index.html", "\nclaude plugin install kukulu@displacetech", "") },
);

// Replace text only inside the part of a file that follows `after`.
function subAfter(t, file, after, from, to) {
  const p = path.join(t.site, file);
  const text = fs.readFileSync(p, "utf8");
  const at = text.indexOf(after);
  if (at === -1 || !text.includes(from, at)) throw new Error(`self-test case cannot find ${JSON.stringify(from)} after ${JSON.stringify(after)} in site/${file}`);
  const k = text.indexOf(from, at);
  fs.writeFileSync(p, text.slice(0, k) + to + text.slice(k + from.length));
}

CASES.push(
  { rule: 1, name: "rule 1: robots.txt deleted", expect: "robots.txt is missing", inject: (t) => fs.rmSync(path.join(t.site, "robots.txt")) },
  { rule: 9, name: "rule 9: a darker dark --muted", expect: "--muted", inject: (t) => sub(t, "styles.css", "--muted:#A7B3BD", "--muted:#333333") },
  { rule: 9, name: "rule 9: contrastMin 21", expect: "below 21", inject: (t) => editConfig(t, (c) => { c.contrastMin = 21; }) },
  { rule: 9, name: "rule 9: the print block removed", expect: "@media print blocks", inject: (t) => {
    const p = path.join(t.site, "styles.css");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/@media print\{[^\n]*\n/, ""));
  } },
  { rule: 9, name: "rule 9: a changed light --accent-text", expect: "light tokens differ", inject: (t) => subAfter(t, "styles.css", "prefers-color-scheme: light", "--accent-text:#8E4C0B", "--accent-text:#8E4C0C") },
  { rule: 10, name: "rule 10: lang removed", expect: 'lacks lang="en"', inject: (t) => sub(t, "index.html", '<html lang="en">', "<html>") },
  { rule: 10, name: "rule 10: a second h1", expect: "2 h1 elements", inject: (t) => sub(t, "index.html", "</main>", "<h1>Again</h1></main>") },
  { rule: 10, name: "rule 10: an h4 after the h1 in 404.html", expect: "skipping a level", inject: (t) => sub(t, "404.html", "Page not found.</h1>", "Page not found.</h1><h4>x</h4>") },
  { rule: 10, name: "rule 10: an svg that is not aria-hidden", expect: "<svg> is not aria-hidden", inject: (t) => sub(t, "index.html", 'viewBox="0 0 32 32" aria-hidden="true"', 'viewBox="0 0 32 32"') },
  { rule: 10, name: "rule 10: a dangling fragment link", expect: 'href="#nowhere"', inject: (t) => sub(t, "index.html", "</main>", '<a href="#nowhere">x</a></main>') },
  { rule: 10, name: "rule 10: a link before the skip link", expect: "not the skip link", inject: (t) => sub(t, "index.html", '<a class="skip"', '<a href="/">x</a><a class="skip"') },
  { rule: 10, name: "rule 10: a button without type", expect: 'lacks type="button"', inject: (t) => sub(t, "index.html", '<button type="button" class="copy"', '<button class="copy"') },
  { rule: 11, name: "rule 11: a decomposed display name", expect: "do: write the macron", inject: (t) => sub(t, "index.html", "Hawaiian for", `K${"u" + "\u0304"}kulu is Hawaiian for`) },
  { rule: 12, name: "rule 12: a changed Referrer-Policy", expect: "differs from the block in SPEC", inject: (t) => sub(t, "_headers", "Referrer-Policy: no-referrer", "Referrer-Policy: same-origin") },
  { rule: 12, name: "rule 12: a Cache-Control line", expect: "differs from the block in SPEC", inject: (t) => sub(t, "_headers", "  X-Content-Type-Options", "  Cache-Control: max-age=60\n  X-Content-Type-Options") },
  {
    rule: 13,
    name: "rule 13: text over budget",
    expect: "over the budget",
    inject: (t) => sub(t, "index.html", "</body>", `<!--${"x".repeat(readJson(t.config).budget.textBytes + 1)}--></body>`),
  },
  { rule: 13, name: "rule 13: fontBytes 1000", expect: "the .woff2 files total", inject: (t) => editConfig(t, (c) => { c.budget.fontBytes = 1000; }) },
  {
    rule: 14,
    name: "rule 14: a devDependencies key",
    expect: "devDependencies",
    inject: (t) => {
      const pkg = readJson(t.pkg);
      pkg.devDependencies = { "left-pad": "1.3.0" };
      writeJson(t.pkg, pkg);
    },
  },
  {
    rule: "report",
    name: "report: textBytes.measured is the sum of the four files",
    expect: "textBytes",
    inject: () => {},
    verify: (t, opts) => {
      const sum = ["index.html", "styles.css", "copy.js", "404.html"].reduce((n, f) => n + fs.statSync(path.join(t.site, f)).size, 0);
      const got = report(optsFor(t, opts)).textBytes.measured;
      return got === sum ? null : `textBytes.measured is ${got}, not ${sum}`;
    },
  },
  { rule: 4, name: "rule 4: install-shell-status given text", expect: "has a status element that is not empty", inject: (t) => sub(t, "index.html", 'id="install-shell-status" role="status" aria-live="polite"></p>', 'id="install-shell-status" role="status" aria-live="polite">x</p>') },
  { rule: 4, name: "rule 4: a .copy-label that does not read Copy", expect: "has no .copy-label reading", inject: (t) => sub(t, "index.html", '<span class="copy-label">Copy</span>', '<span class="copy-label">Grab</span>') },
  { rule: 4, name: "rule 4: the flight-cmd code id renamed", expect: "has no <code> target", inject: (t) => sub(t, "index.html", '<code id="flight-cmd">', '<code id="flight-cmd-x">') },
  { rule: 4, name: "rule 4: a blank line after copy.js line 1", expect: "line 2 is not the COPY_FEEDBACK_MS declaration", inject: (t) => sub(t, "copy.js", "(() => {\n", "(() => {\n\n") },
  { rule: 5, name: "rule 5: og:image set to /og.png", expect: "og:image is", inject: (t) => sub(t, "index.html", '<meta property="og:image" content="https://kukulu.tech/og.png">', '<meta property="og:image" content="/og.png">') },
  { rule: 5, name: "rule 5: a third-party stylesheet link", expect: "<link> href", inject: (t) => sub(t, "index.html", "</head>", '<link rel="stylesheet" href="https://example.com/x.css"></head>') },
  { rule: 5, name: "rule 5: @import in styles.css", expect: "uses @import", inject: (t) => {
    const p = path.join(t.site, "styles.css");
    fs.writeFileSync(p, `@import url(/x.css);\n${fs.readFileSync(p, "utf8")}`);
  } },
  { rule: 8, name: "rule 8: a changed owner.name", expect: "owner.name", inject: (t) => editMarketplace(t, (m) => { m.owner.name = "someone else"; }) },
  { rule: 9, name: "rule 9: a changed print token", expect: "@media print tokens differ", inject: (t) => subAfter(t, "styles.css", "@media print", "--muted:#4A5866", "--muted:#4A5867") },
  { rule: 9, name: "rule 9: a contrast pair with a non-hex token", expect: "not a #rgb/#rrggbb colour", inject: (t) => editConfig(t, (c) => { c.contrastPairs.push(["--grid", "--bg"]); }) },
  { rule: 10, name: "rule 10: an img without alt", expect: "no alt attribute", inject: (t) => sub(t, "index.html", "</main>", '<img src="/og.png"></main>') },
  { rule: 10, name: "rule 10: a button with no name", expect: "no accessible name", inject: (t) => sub(t, "index.html", "</main>", '<button type="button"></button></main>') },
  { rule: 10, name: "rule 10: 404.html main renamed", expect: 'has no <main id="main">', inject: (t) => sub(t, "404.html", '<main id="main"', '<main id="content"') },
  { rule: 12, name: "rule 12: a header line over the line limit", expect: "characters, over", inject: (t) => fs.appendFileSync(path.join(t.site, "_headers"), `  X-Long: ${"x".repeat(HEADERS_MAX_LINE)}\n`) },
  { rule: 12, name: "rule 12: more rules than the rule limit", expect: "rules, over", inject: (t) => fs.appendFileSync(path.join(t.site, "_headers"), Array.from({ length: HEADERS_MAX_RULES + 1 }, (_, k) => `/r${k}\n`).join("")) },
  { rule: 14, name: "rule 14: a CommonJS require call", expect: "CommonJS require", inject: (t) => fs.appendFileSync(path.join(t.scripts, "check-site.mjs"), `\nconst fsx = ${"req" + "uire"}("fs");\n`) },
  { rule: "config", name: "config: contrastMin below 1", expect: '"contrastMin" must be', inject: (t) => editConfig(t, (c) => { c.contrastMin = 0.5; }) },
  { rule: 14, name: "rule 14: a third-party import", expect: 'imports "left-pad"', inject: (t) => fs.appendFileSync(path.join(t.scripts, "check-site.mjs"), ["", "import pad " + "from" + ' "left-pad";', ""].join("\n")) },
);

// A pair of the approved copy changes, from the temp copy of the owner's file.
const pairOf = (t, n) => readJson(t.copyChanges).changes[n - 1];
const editMockup = (t, from, to) => {
  const text = fs.readFileSync(t.mockup, "utf8");
  if (!text.includes(from)) throw new Error(`self-test case cannot find ${JSON.stringify(from)} in the mockup`);
  fs.writeFileSync(t.mockup, text.replace(from, () => to));
};
const writeCopyChanges = (t, data) => fs.writeFileSync(t.copyChanges, `${JSON.stringify(data, null, 2)}\n`);

CASES.push(
  { rule: 16, name: "rule 16: a pair not applied to the page", expect: "approved copy change 1 not applied", inject: (t) => sub(t, "index.html", pairOf(t, 1).new, pairOf(t, 1).old) },
  { rule: 16, name: "rule 16: a pair not applied to the mockup", expect: "approved copy change 2 not applied", inject: (t) => editMockup(t, pairOf(t, 2).new, pairOf(t, 2).old) },
  { rule: 16, name: "rule 16: an old string still present", expect: "approved copy change 3 not applied", inject: (t) => sub(t, "index.html", "</main>", `<p>${pairOf(t, 3).old}</p></main>`) },
  { rule: 16, name: "rule 16: a malformed copy-changes file", expect: 'has an unknown key "extra"', inject: (t) => writeCopyChanges(t, { ...readJson(t.copyChanges), extra: 1 }) },
  { rule: 16, name: "rule 16: an empty changes list", expect: '"changes" must be a non-empty array', inject: (t) => writeCopyChanges(t, { ...readJson(t.copyChanges), changes: [] }) },
  { rule: 16, name: "rule 16: a change with an empty old", expect: 'change 1: "old" must be a non-empty string', inject: (t) => writeCopyChanges(t, { ...readJson(t.copyChanges), changes: [{ old: "", new: "x" }] }) },
  { rule: 16, name: "rule 16: a copy-changes file that is not JSON", expect: "is not valid JSON", inject: (t) => fs.writeFileSync(t.copyChanges, "{ nope") },
);

function makeTemp(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-site-"));
  const t = {
    dir,
    site: path.join(dir, "site"),
    config: path.join(dir, "checks.json"),
    pkg: path.join(dir, "package.json"),
    scripts: path.join(dir, "scripts"),
    mockup: path.join(dir, "mockup.html"),
    copyChanges: path.join(dir, "copy-changes.json"),
  };
  fs.cpSync(opts.siteDir, t.site, { recursive: true });
  fs.copyFileSync(opts.configPath, t.config);
  fs.copyFileSync(opts.packageJsonPath, t.pkg);
  fs.copyFileSync(opts.mockupPath, t.mockup);
  if (fs.existsSync(opts.copyChangesPath)) fs.copyFileSync(opts.copyChangesPath, t.copyChanges);
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
    mockupPath: t.mockup,
    copyChangesPath: t.copyChanges,
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
      if (c.rule === "report") {
        const bad = c.verify(t, base);
        if (bad) problems.push(`${c.name}: ${bad}`);
      } else if (c.rule === "config") {
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
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--self-test" && flags[0] !== "--report")) {
    process.stderr.write("usage: node scripts/check-site.mjs [--self-test | --report]\n");
    return 2;
  }
  try {
    if (flags[0] === "--self-test") {
      const r = selfTest();
      for (const p of r.problems) process.stderr.write(`check-site self-test: ${p}\n`);
      if (r.ok) process.stdout.write(`check-site self-test: ok (${r.count} cases)\n`);
      return r.ok ? 0 : 1;
    }
    if (flags[0] === "--report") {
      process.stdout.write(`${JSON.stringify(report(), null, 2)}\n`);
      return 0;
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
