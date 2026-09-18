// Parse every ```mermaid block in the repo's Markdown with Mermaid itself.
//
// A diagram that does not parse renders as an error box on GitHub, which is
// the sort of breakage nobody notices until someone else reads the docs. This
// is deliberately NOT part of `npm test`: it needs mermaid and jsdom, and the
// plugin is dependency-free on purpose. CI installs them with --no-save for
// this one job. Locally:
//
//   npm install --no-save mermaid jsdom && node scripts/check-diagrams.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  console.error("check-diagrams: jsdom is not installed.\n  npm install --no-save mermaid jsdom");
  process.exit(2);
}

// Mermaid expects a browser. Give it the minimum one that lets it parse.
const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
for (const key of ["window", "document", "Element", "SVGElement", "HTMLElement", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const mermaid = (await import("mermaid")).default;
mermaid.initialize({ startOnLoad: false });

const markdown = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith(".") || e.name === "node_modules") return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return markdown(full);
    return e.name.endsWith(".md") ? [full] : [];
  });

let total = 0;
let failed = 0;
for (const file of markdown(ROOT).sort()) {
  const rel = path.relative(ROOT, file);
  let n = 0;
  for (const block of fs.readFileSync(file, "utf8").matchAll(/^```mermaid\n([\s\S]*?)^```/gm)) {
    total++;
    n++;
    try {
      await mermaid.parse(block[1]);
      console.log(`ok    ${rel} diagram ${n}`);
    } catch (e) {
      failed++;
      const message = String(e?.message || e).split("\n").slice(0, 8).join("\n        ");
      console.log(`FAIL  ${rel} diagram ${n}\n        ${message}`);
    }
  }
}

console.log(`\n${total - failed}/${total} diagrams parse`);
process.exit(failed ? 1 : 0);
