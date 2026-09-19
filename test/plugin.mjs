// Static checks on the plugin itself: manifests, agent and skill frontmatter,
// hook wiring, cross-references and documentation links. None of this needs a
// running server, and all of it breaks silently at load time if it drifts —
// Claude Code will simply not offer the agent, or will offer one that points
// at a skill that no longer exists.

import fs from "node:fs";
import path from "node:path";
import { finish, ok, eq, like, ROOT, frontmatter } from "./harness.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const listDir = (rel) => fs.readdirSync(path.join(ROOT, rel));

const MODELS = ["fable", "opus", "sonnet", "haiku", "inherit"];
const EFFORTS = ["low", "medium", "high"];

// ---------------------------------------------------------------- manifests

const plugin = json(".claude-plugin/plugin.json");
const pkg = json("package.json");
const market = json(".claude-plugin/marketplace.json");

eq(plugin.name, "foundry", "the plugin is named foundry");
ok(plugin.description && plugin.description.length > 40, "the plugin describes itself in the marketplace listing");
like(plugin.version, /^\d+\.\d+\.\d+$/, "the plugin version is semver");
ok(plugin.author?.name, "the plugin names an author");
ok(Array.isArray(plugin.keywords) && plugin.keywords.length >= 3, "the plugin carries keywords for discovery");

eq(pkg.version, plugin.version, "package.json and plugin.json agree on the version");
const serverVersion = read("mcp/server.mjs").match(/const VERSION = "([^"]+)"/)[1];
eq(serverVersion, plugin.version, "the MCP server reports the plugin's version");
eq(pkg.type, "module", "package.json declares ES modules");
ok(pkg.scripts.test && pkg.scripts.lint, "package.json exposes test and lint");
like(pkg.engines.node, /^>=\d+$/, "package.json states a Node floor");

eq(market.plugins.length, 1, "the marketplace lists exactly this plugin");
eq(market.plugins[0].name, plugin.name, "the marketplace entry matches the plugin name");
ok(exists(market.plugins[0].source), "the marketplace source path resolves");
ok(market.owner?.name, "the marketplace names an owner");

// ---------------------------------------------------------------- MCP wiring

