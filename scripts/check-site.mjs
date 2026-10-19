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
const IMPLEMENTED_RULES = [1, 2, 3, 4, 5, 6, 7, 8];

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
