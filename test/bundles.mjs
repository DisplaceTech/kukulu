// The bundle scripts of 0.8.0: scripts/model-identity.mjs here; publish-bundle
// and compare-bundles join it in later tasks. Each runs as a real process.

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finish, ok, eq, like, ROOT, mkDir, buildBundle } from "./harness.mjs";

const IDENTITY = path.join(ROOT, "scripts", "model-identity.mjs");
const FIX = path.join(ROOT, "test", "fixtures", "identity");
const run = (...args) => spawnSync(process.execPath, [IDENTITY, ...args], { encoding: "utf8", cwd: ROOT });
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join("\n");

// ---------------------------------------------------------------- model-identity (P0-05)

const WEIGHTS = "test/fixtures/identity/weights";
const CONFIG = "test/fixtures/identity/config.json";
const before = listing(FIX);

{
  const r = run(WEIGHTS, CONFIG);
  eq(r.status, 0, "model-identity exits 0");
  eq(r.stdout, fs.readFileSync(path.join(FIX, "expected.txt"), "utf8"), "model-identity prints one line per file and the digest from expected.txt");
  eq(r.stdout.split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l)).length, 3, "...three file lines");
  const swapped = run(CONFIG, WEIGHTS);
  eq(swapped.stdout, r.stdout, "the argument order does not change the digest");
}

{
  const image = `sha256:${"c".repeat(64)}`;
  const r = run(WEIGHTS, CONFIG, "--image", image, "--json");
  eq(r.status, 0, "--json exits 0");
  const data = JSON.parse(r.stdout);
  eq(data.files.map((f) => f.path).join(","), "a.bin,config.json,sub/b.bin", "--json prints files sorted by relative path");
  like(data.weights, /^sha256:[0-9a-f]{64}$/, "...the weights digest");
  eq(data.image, image, "...and the image as given");
  eq(JSON.parse(run(WEIGHTS, "--json").stdout).image, null, "...image null when absent");
  const text = run(WEIGHTS, "--image", image);
  like(text.stdout, new RegExp(`weights: sha256:[0-9a-f]{64}\\nimage: ${image}\\n$`), "text output ends with the weights and image lines");
}

{
  const r = run("test/fixtures/identity/nope");
  eq(r.status, 2, "a missing path exits 2");
  eq(r.stderr, "model-identity: test/fixtures/identity/nope: no such file or directory\n", "...naming it");
  eq(r.stdout, "", "...with nothing on stdout");
  const none = run();
  eq(none.status, 2, "no arguments exits 2");
  like(none.stderr, /^usage: node scripts\/model-identity\.mjs/, "...printing usage");
  eq(run(WEIGHTS, "--image", "sha256:abc").status, 2, "a bad --image exits 2");
  eq(run(WEIGHTS, "--image").status, 2, "--image without a value exits 2");
}

eq(listing(FIX), before, "the script writes nothing");

// ---------------------------------------------------------------- publish-bundle (P1-04)

const PUBLISH = path.join(ROOT, "scripts", "publish-bundle.mjs");
const publishRun = (...args) => spawnSync(process.execPath, [PUBLISH, ...args], { encoding: "utf8", cwd: ROOT });
const freshBundle = (opts) => buildBundle(path.join(mkDir("kukulu-pub-src-"), "bundle"), opts);
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).sort().join("\n");

