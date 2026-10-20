// Kūkulu offline verifier: checks a clean-room attestation bundle with nothing
// but node: built-ins, no network and no git (SPEC F-03). It is copied into
// every bundle as verify.mjs, so it imports nothing from this repository. Its
// chain and signature code duplicates mcp/cleanroom.mjs on purpose: a bundle must
// be checkable by someone who does not trust, or even have, the plugin.
//
//   node verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
 * Verify the bundle in `dir`. Returns `{ ok, reasons, notes, checks }`: every
 * failure is a reason `{ check, reason }`, not only the first, and `checks` maps
 * each check that ran to whether it passed.
 */
export function verifyBundle(dir, { key = null } = {}) {
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

  return { ok: reasons.length === 0, reasons, notes, checks };
}

// ---------------------------------------------------------------- the command line

function main(argv) {
  const args = argv.slice(2);
  let json = false;
  let key = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") json = true;
    else if (args[i] === "--key") key = args[++i] ?? null;
    else if (args[i].startsWith("--")) {
      process.stderr.write(`verify-attestation: unknown option ${args[i]}\nusage: node verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]\n`);
      return 2;
    } else positional.push(args[i]);
  }
  if (positional.length !== 1 || (args.includes("--key") && !key)) {
    process.stderr.write("usage: node verify-attestation.mjs <bundle-dir> [--key sha256:<hex>] [--json]\n");
    return 2;
  }
  const result = verifyBundle(path.resolve(positional[0]), { key });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
  }
  for (const r of result.reasons) process.stdout.write(`verify-attestation: ${r.check}: ${r.reason}\n`);
  for (const n of result.notes) process.stdout.write(`verify-attestation: note: ${n}\n`);
  process.stdout.write(result.ok ? "verify-attestation: PASS\n" : `verify-attestation: FAIL (${result.reasons.length} reason${result.reasons.length === 1 ? "" : "s"})\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv));
