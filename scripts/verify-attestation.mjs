// Kūkulu offline verifier: checks a clean-room attestation bundle with nothing
// but node: built-ins, no network and no git (SPEC F-03). It is copied into
// every bundle as verify.mjs, so it imports nothing from this repository. Its
// chain and signature code duplicates mcp/cleanroom.mjs on purpose: a bundle must
// be checkable by someone who does not trust, or even have, the plugin.
//
//   node verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--expect clean-room|control-positive] [--require-enforcement hook|container+proxy|container+proxy+audit] [--json]
//   node verify-attestation.mjs --legacy-log <file> --roots a,b --words a,b [--repo path] [--json]

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- enforcement levels and known limits

export const ENFORCEMENT_LEVELS = ["hook", "container+proxy", "container+proxy+audit"];

// Duplicated from mcp/cleanroom.mjs on purpose (a bundle's verifier imports nothing); test/attest.mjs feeds both the same levels.
export const KNOWN_LIMITS = [
  { id: "interpreter", text: "Interpreter escapes (python3 -c, node -e) are not parsed, so a path or word inside the quoted program is not seen.", levels: ["hook"] },
  { id: "expansion", text: "Shell expansion beyond ~ and $HOME is not evaluated: other variables, and strings assembled at run time (a base64 decode, a variable holding a command), so a path or command built that way is not seen.", levels: ["hook"] },
  { id: "spellings", text: "Option and wrapper spellings the tables do not model are not recognized: the guard judges a command by its text, its wrapper and option parsing follows GNU coreutils, findutils and sudo (and BSD/macOS forms where their manual pages differ), and no table can be proved complete across tool versions.", levels: ["hook"] },
  { id: "indirect", text: "Commands that run a command from their arguments (find -exec, watch, parallel, busybox) and programs outside the fixed network and write lists (unlink, shred, perl -i, cargo fetch) are not recognized.", levels: ["hook"] },
  { id: "patterns", text: "pathPatterns regexes are matched on the paths a call names, not on the files a recursive read or a glob reaches below a directory.", levels: ["hook"] },
  { id: "make", text: "Subprocesses of a make target are not individual tool calls, so what they read is not logged.", levels: ["hook"] },
  { id: "mcp", text: "MCP server internals are not tool calls, so what a server reads on its own is not logged.", levels: ["hook"] },
  { id: "session", text: "Hooks load at session start, so a session that writes the policy is not covered until the next one; the gate's liveness check catches a session with no hooks at all.", levels: ["hook", "container+proxy"] },
  { id: "training", text: "What a model learned in training is outside every boundary; the similarity score, not the log, measures it.", levels: ["hook", "container+proxy"] },
  { id: "packages", text: "Packages named in a lockfile are outside the claim; deny.packages and the gate keep named prior-art packages out of the lockfiles and the cache, and the manifest lists what the lockfiles name.", levels: ["hook", "container+proxy"] },
  { id: "config-writable", text: "Inside the boundary docs/kukulu.json stays writable, because the planner writes it; only the guard protects it after the plan exists.", levels: ["container+proxy"] },
  { id: "tls", text: "The proxy sees host and port, not paths or content inside TLS; whatever an allowed host serves is reachable.", levels: ["container+proxy"] },
];

/** The known-limit texts that apply at an enforcement level, in order. */
export function knownLimitsFor(level) {
  if (!ENFORCEMENT_LEVELS.includes(level)) throw new Error(`enforcement level must be one of ${ENFORCEMENT_LEVELS.join(", ")} (got ${JSON.stringify(level)})`);
  return KNOWN_LIMITS.filter((l) => l.levels.includes(level)).map((l) => l.text);
}

// Duplicated from mcp/cleanroom.mjs on purpose (a bundle's verifier imports nothing); test/attest.mjs feeds both the same entries.
/**
 * Per role, the models the endpoint reported and the token sums of the `usage` entries of that role's agents
 * (SPEC D-02): `{ reported: [sorted model names], usage: { requests, input, output, cacheRead, cacheWrite, cost } }`.
 * `cost` is null when any counted entry's is; an entry that holds an `error` is skipped.
 * scripts/verify-attestation.mjs duplicates this on purpose.
 */
