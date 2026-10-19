#!/usr/bin/env node
// Kūkulu clean-room guard: the PreToolUse hook (SPEC D-02, D-03).
//
// Every project pays for this hook on every tool call, so the first thing it
// does is the cheapest check there is: does the project have a clean-room
// policy at all? If not it exits 0 without output, having imported nothing
// but node: built-ins. mcp/cleanroom.mjs is loaded only after that check,
// with a dynamic import (constraint hooks-lazy-cleanroom).

import fs from "node:fs";
import path from "node:path";

const readStdin = () => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const parseInput = (raw) => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** The policy path docs/kukulu.json names, else the default; an unreadable config means the default. */
function policyFile(root) {
  let rel = "docs/cleanroom.json";
  try {
    const named = JSON.parse(fs.readFileSync(path.join(root, "docs", "kukulu.json"), "utf8"))?.cleanroom?.policy;
    if (typeof named === "string" && named) rel = named;
  } catch {
    // no config, or not JSON: the default applies
  }
  return path.resolve(root, rel);
}

const input = parseInput(readStdin());
const root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
if (!fs.existsSync(policyFile(root))) process.exit(0);

// A policy exists. P3-11 replaces this with the real evaluation; until then the
// guard fails closed, as the rest of the guard will (SPEC principle 11).
process.stderr.write("kukulu clean-room guard: guard internal error: the guard is not implemented yet\n");
process.exit(2);
