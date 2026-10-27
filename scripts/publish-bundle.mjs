// Write a publishable copy of a verified attestation bundle, and re-check a
// published copy (SPEC B-03). Copies files and hashes them; never uses the
// network and never signs anything.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const USAGE = "usage: node scripts/publish-bundle.mjs <bundle-dir> --key sha256:<fp> --out <dir>\n       node scripts/publish-bundle.mjs --check <published-dir> --key sha256:<fp>\n";
const SKIP = new Set(["SHA256SUMS", "VERIFY.txt"]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Every file under `dir` as a posix path relative to it, sorted by code point. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort(byCodePoint);
}

/** Run the verifier that ships in `dir`; returns `{ ok, status, mode, reason }`. Exit 3 is a passing control bundle. */
function runVerifier(dir, key) {
  const verifier = path.join(dir, "verify.mjs");
  if (!fs.existsSync(verifier)) return { ok: false, status: null, mode: null, reason: "verify.mjs is missing from it" };
  const run = spawnSync(process.execPath, [verifier, dir, "--key", key, "--json"], { encoding: "utf8" });
  let verdict = null;
  try {
    verdict = JSON.parse(run.stdout);
  } catch {
    verdict = null;
  }
  const passed = verdict?.ok === true && (run.status === 0 || (run.status === 3 && verdict.mode === "control-positive"));
  if (passed) return { ok: true, status: run.status, mode: verdict.mode, reason: null };
  const first = verdict?.reasons?.[0];
  return { ok: false, status: run.status, mode: verdict?.mode ?? null, reason: first ? `${first.check}: ${first.reason}` : (run.stderr || "").trim().split("\n")[0] || `exit ${run.status}` };
}

export function publish(bundle, key, out, io) {
  const verdict = runVerifier(bundle, key);
  if (!verdict.ok) {
    io.err(`publish-bundle: ${bundle} does not verify: ${verdict.reason}\n`);
    return 1;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
  const flight = manifest.flight;
  const target = path.join(out, flight);
  if (fs.existsSync(target)) {
    io.err(`publish-bundle: ${target} already exists; remove it or choose another --out\n`);
    return 1;
  }
  const files = listFiles(bundle).filter((f) => !SKIP.has(f));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
    fs.copyFileSync(path.join(bundle, f), path.join(target, f));
  }
  fs.writeFileSync(path.join(target, "SHA256SUMS"), files.map((f) => `${sha256(fs.readFileSync(path.join(target, f)))}  ${f}\n`).join(""));
  const control = manifest.mode === "control-positive";
  fs.writeFileSync(path.join(target, "VERIFY.txt"), [
    "K\u016bkulu attestation bundle",
    `flight: ${flight}`,
    `mode: ${manifest.mode}`,
    `enforcement: ${manifest.enforcement?.level ?? "hook"}`,
    `signer: ${key}`,
    `verify: node verify.mjs . --key ${key}`,
    control ? "expected exit status: 3, with the last line CONTROL (positive)" : "expected exit status: 0",
    "Get the signer's fingerprint from a source other than this directory (the project's README, a signed tag, a DNS TXT record) and compare it with the signer line above before trusting this bundle.",
    "",
  ].join("\n"));
  io.out(`publish-bundle: wrote ${target} (${files.length + 2} files)\n`);
  return 0;
}

export function check(dir, key, io) {
  const sums = path.join(dir, "SHA256SUMS");
  if (!fs.existsSync(sums)) {
    io.err(`publish-bundle: ${dir}: SHA256SUMS is missing\n`);
    return 1;
  }
  const listed = [];
  for (const line of fs.readFileSync(sums, "utf8").split("\n").filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) {
      io.err(`publish-bundle: SHA256SUMS has a line that is not "<sha256>  <path>": ${line}\n`);
      return 1;
    }
    const file = path.join(dir, m[2]);
    if (!fs.existsSync(file)) {
      io.err(`publish-bundle: ${m[2]}: listed in SHA256SUMS but missing\n`);
      return 1;
    }
    if (sha256(fs.readFileSync(file)) !== m[1]) {
      io.err(`publish-bundle: ${m[2]}: the SHA-256 differs from SHA256SUMS\n`);
      return 1;
    }
    listed.push(m[2]);
  }
  const extra = listFiles(dir).filter((f) => !SKIP.has(f) && !listed.includes(f));
  if (extra.length) {
    io.err(`publish-bundle: ${extra[0]}: present but not listed in SHA256SUMS\n`);
    return 1;
  }
  const verdict = runVerifier(dir, key);
  if (!verdict.ok) {
    io.err(`publish-bundle: ${dir} does not verify: ${verdict.reason}\n`);
    return 1;
  }
  io.out(`publish-bundle: ok ${dir}\n`);
  return 0;
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  let key = null;
  let out = null;
  let checkDir = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") key = argv[++i] ?? "";
    else if (argv[i] === "--out") out = argv[++i] ?? "";
    else if (argv[i] === "--check") checkDir = argv[++i] ?? "";
    else positional.push(argv[i]);
  }
  const usage = () => {
    io.err(USAGE);
    return 2;
  };
  if (key === null || !FINGERPRINT.test(key)) return usage();
  if (checkDir !== null) {
    if (!checkDir || out !== null || positional.length) return usage();
    return check(path.resolve(checkDir), key, io);
  }
  if (!out || positional.length !== 1) return usage();
  return publish(path.resolve(positional[0]), key, path.resolve(out), io);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