export function rolesUsage(entries) {
  const out = {};
  for (const role of ["planner", "implementer", "reviewer", "summarizer"]) {
    const agent = new RegExp(`^kukulu[-:]${role}$`);
    const reported = new Set();
    const usage = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    for (const e of entries) {
      if (e.kind !== "usage" || !agent.test(e.role ?? "") || !e.data || e.data.error) continue;
      for (const [model, m] of Object.entries(e.data.models ?? {})) {
        reported.add(model);
        for (const key of ["requests", "input", "output", "cacheRead", "cacheWrite"]) usage[key] += m[key] ?? 0;
      }
      usage.cost = usage.cost === null || typeof e.data.cost !== "number" ? null : Math.round((usage.cost + e.data.cost) * 1e6) / 1e6;
    }
    out[role] = { reported: [...reported].sort(), usage };
  }
  return out;
}


const ENTRY_KEYS = ["seq", "prev", "at", "kind", "stage", "task", "role", "model", "session", "tool", "target", "decision", "reason"];
const CHECKPOINT_KEYS = ["chainTip", "git", "policyHash", "guardHash", "loggerHash", "hooksHash", "keyFingerprint", "event"];
const ZERO_HASH = "0".repeat(64);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The bytes a chain hash covers, built from the fields in their fixed order and nothing else. */
function canonicalEntry(entry) {
  const ordered = {};
  for (const key of ENTRY_KEYS) ordered[key] = entry[key] === undefined ? null : entry[key];
  if (entry.data !== undefined) ordered.data = entry.data;
  return JSON.stringify(ordered);
}

/** Recompute the chain from its lines: dense seq, prev links, every hash. */
export function verifyChain(lines) {
  const entries = [];
  let tip = ZERO_HASH;
  for (let i = 0; i < lines.length; i++) {
    const fail = (reason, seq = null) => ({ ok: false, entries, tip, firstBad: { line: i + 1, seq, reason } });
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      return fail("the line is not valid JSON");
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return fail("the line is not a JSON object");
    const want = [...ENTRY_KEYS, ...("data" in entry ? ["data"] : []), "hash"];
    if (Object.keys(entry).join(",") !== want.join(",")) return fail(`the keys are not exactly ${want.join(", ")}, in that order`, entry.seq ?? null);
    if (entry.seq !== i + 1) return fail(`seq is ${JSON.stringify(entry.seq)} but this is entry ${i + 1}; an entry was dropped, added or reordered`, entry.seq);
    if (entry.prev !== tip) return fail("prev does not match the previous entry's hash", entry.seq);
    const { hash, ...rest } = entry;
    if (sha256(Buffer.from(`${entry.prev}\n${canonicalEntry(rest)}`, "utf8")) !== hash) return fail("the hash does not match the entry's content; the entry was edited", entry.seq);
    entries.push(entry);
    tip = hash;
  }
  return { ok: true, entries, tip, firstBad: null };
}

/** True when the checkpoint entry's signature covers exactly its eight fields and verifies with the key. */
export function verifyCheckpoint(entry, publicKey) {
  try {
    const data = entry?.data;
    if (!entry || entry.kind !== "checkpoint" || !data || typeof data.signature !== "string") return false;
    const rest = Object.keys(data).filter((k) => k !== "signature");
    if ([...rest].sort().join(",") !== [...CHECKPOINT_KEYS].sort().join(",")) return false;
    const ordered = {};
    for (const key of CHECKPOINT_KEYS) ordered[key] = data[key];
    return verify(null, Buffer.from(JSON.stringify(ordered), "utf8"), publicKey, Buffer.from(data.signature, "base64"));
  } catch {
    return false;
  }
}

const fingerprintOf = (publicKey) => `sha256:${sha256(publicKey.export({ type: "spki", format: "der" }))}`;
const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null);

/**
 * Verify the bundle in `dir`. Returns `{ ok, mode, enforcement, reasons, notes, checks }` (`mode` is the genesis's, `enforcement` the bundle's level): every
 * failure is a reason `{ check, reason }`, not only the first, and `checks` maps
 * each check that ran to whether it passed.
 */
