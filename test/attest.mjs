// The offline verifier and the attestation bundle it checks (0.7.0). The bundles
// here are built by the harness with mcp/cleanroom.mjs and tampered with on
// disk, one thing at a time; each tamper must fail with the named reason, and
// the untampered bundle must pass with and without --key.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finish, ok, eq, like, ROOT, mkDir, buildBundle, rewriteManifest, signBundleManifest } from "./harness.mjs";
import * as CR from "../mcp/cleanroom.mjs";
import * as V from "../scripts/verify-attestation.mjs";

const VERIFIER = path.join(ROOT, "scripts", "verify-attestation.mjs");
const fresh = (opts) => buildBundle(path.join(mkDir("kukulu-bundle-"), "bundle"), opts);
const run = (dir, ...extra) => spawnSync(process.execPath, [VERIFIER, dir, ...extra], { encoding: "utf8" });
const reasons = (dir, opts) => V.verifyBundle(dir, opts).reasons.map((r) => `${r.check}: ${r.reason}`);
const logLines = (dir) => fs.readFileSync(path.join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean);

// ---------------------------------------------------------------- an intact bundle

{
  const b = fresh();
  const r = run(b.dir);
  eq(r.status, 0, "an intact bundle passes");
  like(r.stdout, /verify-attestation: note: signer: self-consistent, fingerprint not checked against an out-of-band value\n/, "...noting that the signer was not checked out of band");
  like(r.stdout, /verify-attestation: PASS\n$/, "...ending in PASS");
  const keyed = run(b.dir, "--key", b.fingerprint);
  eq(keyed.status + "|" + /note: signer/.test(keyed.stdout), "0|false", "an intact bundle passes with the right --key, with no signer note");
  const wrong = run(b.dir, "--key", "sha256:" + "0".repeat(64));
  eq(wrong.status, 1, "a wrong --key fails");
  like(wrong.stdout, /verify-attestation: signature: the signer's fingerprint is sha256:[0-9a-f]{64}, not the sha256:0{64} you asked for/, "...naming the signer");
  like(wrong.stdout, /verify-attestation: FAIL \(1 reason\)\n$/, "...and counting one reason");
  const j = run(b.dir, "--json");
  const parsed = JSON.parse(j.stdout);
  eq(j.stdout.trim().split("\n").length + "|" + parsed.ok + "|" + Object.keys(parsed).sort().join(","), "1|true|checks,notes,ok,reasons", "--json prints one object");
  eq(Object.keys(parsed.checks).join(","), "manifest,signature,chain,checkpoints,policy,guard,mode,denials,coverage,similarity", "...with a result for each of the ten checks");
  eq(run(b.dir, "--json").status, 0, "...and exits 0 on a pass");
  const bad = JSON.parse(run(b.dir, "--json", "--key", "sha256:" + "1".repeat(64)).stdout);
  eq(bad.ok + "|" + bad.reasons[0].check, "false|signature", "--json carries the reasons too");
}

// ---------------------------------------------------------------- the command line

{
  const b = fresh();
  const none = spawnSync(process.execPath, [VERIFIER], { encoding: "utf8" });
  ok(none.status === 2 && /usage: node verify-attestation\.mjs/.test(none.stderr), "no bundle directory is a usage error");
  const unknown = run(b.dir, "--frobnicate");
  ok(unknown.status === 2 && /unknown option --frobnicate/.test(unknown.stderr), "an unknown option is a usage error");
  const noValue = run(b.dir, "--key");
  eq(noValue.status, 2, "--key without a value is a usage error");
  const missing = run(path.join(b.dir, "nope"));
  eq(missing.status, 1, "a directory that is not a bundle fails");
  like(missing.stdout, /manifest: manifest\.json is missing/, "...saying the manifest is missing");
}

// ---------------------------------------------------------------- check 1: the manifest and its files

{
  const b = fresh();
  fs.appendFileSync(path.join(b.dir, "SUMMARY.md"), "edited\n");
  const r = reasons(b.dir);
  ok(r.length === 1 && /^manifest: SUMMARY\.md: the SHA-256 differs from the manifest's; the file was changed$/.test(r[0]), "a changed file fails check 1 naming it");
  const out = run(b.dir);
  eq(out.status, 1, "...and the command exits 1");
  fs.unlinkSync(path.join(b.dir, "REVIEW.md"));
  ok(reasons(b.dir).some((x) => x === "manifest: REVIEW.md is listed in the manifest but missing from the bundle"), "a missing listed file fails check 1");
  ok(reasons(b.dir).length === 2, "...and every failure is reported, not only the first");

  const sized = fresh();
  rewriteManifest(sized.dir, sized.key, (m) => { m.files[1].bytes += 1; });
  ok(reasons(sized.dir).some((x) => /^manifest: .*: the size differs from the manifest's/.test(x)), "a wrong size fails check 1");

  const versioned = fresh();
  rewriteManifest(versioned.dir, versioned.key, (m) => { m.version = 2; });
  ok(reasons(versioned.dir).some((x) => x === "manifest: manifest.json version is 2, not 1"), "a manifest version other than 1 fails check 1");

  const garbled = fresh();
  fs.writeFileSync(path.join(garbled.dir, "manifest.json"), "{ not json");
  const g = reasons(garbled.dir);
  ok(g.some((x) => /^manifest: manifest\.json does not parse/.test(x)) && g.some((x) => /^signature: manifest\.sig does not verify/.test(x)), "an unparseable manifest fails check 1 and its signature fails check 2");
}

// ---------------------------------------------------------------- check 2: the signature

{
  const b = fresh();
  fs.writeFileSync(path.join(b.dir, "manifest.sig"), Buffer.alloc(64, 7).toString("base64") + "\n");
  eq(JSON.stringify(reasons(b.dir)), JSON.stringify(["signature: manifest.sig does not verify over manifest.json with publisher.pub"]), "a bad manifest.sig fails check 2");
  const edited = fresh();
  const file = path.join(edited.dir, "manifest.json");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"flight": "bundle-test"', '"flight": "other"'));
  eq(JSON.stringify(reasons(edited.dir)), JSON.stringify(["signature: manifest.sig does not verify over manifest.json with publisher.pub"]), "an edited manifest fails check 2 (its listed files are unchanged)");
  const swapped = fresh();
  const other = CR.generateKey(path.join(mkDir("kukulu-other-key-"), "k.pem"));
  fs.writeFileSync(path.join(swapped.dir, "publisher.pub"), other.publicKey.export({ type: "spki", format: "pem" }));
  const s = reasons(swapped.dir);
  ok(s.some((x) => x.startsWith("signature:")) && s.some((x) => x.startsWith("manifest: publisher.pub:")), "a swapped public key fails the signature and the file hash");
  const noSig = fresh();
  fs.unlinkSync(path.join(noSig.dir, "manifest.sig"));
  ok(reasons(noSig.dir).includes("signature: manifest.sig is missing"), "a missing manifest.sig fails check 2");
}

// ---------------------------------------------------------------- check 3: the chain

{
  const b = fresh();
  const lines = logLines(b.dir);
  lines[2] = lines[2].replace('"target":"/p/a.rs"', '"target":"/p/evil.rs"');
  fs.writeFileSync(path.join(b.dir, "log.jsonl"), lines.join("\n") + "\n");
  const r = reasons(b.dir);
  ok(r.some((x) => /^chain: entry 3 \(line 3\): the hash does not match the entry's content; the entry was edited$/.test(x)), "a tampered log line fails check 3 naming its seq");
  ok(r.some((x) => /^manifest: log\.jsonl: the SHA-256 differs/.test(x)), "...and check 1 sees the changed file too");

  const dropped = fresh();
  const dl = logLines(dropped.dir);
  dl.splice(3, 1);
  fs.writeFileSync(path.join(dropped.dir, "log.jsonl"), dl.join("\n") + "\n");
  ok(reasons(dropped.dir).some((x) => /^chain: entry 5 \(line 4\): seq is 5 but this is entry 4; an entry was dropped/.test(x)), "a dropped log line fails check 3");

  const swapped = fresh();
  const sl = logLines(swapped.dir);
  [sl[2], sl[3]] = [sl[3], sl[2]];
  fs.writeFileSync(path.join(swapped.dir, "log.jsonl"), sl.join("\n") + "\n");
  ok(reasons(swapped.dir).some((x) => /^chain: entry 4 \(line 3\)/.test(x)), "a reordered log line fails check 3");

  const tip = fresh();
  rewriteManifest(tip.dir, tip.key, (m) => { m.chain.tip = "f".repeat(64); });
  eq(JSON.stringify(reasons(tip.dir)), JSON.stringify(["chain: chain.tip in the manifest is not the log's tip"]), "a chain.tip mismatch fails check 3");
  const count = fresh();
  rewriteManifest(count.dir, count.key, (m) => { m.chain.entries = 99; });
  ok(reasons(count.dir)[0].startsWith("chain: the manifest says 99 entries"), "a wrong entry count fails check 3");
  const first = fresh();
  rewriteManifest(first.dir, first.key, (m) => { m.chain.first = "e".repeat(64); });
  ok(reasons(first.dir)[0].startsWith("chain: chain.first"), "a wrong chain.first fails check 3");
}

// ---------------------------------------------------------------- check 4: checkpoints and genesis

{
  const stranger = CR.generateKey(path.join(mkDir("kukulu-stranger-"), "k.pem"));
  const b = fresh({ checkpointKey: stranger });
  const r = reasons(b.dir);
  eq(JSON.stringify(r), JSON.stringify(["checkpoints: entry 8: the checkpoint does not verify with publisher.pub"]), "a checkpoint signed by another key fails check 4");

  const gen = fresh();
  rewriteManifest(gen.dir, gen.key, (m) => { m.genesis = { ...m.genesis, target: "tampered" }; });
  eq(JSON.stringify(reasons(gen.dir)), JSON.stringify(["checkpoints: the genesis entry differs from manifest.genesis"]), "a genesis that differs from manifest.genesis fails check 4");

  const named = fresh();
  rewriteManifest(named.dir, named.key, (m) => { m.checkpoints[0].signature = "AAAA"; });
  ok(reasons(named.dir)[0].startsWith("checkpoints: entry 6: the signature differs from the manifest's"), "a manifest checkpoint with another signature fails check 4");
  const ghost = fresh();
  rewriteManifest(ghost.dir, ghost.key, (m) => { m.checkpoints.push({ seq: 99, event: "x", git: "g", signature: "s", ok: true }); });
  ok(reasons(ghost.dir)[0].startsWith("checkpoints: the manifest names a checkpoint at seq 99"), "a manifest checkpoint that the log lacks fails check 4");

  const notFirst = fresh();
  const lines = logLines(notFirst.dir);
  // Re-chain the log without its genesis so the chain itself is valid but starts at the wrong place.
  const pubOnly = path.join(mkDir("kukulu-nogenesis-"), "log.jsonl");
  for (const l of lines.slice(1)) {
    const e = JSON.parse(l);
    CR.appendEntry(pubOnly, { kind: e.kind, stage: e.stage, task: e.task, role: e.role, model: e.model, session: e.session, tool: e.tool, target: e.target, decision: e.decision, reason: e.reason, ...(e.data ? { data: e.data } : {}) });
  }
  fs.copyFileSync(pubOnly, path.join(notFirst.dir, "log.jsonl"));
  ok(reasons(notFirst.dir).some((x) => x === "checkpoints: the log has no genesis entry"), "a log with no genesis entry fails check 4");
}

// ---------------------------------------------------------------- check 5: the policy

{
  const other = "9".repeat(64);
  const b = fresh();
  rewriteManifest(b.dir, b.key, (m) => { m.policy.hashes = [other]; });
  const r = reasons(b.dir);
  ok(r.length === 2 && r.every((x) => /^policy: entry (6|8): the checkpoint's policyHash [0-9a-f]{64} is not in the manifest's policy\.hashes$/.test(x)), "a checkpoint policyHash missing from policy.hashes fails check 5");

  // A policy change between checkpoints: a third checkpoint under another policy hash, then back.
  const key = CR.generateKey(path.join(mkDir("kukulu-policy-key-"), "k.pem"));
  const changed = fresh({
    key,
    extra: (log) => {
      const entries = CR.readEntries(log);
      const first = entries.find((e) => e.kind === "checkpoint").data;
      const data = CR.signCheckpoint({ chainTip: entries.at(-1).hash, git: first.git, policyHash: other, guardHash: first.guardHash, loggerHash: first.loggerHash, hooksHash: first.hooksHash, keyFingerprint: key.fingerprint, event: "policy-edit" }, key.privateKey);
      CR.appendEntry(log, { kind: "checkpoint", stage: "implement", role: "session", model: "claude-test", session: "s-1", data });
    },
  });
  const was = changed.manifest.policy.current;
  rewriteManifest(changed.dir, key, (m) => { m.policy.hashes = [was, other]; });
  const res = V.verifyBundle(changed.dir);
  ok(res.ok && res.notes.includes("policy changed at seq 7") && res.notes.includes("policy changed at seq 9"), "a policy change between checkpoints is reported, not failed");
  const cli = run(changed.dir);
  like(cli.stdout, /verify-attestation: note: policy changed at seq 7\n/, "...as a note on the command line");
  rewriteManifest(changed.dir, key, (m) => { m.policy.hashes = [other, was]; });
  ok(reasons(changed.dir).some((x) => /^policy: policy\.hashes is not the checkpoints' distinct policy hashes in the order they first appear$/.test(x)), "policy.hashes in another order fails check 5");

  const current = fresh();
  rewriteManifest(current.dir, current.key, (m) => { m.policy.current = other; });
  const c = reasons(current.dir);
  ok(c.includes("policy: policy.json does not hash to the manifest's policy.current") && c.some((x) => /last checkpoint's policyHash is not the manifest's policy\.current/.test(x)), "a policy.json that is not policy.current fails check 5");
  const noPolicy = fresh();
  fs.unlinkSync(path.join(noPolicy.dir, "policy.json"));
  ok(reasons(noPolicy.dir).includes("policy: policy.json is missing"), "a missing policy.json fails check 5");
}

// ---------------------------------------------------------------- check 6: the guard

{
  const b = fresh();
  rewriteManifest(b.dir, b.key, (m) => { m.plugin.guardHash = "0".repeat(64); });
  const r = reasons(b.dir);
  ok(r.length === 2 && r.every((x) => /^guard: entry (6|8): the checkpoint's guardHash differs from the manifest's plugin\.guardHash$/.test(x)), "a differing guardHash fails check 6");
  for (const field of ["loggerHash", "hooksHash"]) {
    const c = fresh();
    rewriteManifest(c.dir, c.key, (m) => { m.plugin[field] = "1".repeat(64); });
    ok(reasons(c.dir).every((x) => x.includes(field)) && reasons(c.dir).length === 2, "a differing " + field + " fails check 6");
  }
}

// ---------------------------------------------------------------- check 7: the mode

{
  const b = fresh({ extra: (log) => CR.appendEntry(log, { kind: "gate", stage: "controller", role: "session", data: { failed: "mode", reason: "the flight was recorded in general mode" } }) });
  eq(JSON.stringify(reasons(b.dir)), JSON.stringify(["mode: entry 7: a gate failed the mode check: the flight was recorded in general mode"]), "a gate entry recording a mode failure fails check 7");
  const other = fresh({ extra: (log) => CR.appendEntry(log, { kind: "gate", stage: "controller", role: "session", data: { failed: "chain", reason: "x" } }) });
  ok(V.verifyBundle(other.dir).ok, "a gate that failed on another check does not fail check 7");
  const general = fresh({ mode: "general" });
  eq(JSON.stringify(reasons(general.dir)), JSON.stringify(['mode: the genesis records mode "general", not "clean-room"']), "a genesis that is not clean-room fails check 7");
}

// ---------------------------------------------------------------- check 8: the denials

{
  const b = fresh();
  rewriteManifest(b.dir, b.key, (m) => { m.denials.total = 2; });
  eq(JSON.stringify(reasons(b.dir)), JSON.stringify(["denials: the manifest says 2 denials, the log has 1"]), "a wrong denial count fails check 8");
  const reason = fresh();
  rewriteManifest(reason.dir, reason.key, (m) => { m.denials.byReason = { "denied path: /elsewhere": 1 }; });
  ok(reasons(reason.dir)[0].startsWith("denials: the manifest's denials.byReason differs"), "a wrong denial reason fails check 8");

  // A verdict on the denial (seq 4), and one on an entry that is not a denial (seq 3), which counts for nothing.
  const v = fresh({
    extra: (log) => {
      CR.appendEntry(log, { kind: "human", stage: "controller", role: "operator", target: "#4: false positive — a header named in a comment", data: { kind: "verdict", via: "kukulu_cleanroom_record" } });
      CR.appendEntry(log, { kind: "human", stage: "controller", role: "operator", target: "#3: offline test — not a denial", data: { kind: "verdict", via: "kukulu_cleanroom_record" } });
    },
  });
  eq(JSON.stringify(v.manifest.denials.verdicts), JSON.stringify({ "prior-art attempt": 0, "false positive": 1, "offline test": 0, unclassified: 0 }), "the harness counts the verdict (test setup)");
  ok(V.verifyBundle(v.dir).ok, "verdicts recounted from the log match an honest manifest");
  rewriteManifest(v.dir, v.key, (m) => { m.denials.verdicts = { "prior-art attempt": 0, "false positive": 0, "offline test": 1, unclassified: 0 }; });
  ok(reasons(v.dir)[0].startsWith("denials: the manifest's denials.verdicts differs"), "a wrong verdict count fails check 8");
  rewriteManifest(v.dir, v.key, (m) => { m.denials.verdicts = { "prior-art attempt": 0, "false positive": 0, "offline test": 0, unclassified: 1 }; });
  ok(reasons(v.dir)[0].startsWith("denials: the manifest's denials.verdicts differs"), "...including a verdict hidden as unclassified");

  const tampered = fresh();
  const lines = logLines(tampered.dir);
  lines[2] = lines[2].replace('"target":"/p/a.rs"', '"target":"/p/x.rs"');
  fs.writeFileSync(path.join(tampered.dir, "log.jsonl"), lines.join("\n") + "\n");
  ok(reasons(tampered.dir).includes("denials: not checked: the chain does not verify"), "checks 5 to 9 say so when the chain does not verify");
}

// ---------------------------------------------------------------- check 9: the coverage gaps

{
  const sha = (c) => c.repeat(40);
  const commits = [
    `${sha("b")}\x1fG\x1fP0-01: fine\x1fimplement\x1fP0-01`,
    `${sha("c")}\x1fG\x1fa commit with no trailer\x1f\x1f`,
    `${sha("d")}\x1fN\x1fP0-02: unsigned\x1fimplement\x1fP0-02`,
    `${sha("e")}\x1fB\x1fP0-03: bad signature\x1fimplement\x1fP0-03`,
  ].join("\n") + "\n";
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const hold = { clock: () => now, commits };
  const extra = (log) => {
    const e = { stage: "controller", role: "operator" };
    CR.appendEntry(log, { kind: "gate", ...e, data: { checks: 7, ok: true } });
    CR.appendEntry(log, { kind: "gate", ...e, data: { checks: 7, ok: true } });
    CR.appendEntry(log, { kind: "human", ...e, target: "installed a tool by hand", data: { kind: "intervention", via: "kukulu_cleanroom_record" } });
    now += 5 * 3600 * 1000;
    CR.appendEntry(log, { kind: "human", ...e, target: "carry on", data: { kind: "instruction", via: "kukulu_cleanroom_record" } });
  };
  const expected = [
    { kind: "silent-gates", from: 7, to: 8 },
    { kind: "untrailed-commit", sha: sha("c"), subject: "a commit with no trailer" },
    { kind: "intervention", seq: 9 },
    { kind: "idle", from: 9, to: 10, hours: 5 },
    { kind: "unsigned-commit", sha: sha("d") },
    { kind: "unsigned-commit", sha: sha("e") },
  ];
  const b = fresh({ ...hold, extra });
  const r = reasons(b.dir);
  ok(r.length === expected.length && expected.every((g) => r.includes("coverage: the log shows a gap the manifest omits: " + JSON.stringify(g))), "a missing coverage gap fails check 9");
  for (const kind of ["silent-gates", "untrailed-commit", "intervention", "idle", "unsigned-commit"]) {
    ok(r.some((x) => x.includes(JSON.stringify(kind))), "each gap kind is recomputed: " + kind);
  }
  const honest = fresh({ ...hold, extra, gaps: expected });
  const out = run(honest.dir);
  eq(out.status, 0, "a manifest that lists every gap passes check 9");
  for (const g of expected) ok(out.stdout.includes("verify-attestation: note: coverage gap: " + JSON.stringify(g) + "\n"), "...and every gap is printed: " + g.kind);
  const swapped = fresh({ ...hold, extra, gaps: [expected[1], expected[0], ...expected.slice(2)] });
  eq(JSON.stringify(reasons(swapped.dir)), JSON.stringify(["coverage: the manifest lists the gaps in a different order than the log gives them"]), "gaps listed in another order fail check 9");
  const invented = fresh({ ...hold, extra, gaps: [...expected, { kind: "intervention", seq: 2 }] });
  ok(reasons(invented.dir)[0].startsWith("coverage: the manifest lists a gap the log and commits.txt do not show:"), "a gap the log does not show fails check 9");
  now = Date.parse("2026-01-01T00:00:00.000Z");
  const tight = fresh({ ...hold, extra, gaps: expected, idleGapHours: 6 });
  ok(reasons(tight.dir).length === 1 && /omits|do not show/.test(reasons(tight.dir)[0]), "idleGapHours is the manifest's own: a longer one drops the idle gap");
  const noHours = fresh();
  rewriteManifest(noHours.dir, noHours.key, (m) => { delete m.coverage.idleGapHours; });
  ok(reasons(noHours.dir).includes("coverage: the manifest's coverage.idleGapHours is not a positive number"), "a manifest with no idleGapHours fails check 9");
  const noCommits = fresh();
  fs.unlinkSync(path.join(noCommits.dir, "commits.txt"));
  ok(reasons(noCommits.dir).some((x) => x.startsWith("coverage: commits.txt is missing")), "a missing commits.txt fails check 9");
  ok(V.verifyBundle(fresh().dir).notes.every((n) => !n.startsWith("coverage gap")), "an intact bundle has no gaps to print");
}

// ---------------------------------------------------------------- check 10: the similarity report

{
  const text = JSON.stringify({ verdict: "clear", score: 0.01 }) + "\n";
  const b = fresh({ similarity: text });
  ok(V.verifyBundle(b.dir).ok, "a bundle with a similarity.json that matches the manifest passes");
  fs.writeFileSync(path.join(b.dir, "similarity.json"), JSON.stringify({ verdict: "clear", score: 0 }) + "\n");
  const r = reasons(b.dir);
  ok(r.includes("similarity: similarity.json does not hash to the manifest's similarity.sha256"), "a changed similarity.json fails check 10");
  fs.unlinkSync(path.join(b.dir, "similarity.json"));
  ok(reasons(b.dir).includes("similarity: similarity.json is missing but the manifest records its hash"), "a missing similarity.json fails check 10");
  ok(V.verifyBundle(fresh().dir).checks.similarity === true, "a bundle with no similarity report passes check 10");
}

// ---------------------------------------------------------------- the verifier and the module agree

{
  const b = fresh();
  const lines = logLines(b.dir);
  const same = (ls, label) => {
    const a = V.verifyChain(ls);
    const c = CR.verifyChain(ls);
    eq(JSON.stringify([a.ok, a.tip, a.entries.length, a.firstBad]), JSON.stringify([c.ok, c.tip, c.entries.length, c.firstBad]), `the verifier and mcp/cleanroom.mjs agree on ${label}`);
  };
  same(lines, "an intact chain");
  const t = lines.slice();
  t[3] = t[3].replace('"decision":"denied"', '"decision":"allowed"');
  same(t, "a tampered chain");
  const r = lines.slice();
  [r[1], r[2]] = [r[2], r[1]];
  same(r, "a reordered chain");
  const d = lines.slice();
  d.splice(1, 1);
  same(d, "a chain with a dropped line");
  same(["{nope"], "a line that is not JSON");
  same([], "an empty chain");
  const entries = CR.readEntries(path.join(b.dir, "log.jsonl"));
  const cps = entries.filter((e) => e.kind === "checkpoint");
  const stranger = CR.generateKey(path.join(mkDir("kukulu-stranger-"), "k.pem"));
  for (const [label, entry, pub] of [
    ["a good checkpoint", cps[0], b.key.publicKey],
    ["a checkpoint under another key", cps[0], stranger.publicKey],
    ["a changed checkpoint field", { ...cps[0], data: { ...cps[0].data, git: "c".repeat(40) } }, b.key.publicKey],
    ["a checkpoint with an added field", { ...cps[0], data: { ...cps[0].data, extra: 1 } }, b.key.publicKey],
    ["a non-checkpoint entry", entries[2], b.key.publicKey],
  ]) {
    eq(V.verifyCheckpoint(entry, pub), CR.verifyCheckpoint(entry, pub), `the verifier and mcp/cleanroom.mjs agree on ${label}`);
  }
}

// ---------------------------------------------------------------- self-containment

{
  const src = fs.readFileSync(VERIFIER, "utf8");
  ok(!/^#!/.test(src), "the verifier has no shebang (it runs as node ...)");
  const imports = [...src.matchAll(/^import\b[^;]*from\s*["']([^"']+)["']/gm)].map((m) => m[1]);
  ok(imports.length > 0 && imports.every((i) => i.startsWith("node:")), `the verifier imports only node: modules (${imports.join(", ")})`);
  // The copy in a bundle runs alone, from its own directory, with the repository out of reach.
  const b = fresh();
  const alone = spawnSync(process.execPath, [path.join(b.dir, "verify.mjs"), b.dir], { cwd: b.dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  eq(alone.status, 0, "the bundle's verify.mjs copy runs from the bundle directory and passes");
  eq(fs.readFileSync(path.join(b.dir, "verify.mjs"), "utf8"), src, "...and is a byte copy of the script");
}

finish();
