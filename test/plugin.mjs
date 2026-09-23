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
eq(server.env.FOUNDRY_CONFIG, "${FOUNDRY_CONFIG:-}", "the global routing config path passes through, empty by default");
eq(server.env.FOUNDRY_PROFILE, "${FOUNDRY_PROFILE:-}", "the routing profile passes through, empty by default");

// ---------------------------------------------------------------- hooks

eq(plugin.hooks, "./hooks/hooks.json", "the plugin points at hooks/hooks.json");
const hooks = json("hooks/hooks.json");
eq(Object.keys(hooks.hooks).sort().join(","), "Stop,SubagentStop", "the guard is wired to Stop and SubagentStop");
for (const [event, entries] of Object.entries(hooks.hooks)) {
  const cmd = entries[0].hooks[0];
  eq(cmd.type, "command", `${event} runs a command hook`);
  like(cmd.command, /^"\$\{CLAUDE_PLUGIN_ROOT\}"\//, `${event}'s command quotes the plugin root, so a path with spaces still works`);
  const script = cmd.command.replace(/^"\$\{CLAUDE_PLUGIN_ROOT\}"\//, "");
  eq(script, "scripts/implement-guard.mjs", `${event} points at the guard script`);
  ok(exists(script), `${event}'s script exists`);
  ok(fs.statSync(path.join(ROOT, script)).mode & 0o111, `${event}'s script is executable`);
  like(read(script), /^#!\/usr\/bin\/env node\n/, `${event}'s script has a shebang`);
}
// SubagentStop is scoped to the implementer at the hook-registration level
// (F-07): the harness never even runs the guard for any other subagent.
like(hooks.hooks.SubagentStop[0].matcher, /foundry.implementer/, "SubagentStop's matcher names the implementer");
ok(!hooks.hooks.Stop[0].matcher, "Stop carries no matcher — a Stop event has no agent to match against");

// ---------------------------------------------------------------- agents and skills

const skillNames = listDir("skills").filter((d) => exists(`skills/${d}/SKILL.md`));
const agentNames = listDir("agents").map((f) => f.replace(/\.md$/, ""));
eq(skillNames.sort().join(","), "go-flight,implement,plan-build,pull-feedback,review-build,summarize", "the six skills are present");
eq(agentNames.sort().join(","), "implementer,planner,reviewer,summarizer", "the four stage agents are present");

// pull-feedback is a standalone maintainer utility, not a pipeline stage: it
// has no generated agent and no pinned model of its own, so it does not
// belong in the stage-vs-controller either/or check the loop below runs.
{
  const fm = frontmatter(read("skills/pull-feedback/SKILL.md"));
  ok(fm, "skills/pull-feedback has frontmatter");
  eq(fm.name, "pull-feedback", "skills/pull-feedback's name matches its directory");
  ok(fm.description && fm.description.length > 30, "skills/pull-feedback has a usable description");
  eq(fm["disable-model-invocation"], undefined, "skills/pull-feedback is model-invocable, like go-flight");
}

for (const name of skillNames.filter((n) => n !== "pull-feedback")) {
  const fm = frontmatter(read(`skills/${name}/SKILL.md`));
  ok(fm, `skills/${name} has frontmatter`);
  eq(fm.name, name, `skills/${name}'s name matches its directory`);
  ok(fm.description && fm.description.length > 30, `skills/${name} has a usable description`);
  if (name === "go-flight") {
    // The controller makes no engineering decisions itself, so it carries no
    // invocation restriction: a person or another agent can ask for it by
    // name, and the literal slash command still works too.
    eq(fm["disable-model-invocation"], undefined, `skills/${name} is model-invocable, not restricted to the literal command`);
    ok(MODELS.includes(fm.model), `skills/${name} pins a known model (${fm.model})`);
    ok(EFFORTS.includes(fm.effort), `skills/${name} pins an effort level (${fm.effort})`);
  } else {
    // The four stage skills are preloaded into their foundry-<role> agent, and
    // disable-model-invocation also blocks preloading — so a stage skill must
    // never set it. Model and effort belong solely to the agent that routing
    // generates; the skill inherits whatever the agent is running as.
    eq(fm["disable-model-invocation"], undefined, `skills/${name} stays preloadable: disable-model-invocation also blocks preloading`);
    eq(fm.model, "inherit", `skills/${name} lets its agent's routed model own the turn`);
    eq(fm.effort, undefined, `skills/${name} carries no effort of its own; the agent's does`);
    like(fm.description, /^Foundry pipeline stage/, `skills/${name}'s description marks it as a pipeline stage`);
  }
}

// A Write refusal should never cost a turn or a returned-as-text file
// (F-16): every skill that writes a deliverable file states the heredoc
// fallback.
for (const name of ["summarize", "plan-build", "implement"]) {
  like(read(`skills/${name}/SKILL.md`), /heredoc/, `skills/${name} states the shell-heredoc fallback for a refused Write`);
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
eq(toolNames.length, 15, "the server defines fifteen tools");

// Every stage agent's own tool set is explicit (F-16): no agent is left to
// discover by trial and error what it is allowed to call.
for (const name of agentNames) {
  const fm = frontmatter(read(`agents/${name}.md`));
  ok(typeof fm.tools === "string" && fm.tools.length > 0, `agents/${name} declares a tools: list`);
  const tools = fm.tools.split(",").map((s) => s.trim());
  for (const general of ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]) {
    ok(tools.includes(general), `agents/${name}'s tools include ${general}`);
  }
  ok(!tools.includes("Agent"), `agents/${name} cannot spawn further agents`);
  const mcpTools = tools.filter((t) => t.startsWith("mcp__"));
  ok(mcpTools.length > 0, `agents/${name} names at least one foundry MCP tool`);
  for (const t of mcpTools) {
    ok(t.startsWith("mcp__plugin_foundry_foundry__"), `agents/${name}'s MCP tool ${t} uses the plugin-prefixed form`);
    ok(toolNames.includes(t.replace("mcp__plugin_foundry_foundry__", "")), `agents/${name}'s MCP tool ${t} actually exists`);
  }
  ok(mcpTools.some((t) => t.endsWith("foundry_status")), `agents/${name} can call foundry_status to re-orient itself`);
  ok(tools.includes("mcp__plugin_foundry_foundry__foundry_feedback_log"), `agents/${name} can log pipeline friction the moment it happens`);
}
// A plugin-shipped MCP server's tools are exposed as
// mcp__plugin_<plugin>_<server>__<tool> (verified with --plugin-dir), not as
// the bare mcp__<server>__<tool> a project .mcp.json would give. The
// controller lists both, so it is allowed its tools whichever way the server
// was loaded.
const MCP_PREFIXES = ["mcp__plugin_foundry_foundry__", "mcp__foundry__"];
const bareTool = (t) => MCP_PREFIXES.reduce((s, p) => s.replace(p, ""), t);
ok(allowed.includes("Agent"), "the flight controller may spawn agents");
for (const t of ["foundry_status", "foundry_next", "foundry_agents_sync", "foundry_run_halt", "foundry_feedback_log"]) {
  for (const p of MCP_PREFIXES) ok(allowed.includes(p + t), `the flight controller may call ${p}${t}`);
}
for (const t of allowed.filter((a) => a.startsWith("mcp__"))) {
  ok(MCP_PREFIXES.some((p) => t.startsWith(p)), `the flight controller's allowed tool ${t} names the foundry server`);
  ok(toolNames.includes(bareTool(t)), `the flight controller's allowed tool ${t} exists`);
}
ok(
  allowed.every((a) => a === "Agent" || MCP_PREFIXES.some((p) => a.startsWith(p))),
  "the flight controller is allowed nothing beyond Agent, the read-only foundry tools, agents_sync, and run_halt",
);
ok(
  // run_halt is the one deliberate exception: it records a clean halt reason
  // when a stage cannot even be spawned, rather than leaving the flight to
  // silently retry against whatever broke.
  !allowed.some((a) => /run_start|task_|run_finish|review_submit|summary_commit/.test(a)),
  "the flight controller cannot touch the tools that change project state",
);
for (const name of agentNames) like(goFlight, new RegExp(`foundry:${name}`), `go-flight names foundry:${name}`);
like(goFlight, /notification/, "go-flight describes the loop as event-driven, not a blocking wait");
like(goFlight, /do not poll/, "go-flight says not to poll while a stage is running");
// F-04: the reviewer mutation-tests through the MCP, never by hand-editing source.
ok(String(frontmatter(read("agents/reviewer.md")).tools).includes("mcp__plugin_foundry_foundry__foundry_mutate"), "agents/reviewer can call foundry_mutate");
{
  const reviewSkill = read("skills/review-build/SKILL.md");
  like(reviewSkill, /foundry_mutate/, "review-build tells the reviewer to mutation-test with foundry_mutate");
  ok(!reviewSkill.includes("git checkout -- <file>"), "review-build no longer tells the reviewer to hand-edit source and git checkout it");
}
like(goFlight, /agentModel/, "go-flight passes agentModel (an Agent-legal alias) on a fallback spawn");
ok(!/`model: model`|and `model: model`/.test(goFlight), "go-flight no longer passes the raw routed model to the Agent tool (F-02)");

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
like(read("skills/plan-build/SKILL.md"), /cat\s+docs\/foundry\.json/, "the planner is told to quote foundry.json from disk, not from memory, in its report (F-06)");
like(template, /⚠️ ASSUMPTION/, "the template explains the assumption marker");

// ---------------------------------------------------------------- routing config templates

const foundryConfigTemplate = json("templates/foundry.config.example.json");
eq(
  Object.keys(foundryConfigTemplate.roles).sort().join(","),
  ["implementer", "planner", "reviewer", "summarizer"].join(","),
  "the global config template covers exactly the four roles",
);
ok(Object.keys(foundryConfigTemplate.profiles).length >= 2, "the template shows more than one profile");
for (const file of listDir("templates/ccr").filter((f) => f.endsWith(".json"))) {
  const provider = json(`templates/ccr/${file}`).provider;
  ok(provider?.name, `templates/ccr/${file} names a provider`);
  ok(provider?.base_url, `templates/ccr/${file} gives a base_url`);
  ok(provider?.protocol, `templates/ccr/${file} names a protocol`);
  ok(Array.isArray(provider?.models) && provider.models.length > 0, `templates/ccr/${file} lists at least one model`);
}

// ---------------------------------------------------------------- constraints template

const constraintsTemplate = json("templates/constraints.example.json");
ok(Array.isArray(constraintsTemplate) && constraintsTemplate.length >= 3, "the constraints template ships at least three worked rules");
for (const rule of constraintsTemplate) {
  ok(rule.id, `constraint template rule '${rule.id}' has an id`);
  ok(Array.isArray(rule.paths) && rule.paths.length, `${rule.id} names at least one path`);
  ok(rule.pattern, `${rule.id} has a pattern`);
  ok(Array.isArray(rule.shouldMatch) && rule.shouldMatch.length, `${rule.id} has at least one shouldMatch fixture`);
  ok(Array.isArray(rule.shouldNotMatch) && rule.shouldNotMatch.length, `${rule.id} has at least one shouldNotMatch fixture`);
}
ok(read("docs/operations.md").includes("templates/constraints.example.json"), "the constraints template is referenced from docs/operations.md");
ok(read("skills/plan-build/SKILL.md").includes("templates/constraints.example.json"), "...and from the plan-build skill that would actually use it");

// ---------------------------------------------------------------- config keys documented

// Every key cfg() actually returns has a row in operations.md's config
// table — a knob nobody wrote down is a knob nobody will find.
{
  const cfgSrc = serverSrc.match(/function cfg\(\) \{[\s\S]*?\n\}/)[0];
  const cfgKeys = Array.from(cfgSrc.matchAll(/^ {4}(\w+):/gm), (m) => m[1]);
  ok(cfgKeys.length >= 9, "cfg()'s top-level keys were actually extracted from the source");
  const opsDoc = read("docs/operations.md");
  for (const key of cfgKeys) {
    if (key === "policies") {
      ok(opsDoc.includes("`policies.signing`"), "operations.md documents policies.signing");
      ok(opsDoc.includes("`policies.push`"), "operations.md documents policies.push");
      ok(opsDoc.includes("`policies.pr`"), "operations.md documents policies.pr");
      ok(opsDoc.includes("`policies.feedback`"), "operations.md documents policies.feedback");
      continue;
    }
    ok(opsDoc.includes(`\`${key}\``), `operations.md's config table documents '${key}'`);
  }
}

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

// The compound-engineering loop (V3-15): a flight's SUMMARY.md friction
// feeds docs/feedback/, and a release plan under docs/plans/ works through
// it. Both directories are real (not just directory entries a moment
// after `mkdir`) and linked from the README.
ok(exists("docs/feedback/README.md"), "docs/feedback/ exists and explains its own convention");
ok(exists("docs/plans"), "docs/plans/ exists");
ok(readme.includes("docs/feedback/"), "docs/feedback/ is linked from the README");
ok(readme.includes("docs/plans/"), "docs/plans/ is linked from the README");
// V3.1-03: the old "write a heading and hope the summarizer reads it"
// convention is retired in favor of calling foundry_feedback_log the
// moment friction happens, so it survives a flight that never summarizes.
ok(!read("skills/implement/SKILL.md").includes("## Pipeline friction"), "the implement skill no longer collects friction into a HANDOFF.md heading");
ok(!read("skills/review-build/SKILL.md").includes("## Pipeline friction"), "the review-build skill no longer collects friction into a REVIEW.md heading");
like(read("skills/implement/SKILL.md"), /foundry_feedback_log/, "the implement skill calls foundry_feedback_log directly");
like(read("skills/review-build/SKILL.md"), /foundry_feedback_log/, "the review-build skill calls foundry_feedback_log directly");
like(read("skills/plan-build/SKILL.md"), /foundry_feedback_log/, "the plan-build skill calls foundry_feedback_log directly");
like(read("skills/summarize/SKILL.md"), /feedbackCount/, "the summarize skill reads feedbackCount rather than scanning headings");
like(read("skills/summarize/SKILL.md"), /\.foundry\/feedback\.jsonl/, "...and reads the feedback log itself for the entries");
like(read("docs/feedback/README.md"), /foundry_feedback_log/, "docs/feedback/README.md documents the tool that produces the source log");
like(read("docs/feedback/README.md"), /\/foundry:pull-feedback/, "...and the skill that pulls it back here");

finish();