export function verifyBundle(dir, { key = null, expect = null, requireEnforcement = null } = {}) {
  const reasons = [];
  const notes = [];
  const checks = {};
  const fail = (check, reason) => {
    reasons.push({ check, reason });
    checks[check] = false;
  };
  const start = (check) => {
    if (!(check in checks)) checks[check] = true;
  };

  // 1. the manifest, and every file it lists
  start("manifest");
  const manifestBytes = readIfExists(path.join(dir, "manifest.json"));
  let manifest = null;
  if (!manifestBytes) fail("manifest", "manifest.json is missing");
  else {
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8"));
    } catch (e) {
      fail("manifest", `manifest.json does not parse: ${e.message}`);
    }
  }
  if (manifest) {
    if (manifest.version !== 1) fail("manifest", `manifest.json version is ${JSON.stringify(manifest.version)}, not 1`);
    if (!Array.isArray(manifest.files)) fail("manifest", "manifest.json has no files list");
    else {
      for (const f of manifest.files) {
        const bytes = typeof f?.path === "string" ? readIfExists(path.join(dir, f.path)) : null;
        if (!bytes) fail("manifest", `${f?.path ?? "(unnamed file)"} is listed in the manifest but missing from the bundle`);
        else if (sha256(bytes) !== f.sha256) fail("manifest", `${f.path}: the SHA-256 differs from the manifest's; the file was changed`);
        else if (bytes.length !== f.bytes) fail("manifest", `${f.path}: the size differs from the manifest's (${bytes.length} bytes, listed ${f.bytes})`);
      }
    }
  }

  // 2. the signature over the manifest bytes
  start("signature");
  let publicKey = null;
  const pubPem = readIfExists(path.join(dir, "publisher.pub"));
  if (!pubPem) fail("signature", "publisher.pub is missing");
  else {
    try {
      publicKey = createPublicKey(pubPem);
    } catch (e) {
      fail("signature", `publisher.pub is not a public key: ${e.message}`);
    }
  }
  const sigText = readIfExists(path.join(dir, "manifest.sig"));
  if (!sigText) fail("signature", "manifest.sig is missing");
  else if (publicKey && manifestBytes) {
    let good = false;
    try {
      good = verify(null, manifestBytes, publicKey, Buffer.from(sigText.toString("utf8").trim(), "base64"));
    } catch {
      good = false;
    }
    if (!good) fail("signature", "manifest.sig does not verify over manifest.json with publisher.pub");
  }
  if (publicKey) {
    const fingerprint = fingerprintOf(publicKey);
    if (key) {
      if (fingerprint !== key) fail("signature", `the signer's fingerprint is ${fingerprint}, not the ${key} you asked for`);
    } else notes.push("signer: self-consistent, fingerprint not checked against an out-of-band value");
  }

  // 3. the chain
  start("chain");
  const logBytes = readIfExists(path.join(dir, "log.jsonl"));
  let chain = null;
  if (!logBytes) fail("chain", "log.jsonl is missing");
  else {
    chain = verifyChain(logBytes.toString("utf8").split("\n").filter(Boolean));
    if (!chain.ok) fail("chain", `entry ${chain.firstBad.seq ?? "?"} (line ${chain.firstBad.line}): ${chain.firstBad.reason}`);
    if (manifest?.chain) {
      const first = chain.entries[0]?.hash ?? null;
      if (manifest.chain.entries !== chain.entries.length) fail("chain", `the manifest says ${manifest.chain.entries} entries, the log has ${chain.entries.length}`);
      if (manifest.chain.first !== first) fail("chain", "chain.first in the manifest is not the first entry's hash");
      if (manifest.chain.tip !== chain.tip) fail("chain", "chain.tip in the manifest is not the log's tip");
    } else if (manifest) fail("chain", "the manifest has no chain section");
  }

  // 4. the checkpoints and the genesis
  start("checkpoints");
  if (chain && publicKey) {
    const checkpoints = chain.entries.filter((e) => e.kind === "checkpoint");
    for (const e of checkpoints) {
      if (!verifyCheckpoint(e, publicKey)) fail("checkpoints", `entry ${e.seq}: the checkpoint does not verify with publisher.pub`);
    }
    for (const named of manifest?.checkpoints ?? []) {
      const found = chain.entries.find((e) => e.seq === named.seq);
      if (!found || found.kind !== "checkpoint") fail("checkpoints", `the manifest names a checkpoint at seq ${named.seq}, which the log does not have`);
      else if (found.data.signature !== named.signature) fail("checkpoints", `entry ${named.seq}: the signature differs from the manifest's`);
    }
    const genesis = chain.entries.find((e) => e.kind === "genesis");
    if (!genesis) fail("checkpoints", "the log has no genesis entry");
    else if (manifest && JSON.stringify(genesis) !== JSON.stringify(manifest.genesis)) fail("checkpoints", "the genesis entry differs from manifest.genesis");
  } else if (!chain) fail("checkpoints", "not checked: the log is missing");
  else fail("checkpoints", "not checked: there is no usable publisher.pub");

  // Checks 5 to 10 read the log and the manifest together, so they need both to be sound.
  const sound = chain?.ok && manifest;
  const unsound = !chain ? "the log is missing" : !chain.ok ? "the chain does not verify" : !manifest ? "there is no readable manifest" : null;
  const notChecked = (check) => {
    start(check);
    if (!sound) fail(check, "not checked: " + unsound);
    return sound;
  };
  const entries = sound ? chain.entries : [];
  const checkpointEntries = entries.filter((e) => e.kind === "checkpoint" && e.data);

  // 5. the policy: every checkpoint's hash is one the manifest lists, and the policy file is the current one
  if (notChecked("policy")) {
    const listed = manifest.policy?.hashes;
    const seen = [];
    for (const e of checkpointEntries) if (!seen.includes(e.data.policyHash)) seen.push(e.data.policyHash);
    if (!Array.isArray(listed)) fail("policy", "the manifest has no policy.hashes list");
    else {
      for (const e of checkpointEntries) {
        if (!listed.includes(e.data.policyHash)) fail("policy", `entry ${e.seq}: the checkpoint's policyHash ${e.data.policyHash} is not in the manifest's policy.hashes`);
      }
      if (JSON.stringify(listed) !== JSON.stringify(seen) && checks.policy) fail("policy", "policy.hashes is not the checkpoints' distinct policy hashes in the order they first appear");
    }
    let before = null;
    for (const e of checkpointEntries) {
      if (before !== null && e.data.policyHash !== before) notes.push(`policy changed at seq ${e.seq}`);
      before = e.data.policyHash;
    }
    const policyBytes = readIfExists(path.join(dir, "policy.json"));
    if (!policyBytes) fail("policy", "policy.json is missing");
    else if (sha256(policyBytes) !== manifest.policy?.current) fail("policy", "policy.json does not hash to the manifest's policy.current");
    const lastPolicy = checkpointEntries.at(-1)?.data.policyHash;
    if (lastPolicy && manifest.policy?.current && lastPolicy !== manifest.policy.current) fail("policy", "the last checkpoint's policyHash is not the manifest's policy.current");
  }

  // 6. the guard: the scripts and hooks every checkpoint saw are the ones the manifest names
  if (notChecked("guard")) {
    const plugin = manifest.plugin ?? {};
    for (const e of checkpointEntries) {
      for (const field of ["guardHash", "loggerHash", "hooksHash"]) {
        if (e.data[field] !== plugin[field]) fail("guard", `entry ${e.seq}: the checkpoint's ${field} differs from the manifest's plugin.${field}`);
      }
    }
    // mcp/cleanroom.mjs is pinned in genesis from 0.7.1 on; older records stay readable.
    const genesisHash = entries.find((e) => e.kind === "genesis")?.data?.cleanroomHash;
    if (plugin.cleanroomHash === undefined) notes.push("plugin.cleanroomHash absent (bundle from 0.7.0 or earlier)");
    else if (genesisHash === undefined) notes.push("genesis has no cleanroomHash (flight started on 0.7.0 or earlier); plugin.cleanroomHash not compared");
    else if (plugin.cleanroomHash !== genesisHash) fail("guard", "the manifest's plugin.cleanroomHash differs from the genesis entry's cleanroomHash");
  }

  // 7. the mode: clean-room from the genesis on, and no gate ever failed on it
  if (notChecked("mode")) {
    const genesis = entries.find((e) => e.kind === "genesis");
    const gm = genesis?.data?.mode;
    if (gm !== "clean-room" && gm !== "control-positive") fail("mode", `the genesis records mode ${JSON.stringify(gm ?? null)}, which is neither "clean-room" nor "control-positive"`);
    else {
      if (manifest?.mode !== gm) fail("mode", `the manifest says ${manifest?.mode}, but the genesis records ${gm}`);
      if (expect && gm !== expect) fail("mode", `the bundle is ${gm}, expected ${expect}`);
    }
    for (const e of entries) {
      if (e.kind === "gate" && e.data?.failed === "mode") fail("mode", `entry ${e.seq}: a gate failed the mode check${e.data.reason ? `: ${e.data.reason}` : ""}`);
    }
  }

  // 8. the denials, recounted from the log with the human verdicts
  if (notChecked("denials")) {
    const classes = ["prior-art attempt", "false positive", "offline test"];
    const denied = entries.filter((e) => e.kind === "denied");
    const byReason = {};
    for (const e of denied) byReason[e.reason ?? "(no reason)"] = (byReason[e.reason ?? "(no reason)"] ?? 0) + 1;
    const verdictOf = new Map();
    for (const e of entries) {
      const m = e.kind === "human" && e.data?.kind === "verdict" ? /^#(\d+): (prior-art attempt|false positive|offline test)\b/.exec(e.target ?? "") : null;
      if (m && denied.some((d) => d.seq === Number(m[1]))) verdictOf.set(Number(m[1]), m[2]);
    }
    const verdicts = Object.fromEntries(classes.map((c) => [c, 0]));
    for (const c of verdictOf.values()) verdicts[c] += 1;
    verdicts.unclassified = denied.filter((d) => !verdictOf.has(d.seq)).length;
    const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
    const m = manifest.denials ?? {};
    if (m.total !== denied.length) fail("denials", `the manifest says ${m.total} denials, the log has ${denied.length}`);
    if (sorted(m.byReason) !== sorted(byReason)) fail("denials", `the manifest's denials.byReason differs from the log's: ${sorted(byReason)}`);
    if (sorted(m.verdicts) !== sorted(verdicts)) fail("denials", `the manifest's denials.verdicts differs from the log's: ${sorted(verdicts)}`);
  }

  // The level, for the gaps below; an unknown name is check 11's business, and reads as hook here.
  const bundleLevel = ENFORCEMENT_LEVELS.includes(manifest?.enforcement?.level) ? manifest.enforcement.level : "hook";

  // 9. the coverage gaps, recomputed from the log and commits.txt
  if (notChecked("coverage")) {
    const idleGapHours = manifest.coverage?.idleGapHours;
    const commitBytes = readIfExists(path.join(dir, "commits.txt"));
    if (typeof idleGapHours !== "number" || !(idleGapHours > 0)) fail("coverage", "the manifest's coverage.idleGapHours is not a positive number");
    else if (!commitBytes) fail("coverage", "commits.txt is missing, so untrailed and unsigned commits cannot be recomputed");
    else {
      const commits = commitBytes.toString("utf8").split("\n").filter(Boolean).map((l) => {
        const [sha, sig, subject, stage] = l.split("\x1f");
        return { sha, sig, subject, stage: stage ?? "" };
      });
      const gaps = [];
      for (let i = 1; i < entries.length; i++) {
        if (entries[i].kind === "gate" && entries[i - 1].kind === "gate") gaps.push({ kind: "silent-gates", from: entries[i - 1].seq, to: entries[i].seq });
      }
      for (const c of commits) if (c.stage === "") gaps.push({ kind: "untrailed-commit", sha: c.sha, subject: c.subject });
      for (const e of entries) if (e.kind === "human" && e.data?.kind === "intervention") gaps.push({ kind: "intervention", seq: e.seq });
      for (let i = 1; i < entries.length; i++) {
        const a = entries[i - 1];
        const b = entries[i];
        if (a.stage === null || a.stage !== b.stage) continue;
        const hours = (Date.parse(b.at) - Date.parse(a.at)) / 3600000;
        if (hours > idleGapHours) gaps.push({ kind: "idle", from: a.seq, to: b.seq, hours: Math.round(hours * 100) / 100 });
      }
      for (const c of commits) {
        if ((c.sig === "N" || c.sig === "B") && !(bundleLevel === "container+proxy" && c.stage !== "")) gaps.push({ kind: "unsigned-commit", sha: c.sha });
      }
      if (bundleLevel === "container+proxy") {
        const trailed = commits.filter((c) => (c.sig === "N" || c.sig === "B") && c.stage !== "").length;
        if (manifest.coverage?.unsignedTrailed !== trailed) fail("coverage", `the manifest says ${manifest.coverage?.unsignedTrailed} unsigned commits carry a stage trailer, but commits.txt shows ${trailed}`);
        if (trailed > 0) notes.push(`unsigned commits: ${trailed} (expected under container+proxy: commits made inside the boundary are unsigned, and the checkpoints sign their heads)`);
      }
      const want = gaps.map((g) => JSON.stringify(g));
      const have = (manifest.coverage?.gaps ?? []).map((g) => JSON.stringify(g));
      for (const g of want) if (!have.includes(g)) fail("coverage", `the log shows a gap the manifest omits: ${g}`);
      for (const g of have) if (!want.includes(g)) fail("coverage", `the manifest lists a gap the log and commits.txt do not show: ${g}`);
      if (checks.coverage && JSON.stringify(want) !== JSON.stringify(have)) fail("coverage", "the manifest lists the gaps in a different order than the log gives them");
      for (const g of want) notes.push(`coverage gap: ${g}`);
    }
  }

  // 10. the similarity report, when the manifest carries one
  start("similarity");
  if (manifest?.similarity) {
    const bytes = readIfExists(path.join(dir, "similarity.json"));
    if (!bytes) fail("similarity", "similarity.json is missing but the manifest records its hash");
    else if (sha256(bytes) !== manifest.similarity.sha256) fail("similarity", "similarity.json does not hash to the manifest's similarity.sha256");
  }

  // 11. the enforcement level: a known name, the boundary genesis recorded, the egress summary recounted, and the known limits that level has
  let level = "hook";
  if (notChecked("enforcement")) {
    const given = manifest.enforcement;
    if (given === undefined) notes.push("enforcement absent (bundle from 0.7.x); read as hook");
    else level = given?.level;
    if (!ENFORCEMENT_LEVELS.includes(level)) {
      fail("enforcement", `the manifest's level ${JSON.stringify(level)} is not one of ${ENFORCEMENT_LEVELS.join(", ")}`);
    } else {
      const genesis = entries.find((e) => e.kind === "genesis");
      if (level === "container+proxy") {
        if (!genesis?.data?.boundary) fail("enforcement", "the bundle says container+proxy, but the genesis records no boundary");
        else if (JSON.stringify(given.boundary) !== JSON.stringify(genesis.data.boundary)) fail("enforcement", "the manifest's boundary differs from the genesis entry's");
        const recount = {};
        for (const e of entries) {
          if (e.kind !== "egress") continue;
          recount[e.target] ??= { allowed: 0, denied: 0 };
          recount[e.target][e.decision === "allowed" ? "allowed" : "denied"] += 1;
        }
        const sorted = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
        if (sorted(given.egress) !== sorted(recount)) fail("enforcement", `the egress summary differs from the log's: ${sorted(recount)}`);
        for (const e of entries) {
          if (e.kind === "gate" && e.data?.failed === "boundary") fail("enforcement", `entry ${e.seq}: a gate failed the boundary check${e.data.reason ? `: ${e.data.reason}` : ""}`);
        }
      }
      // A 0.7.x manifest has no enforcement field and carries the eight limits it was written with; it is not compared.
      if (given !== undefined && JSON.stringify(manifest.coverage?.knownLimits) !== JSON.stringify(knownLimitsFor(level))) {
        fail("enforcement", `coverage.knownLimits is not the known-limit list for level ${level}`);
      }
      if (requireEnforcement && ENFORCEMENT_LEVELS.indexOf(level) < ENFORCEMENT_LEVELS.indexOf(requireEnforcement)) {
        fail("enforcement", `the bundle was built under ${level}, below the required ${requireEnforcement}`);
      }
    }
  }

  // 12. the roles: the reported models and token sums recount from the usage entries, and a model nobody routed to is noted
  if (notChecked("roles") && manifest.roles) {
    const recount = rolesUsage(entries);
    for (const [role, record] of Object.entries(manifest.roles)) {
      if (!recount[role]) continue;
      for (const field of ["reported", "usage"]) {
        if (JSON.stringify(record[field]) !== JSON.stringify(recount[role][field])) fail("roles", `${role}.${field} differs from the log's: ${JSON.stringify(recount[role][field])}`);
      }
      const reported = recount[role].reported ?? [];
      if (reported.some((m) => m !== record.model)) notes.push(`${role}: the endpoint reported ${reported.join(", ")}; routing declared ${record.model}`);
    }
  }

  const genesisMode = entries.find((e) => e.kind === "genesis")?.data?.mode;
  return { ok: reasons.length === 0, mode: typeof genesisMode === "string" ? genesisMode : null, enforcement: ENFORCEMENT_LEVELS.includes(level) ? level : null, reasons, notes, checks };
}