eq(plugin.mcpServers, "./.mcp.json", "the plugin points at .mcp.json for its MCP server");
const mcp = json(".mcp.json");
const server = mcp.mcpServers.foundry;
ok(server, "the MCP config defines a server called foundry");
eq(server.command, "node", "the server runs under node, with no install step");
like(server.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}/, "the server path is resolved from CLAUDE_PLUGIN_ROOT");
ok(exists(server.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", "")), "the server file the config names exists");
eq(server.env.FOUNDRY_PROJECT_DIR, "${CLAUDE_PROJECT_DIR}", "the server is told which project it is operating on");

// ---------------------------------------------------------------- hooks

eq(plugin.hooks, "./hooks/hooks.json", "the plugin points at hooks/hooks.json");
const hooks = json("hooks/hooks.json");
eq(Object.keys(hooks.hooks).sort().join(","), "Stop,SubagentStop", "the guard is wired to Stop and SubagentStop");
for (const [event, entries] of Object.entries(hooks.hooks)) {
  const cmd = entries[0].hooks[0];
  eq(cmd.type, "command", `${event} runs a command hook`);
  like(cmd.command, /^"\$\{CLAUDE_PLUGIN_ROOT\}"\//, `${event}'s command quotes the plugin root, so a path with spaces still works`);
  const script = cmd.command.replace(/^"\$\{CLAUDE_PLUGIN_ROOT\}"\//, "");
  ok(exists(script), `${event}'s script exists`);
  ok(fs.statSync(path.join(ROOT, script)).mode & 0o111, `${event}'s script is executable`);
  like(read(script), /^#!\/usr\/bin\/env bash\n/, `${event}'s script has a shebang`);
}

// ---------------------------------------------------------------- agents and skills

const skillNames = listDir("skills").filter((d) => exists(`skills/${d}/SKILL.md`));
const agentNames = listDir("agents").map((f) => f.replace(/\.md$/, ""));
eq(skillNames.sort().join(","), "go-flight,implement,plan-build,review-build,summarize", "the five skills are present");
eq(agentNames.sort().join(","), "implementer,planner,reviewer,summarizer", "the four stage agents are present");

for (const name of skillNames) {
  const fm = frontmatter(read(`skills/${name}/SKILL.md`));
  ok(fm, `skills/${name} has frontmatter`);
  eq(fm.name, name, `skills/${name}'s name matches its directory`);
  ok(fm.description && fm.description.length > 30, `skills/${name} has a usable description`);
  eq(fm["disable-model-invocation"], true, `skills/${name} is invoked deliberately, never guessed into`);
  ok(MODELS.includes(fm.model), `skills/${name} pins a known model (${fm.model})`);
  ok(EFFORTS.includes(fm.effort), `skills/${name} pins an effort level (${fm.effort})`);
}

for (const name of agentNames) {
  const body = read(`agents/${name}.md`);
  const fm = frontmatter(body);
  ok(fm, `agents/${name} has frontmatter`);
  eq(fm.name, name, `agents/${name}'s name matches its filename`);
  ok(fm.description && fm.description.length > 40, `agents/${name} has a description the orchestrator can route on`);
  ok(MODELS.includes(fm.model), `agents/${name} pins a known model (${fm.model})`);
  ok(EFFORTS.includes(fm.effort), `agents/${name} pins an effort level (${fm.effort})`);
  ok(fm.color, `agents/${name} has a colour`);
  const skills = Array.isArray(fm.skills) ? fm.skills : [];
  eq(skills.length, 1, `agents/${name} preloads exactly one skill`);
  like(skills[0], /^foundry:/, `agents/${name}'s skill is namespaced`);
  ok(skillNames.includes(skills[0].replace("foundry:", "")), `agents/${name}'s skill exists`);
  like(body, new RegExp(`/${skills[0]}`), `agents/${name} tells the model how to reload its skill by name`);
}

// The four stage agents must line up with the four stages the server delegates to.
const serverSrc = read("mcp/server.mjs");
const AGENT_MAP = serverSrc.match(/const AGENT = \{([^}]+)\}/)[1];
for (const name of agentNames) {
  like(AGENT_MAP, new RegExp(`foundry:${name}`), `the server's stage table names foundry:${name}`);
}
eq((AGENT_MAP.match(/foundry:/g) || []).length, agentNames.length, "the stage table has no agent the plugin does not ship");

// ---------------------------------------------------------------- the flight controller

const goFlight = read("skills/go-flight/SKILL.md");
const fmGo = frontmatter(goFlight);
const allowed = String(fmGo["allowed-tools"]).split(",").map((s) => s.trim());
const toolNames = Array.from(serverSrc.matchAll(/name: "(foundry_[a-z_]+)"/g), (m) => m[1]);
eq(toolNames.length, 10, "the server defines ten tools");
ok(allowed.includes("Agent"), "the flight controller may spawn agents");
for (const t of allowed.filter((a) => a.startsWith("mcp__"))) {
  ok(toolNames.includes(t.replace("mcp__foundry__", "")), `the flight controller's allowed tool ${t} exists`);
}
ok(
  allowed.every((a) => a === "Agent" || a.startsWith("mcp__foundry__foundry_")),
  "the flight controller is allowed nothing beyond Agent and the read-only foundry tools",
);
ok(
  !allowed.some((a) => /run_start|task_|run_finish|review_submit|summary_commit/.test(a)),
  "the flight controller cannot touch the tools that change state",
);
for (const name of agentNames) like(goFlight, new RegExp(`foundry:${name}`), `go-flight names foundry:${name}`);

// ---------------------------------------------------------------- cross-references

const MD = [
  "README.md",
  ...(exists("docs") ? listDir("docs").filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`) : []),
  ...(exists("CONTRIBUTING.md") ? ["CONTRIBUTING.md"] : []),
  ...(exists("CHANGELOG.md") ? ["CHANGELOG.md"] : []),
];
const PROSE = [...MD, ...skillNames.map((n) => `skills/${n}/SKILL.md`), ...agentNames.map((n) => `agents/${n}.md`), "templates/SPEC.md"];

let unknownTool = null;
let unknownSkill = null;
for (const file of PROSE) {
  const body = read(file);
  for (const m of body.matchAll(/\bfoundry_[a-z_]+/g)) {
    if (!toolNames.includes(m[0]) && !unknownTool) unknownTool = `${file}: ${m[0]}`;
  }
  for (const m of body.matchAll(/\bfoundry:([a-z-]+)/g)) {
    if (!skillNames.includes(m[1]) && !agentNames.includes(m[1]) && !unknownSkill) unknownSkill = `${file}: ${m[0]}`;
  }
}
eq(unknownTool, null, "every foundry_* tool named in prose exists on the server");
eq(unknownSkill, null, "every foundry:* skill or agent named in prose exists");

// Documentation links have to land somewhere.
let brokenLink = null;
for (const file of MD) {
  const dir = path.dirname(path.join(ROOT, file));
  for (const m of read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(dir, target)) && !brokenLink) brokenLink = `${file} → ${m[1]}`;
  }
}
eq(brokenLink, null, "every relative link in the documentation resolves");

// Diagrams are Mermaid, not ASCII art: box-drawing belongs only in a `text`
// fence (a file tree), never in a fence pretending to be a diagram.
let asciiArt = null;
for (const file of MD) {
  for (const m of read(file).matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)) {
    const [info, block] = [m[1].trim(), m[2]];
    if (/[│├└┌┐┘─►▶]/.test(block) && info !== "text" && !asciiArt) asciiArt = `${file}: \`\`\`${info || "(untagged)"}`;
  }
}
eq(asciiArt, null, "diagrams are drawn in Mermaid, not in box-drawing characters");

let mermaidCount = 0;
for (const file of MD) mermaidCount += (read(file).match(/^```mermaid$/gm) || []).length;
ok(mermaidCount >= 3, `the documentation carries Mermaid diagrams (${mermaidCount} found)`);

// ---------------------------------------------------------------- the spec template

const template = read("templates/SPEC.md");
for (const heading of [
  "## 1. Overview",
  "## 2. Goals and non-goals",
  "## 3. Engineering principles",
  "## 4. Architecture",
  "## 5. Data and configuration",
  "## 6. Interfaces",
  "## 7. Commands",
  "## 8. Phases",
  "## 9. Open questions",
]) {
  ok(template.includes(heading), `the SPEC template keeps "${heading}"`);
}
like(read("skills/plan-build/SKILL.md"), /⚠️ ASSUMPTION/, "the planner knows the template's assumption marker");
like(template, /⚠️ ASSUMPTION/, "the template explains the assumption marker");

// ---------------------------------------------------------------- CI wiring

const workflows = listDir(".github/workflows");
ok(workflows.length > 0, "there is at least one CI workflow");
let unpinned = null;
let usesCount = 0;
for (const wf of workflows) {
  for (const m of read(`.github/workflows/${wf}`).matchAll(/uses:\s*(\S+)/g)) {
    usesCount++;
    if (!/^[\w.-]+\/[\w./-]+@v?\d[\w.-]*$/.test(m[1]) && !unpinned) unpinned = `${wf}: ${m[1]}`;
  }
}
eq(unpinned, null, `every action in CI is pinned to a released version (${usesCount} uses)`);
ok(
  workflows.some((wf) => read(`.github/workflows/${wf}`).includes("npm test")),
  "CI runs the test suite",
);
ok(
  workflows.some((wf) => read(`.github/workflows/${wf}`).includes("npm run lint")),
  "CI runs the lint script",
);

// The matrix has to actually test the floor package.json promises.
const matrix = read(".github/workflows/ci.yml").match(/node: \[([^\]]+)\]/);
ok(matrix, "the CI matrix lists Node versions");
const versions = matrix[1].split(",").map((v) => Number(v.trim()));
eq(Math.min(...versions), Number(pkg.engines.node.replace(/\D/g, "")), "the CI matrix tests the Node floor package.json declares");
ok(versions.length >= 3, `the matrix covers several Node versions (${versions.join(", ")})`);

// Every document in docs/ is reachable from the README.
const readme = read("README.md");
let orphan = null;
for (const f of listDir("docs").filter((f) => f.endsWith(".md"))) {
  if (!readme.includes(`docs/${f}`) && !orphan) orphan = f;
}
eq(orphan, null, "every document in docs/ is linked from the README");

finish();
