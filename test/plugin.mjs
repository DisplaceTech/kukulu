// Static checks on the plugin itself: manifests, agent and skill frontmatter,
// hook wiring, cross-references and documentation links. None of this needs a
// running server, and all of it breaks silently at load time if it drifts —
// Claude Code will simply not offer the agent, or will offer one that points
// at a skill that no longer exists.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { finish, ok, eq, like, ROOT, frontmatter, mkDir } from "./harness.mjs";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const listDir = (rel) => fs.readdirSync(path.join(ROOT, rel));

/** The files git tracks in `root`, repo-relative with forward slashes; a link may only land on one of these. */
function trackedFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : [];
}

/** The documentation set: tracked README, CONTRIBUTING, CHANGELOG and top-level docs/*.md. */
const docFiles = (tracked) => tracked.filter((f) => ["README.md", "CONTRIBUTING.md", "CHANGELOG.md"].includes(f) || /^docs\/[^/]+\.md$/.test(f));

/**
 * Every relative link in the documentation that does not land on a tracked
 * file (or a directory holding one), as `<file> → <target>`. A gitignored file
 * on the maintainer's machine must not make a link pass.
 */
function brokenLinks(root, content = (f) => fs.readFileSync(path.join(root, f), "utf8")) {
  const tracked = trackedFiles(root);
  const broken = [];
  for (const file of docFiles(tracked)) {
    const dir = path.posix.dirname(file);
    // Inline code spans quote example link text (a PLAN task shows the line it will add elsewhere), so they are not links.
    for (const m of content(file).replace(/`[^`\n]*`/g, "").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(dir, target)).replace(/\/$/, "");
      if (!tracked.some((f) => f === resolved || f.startsWith(`${resolved}/`))) broken.push(`${file} → ${m[1]}`);
    }
  }
  return broken;
}

const MODELS = ["fable", "opus", "sonnet", "haiku", "inherit"];
const EFFORTS = ["low", "medium", "high"];

// ---------------------------------------------------------------- manifests

const plugin = json(".claude-plugin/plugin.json");
const pkg = json("package.json");
const market = json(".claude-plugin/marketplace.json");

eq(plugin.name, "kukulu", "the plugin is named kukulu");
ok(plugin.description && plugin.description.length > 40, "the plugin describes itself in the marketplace listing");
like(plugin.version, /^\d+\.\d+\.\d+$/, "the plugin version is semver");
ok(plugin.author?.name, "the plugin names an author");
ok(Array.isArray(plugin.keywords) && plugin.keywords.length >= 3, "the plugin carries keywords for discovery");

eq(pkg.version, plugin.version, "package.json and plugin.json agree on the version");
const serverVersion = read("mcp/server.mjs").match(/const VERSION = "([^"]+)"/)[1];
eq(serverVersion, plugin.version, "the MCP server reports the plugin's version");
{
  const newest = read("CHANGELOG.md").match(/^## \[(\d+\.\d+\.\d+)\]/m)[1];
  eq(newest, plugin.version, "CHANGELOG.md's newest entry is the package version");
}
eq(pkg.type, "module", "package.json declares ES modules");
ok(pkg.scripts.test && pkg.scripts.lint, "package.json exposes test and lint");
like(pkg.engines.node, /^>=\d+$/, "package.json states a Node floor");

eq(market.plugins.length, 1, "the marketplace lists exactly this plugin");
eq(market.plugins[0].name, plugin.name, "the marketplace entry matches the plugin name");
ok(exists(market.plugins[0].source), "the marketplace source path resolves");
eq(market.owner?.name, "Displace Technologies LLC", "the marketplace names Displace Technologies LLC as its owner");
eq(read("NOTICE"), "K\u016bkulu\nCopyright 2026 Displace Technologies LLC\n\nOriginally developed by Eric Mann. Copyright in this project was\nassigned to Displace Technologies LLC effective October 15, 2026.\n", "NOTICE names the copyright holder and records the assignment");
like(read("LICENSE"), /Apache License\s+Version 2\.0, January 2004/, "LICENSE is still the unmodified Apache-2.0 text");
eq(createHash("sha256").update(fs.readFileSync(path.join(ROOT, "LICENSE"))).digest("hex"), "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30", "...byte-identical to the 0.5.0 file");

// ---------------------------------------------------------------- MCP wiring

eq(plugin.mcpServers, "./.mcp.json", "the plugin points at .mcp.json for its MCP server");
const mcp = json(".mcp.json");
const server = mcp.mcpServers.kukulu;
ok(server, "the MCP config defines a server called kukulu");
eq(server.command, "node", "the server runs under node, with no install step");
like(server.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}/, "the server path is resolved from CLAUDE_PLUGIN_ROOT");
ok(exists(server.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", "")), "the server file the config names exists");
eq(server.env.KUKULU_PROJECT_DIR, "${CLAUDE_PROJECT_DIR}", "the server is told which project it is operating on");
eq(server.env.KUKULU_CONFIG, "${KUKULU_CONFIG:-}", "the global routing config path passes through, empty by default");
eq(server.env.KUKULU_PROFILE, "${KUKULU_PROFILE:-}", "the routing profile passes through, empty by default");
eq(server.env.FOUNDRY_CONFIG, undefined, ".mcp.json no longer passes FOUNDRY_CONFIG");
eq(server.env.FOUNDRY_PROFILE, undefined, "...or FOUNDRY_PROFILE");

// ---------------------------------------------------------------- hooks

eq(plugin.hooks, "./hooks/hooks.json", "the plugin points at hooks/hooks.json");
const hooks = json("hooks/hooks.json");
eq(Object.keys(hooks.hooks).sort().join(","), "PostToolUse,PreToolUse,Stop,SubagentStop,UserPromptSubmit", "hooks.json wires Stop, SubagentStop, PreToolUse, PostToolUse and UserPromptSubmit");
for (const [event, entries] of Object.entries(hooks.hooks).filter(([e]) => e === "Stop" || e === "SubagentStop")) {
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
like(hooks.hooks.SubagentStop[0].matcher, /kukulu.implementer/, "SubagentStop's matcher names the implementer");
eq(hooks.hooks.SubagentStop[0].matcher, "^(kukulu:implementer|kukulu-implementer)$", "SubagentStop's matcher names only the kukulu implementer");
{
  const wired = (event) => hooks.hooks[event].flatMap((e) => e.hooks.map((h) => h.command));
  const CR = (script) => `"${"$"}{CLAUDE_PLUGIN_ROOT}"/scripts/${script}`;
  eq(JSON.stringify(wired("PreToolUse")), JSON.stringify([CR("cleanroom-guard.mjs")]), "PreToolUse runs the clean-room guard");
  ok(hooks.hooks.PreToolUse.every((e) => !e.matcher), "...with no matcher, so every tool is checked");
  eq(JSON.stringify(wired("PostToolUse")), JSON.stringify([CR("cleanroom-log.mjs")]), "PostToolUse runs the clean-room logger");
  eq(JSON.stringify(wired("UserPromptSubmit")), JSON.stringify([CR("cleanroom-log.mjs")]), "UserPromptSubmit runs the clean-room logger");
  for (const script of ["scripts/cleanroom-guard.mjs", "scripts/cleanroom-log.mjs"]) {
    ok(exists(script) && fs.statSync(path.join(ROOT, script)).mode & 0o111 && /^#!\/usr\/bin\/env node\n/.test(read(script)), `${script} is executable with a shebang`);
  }
  ok(spawnSync("git", ["ls-files", "-s", "scripts/cleanroom-guard.mjs", "scripts/cleanroom-log.mjs"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean).every((l) => l.startsWith("100755")), "both clean-room hook scripts are mode 755 in git");
}
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
    // The four stage skills are preloaded into their kukulu-<role> agent, and
    // disable-model-invocation also blocks preloading — so a stage skill must
    // never set it. Model and effort belong solely to the agent that routing
    // generates; the skill inherits whatever the agent is running as.
    eq(fm["disable-model-invocation"], undefined, `skills/${name} stays preloadable: disable-model-invocation also blocks preloading`);
    eq(fm.model, "inherit", `skills/${name} lets its agent's routed model own the turn`);
    eq(fm.effort, undefined, `skills/${name} carries no effort of its own; the agent's does`);
    like(fm.description, /^Kūkulu pipeline stage/, `skills/${name}'s description marks it as a pipeline stage`);
  }
}

// A Write refusal should never cost a turn or a returned-as-text file
// (F-16): every skill that writes a deliverable file states the heredoc
// fallback.
for (const name of ["plan-build", "implement"]) {
  like(read(`skills/${name}/SKILL.md`), /heredoc/, `skills/${name} states the shell-heredoc fallback for a refused Write`);
}

{
  const ws = read("docs/writing-specs.md");
  like(ws, /from: "<that task's id>"/, "writing-specs.md teaches from");
  like(ws, /mutation\.targeted/, "writing-specs.md teaches mutation.targeted");
  like(ws, /^## Clean-room flights$/m, "writing-specs.md has a Clean-room flights section");
  like(ws, /`Kukulu-Stage` and `Kukulu-Task` trailers, added by the server and not by a git hook/, "...naming the built-in trailers");
  ok(!/commit-msg/.test(ws), "...and no longer shows a commit-msg hook");
  like(read("templates/SPEC.md"), /\{filter\}/, "templates/SPEC.md names the {filter} placeholder");
}
{
  const opsDoc = read("docs/operations.md");
  const keys = /const CLEANROOM_KEYS = \[([^\]]*)\]/.exec(read("mcp/server.mjs"))[1].match(/"([A-Za-z]+)"/g).map((k) => k.replaceAll('"', ""));
  const missing = keys.filter((k) => !opsDoc.includes("`cleanroom." + k + "`"));
  eq(missing.join(",") + "|" + keys.length, "|" + keys.length, "operations.md documents every cleanroom key (" + keys.join(", ") + ")");
  ok(opsDoc.includes("`KUKULU_CLEANROOM_LOG`") && opsDoc.includes("kukulu_run_resume"), "operations.md documents KUKULU_CLEANROOM_LOG and the resume call");
  ok(!/foundry/i.test(opsDoc), "operations.md has no pre-0.6.0 name left");
  const arch = read("docs/architecture.md");
  ok(arch.includes("cleanroom-guard.mjs") && arch.includes("cleanroom-log.mjs") && /^## Clean-room mode$/m.test(arch), "architecture.md shows the clean-room hook scripts");
  ok(!/decision 4a/i.test(arch) && /```mermaid\nflowchart LR\n    N\["kukulu_next picks a stage"\]/.test(arch), "architecture.md places the gate in a diagram, not in the numbered stage decisions");
}
like(read("docs/operations.md"), /^## Running flight after flight$/m, "operations.md explains running flight after flight");
like(read("docs/operations.md"), /^## Signing$/m, "operations.md has a signing section");
like(read("skills/pull-feedback/SKILL.md"), /docs\/flights\/\*\/feedback\.jsonl/, "pull-feedback reads archived flight logs too");
{
  const pull = read("skills/pull-feedback/SKILL.md");
  ok(!/git commit|Commit the new/.test(pull) && /Do not commit/.test(pull), "pull-feedback never runs git commit");
  like(pull, /docs\/feedback\/\.private-names/, "...names .private-names");
  like(pull, /next letter after the highest label in `docs\/feedback\/\.private-names`, never earlier than `project-e`/, "pull-feedback assigns project-<letter> labels after the highest in .private-names");
  like(pull, /creating it with mode 0600/, "...creates .private-names with mode 0600");
  like(pull, /write the real name nowhere else: not in the feedback file, a commit, a plan, a spec, a test name or the changelog/, "...writes the real name nowhere else");
  like(read("CONTRIBUTING.md"), /`<date>-<label>\.md`/, "CONTRIBUTING's Flight feedback names files by label");
  like(pull, /CONTRIBUTING\.md#flight-feedback/, "...links CONTRIBUTING.md#flight-feedback, a tracked target");
  ok(trackedFiles(ROOT).includes("CONTRIBUTING.md"), "...and CONTRIBUTING.md is tracked");
  like(read("CONTRIBUTING.md"), /^## Flight feedback$/m, "CONTRIBUTING.md has a Flight feedback section");
}
like(read("skills/pull-feedback/SKILL.md"), /how many items came from each/, "...and its header names every source log with its count");

{
  const im = read("skills/implement/SKILL.md");
  like(im, /## Codebase notes/, "the implement skill keeps project lessons out of the feedback log (project-c F-08, F-09): it names ## Codebase notes");
  like(im, /never in `kukulu_feedback_log`/, "...and says project lessons never go to kukulu_feedback_log");
  like(im, /heredoc/, "...and keeps the heredoc fallback");
}

{
  const pb = read("skills/plan-build/SKILL.md");
  like(pb, /kukulu_plan_commit/, "plan-build commits through kukulu_plan_commit (project-d F-03)");
  ok(!pb.includes("Commit PLAN.md, PROGRESS.md, kukulu.json and CLAUDE.md as"), "...and no longer tells the planner to commit by hand");
  like(pb, /renumber: true/, "plan-build renumbers with renumber: true (project-c F-07)");
  like(pb, /"from": "<that task's id>"/, "plan-build gates late rules with from (project-d F-01)");
  like(pb, /test ! -f X \|\| bash X/, "...and forbids the test-or-skip guard");
  like(pb, /## Flight <slug> notes/, "plan-build caps only its own flight section of an existing CLAUDE.md (project-c F-20)");
  like(pb, /60 lines/, "...at 60 lines");
  like(pb, /strayArtifacts/, "plan-build regenerates stray artifacts (project-c F-04)");
  like(pb, /mutation\.targeted/, "plan-build fills mutation.targeted");
  like(pb, /"flight"/, "...and sets flight");
}

{
  const rb = read("skills/review-build/SKILL.md");
  like(rb, /targeted: <name>/, "review-build prefers targeted mutation commands (project-c F-12)");
  like(rb, /mutation\.targeted/, "...when the config has them");
  like(rb, /confirmKill: true/, "review-build confirms suspicious kills (project-c F-02)");
  like(rb, /failedCommands/, "...by reading failedCommands");
  like(rb, /inconclusive/, "...and treating an inconclusive result as a survivor");
  like(rb, /lastReviewCommit/, "review-build scopes later rounds to the diff since lastReviewCommit (project-c F-16)");
  like(rb, /at least three/, "...sweeps a surviving file with at least three further mutations");
  like(rb, /one R-task per file/, "...and queues one R-task per file");
  like(rb, /## Notes/, "...putting out-of-diff survivors under ## Notes");
}

{
  const sum = read("skills/summarize/SKILL.md");
  ok(!/heredoc/i.test(sum), "the summarize skill passes content and never writes SUMMARY.md itself (project-c F-03): no heredoc");
  for (const word of ["content", "kukulu_summary_commit"]) like(sum, new RegExp(word), `...it names ${word}`);
  like(sum, /Never call `Write`/, "...and forbids writing the file itself");
  like(sum, /kukulu_flight_archive/, "the summarize skill archives when policies.archive is true");
  like(sum, /archive: true/, "...keyed on the archive field of the summary result");
  like(sum, /kukulu_pr_finalize\(\{ breaking \}\)/, "the summarize skill ends with kukulu_pr_finalize");
  like(sum, /Never pass `resign`/, "...and never passes resign");
  for (const status of ["AWAITING SIGNING", "AUTO-MERGE ON", "READY"]) like(sum, new RegExp(status), `...its final message can say ${status}`);
  like(sum, /Codebase notes/, "the summarize skill lifts Codebase notes");
}

for (const name of agentNames) {
  const body = read(`agents/${name}.md`);
  const fm = frontmatter(body);
  ok(fm, `agents/${name} has frontmatter`);
  eq(fm.name, name, `agents/${name}'s name matches its filename`);
  ok(fm.description && fm.description.length > 40, `agents/${name} has a description the orchestrator can route on`);
  ok(MODELS.includes(fm.model), `agents/${name} pins a known model (${fm.model})`);
  ok(fm.model !== "fable", `agents/${name} does not default to fable`);
  ok(EFFORTS.includes(fm.effort), `agents/${name} pins an effort level (${fm.effort})`);
  ok(fm.color, `agents/${name} has a colour`);
  const skills = Array.isArray(fm.skills) ? fm.skills : [];
  eq(skills.length, 1, `agents/${name} preloads exactly one skill`);
  like(skills[0], /^kukulu:/, `agents/${name}'s skill is namespaced`);
  ok(skillNames.includes(skills[0].replace("kukulu:", "")), `agents/${name}'s skill exists`);
  like(body, new RegExp(`/${skills[0]}`), `agents/${name} tells the model how to reload its skill by name`);
}

// The four stage agents must line up with the four stages the server delegates to.
const serverSrc = read("mcp/server.mjs");
const AGENT_MAP = serverSrc.match(/const AGENT = \{([^}]+)\}/)[1];
for (const name of agentNames) {
  like(AGENT_MAP, new RegExp(`kukulu:${name}`), `the server's stage table names kukulu:${name}`);
}
eq((AGENT_MAP.match(/kukulu:/g) || []).length, agentNames.length, "the stage table has no agent the plugin does not ship");

// ---------------------------------------------------------------- the flight controller

const goFlight = read("skills/go-flight/SKILL.md");
const fmGo = frontmatter(goFlight);
const allowed = String(fmGo["allowed-tools"]).split(",").map((s) => s.trim());
const toolNames = Array.from(serverSrc.matchAll(/name: "(kukulu_[a-z_]+)"/g), (m) => m[1]);
eq(toolNames.length, 25, "the server defines twenty-five tools");

const COUNT_WORDS = { 18: "Eighteen", 19: "Nineteen", 20: "Twenty", 21: "Twenty-one", 22: "Twenty-two", 23: "Twenty-three", 24: "Twenty-four", 25: "Twenty-five" };
like(read("docs/mcp-tools.md").split("\n")[2], new RegExp(`^${COUNT_WORDS[toolNames.length]} tools,`), "docs/mcp-tools.md states the tool count in words");

{
  const readme = read("README.md");
  const tableRows = readme.slice(readme.indexOf("## MCP tools"), readme.indexOf("## The guard hook"));
  const missing = toolNames.filter((t) => !tableRows.includes(`| \`${t}\` |`));
  eq(missing.join(","), "", "README's tool table lists every server tool");
  const WORDS = COUNT_WORDS[toolNames.length].toLowerCase();
  like(readme, new RegExp(`exposes ${WORDS} tools`), "README states the tool count in words");
}

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
  ok(mcpTools.length > 0, `agents/${name} names at least one kukulu MCP tool`);
  for (const t of mcpTools) {
    ok(t.startsWith("mcp__plugin_kukulu_kukulu__"), `agents/${name}'s MCP tool ${t} uses the plugin-prefixed form`);
    ok(toolNames.includes(t.replace("mcp__plugin_kukulu_kukulu__", "")), `agents/${name}'s MCP tool ${t} actually exists`);
  }
  ok(mcpTools.some((t) => t.endsWith("kukulu_status")), `agents/${name} can call kukulu_status to re-orient itself`);
  ok(tools.includes("mcp__plugin_kukulu_kukulu__kukulu_feedback_log"), `agents/${name} can log pipeline friction the moment it happens`);
}
const agentTools = (n) => frontmatter(read(`agents/${n}.md`)).tools.split(",").map((t) => t.trim());
const PFX = "mcp__plugin_kukulu_kukulu__";
ok(agentTools("planner").includes(`${PFX}kukulu_plan_commit`), "agents/planner names kukulu_plan_commit");
for (const t of ["kukulu_summary_commit", "kukulu_flight_archive", "kukulu_pr_finalize"]) {
  ok(agentTools("summarizer").includes(PFX + t), `agents/summarizer names ${t}`);
}
for (const name of agentNames) {
  const fm = frontmatter(read(`agents/${name}.md`));
  ok(read("README.md").includes(`\`${name}\` (${fm.model}, ${fm.effort})`), `README's agent defaults match agents/${name}.md`);
}
// A plugin-shipped MCP server's tools are exposed as
// mcp__plugin_<plugin>_<server>__<tool> (verified with --plugin-dir), not as
// the bare mcp__<server>__<tool> a project .mcp.json would give. The
// controller lists both, so it is allowed its tools whichever way the server
// was loaded.
const MCP_PREFIXES = ["mcp__plugin_kukulu_kukulu__", "mcp__kukulu__"];
const bareTool = (t) => MCP_PREFIXES.reduce((s, p) => s.replace(p, ""), t);
ok(allowed.includes("Agent"), "the flight controller may spawn agents");
for (const t of ["kukulu_status", "kukulu_next", "kukulu_agents_sync", "kukulu_run_halt", "kukulu_feedback_log"]) {
  for (const p of MCP_PREFIXES) ok(allowed.includes(p + t), `the flight controller may call ${p}${t}`);
}
for (const t of allowed.filter((a) => a.startsWith("mcp__"))) {
  ok(MCP_PREFIXES.some((p) => t.startsWith(p)), `the flight controller's allowed tool ${t} names the kukulu server`);
  ok(toolNames.includes(bareTool(t)), `the flight controller's allowed tool ${t} exists`);
}
ok(
  allowed.every((a) => a === "Agent" || MCP_PREFIXES.some((p) => a.startsWith(p))),
  "the flight controller is allowed nothing beyond Agent, the read-only kukulu tools, agents_sync, run_halt, flight_options and pr_finalize",
);
ok(
  // run_halt is a deliberate exception: it records a clean halt reason when
  // a stage cannot even be spawned, rather than leaving the flight to
  // silently retry against whatever broke. flight_options is the other: it
  // applies the operator's own go-flight options, never a judgment call.
  !allowed.some((a) => /run_start|task_|run_finish|review_submit|summary_commit/.test(a)),
  "the flight controller cannot touch the tools that change project state",
);
like(goFlight, /resume: true/, "go-flight resumes a round-cap halt with kukulu_flight_options (project-c F-13, F-18)");
like(goFlight, /kukulu_pr_finalize\(\{ resign: true \}\)/, "go-flight finishes a signing-blocked flight only with kukulu_pr_finalize({ resign: true })");
like(goFlight, /`flight=<slug>`/, "go-flight passes flight=<slug> to the planner");
like(goFlight, /Flight slug: <slug>\./, "...as the sentence the planner skill looks for");
for (const name of agentNames) like(goFlight, new RegExp(`kukulu:${name}`), `go-flight names kukulu:${name}`);
like(goFlight, /notification/, "go-flight describes the loop as event-driven, not a blocking wait");
like(goFlight, /do not poll/, "go-flight says not to poll while a stage is running");
// F-04: the reviewer mutation-tests through the MCP, never by hand-editing source.
ok(String(frontmatter(read("agents/reviewer.md")).tools).includes("mcp__plugin_kukulu_kukulu__kukulu_mutate"), "agents/reviewer can call kukulu_mutate");
{
  const reviewSkill = read("skills/review-build/SKILL.md");
  like(reviewSkill, /kukulu_mutate/, "review-build tells the reviewer to mutation-test with kukulu_mutate");
  ok(!reviewSkill.includes("git checkout -- <file>"), "review-build no longer tells the reviewer to hand-edit source and git checkout it");
}
// V4-06: the planner carves streams, and only where they are safe.
{
  const planSkill = read("skills/plan-build/SKILL.md");
  like(planSkill, /## Parallel streams \(optional\)/, "plan-build has a Parallel streams section");
  like(planSkill, /\*\*Stream:\*\* <slug>/, "...documenting the PLAN.md Stream field");
  like(planSkill, /\{stream: <slug>\}/, "...and the PROGRESS.md suffix tag");
  like(planSkill, /disjoint across the streams of a\s+wave/, "...the disjoint-files rule");
  like(planSkill, /Keep shared-edit hotspots out of waves/, "...the hotspots rule");
  like(planSkill, /package manifests and lockfiles/, "...naming the usual hotspots");
  like(planSkill, /Phase-end tasks are always serial/, "...that phase-end tasks stay serial");
  like(planSkill, /"exclusive": true/, "...the exclusive marker for port- or directory-bound commands");
  like(planSkill, /`parallel\.setup`/, "...parallel.setup for a fresh worktree");
  like(planSkill, /do not force them/, "...and that a fully serial plan is fine");
  like(read("docs/writing-specs.md"), /Independent components parallelize/, "writing-specs.md tells spec authors how to help");
}
// V4-04: parallel waves.
like(goFlight, /streams/, "go-flight describes the streams a parallel wave returns");
like(goFlight, /in a single message/, "go-flight spawns a wave's streams in a single message so they run concurrently");
like(goFlight, /every\*\* spawned stream has finished|all of\s+them have returned/, "go-flight waits for every stream before calling kukulu_next again");
like(goFlight, /Exactly one `kukulu_next` result is in\s+flight at a time/, "go-flight's one-at-a-time rule is restated per kukulu_next result");
{
  const implSkill = read("skills/implement/SKILL.md");
  like(implSkill, /## Stream mode/, "the implement skill has a Stream mode section");
  like(implSkill, /kukulu_stream_finish/, "...naming kukulu_stream_finish");
  like(implSkill, /STREAM NOT\s+STARTED/, "...and telling a stream implementer to stop, not retry, when run_start refuses");
  like(implSkill, /never `cd` out of `cwd`|`cd <cwd> &&`/, "...and telling the implementer to work only inside its cwd");
  like(implSkill, /docs\/PROGRESS\.md`,\s+`docs\/PLAN\.md`,\s+`docs\/HANDOFF\.md`/, "...and to leave the shared files to the MCP");
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

// These files describe a flight, and a flight's spec names tools it has not
// built yet, so the tool/skill-name check cannot hold for them.
const FLIGHT_ARTIFACTS = ["docs/SPEC.md", "docs/PLAN.md", "docs/PROGRESS.md", "docs/HANDOFF.md", "docs/REVIEW.md", "docs/SUMMARY.md"];

// Retired tools stay in the history of CHANGELOG.md and README.md and nowhere else.
const RETIRED_TOOLS = ["kukulu_migrate"];
const RETIRED_ALLOWED = ["CHANGELOG.md", "README.md"];
for (const name of skillNames) {
  ok(!/\.foundry\//.test(read(`skills/${name}/SKILL.md`)), `no skill mentions the .foundry/ layout (${name})`);
}
ok(!/FOUNDRY_/.test(read("docs/operations.md")), "operations.md no longer documents the FOUNDRY_* fallbacks");

like(goFlight, /"resume: <reason>".*kukulu_run_resume\(\{ reason \}\)/, "go-flight maps resume: <reason> to kukulu_run_resume");
{
  const ops = read("docs/operations.md");
  const halts = ops.slice(ops.indexOf("## Halts"), ops.indexOf("## Halts") + ops.slice(ops.indexOf("## Halts") + 3).indexOf("\n## ") + 3);
  ok(!/\$EDITOR/.test(halts) && !/"halted": null/.test(ops), "operations.md's Halts section names no hand edit of .kukulu/state.json");
}

like(read("skills/review-build/SKILL.md"), /Capping mutation-only rounds[\s\S]*review\.mutationFixRounds/, "review-build caps mutation-only rounds at mutationFixRounds");
like(read("skills/review-build/SKILL.md"), /Round 2 and later\*\*: read `prChecks`/, "review-build reads prChecks from round 2");

{
  const planSkill = read("skills/plan-build/SKILL.md");
  ok(/kukulu\.tech — Specification" gives `kukulu-tech`/.test(planSkill) && /K\u016bkulu 0\.7\.0 — Specification" gives `kukulu-0-7-0`/.test(planSkill), "plan-build states the slug rule with both examples");
}

like(goFlight, /"record: <text>".*kukulu_cleanroom_record\(\{ text, kind \}\)/, "go-flight maps record: to kukulu_cleanroom_record");
like(goFlight, /print `gate: ok \(<n> checks\)`/, "go-flight prints the gate line");

like(read("skills/implement/SKILL.md"), /A denial is not an obstacle to route around/, "the implement skill says a denial is never worked around");
like(read("skills/review-build/SKILL.md"), /A denial that was worked around[^.]*is a category 1 finding/, "review-build treats a worked-around denial as category 1");
ok(read("README.md").includes("(./docs/cleanroom.md)") && exists("docs/cleanroom.md"), "docs/cleanroom.md is linked from the README");

like(read("skills/plan-build/SKILL.md"), /Write the deliverables in the order 3, 1, 2, 4: `docs\/kukulu\.json` first/, "plan-build writes docs/kukulu.json first in clean-room mode");

like(read("agents/summarizer.md"), /mcp__plugin_kukulu_kukulu__kukulu_similarity/, "agents/summarizer names kukulu_similarity");
like(read("agents/summarizer.md"), /mcp__plugin_kukulu_kukulu__kukulu_attest/, "agents/summarizer names kukulu_attest");
{
  const cleanroomDoc = read("docs/cleanroom.md");
  ok(cleanroomDoc.includes("## Reading a bundle") && cleanroomDoc.includes("## Verifying offline"), "docs/cleanroom.md has Reading a bundle and Verifying offline");
  ok(/node docs\/attestation\/verify\.mjs docs\/attestation --key sha256:<fingerprint>/.test(cleanroomDoc) && cleanroomDoc.includes("`--json`") && cleanroomDoc.includes("--legacy-log"), "docs/cleanroom.md documents verify-attestation.mjs with --key, --json and --legacy-log");
  ok(cleanroomDoc.includes("verify-attestation: PASS") && /verify-attestation: FAIL \(\d+ reasons?\)/.test(cleanroomDoc), "...with sample PASS and FAIL output");
  const contributing = read("CONTRIBUTING.md");
  ok(/^\| `cleanroom` \|/m.test(contributing) && /^\| `attest` \|/m.test(contributing), "CONTRIBUTING's suite table lists cleanroom and attest");
}

{
  const summarize = read("skills/summarize/SKILL.md");
  like(summarize, /When `docs\/kukulu\.json` configures `cleanroom\.similarity`, call `kukulu_similarity` once, after `kukulu_summary_commit`/, "summarize calls kukulu_similarity when cleanroom.similarity is configured");
  like(summarize, /`## Contamination score` section[\s\S]*`kukulu_summary_commit\(\{ content \}\)` a second time/, "...under ## Contamination score, committed with a second summary_commit");
  like(summarize, /call `kukulu_attest` once, after `kukulu_similarity`[^.]*and before `kukulu_flight_archive`/, "summarize calls kukulu_attest before kukulu_flight_archive");
  like(summarize, /`## Attestation` section to your summary text: the directory, the manifest hash[^.]*fingerprint[^.]*verifier's result line/, "...adds ## Attestation");
  ok(summarize.indexOf("kukulu_attest") < summarize.indexOf("call `kukulu_flight_archive`"), "...and the attestation paragraph comes first in the skill");
}

let unknownTool = null;
let retiredMention = null;
let unknownSkill = null;
for (const file of PROSE) {
  if (FLIGHT_ARTIFACTS.includes(file)) continue;
  const body = read(file);
  for (const m of body.matchAll(/\bkukulu_[a-z_]+/g)) {
    if (RETIRED_TOOLS.includes(m[0])) {
      if (!RETIRED_ALLOWED.includes(file) && !retiredMention) retiredMention = `${file}: ${m[0]}`;
    } else if (!toolNames.includes(m[0]) && !unknownTool) unknownTool = `${file}: ${m[0]}`;
  }
  for (const m of body.matchAll(/\bkukulu:([a-z-]+)/g)) {
    if (!skillNames.includes(m[1]) && !agentNames.includes(m[1]) && !unknownSkill) unknownSkill = `${file}: ${m[0]}`;
  }
}
eq(unknownTool, null, "every kukulu_* tool named in prose exists on the server");
eq(retiredMention, null, "kukulu_migrate appears only in CHANGELOG.md and README.md");
ok(!/migrate/.test(goFlight) && !allowed.some((t) => t.endsWith("kukulu_migrate")), "go-flight no longer offers migrate");
eq(unknownSkill, null, "every kukulu:* skill or agent named in prose exists");

// Documentation links have to land somewhere that git tracks.
eq(brokenLinks(ROOT).join("\n"), "", "every relative link in the documentation resolves");

{
  const tmp = mkDir("kukulu-links-");
  const git = (...args) => spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
  git("init", "-q");
  fs.mkdirSync(path.join(tmp, "docs"));
  fs.writeFileSync(path.join(tmp, "README.md"), "See [x](docs/x.md).\n");
  fs.writeFileSync(path.join(tmp, "docs", "x.md"), "# x\n");
  git("add", "README.md");
  eq(brokenLinks(tmp).join("\n"), "README.md → docs/x.md", "a link to an untracked file fails the link check, naming the file and target");
  git("add", "docs/x.md");
  eq(brokenLinks(tmp).join("\n"), "", "...and passes once the target is tracked");
}


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
like(read("skills/plan-build/SKILL.md"), /cat\s+docs\/kukulu\.json/, "the planner is told to quote kukulu.json from disk, not from memory, in its report (F-06)");
like(template, /⚠️ ASSUMPTION/, "the template explains the assumption marker");

// ---------------------------------------------------------------- routing config templates

const kukuluConfigTemplate = json("templates/kukulu.config.example.json");
eq(
  Object.keys(kukuluConfigTemplate.roles).sort().join(","),
  ["implementer", "planner", "reviewer", "summarizer"].join(","),
  "the global config template covers exactly the four roles",
);
ok(Object.keys(kukuluConfigTemplate.profiles).length >= 2, "the template shows more than one profile");
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
ok(constraintsTemplate.some((r) => r.from), "some constraints template rule carries from");
ok(read("docs/operations.md").includes("templates/constraints.example.json"), "the constraints template is referenced from docs/operations.md");
ok(read("skills/plan-build/SKILL.md").includes("templates/constraints.example.json"), "...and from the plan-build skill that would actually use it");

// ---------------------------------------------------------------- config keys documented

// Every key cfg() actually returns has a row in operations.md's config
// table — a knob nobody wrote down is a knob nobody will find.
{
  const cfgSrc = serverSrc.match(/function cfgFrom\(c, planIds\) \{[\s\S]*?\n\}/)[0];
  const cfgKeys = Array.from(cfgSrc.matchAll(/^ {4}(\w+):/gm), (m) => m[1]);
  ok(cfgKeys.length >= 9, "cfg()'s top-level keys were actually extracted from the source");
  const opsDoc = read("docs/operations.md");
  for (const key of cfgKeys) {
    if (key === "policies") {
      ok(opsDoc.includes("`policies.signing`"), "operations.md documents policies.signing");
      ok(opsDoc.includes("`policies.push`"), "operations.md documents policies.push");
      ok(opsDoc.includes("`policies.pr`"), "operations.md documents policies.pr");
      ok(opsDoc.includes("`policies.feedback`"), "operations.md documents policies.feedback");
      ok(opsDoc.includes("`policies.archive`"), "operations.md documents policies.archive");
      ok(opsDoc.includes("`policies.finalize`"), "operations.md documents policies.finalize");
      ok(opsDoc.includes("`policies.mergeMethod`"), "operations.md documents policies.mergeMethod");
      continue;
    }
    if (key === "mutation") {
      ok(opsDoc.includes("`mutation.targeted`"), "operations.md documents mutation.targeted");
      continue;
    }
    if (key === "cleanroom") {
      ok(opsDoc.includes("`cleanroom.policy`") && opsDoc.includes("`cleanroom.signingKey`"), "operations.md documents cleanroom.policy and cleanroom.signingKey");
      ok(opsDoc.includes("`KUKULU_CLEANROOM_KEY`"), "operations.md documents KUKULU_CLEANROOM_KEY");
      ok(opsDoc.includes("`cleanroom.idleGapHours`"), "operations.md documents cleanroom.idleGapHours");
      ok(opsDoc.includes("`cleanroom.similarity`") && ["subject", "pairs", "languages", "ngram", "minIdentLen", "commentNgram", "identExclusions", "near", "separationMargin"].every((k) => opsDoc.includes(`\`${k}\``)), "operations.md documents cleanroom.similarity");
      continue;
    }
    if (key === "review") {
      ok(opsDoc.includes("`review.mutationFixRounds`"), "operations.md documents review.mutationFixRounds");
      continue;
    }
    if (key === "parallel") {
      ok(opsDoc.includes("`parallel.maxStreams`"), "operations.md documents parallel.maxStreams");
      ok(opsDoc.includes("`parallel.setup`"), "operations.md documents parallel.setup");
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
for (const f of docFiles(trackedFiles(ROOT)).filter((f) => f.startsWith("docs/")).map((f) => f.slice(5))) {
  if (!readme.includes(`docs/${f}`) && !orphan) orphan = f;
}
eq(orphan, null, "every document in docs/ is linked from the README");

// The compound-engineering loop (V3-15): a flight's SUMMARY.md friction
// feeds docs/feedback/, and a release plan under docs/plans/ works through
// it. Pulled feedback names other projects, so it stays on the
// maintainer's machine: only docs/feedback/.gitkeep is tracked.
ok(exists("docs/feedback/.gitkeep"), "docs/feedback/ is kept as a tracked, empty directory");
ok(/^docs\/feedback\/\*$/m.test(read(".gitignore")) && /^!docs\/feedback\/\.gitkeep$/m.test(read(".gitignore")), ".gitignore keeps pulled feedback out of the repo");
ok(exists("docs/plans"), "docs/plans/ exists");
ok(readme.includes("docs/plans/"), "docs/plans/ is linked from the README");
// V3.1-03: the old "write a heading and hope the summarizer reads it"
// convention is retired in favor of calling kukulu_feedback_log the
// moment friction happens, so it survives a flight that never summarizes.
ok(!read("skills/implement/SKILL.md").includes("## Pipeline friction"), "the implement skill no longer collects friction into a HANDOFF.md heading");
ok(!read("skills/review-build/SKILL.md").includes("## Pipeline friction"), "the review-build skill no longer collects friction into a REVIEW.md heading");
like(read("skills/implement/SKILL.md"), /kukulu_feedback_log/, "the implement skill calls kukulu_feedback_log directly");
like(read("skills/review-build/SKILL.md"), /kukulu_feedback_log/, "the review-build skill calls kukulu_feedback_log directly");
like(read("skills/plan-build/SKILL.md"), /kukulu_feedback_log/, "the plan-build skill calls kukulu_feedback_log directly");
like(read("skills/summarize/SKILL.md"), /feedbackCount/, "the summarize skill reads feedbackCount rather than scanning headings");
like(read("skills/summarize/SKILL.md"), /\.kukulu\/feedback\.jsonl/, "...and reads the feedback log itself for the entries");

// R2-02: the fake-signer fixture is allowlisted narrowly, defaults kept.
const gitleaks = read(".gitleaks.toml");
const glPaths = [...gitleaks.matchAll(/^paths\s*=\s*\[(.*)\]\s*$/gm)].flatMap((m) => [...m[1].matchAll(/\x27\x27\x27(.*?)\x27\x27\x27/g)].map((x) => x[1]));
ok(/useDefault\s*=\s*true/.test(gitleaks) && glPaths.length > 0 && glPaths.every((p) => p.startsWith("^test/")), ".gitleaks.toml keeps the default rules and allowlists only the test fixtures");
ok(/condition\s*=\s*"AND"/.test(gitleaks) && /^regexes\s*=\s*\[\s*\x27\x27\x270123456789ABCDEF\x27\x27\x27\s*\]\s*$/m.test(gitleaks), ".gitleaks.toml allowlist is AND-scoped to the fixture value");
const preCommit = read(".pre-commit-config.yaml");
const glRev = /repo:\s*https:\/\/github\.com\/gitleaks\/gitleaks\s*\n\s*rev:\s*v?(\S+)/.exec(preCommit)?.[1];
const scanYml = read(".github/workflows/secret-scan.yml");
const glPin = /^\s*GITLEAKS_VERSION:\s*"?([^"\s#]+)"?/m.exec(scanYml)?.[1];
ok(glRev && glPin === glRev, "secret-scan.yml pins GITLEAKS_VERSION to the pre-commit gitleaks rev");

// RN-12: the README explains the name, gives the maintainer's reason, and no longer mentions the MIT releases.
{
  const readme = read("README.md");
  like(readme, /^## The name$/m, "the README has a \"The name\" section");
  ok(!/PLACEHOLDER/i.test(readme), "...with no placeholder left in it");
  like(readme, /I chose the name because I wanted to honor Hawaiian culture/, "...carrying the maintainer's own sentence about why the name was chosen");
  like(readme, /^<h1 align="center">K\u016bkulu<\/h1>$/m, "the README title is centered");
  like(readme, /not affiliated with or endorsed by any Native Hawaiian organization/, "...stating there is no affiliation or endorsement");
  ok(!/MIT License/.test(readme), "the README no longer carries the MIT footer");
  ok(readme.indexOf("## The name") < readme.indexOf("## Quickstart"), "...and the name section comes before the Quickstart");
}

// RN-01: the name check. Fixtures are built from escapes so this file is itself
// clean: the display name has a macron over the first u (U+016B), identifiers
// are ASCII, and the okina in a Hawaiian word is U+02BB.
{
  const U = "\u016b";
  const display = `K${U}kulu`;
  const ascii = "K" + "ukulu";
  const run = (files) => {
    const dir = mkDir("kukulu-names-");
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    return spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-names.mjs"), dir], { encoding: "utf8" });
  };

  const clean = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-names.mjs")], { encoding: "utf8" });
  eq(clean.status, 0, `check-names passes on this repository (${(clean.stderr || clean.stdout).trim()})`);

  const good = run({ "README.md": `# ${display}\n\n${display} is built from a spec. Run \`${ascii}\` or see https://github.com/DisplaceTech/${ascii.toLowerCase()}.\n` });
  eq(good.status, 0, "check-names accepts the display name in prose and the ASCII spelling in code and URLs");

  const inPath = run({ [`docs/${U}x.md`]: "x\n" });
  eq(inPath.status, 1, "check-names refuses a non-ASCII path");
  like(inPath.stderr, /path contains non-ASCII characters/, "...and says paths use the ASCII identifier");

  const inIdent = run({ "server.mjs": `const name = "${display.toLowerCase()}_status";\n` });
  eq(inIdent.status, 1, "check-names refuses the macron letter in an identifier");
  like(inIdent.stderr, /server\.mjs:1: a .* outside the standalone word/, "...and names the file and line");

  const inUrl = run({ "README.md": `See https://example.com/${display}/x for it.\n` });
  eq(inUrl.status, 1, "check-names refuses the display name inside a URL");

  const nfd = run({ "README.md": `${display.replace(U, "u\u0304")} is decomposed.\n` });
  eq(nfd.status, 1, "check-names refuses a decomposed u + U+0304");
  like(nfd.stderr, /single NFC character U\+016B/, "...and says to store U+016B");

  const prose = run({ "docs/guide.md": `${ascii} builds from a spec.\n` });
  eq(prose.status, 1, "check-names refuses the ASCII spelling in prose");
  like(prose.stderr, /docs\/guide\.md:1: the display name is written/, "...and names the file and line");

  const fenced = run({ "docs/guide.md": `Text.\n\n\`\`\`bash\n${ascii} --help\n\`\`\`\n\nInline \`${ascii}\` too.\n` });
  eq(fenced.status, 0, "check-names allows the ASCII spelling in fenced blocks and inline code");

  const history = run({ "docs/flights/old/SUMMARY.md": `${ascii} history.\n`, "docs/feedback/a.md": `${ascii} history.\n` });
  eq(history.status, 0, "check-names leaves history paths alone");

  const changelog = run({ "CHANGELOG.md": `## [0.6.0]\n\n${display} is new.\n\n## [0.5.0]\n\n${ascii} was Foundry.\n` });
  eq(changelog.status, 0, "check-names treats CHANGELOG.md as history from the 0.5.0 entry down");
  const changelogNew = run({ "CHANGELOG.md": `## [0.6.0]\n\n${ascii} is new.\n\n## [0.5.0]\n` });
  eq(changelogNew.status, 1, "...but not the entries above it");

  const apostrophe = run({ "README.md": "Hawai'i and '\u014dlelo.\n" });
  eq(apostrophe.status, 1, "check-names refuses an apostrophe where the okina belongs");
  like(apostrophe.stderr, /\u02bbokina/, "...and names the okina");
  // The private-name denylist: always a temp root, never the maintainer's own file.
  {
    const names = "# private names\nproject-e Orbit\nproject-f Quasar Works\n";
    const withNames = (files) => run({ "docs/feedback/.private-names": names, ...files });
    const named = withNames({ "docs/notes.md": "Intro line.\nSee the quasar works dashboard.\n" });
    eq(named.status, 1, "a tracked file naming private project #2 fails check-names");
    like(named.stderr, /check-names: docs\/notes\.md:2: contains private project name #2 \(see docs\/feedback\/\.private-names\); replace it with its label/, "...with file, line and #2");
    ok(!/quasar/i.test(named.stdout + named.stderr), "...and no output contains the name");
    eq(withNames({ "docs/feedback/2026-01-01-project-f.md": "Quasar Works did this.\n", "test/fixtures/x.jsonl": "Orbit\n" }).status, 0, "the same name under docs/feedback/ passes");
    const none = run({ "README.md": "Orbit.\n" });
    eq(none.status, 0, "without a denylist check-names still passes");
    like(none.stdout, /private-name check skipped \(no docs\/feedback\/\.private-names\)/, "...and prints the skipped line");
    eq(withNames({ "docs/notes.md": "The orbital and orbiting words, Quasar Worksheets.\n" }).status, 0, "a private name is matched only as a whole word");
    ok(spawnSync("git", ["check-ignore", "-q", "docs/feedback/.private-names"], { cwd: ROOT }).status === 0, "docs/feedback/.private-names is gitignored");
  }

  const okina = run({ "README.md": "Hawai\u02bbi and \u02bb\u014dlelo.\n" });
  eq(okina.status, 0, "check-names accepts the okina");
}

finish();