// ---------------------------------------------------------------- pre-0.6.0 tool logs

// The log cleanflate's evidence cites was written by the plugin's earlier name; its stage key carries that name.
// It is spelled in pieces so that a search for the old name finds only history, never this reader.
const LEGACY_STAGE_KEY = "foun" + "dry_stage";
const READ_CAPABLE = ["Read", "Glob", "Grep", "Bash", "WebFetch"];
const LEGACY_NOTE = "legacy log: no hash chain or signatures; integrity rests on the git history that holds it";

const expandHome = (p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);

/** Why a parsed line is not a legacy tool-log entry, or null when it is one. */
function legacyProblem(e) {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return "the line is not a JSON object";
  if (typeof e.ts !== "string" || Number.isNaN(Date.parse(e.ts))) return "ts is missing or not a timestamp";
  const stage = e[LEGACY_STAGE_KEY] ?? e.stage;
  if (stage !== null && typeof stage !== "string") return "the stage is not a string";
  if (typeof e.tool !== "string" || !e.tool) return "tool is missing";
  if (typeof e.target !== "string") return "target is missing";
  if (e.decision !== "allowed" && e.decision !== "denied") return 'decision is not "allowed" or "denied"';
  if (e.task_id !== undefined && e.task_id !== null && typeof e.task_id !== "string") return "task_id is neither null nor a string";
  if (e.reason !== undefined && e.reason !== null && typeof e.reason !== "string") return "reason is neither null nor a string";
  return null;
}