{
  const b = freshBundle();
  const out = mkDir("kukulu-pub-out-");
  const r = publishRun(b.dir, "--key", b.fingerprint, "--out", out);
  eq(r.status, 0, "publish exits 0");
  const dest = path.join(out, "bundle-test");
  like(r.stdout, new RegExp(`^publish-bundle: wrote ${dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(\\d+ files\\)\n$`), "...naming the directory and the file count");
  const check = publishRun("--check", dest, "--key", b.fingerprint);
  eq(check.status, 0, "publish then --check passes");
  like(check.stdout, /^publish-bundle: ok /, "...printing ok");

  const copied = fs.readdirSync(b.dir, { recursive: true }).filter((f) => fs.statSync(path.join(b.dir, f)).isFile()).sort();
  ok(copied.every((f) => fs.readFileSync(path.join(b.dir, f)).equals(fs.readFileSync(path.join(dest, f)))), "every file is copied byte for byte");
  const lines = fs.readFileSync(path.join(dest, "SHA256SUMS"), "utf8").split("\n").filter(Boolean);
  eq(lines.map((l) => l.slice(66)).join(","), copied.join(","), "SHA256SUMS lists every copied file, sorted by path");
  ok(lines.every((l) => /^[0-9a-f]{64} {2}\S/.test(l)), "...in sha256sum -c format");
  ok(lines.every((l) => l.slice(0, 64) === createHash("sha256").update(fs.readFileSync(path.join(dest, l.slice(66)))).digest("hex")), "...with correct digests");
  ok(!lines.some((l) => /SHA256SUMS|VERIFY\.txt/.test(l)), "...not listing itself or VERIFY.txt");
  const verify = fs.readFileSync(path.join(dest, "VERIFY.txt"), "utf8").split("\n");
  eq(verify[0], "K\u016bkulu attestation bundle", "VERIFY.txt starts with the display name");
  eq(verify.slice(1, 7).join("|"), `flight: bundle-test|mode: clean-room|enforcement: hook|signer: ${b.fingerprint}|verify: node verify.mjs . --key ${b.fingerprint}|expected exit status: 0`, "...then the flight, mode, level, signer, command and expected status");
  like(verify[7], /^Get the signer's fingerprint from a source other than this directory/, "...and the out-of-band sentence");

  fs.appendFileSync(path.join(dest, "SUMMARY.md"), "x");
  const bad = publishRun("--check", dest, "--key", b.fingerprint);
  eq(bad.status, 1, "a changed byte in the published copy fails --check");
  eq(bad.stderr, "publish-bundle: SUMMARY.md: the SHA-256 differs from SHA256SUMS\n", "...naming the file");

  const before = tree(out);
  const again = publishRun(b.dir, "--key", b.fingerprint, "--out", out);
  eq(again.status, 1, "an existing output directory refuses");
  like(again.stderr, /already exists; remove it or choose another --out/, "...with the reason");
  eq(tree(out), before, "...and writes nothing");

  const other = mkDir("kukulu-pub-out-");
  const wrong = publishRun(b.dir, "--key", `sha256:${"0".repeat(64)}`, "--out", other);
  eq(wrong.status, 1, "the wrong --key refuses");
  like(wrong.stderr, /^publish-bundle: .* does not verify: signature: /, "...saying the bundle does not verify");
  eq(fs.readdirSync(other).length, 0, "...before writing anything");
}

{
  const c = freshBundle({ mode: "control-positive" });
  const out = mkDir("kukulu-pub-out-");
  const r = publishRun(c.dir, "--key", c.fingerprint, "--out", out);
  eq(r.status, 0, "a control bundle publishes");
  const verify = fs.readFileSync(path.join(out, "bundle-test", "VERIFY.txt"), "utf8");
  like(verify, /\nmode: control-positive\n/, "...recording its mode");
  like(verify, /\nexpected exit status: 3, with the last line CONTROL \(positive\)\n/, "...with expected exit status 3");
  eq(publishRun("--check", path.join(out, "bundle-test"), "--key", c.fingerprint).status, 0, "...and --check accepts it");
}

{
  const b = freshBundle();
  const fp = b.fingerprint;
  eq(publishRun(b.dir, "--out", "x").status, 2, "missing --key is a usage error");
  eq(publishRun(b.dir, "--key", fp).status, 2, "missing --out is a usage error");
  eq(publishRun(b.dir, "--key", "sha256:abc", "--out", "x").status, 2, "a malformed fingerprint is a usage error");
  eq(publishRun("--check", b.dir, "--key", fp, "--out", "x").status, 2, "both forms at once is a usage error");
  like(publishRun().stderr, /^usage: node scripts\/publish-bundle\.mjs/, "usage goes to stderr");
}

finish();
