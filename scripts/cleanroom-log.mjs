#!/usr/bin/env node
// Kūkulu clean-room logger: the PostToolUse and UserPromptSubmit hook (SPEC
// D-02, D-04, D-09). Like the guard it exits 0 at once, silently, in a project
// with no clean-room policy, before importing anything but node: built-ins.

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

// A policy exists. P3-12 replaces this with the real logging; the logger never blocks a call.
process.exit(0);