/** The path-like tokens of a read-capable call's target: whitespace-split, quotes and shell punctuation stripped. */
function legacyTokens(target) {
  return target
    .split(/[\s;|&<>()=]+/)
    .map((t) => t.replace(/^["'`]+|["'`]+$/g, ""))
    .filter((t) => t && (t.startsWith("/") || t.startsWith("~") || t.startsWith("./") || t.startsWith("../") || t.includes("/")));
}

/**
 * The repository a log file sits in: the nearest ancestor holding `.git`, found
 * without running git (SPEC F-03), or null outside any repository.
 */
export function repoRootOf(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Read a pre-0.6.0 tool log: one JSON object per line. Every line is parsed or
 * reported failed, never dropped. Forbidden-read candidates are read-capable
 * calls with a path-like token under a root, or naming a word outside the repository.
 */
// Roots, words and repo have no defaults: they belong to the project whose log is read, never to this reader.
export function readLegacyLog(text, { roots, words, repo } = {}) {
  if (!Array.isArray(roots) || !Array.isArray(words) || typeof repo !== "string") throw new TypeError("readLegacyLog needs roots and words (arrays) and repo (a path); pass the ones the logged project used");
  const rootPaths = roots.map(expandHome);
  const repoPath = path.resolve(expandHome(repo));
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const out = { lines: lines.length, parsed: 0, failed: [], byTool: {}, byStage: {}, denials: [], readCapable: 0, candidates: [], note: LEGACY_NOTE };
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  lines.forEach((raw, i) => {
    const n = i + 1;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      out.failed.push({ line: n, reason: "the line is not valid JSON" });
      return;
    }
    const problem = legacyProblem(e);
    if (problem) {
      out.failed.push({ line: n, reason: problem });
      return;
    }
    out.parsed += 1;
    bump(out.byTool, e.tool);
    bump(out.byStage, e[LEGACY_STAGE_KEY] ?? e.stage ?? "(none)");
    if (e.decision === "denied") out.denials.push({ line: n, ts: e.ts, tool: e.tool, reason: e.reason ?? "(no reason)" });
    if (!READ_CAPABLE.includes(e.tool)) return;
    out.readCapable += 1;
    for (const token of legacyTokens(e.target)) {
      const abs = path.resolve(expandHome(token));
      const underRoot = rootPaths.find((r) => abs === r || abs.startsWith(r.endsWith("/") ? r : r + "/"));
      const outside = path.isAbsolute(expandHome(token)) ? !(abs === repoPath || abs.startsWith(repoPath + "/")) : token.startsWith("*") || token.startsWith("../");
      const word = outside ? words.find((w) => token.toLowerCase().includes(w.toLowerCase())) : undefined;
      if (underRoot || word) {
        out.candidates.push({ line: n, ts: e.ts, tool: e.tool, token, why: underRoot ? "under root " + roots[rootPaths.indexOf(underRoot)] : "names " + word + " outside the repository", decision: e.decision });
        break;
      }
    }
  });
  return out;
}

function printLegacy(file, r) {
  const w = (t) => process.stdout.write(t + "\n");
  const counts = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + " " + v).join(", ") || "none";
  w("legacy log: " + file);
  w("lines: " + r.parsed + " parsed, " + r.failed.length + " failed");
  for (const x of r.failed) w("  failed line " + x.line + ": " + x.reason);
  w("calls by tool: " + counts(r.byTool));
  w("calls by stage: " + counts(r.byStage));
  w("denials: " + r.denials.length);
  for (const d of r.denials) w("  line " + d.line + " (" + d.ts + ") " + d.tool + ": " + d.reason);
  w("read-capable calls: " + r.readCapable);
  w("forbidden-read candidates: " + r.candidates.length);
  for (const c of r.candidates) w("  line " + c.line + " (" + c.ts + ") " + c.tool + " " + c.decision + ": " + c.token + " (" + c.why + ")");
  w(r.note);
}

// ---------------------------------------------------------------- the command line

function main(argv) {
  const args = argv.slice(2);
  const usage = "usage: node verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--expect clean-room|control-positive] [--require-enforcement hook|container+proxy|container+proxy+audit] [--json]\n       node verify-attestation.mjs --legacy-log <file> --roots <a,b> --words <a,b> [--repo <path>] [--json]\n";
  let json = false;
  let key = null;
  let legacy = null;
  const legacyOpts = {};
  const positional = [];
  const wants = { "--key": "key", "--expect": "expect", "--require-enforcement": "requireEnforcement", "--legacy-log": "legacy", "--roots": "roots", "--words": "words", "--repo": "repo" };
  const given = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] in wants) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        process.stderr.write("verify-attestation: " + args[i - 1] + " needs a value\n" + usage);
        return 2;
      }
      given[wants[args[i - 1]]] = value;
    } else if (args[i].startsWith("--")) {
      process.stderr.write("verify-attestation: unknown option " + args[i] + "\n" + usage);
      return 2;
    } else positional.push(args[i]);
  }
  key = given.key ?? null;
  legacy = given.legacy ?? null;
  if (legacy) {
    if (positional.length || key) {
      process.stderr.write("verify-attestation: --legacy-log takes a log file and no bundle directory or --key\n" + usage);
      return 2;
    }
    if (!given.roots || !given.words) {
      process.stderr.write("verify-attestation: --legacy-log needs --roots and --words: the paths the logged build must not have read and the names it must not have looked for; there are no defaults\n" + usage);
      return 2;
    }
    legacyOpts.roots = given.roots.split(",").filter(Boolean);
    legacyOpts.words = given.words.split(",").filter(Boolean);
    legacyOpts.repo = given.repo ?? repoRootOf(legacy);
    if (!legacyOpts.repo) {
      process.stderr.write("verify-attestation: " + legacy + " is not inside a git repository; pass --repo <path> with the root the logged build ran in\n" + usage);
      return 2;
    }
    let text;
    try {
      text = fs.readFileSync(legacy, "utf8");
    } catch (e) {
      process.stderr.write("verify-attestation: cannot read " + legacy + ": " + e.message + "\n");
      return 2;
    }
    const result = readLegacyLog(text, legacyOpts);
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else printLegacy(legacy, result);
    return result.failed.length ? 1 : 0;
  }
  if (given.expect !== undefined && given.expect !== "clean-room" && given.expect !== "control-positive") {
    process.stderr.write("verify-attestation: --expect takes clean-room or control-positive\n" + usage);
    return 2;
  }
  if (given.requireEnforcement !== undefined && !ENFORCEMENT_LEVELS.includes(given.requireEnforcement)) {
    process.stderr.write("verify-attestation: --require-enforcement takes " + ENFORCEMENT_LEVELS.join(", ") + "\n" + usage);
    return 2;
  }
  if (given.roots || given.words || given.repo) {
    process.stderr.write("verify-attestation: --roots, --words and --repo belong to --legacy-log\n" + usage);
    return 2;
  }
  if (positional.length !== 1) {
    process.stderr.write(usage);
    return 2;
  }
  const result = verifyBundle(path.resolve(positional[0]), { key, expect: given.expect ?? null, requireEnforcement: given.requireEnforcement ?? null });
  // A control bundle that passes is not a clean-room pass: it exits 3 unless the caller said it expected a control bundle.
  const passCode = result.ok && result.mode === "control-positive" && given.expect !== "control-positive" ? 3 : 0;
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return result.ok ? passCode : 1;
  }
  for (const r of result.reasons) process.stdout.write("verify-attestation: " + r.check + ": " + r.reason + "\n");
  for (const n of result.notes) process.stdout.write("verify-attestation: note: " + n + "\n");
  process.stdout.write(!result.ok ? "verify-attestation: FAIL (" + result.reasons.length + " reason" + (result.reasons.length === 1 ? "" : "s") + ")\n" : passCode === 3 ? "verify-attestation: CONTROL (positive)\n" : "verify-attestation: PASS\n");
  return result.ok ? passCode : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv));
