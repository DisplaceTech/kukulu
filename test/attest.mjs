// The offline verifier and the attestation bundle it checks (0.7.0). The bundles
// here are built by the harness with mcp/cleanroom.mjs and tampered with on
// disk, one thing at a time; each tamper must fail with the named reason, and
// the untampered bundle must pass with and without --key.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  finish, ok, eq, like, isError, ROOT, mkDir, buildBundle, rewriteManifest, signBundleManifest,
  cleanroomRepo, plannedRepo, addPlan, withServer, logCall, runHook, testKeyFor, setState, git, writeFile, readFile, hasFile,
} from "./harness.mjs";
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

  // The editor recomputes the edited entry's hash and refreshes the manifest, so only the link to the next entry gives it away.
  const rehashed = fresh();
  const rl = logLines(rehashed.dir);
  const { hash: _old, ...bare } = JSON.parse(rl[2].replace('"target":"/p/a.rs"', '"target":"/p/evil.rs"'));
  rl[2] = JSON.stringify({ ...bare, hash: CR.entryHash(bare.prev, bare) });
  fs.writeFileSync(path.join(rehashed.dir, "log.jsonl"), rl.join("\n") + "\n");
  rewriteManifest(rehashed.dir, rehashed.key, (m) => {
    const bytes = fs.readFileSync(path.join(rehashed.dir, "log.jsonl"));
    const file = m.files.find((x) => x.path === "log.jsonl");
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    file.bytes = bytes.length;
  });
  ok(reasons(rehashed.dir).some((x) => /^chain: entry 4 \(line 4\): prev does not match/.test(x)), "a rehashed log edit fails check 3 on the broken link");

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

{
  // mcp/cleanroom.mjs is pinned in genesis from 0.7.1 on (SPEC A-06); older bundles stay readable.
  const absent = fresh();
  const absentOut = V.verifyBundle(absent.dir);
  ok(absentOut.reasons.length === 0 && absentOut.notes.includes("plugin.cleanroomHash absent (bundle from 0.7.0 or earlier)"), "a bundle without plugin.cleanroomHash verifies with the absent note");
  const pinned = fresh({ cleanroomHash: "c".repeat(64) });
  const pinnedOut = V.verifyBundle(pinned.dir);
  ok(pinnedOut.reasons.length === 0 && !pinnedOut.notes.some((n) => /cleanroomHash/.test(n)), "a bundle whose plugin.cleanroomHash equals genesis passes without a note");
  const differs = fresh({ cleanroomHash: "c".repeat(64) });
  rewriteManifest(differs.dir, differs.key, (m) => { m.plugin.cleanroomHash = "d".repeat(64); });
  eq(JSON.stringify(reasons(differs.dir)), JSON.stringify(["guard: the manifest's plugin.cleanroomHash differs from the genesis entry's cleanroomHash"]), "a bundle whose plugin.cleanroomHash differs from genesis fails the guard check");
  const noGenesis = fresh();
  rewriteManifest(noGenesis.dir, noGenesis.key, (m) => { m.plugin.cleanroomHash = "d".repeat(64); });
  const noGenesisOut = V.verifyBundle(noGenesis.dir);
  ok(noGenesisOut.reasons.length === 0 && noGenesisOut.notes.includes("genesis has no cleanroomHash (flight started on 0.7.0 or earlier); plugin.cleanroomHash not compared"), "a genesis without cleanroomHash passes with the not-compared note");
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

// ---------------------------------------------------------------- pre-0.6.0 tool logs (the cleanflate fixture)

{
  const fixture = path.join(ROOT, "test", "fixtures", "foundry-tool-log.jsonl");
  const raw = fs.readFileSync(fixture, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const source = fs.readFileSync(path.join(ROOT, "test", "fixtures", "foundry-tool-log.SOURCE"), "utf8");
  const first = JSON.parse(lines[0]).ts;
  const last = JSON.parse(lines.at(-1)).ts;
  ok(lines.length === 20 && raw.endsWith("\n") && source.includes(first) && source.includes(last) && source.includes("85f210084a367dcc706c732f5776bf0563cdc0cd") && source.includes("unmodified"), "the cleanflate fixture is 20 lines whose first and last ts match SOURCE");
  eq(first + " " + last, "2026-09-29T14:53:58.191Z 2026-09-29T14:56:41.968Z", "...and they are the planned range");

  // The excerpt's own build: where it must not have read, what it must not have named, and the root it ran in.
  // These are fixture data; the verifier itself has no defaults.
  const legacyArgs = ["--roots", "~/.cargo/registry/,~/.cargo/git/,/usr/include/zlib.h", "--words", "zlib,miniz,flate2,libdeflate,libz-sys,libz_sys,zopfli", "--repo", "/media/ericmann/Data/Projects/cleanflate"];
  const r = spawnSync(process.execPath, [VERIFIER, "--legacy-log", fixture, ...legacyArgs], { encoding: "utf8" });
  eq(r.status, 0, "the legacy reader exits 0 when every line parses");
  like(r.stdout, /^lines: 20 parsed, 0 failed$/m, "every line of it parses");
  like(r.stdout, /^denials: 1$/m, "it has exactly one denial");
  like(r.stdout, /^  line 9 \(2026-09-29T14:54:47\.458Z\) Bash: forbidden word in path argument: \*\/libz-sys-\*\/src\/lib\.rs$/m, "its reason is forbidden word in path argument: */libz-sys-*/src/lib.rs");
  like(r.stdout, /^forbidden-read candidates: 1\n  line 9 .*Bash denied: \*\/libz-sys-\*\/src\/lib\.rs \(names libz-sys outside the repository\)$/m, "it is a forbidden-read candidate on libz-sys");
  like(r.stdout, /^legacy log: no hash chain or signatures; integrity rests on the git history that holds it$/m, "the legacy line is printed");
  like(r.stdout, /^read-capable calls: 13$/m, "read-capable calls are counted");
  like(r.stdout, /^calls by tool: Bash 13, /m, "calls by tool are counted");
  like(r.stdout, /^calls by stage: implement 20$/m, "calls by stage are counted");

  const j = JSON.parse(spawnSync(process.execPath, [VERIFIER, "--legacy-log", fixture, ...legacyArgs, "--json"], { encoding: "utf8" }).stdout);
  eq(j.parsed + "|" + j.failed.length + "|" + j.denials.length + "|" + j.candidates.length, "20|0|1|1", "--json carries the same counts");

  const none = spawnSync(process.execPath, [VERIFIER, "--legacy-log", fixture, "--words", "nothing-here", "--roots", "/nowhere/"], { encoding: "utf8" });
  like(none.stdout, /^forbidden-read candidates: 0$/m, "--words and --roots decide the candidates");
  const inside = spawnSync(process.execPath, [VERIFIER, "--legacy-log", fixture, ...legacyArgs.slice(0, 4), "--repo", "/"], { encoding: "utf8" });
  like(inside.stdout, /^forbidden-read candidates: 1$/m, "a glob that starts with * stays a candidate whatever --repo says");

  // A path under a root is a candidate whatever it names; a word inside the repository is not.
  const probe = path.join(mkDir("kukulu-legacy-"), "log.jsonl");
  const stageKey = "foun" + "dry_stage";
  const row = (tool, target) => JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", [stageKey]: "implement", task_id: "P0-01", model: "m", tool, target, decision: "allowed", reason: null }) + "\n";
  fs.writeFileSync(probe, row("Read", "/home/x/.cargo/registry/src/a/lib.rs") + row("Read", "/repo/src/zlib_notes.rs") + row("Grep", "zlib") + row("Write", "/elsewhere/zlib.rs") + row("Bash", "ls /repo/src /elsewhere/miniz/a.c"));
  for (const [args, what] of [[["--words", "zlib"], "--roots"], [["--roots", "/r/"], "--words"]]) {
    const u = spawnSync(process.execPath, [VERIFIER, "--legacy-log", probe, ...args], { encoding: "utf8" });
    ok(u.status === 2 && /needs --roots and --words: .*there are no defaults/.test(u.stderr), "--legacy-log without " + what + " is a usage error: the reader has no defaults");
  }
  const outsideRepo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kukulu-legacy-norepo-")), "log.jsonl");
  fs.copyFileSync(probe, outsideRepo);
  const norepo = spawnSync(process.execPath, [VERIFIER, "--legacy-log", outsideRepo, "--roots", "/r/", "--words", "w"], { encoding: "utf8" });
  ok(norepo.status === 2 && /is not inside a git repository; pass --repo/.test(norepo.stderr), "a log outside any repository needs --repo");
  const inRepo = mkDir("kukulu-legacy-repo-");
  fs.mkdirSync(path.join(inRepo, ".git"));
  fs.mkdirSync(path.join(inRepo, "logs"));
  fs.writeFileSync(path.join(inRepo, "logs", "log.jsonl"), row("Read", path.join(inRepo, "src", "zlib_notes.rs")) + row("Read", "/elsewhere/zlib.rs") + row("Read", path.join(path.dirname(inRepo), "kukulu-legacy-sibling", "zlib.rs")));
  const d = JSON.parse(spawnSync(process.execPath, [VERIFIER, "--legacy-log", path.join(inRepo, "logs", "log.jsonl"), "--roots", "/r/", "--words", "zlib", "--json"], { encoding: "utf8" }).stdout);
  eq(JSON.stringify(d.candidates.map((c) => c.line)), "[2,3]", "--repo defaults to the git repository holding the log: a word inside it is not a candidate, one outside it, a sibling of the repository included, is");
  const p = JSON.parse(spawnSync(process.execPath, [VERIFIER, "--legacy-log", probe, "--roots", "/home/x/.cargo/registry/", "--words", "zlib,miniz", "--repo", "/repo", "--json"], { encoding: "utf8" }).stdout);
  eq(JSON.stringify(p.candidates.map((c) => c.line)), "[1,5]", "a root hit and a word outside the repository are candidates; a word inside it, a bare word and a write are not");

  // A malformed line is counted, named and fails the run; the others are still read.
  const bad = path.join(mkDir("kukulu-legacy-"), "log.jsonl");
  fs.writeFileSync(bad, lines[0] + "\n{not json\n" + JSON.stringify({ ts: "x", tool: "Bash" }) + "\n" + lines[1] + "\n");
  const b = spawnSync(process.execPath, [VERIFIER, "--legacy-log", bad, ...legacyArgs], { encoding: "utf8" });
  eq(b.status, 1, "a malformed line is counted as failed and exits 1");
  like(b.stdout, /^lines: 2 parsed, 2 failed$/m, "...the other lines are still read");
  like(b.stdout, /^  failed line 2: the line is not valid JSON$/m, "...and a failed line is named");
  like(b.stdout, /^  failed line 3: ts is missing or not a timestamp$/m, "...with its reason");
  const missing = spawnSync(process.execPath, [VERIFIER, "--legacy-log", path.join(bad, "nope"), ...legacyArgs], { encoding: "utf8" });
  ok(missing.status === 2 && /cannot read/.test(missing.stderr), "an unreadable log file is a usage error");
  const mixed = spawnSync(process.execPath, [VERIFIER, "--legacy-log", fixture, "somedir"], { encoding: "utf8" });
  eq(mixed.status, 2, "--legacy-log with a bundle directory is a usage error");
  const stray = spawnSync(process.execPath, [VERIFIER, fixture, "--words", "x"], { encoding: "utf8" });
  eq(stray.status, 2, "--words without --legacy-log is a usage error");
}

// ---------------------------------------------------------------- kukulu_attest

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const LOGPATH = (repo) => path.join(repo, ".kukulu", "cleanroom", "log.jsonl");
const entriesOf = (repo) => CR.readEntries(LOGPATH(repo));
const GUARD = path.join(ROOT, "scripts", "cleanroom-guard.mjs");
const LOGGER = path.join(ROOT, "scripts", "cleanroom-log.mjs");

/** A server over \`repo\` whose every call is preceded by a logged tool call, as a live session's hooks would leave. \`keyOf\` is the repo whose signing key to use (a copy keeps the original's). */
const live = (repo, fn, keyOf = repo) => withServer(repo, async (server) => fn({ ...server, call: async (name, args) => { logCall(repo); return server.call(name, args); } }), { env: { KUKULU_CLEANROOM_KEY: testKeyFor(keyOf) } });
const trailed = (repo, id, title, file) => {
  writeFile(repo, file, "x\n");
  git(repo, ["add", "--", file]);
  git(repo, ["commit", "-qm", id + ": " + title + "\n\nKukulu-Stage: implement\nKukulu-Task: " + id, "--", file]);
};
const copyOf = (repo) => {
  const dest = path.join(mkDir("kukulu-attest-copy-"), "repo");
  fs.cpSync(repo, dest, { recursive: true });
  return dest;
};

/** A clean-room flight taken to the end of the summary stage: a denial with a verdict, a prompt, two tasks, review, summary. */
async function summarizedFlight() {
  const repo = cleanroomRepo();
  await live(repo, async ({ call }) => { await call("kukulu_next"); });
  const tasks = [
    { id: "P0-01", title: "Create hello", goal: "write hello.txt", files: "hello.txt" },
    { id: "P0-02", title: "Create world", goal: "write world.txt", files: "world.txt", depends: ["P0-01"] },
  ];
  addPlan(repo, { tasks, config: { flight: "w1" } });
  const env = { CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: ROOT };
  runHook(LOGGER, { hook_event_name: "UserPromptSubmit", prompt: "Build it without looking anything up.", cwd: repo, session_id: "s1", model: "claude-test" }, env);
  await live(repo, async ({ call }) => {
    await call("kukulu_next");
    await call("kukulu_run_start");
    for (const t of tasks) {
      await call("kukulu_task_next");
      if (t.id === "P0-01") {
        const denied = runHook(GUARD, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: path.join(os.homedir(), ".cargo", "registry", "src", "index", "x.rs") }, cwd: repo, session_id: "s1", model: "claude-test" }, env);
        eq(denied.status, 2, "(setup) the guard denies a Read under deny.paths");
      }
      trailed(repo, t.id, t.title, t.files);
      await call("kukulu_task_done", { id: t.id, log: "wrote " + t.files });
    }
    const seq = entriesOf(repo).find((e) => e.kind === "denied").seq;
    const rec = await call("kukulu_cleanroom_record", { text: "#" + seq + ": false positive — a registry path in a comment", kind: "verdict" });
    ok(!rec.error, "(setup) the denial is classified");
    writeFile(repo, "docs/HANDOFF.md", "# Handoff\n");
    await call("kukulu_run_finish");
    writeFile(repo, "docs/REVIEW.md", "# Review\nRound: 1\n**Verdict**: APPROVED\n");
    await call("kukulu_review_submit", { verdict: "APPROVED" });
    const sum = await call("kukulu_summary_commit", { content: "# Summary\nDone.\n" });
    ok(!sum.error, "(setup) the summary is committed");
  });
  return repo;
}

{
  // refusals that need no flight
  const general = plannedRepo({ config: { flight: "w1" } });
  setState(general, { implemented: true, reviewed: true, verdict: "APPROVED", summarized: true });
  git(general, ["add", "-A"]);
  git(general, ["commit", "-qm", "chore: approved"]);
  await withServer(general, async ({ call }) => {
    isError(await call("kukulu_attest"), /only works in clean-room mode/, "kukulu_attest refuses outside clean-room mode");
    ok(!hasFile(general, "docs/attestation"), "...before any write");
  });

  const early = cleanroomRepo();
  await live(early, async ({ call }) => { await call("kukulu_next"); });
  addPlan(early, { config: { flight: "w1" } });
  await live(early, async ({ call }) => {
    isError(await call("kukulu_attest"), /the summary is not committed yet; call kukulu_summary_commit first/, "kukulu_attest refuses before the summary is committed");
  });
}

{
  const flight = await summarizedFlight();
  eq(git(flight, ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter((l) => l && !l.endsWith("log.jsonl")).join("\n"), "", "(setup) the finished flight's tree is clean");

  // refusals on a finished flight
  {
    const repo = copyOf(flight);
    fs.appendFileSync(path.join(repo, "CLAUDE.md"), "edited\n");
    await live(repo, async ({ call }) => {
      isError(await call("kukulu_attest"), /the working tree is not clean:\n.*CLAUDE\.md/, "kukulu_attest refuses on a dirty tree");
      writeFile(repo, "notes.txt", "x\n");
      isError(await call("kukulu_attest", { evidence: ["notes.txt"] }), /evidence path notes\.txt is not tracked by git/, "...an untracked evidence path");
      isError(await call("kukulu_attest", { evidence: ["/etc/passwd"] }), /evidence path "\/etc\/passwd" must be repo-relative/, "...an evidence path outside the repo (absolute)");
      isError(await call("kukulu_attest", { evidence: ["../outside.txt"] }), /must be repo-relative, with no '~' and no '\.\.' segment/, "...and with a .. segment");
      isError(await call("kukulu_attest", { evidence: ["no/such/file.txt"] }), /does not exist or is not a file/, "...and a missing evidence path");
      isError(await call("kukulu_attest", { evidence: "x" }), /evidence must be an array of repo-relative file paths/, "...and evidence that is not an array");
      ok(!hasFile(repo, "docs/attestation"), "none of the refusals wrote a bundle");
    }, flight);
  }
  {
    const repo = copyOf(flight);
    writeFile(repo, "docs/cleanroom.json", readFile(repo, "docs/cleanroom.json").replace('"WebSearch"', '"WebSearch", "Agent"'));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "edit the policy"]);
    await live(repo, async ({ call }) => {
      isError(await call("kukulu_attest"), /^clean-room gate failed: policy: /, "kukulu_attest refuses when the gate fails");
      ok(!hasFile(repo, "docs/attestation"), "...before any write");
      eq(entriesOf(repo).at(-1).data.failed, "policy", "...recording the failure in the chain");
    }, flight);
  }

  // the bundle
  {
    const repo = copyOf(flight);
    writeFile(repo, "docs/conformance.txt", "all 41 vectors pass\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "docs: conformance results\n\nKukulu-Stage: implement\nKukulu-Task: -"]);
    const head = git(repo, ["rev-parse", "HEAD"]);
    const before = entriesOf(repo).length;
    await live(repo, async ({ call }) => {
      const r = await call("kukulu_attest", { evidence: ["docs/conformance.txt"] });
      ok(!r.error, "kukulu_attest runs on a finished clean-room flight" + (r.error ? ": " + r.error : ""));
      const dir = path.join(repo, "docs", "attestation");
      const names = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.relative(dir, path.join(d.parentPath ?? d.path, d.name))).sort();
      const want = ["PROGRESS.md", "REVIEW.md", "SUMMARY.md", "commits.txt", "evidence/docs/conformance.txt", "kukulu.json", "log.jsonl", "manifest.json", "manifest.sig", "policy.json", "publisher.pub", "similarity.json", "state.json", "verify.mjs"].filter((n) => n !== "similarity.json").sort();
      eq(names.join(","), want.join(","), "the bundle holds every F-01 file (similarity.json only when a score ran)");
      eq(r.files.join(","), names.join(","), "...and the result lists them");
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      const listed = manifest.files.map((f) => f.path).sort();
      eq(listed.join(","), names.filter((n) => !["manifest.json", "manifest.sig", "verify.mjs"].includes(n)).join(","), "manifest.files lists every file but manifest.json, manifest.sig and verify.mjs");
      ok(manifest.files.every((f) => f.sha256 === sha(fs.readFileSync(path.join(dir, f.path))) && f.bytes === fs.statSync(path.join(dir, f.path)).size), "...with each file's SHA-256 and size");
      const verifierBytes = fs.readFileSync(VERIFIER);
      ok(fs.readFileSync(path.join(dir, "verify.mjs")).equals(verifierBytes) && manifest.plugin.verifierHash === sha(verifierBytes), "verify.mjs is a byte copy and its hash is plugin.verifierHash");
      eq(r.manifest, sha(fs.readFileSync(path.join(dir, "manifest.json"))), "the result carries the SHA-256 of manifest.json");
      eq(fs.readFileSync(path.join(dir, "evidence/docs/conformance.txt"), "utf8"), "all 41 vectors pass\n", "an evidence file is copied to evidence/<its path>");

      const commits = fs.readFileSync(path.join(dir, "commits.txt"), "utf8").split("\n").filter(Boolean);
      const count = Number(git(repo, ["rev-list", "--count", "main..HEAD~1"]));
      const fields = commits.map((l) => l.split("\x1f"));
      ok(commits.length === count && fields.every((f) => f.length === 5 && /^[0-9a-f]{40}$/.test(f[0]) && f[3] !== "" && f[4] !== ""), "commits.txt has one line per commit with both trailers (" + count + " commits)");
      ok(fields.some((f) => f[2] === "P0-01: Create hello" && f[3] === "implement" && f[4] === "P0-01"), "...the task commits' subject and trailers as written");
      eq(fields[0][2], "docs: conformance results", "...the newest first, as git log prints them");
      ok(manifest.coverage.gaps.length === count && manifest.coverage.gaps.every((g) => g.kind === "unsigned-commit"), "the gaps are the unsigned commits of this unsigned test repository, and nothing else (" + count + ")");

      ok(r.verify.ok === true && r.verify.reasons.length === 0, "the verifier's PASS is returned");
      eq(Object.keys(r.verify.checks).join(","), "manifest,signature,chain,checkpoints,policy,guard,mode,denials,coverage,similarity", "...with all ten checks run");
      eq(r.fingerprint, manifest.signer.fingerprint, "the result carries the signer's fingerprint");
      const cli = spawnSync(process.execPath, [VERIFIER, dir, "--key", r.fingerprint], { encoding: "utf8" });
      eq(cli.status, 0, "the CLI passes the committed bundle with the right --key");

      const entries = entriesOf(repo);
      const tail = entries.slice(-2);
      eq(tail.map((e) => e.kind).join(",") + "|" + tail[1].data.event, "attest,checkpoint|kukulu_attest", "an attest entry and a checkpoint follow the bundle");
      eq(tail[0].data.manifest, r.manifest, "...the attest entry holds the manifest's hash");
      ok(CR.verifyCheckpoint(tail[1], CR.loadKey(testKeyFor(flight)).publicKey), "...and the checkpoint verifies");
      eq(fs.readFileSync(path.join(dir, "log.jsonl"), "utf8").split("\n").filter(Boolean).length, entries.length - 2, "the bundle's log ends before those two entries");
      eq(manifest.chain.entries, entries.length - 2, "...and manifest.chain counts it");
      ok(entries.length > before, "(the chain grew)");

      eq(git(repo, ["log", "-1", "--format=%s"]), "chore: attestation bundle", "the bundle is committed as chore: attestation bundle");
      const committed = git(repo, ["show", "--name-only", "--format="]).split("\n").filter(Boolean).sort();
      eq(committed.join(","), [...names.map((n) => "docs/attestation/" + n), ".kukulu/cleanroom/log.jsonl"].sort().join(","), "...with the bundle and the log");
      eq(git(repo, ["log", "-1", "--format=%(trailers:key=Kukulu-Stage,valueonly)"]).trim(), "summarize", "...carrying the summarize trailer");
      eq(r.push, "skipped: no origin remote", "no origin means the push is skipped");
      eq(manifest.repo.head, head, "the manifest names the commit it was made at");
      eq(manifest.denials.verdicts["false positive"] + "|" + manifest.denials.verdicts.unclassified + "|" + manifest.denials.total, "1|0|1", "the denial's verdict is counted");
      eq(manifest.human.verdicts + "|" + (manifest.human.instructions >= 1), "1|true", "the human entries are counted, the prompt among them");
      ok(JSON.stringify(manifest.coverage.knownLimits) === JSON.stringify(CR.KNOWN_LIMITS) && manifest.coverage.idleGapHours === 3, "the coverage section carries the known limits and the idle threshold");
      eq(JSON.stringify(Object.keys(manifest.roles)), JSON.stringify(["planner", "implementer", "reviewer", "summarizer"]), "the manifest's roles name every role");
      eq(JSON.stringify(Object.values(manifest.roles).map(({ assurance, ...rest }) => rest)), JSON.stringify(Object.values(entriesOf(repo)[0].data.roles)), "the manifest's roles repeat genesis's roles");
      ok(Object.values(manifest.roles).every((r) => r.assurance === "configuration" && r.identity.source === "vendor-asserted"), "...with assurance configuration and identity vendor-asserted for the default routing");
      eq(Object.keys(manifest).slice(5, 8).join(","), "genesis,roles,policy", "roles follows genesis in the manifest");
      eq(manifest.plugin.cleanroomHash, CR.policyHash(fs.readFileSync(path.join(ROOT, "mcp", "cleanroom.mjs"))), "the manifest's plugin object carries cleanroomHash");
      eq(Object.keys(manifest.plugin).join(","), "version,guardHash,loggerHash,hooksHash,cleanroomHash,verifierHash", "...after hooksHash");
      eq(manifest.selfTest.ok + "|" + manifest.selfTest.cases, "true|" + manifest.selfTest.cases, "the self-test result is recorded");
      ok(manifest.selfTest.cases > 100, "...with its case count (" + manifest.selfTest.cases + ")");

      // a second call replaces the bundle
      const again = await call("kukulu_attest");
      ok(!again.error && again.manifest !== r.manifest, "a second kukulu_attest replaces the bundle");
      ok(!fs.existsSync(path.join(dir, "evidence")), "...without the evidence it was not given");
    }, flight);
  }

  // a bundle the verifier rejects is never committed
  {
    const repo = copyOf(flight);
    const key = CR.loadKey(testKeyFor(flight));
    const stranger = CR.generateKey(path.join(mkDir("kukulu-stranger-"), "k.pem"));
    const last = entriesOf(repo).findLast((e) => e.kind === "checkpoint").data;
    const base = { git: last.git, policyHash: last.policyHash, guardHash: last.guardHash, loggerHash: last.loggerHash, hooksHash: last.hooksHash, keyFingerprint: last.keyFingerprint };
    // The newest checkpoint is good, so the gate passes; the one before it is signed by another key.
    CR.appendEntry(LOGPATH(repo), { kind: "checkpoint", stage: "summarize", role: "session", data: CR.signCheckpoint({ chainTip: "a".repeat(64), ...base, event: "forged" }, stranger.privateKey) });
    CR.appendEntry(LOGPATH(repo), { kind: "checkpoint", stage: "summarize", role: "session", data: CR.signCheckpoint({ chainTip: "b".repeat(64), ...base, event: "honest" }, key.privateKey) });
    const head = git(repo, ["rev-parse", "HEAD"]);
    await live(repo, async ({ call }) => {
      const r = await call("kukulu_attest");
      isError(r, /the attestation bundle did not verify, so it was removed and nothing was committed:\n  checkpoints: entry \d+: the checkpoint does not verify with publisher\.pub/, "a bundle the verifier rejects is refused with the verifier's reasons");
      ok(!hasFile(repo, "docs/attestation"), "...and removed");
      eq(git(repo, ["rev-parse", "HEAD"]) + "|" + git(repo, ["diff", "--cached", "--name-only"]), head + "|", "...with no commit and nothing staged");
      ok(!entriesOf(repo).some((e) => e.kind === "attest"), "...and no attest entry in the chain");
    }, flight);
  }

  // a failed commit leaves the tree as it found it
  {
    const repo = copyOf(flight);
    const hook = path.join(repo, ".git", "hooks", "commit-msg");
    fs.writeFileSync(hook, "#!/bin/sh\nhead -1 \"$1\" | grep -q '^chore: attestation bundle' && { echo 'rejected by test hook' >&2; exit 1; }\nexit 0\n", { mode: 0o755 });
    const head = git(repo, ["rev-parse", "HEAD"]);
    await live(repo, async ({ call }) => {
      isError(await call("kukulu_attest"), /git commit failed/, "a failing commit makes kukulu_attest refuse");
      ok(!hasFile(repo, "docs/attestation"), "...leaving no bundle");
      eq(git(repo, ["rev-parse", "HEAD"]) + "|" + git(repo, ["diff", "--cached", "--name-only"]), head + "|", "...HEAD unmoved and nothing staged");
      ok(!entriesOf(repo).some((e) => e.kind === "attest") && entriesOf(repo).at(-1).kind === "gate", "...and the chain holds no attest entry or checkpoint from the call (only the gate's own)");
    }, flight);
  }

  // tampering with a bundle kukulu_attest built
  {
    const built = copyOf(flight);
    let fingerprint = null;
    await live(built, async ({ call }) => {
      const r = await call("kukulu_attest");
      ok(!r.error, "(setup) a real bundle is built for the tamper cases");
      fingerprint = r.fingerprint;
    }, flight);
    const real = path.join(built, "docs", "attestation");
    const signer = CR.loadKey(testKeyFor(flight));
    const stranger = CR.generateKey(path.join(mkDir("kukulu-tamper-key-"), "k.pem"));
    const tamper = (fn) => {
      const dir = path.join(mkDir("kukulu-tamper-"), "bundle");
      fs.cpSync(real, dir, { recursive: true });
      fn(dir);
      return dir;
    };
    // Make the manifest agree with a changed file, so the change is judged by the check that owns it and not only by check 1.
    const refile = (dir, name, key = signer) => rewriteManifest(dir, key, (m) => {
      const f = m.files.find((x) => x.path === name);
      const bytes = fs.readFileSync(path.join(dir, name));
      f.sha256 = sha(bytes);
      f.bytes = bytes.length;
    });
    const has = (dir, re, opts) => reasons(dir, opts).some((x) => re.test(x));
    const cli = (dir, ...extra) => spawnSync(process.execPath, [VERIFIER, dir, ...extra], { encoding: "utf8" });

    eq(cli(real).status + "|" + cli(real, "--key", fingerprint).status, "0|0", "the untampered bundle passes with and without --key");
    ok(V.verifyBundle(real, { key: fingerprint }).notes.every((n) => !n.startsWith("signer:")), "...and with --key there is no unchecked-signer note");

    const file = tamper((d) => fs.appendFileSync(path.join(d, "SUMMARY.md"), "x"));
    eq(JSON.stringify(reasons(file)), JSON.stringify(["manifest: SUMMARY.md: the SHA-256 differs from the manifest's; the file was changed"]), "a tampered file fails");

    const manifest = tamper((d) => {
      const m = JSON.parse(fs.readFileSync(path.join(d, "manifest.json"), "utf8"));
      m.chain.entries += 1;
      fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
    });
    ok(has(manifest, /^signature: manifest\.sig does not verify over manifest\.json/), "a tampered manifest fails (the signature no longer covers it)");
    ok(has(manifest, /^chain: the manifest says \d+ entries/), "...and its count disagrees with the log");

    const sig = tamper((d) => {
      const raw = Buffer.from(fs.readFileSync(path.join(d, "manifest.sig"), "utf8").trim(), "base64");
      raw[0] ^= 1;
      fs.writeFileSync(path.join(d, "manifest.sig"), raw.toString("base64") + "\n");
    });
    eq(JSON.stringify(reasons(sig)), JSON.stringify(["signature: manifest.sig does not verify over manifest.json with publisher.pub"]), "a tampered signature fails");

    const line = tamper((d) => {
      const f = path.join(d, "log.jsonl");
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"decision":"allowed"', '"decision":"denied"'));
    });
    ok(has(line, /^chain: entry \d+ \(line \d+\): the hash does not match the entry's content; the entry was edited$/), "a tampered log line fails");
    ok(has(line, /^manifest: log\.jsonl: the SHA-256 differs/), "...and so does the file's hash");

    // A checkpoint edited, the chain rehashed from there, the manifest refreshed and signed again: only the checkpoint's own signature gives it away.
    const checkpoint = tamper((d) => {
      const f = path.join(d, "log.jsonl");
      const entries = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const at = entries.findIndex((e) => e.kind === "checkpoint");
      entries[at].data.git = "c".repeat(40);
      let prev = at === 0 ? CR.ZERO_HASH : entries[at - 1].hash;
      for (let i = at; i < entries.length; i++) {
        const { hash, ...rest } = entries[i];
        rest.prev = prev;
        entries[i] = { ...rest, hash: CR.entryHash(prev, rest) };
        prev = entries[i].hash;
      }
      fs.writeFileSync(f, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
      rewriteManifest(d, signer, (m) => {
        const bytes = fs.readFileSync(f);
        const file = m.files.find((x) => x.path === "log.jsonl");
        file.sha256 = sha(bytes);
        file.bytes = bytes.length;
        m.chain.tip = entries.at(-1).hash;
      });
    });
    const cp = reasons(checkpoint);
    ok(cp.some((x) => /^checkpoints: entry \d+: the checkpoint does not verify with publisher\.pub$/.test(x)) && !cp.some((x) => x.startsWith("chain:") || x.startsWith("signature:") || x.startsWith("manifest:")), "a tampered checkpoint fails (and only the checkpoint check)");

    const policyFile = tamper((d) => fs.appendFileSync(path.join(d, "policy.json"), " "));
    ok(has(policyFile, /^manifest: policy\.json: the SHA-256 differs/), "a tampered policy fails the file's hash");
    const policy = tamper((d) => {
      fs.appendFileSync(path.join(d, "policy.json"), " ");
      refile(d, "policy.json");
    });
    eq(JSON.stringify(reasons(policy)), JSON.stringify(["policy: policy.json does not hash to the manifest's policy.current"]), "...and, with the manifest refreshed, check 5 (a tampered policy fails)");

    const pub = tamper((d) => fs.writeFileSync(path.join(d, "publisher.pub"), stranger.publicKey.export({ type: "spki", format: "pem" })));
    ok(has(pub, /^signature: manifest\.sig does not verify/) && has(pub, /^manifest: publisher\.pub:/), "a swapped public key fails");
    const taken = tamper((d) => {
      fs.writeFileSync(path.join(d, "publisher.pub"), stranger.publicKey.export({ type: "spki", format: "pem" }));
      refile(d, "publisher.pub", stranger);
    });
    ok(has(taken, /^checkpoints: entry \d+: the checkpoint does not verify with publisher\.pub$/) && !has(taken, /^signature:/), "...and a bundle re-signed by its forger still fails on the checkpoints");
    ok(has(taken, /^signature: the signer's fingerprint is sha256:[0-9a-f]{64}, not the /, { key: fingerprint }), "...and on the fingerprint asked for out of band");

    const trailer = tamper((d) => {
      const f = path.join(d, "commits.txt");
      const lines = fs.readFileSync(f, "utf8").split("\n");
      const fields = lines[0].split("\x1f");
      fields[3] = "";
      lines[0] = fields.join("\x1f");
      fs.writeFileSync(f, lines.join("\n"));
    });
    ok(has(trailer, /^manifest: commits\.txt: the SHA-256 differs/), "a tampered commit trailer fails the file's hash");
    const trailer2 = tamper((d) => {
      const f = path.join(d, "commits.txt");
      const lines = fs.readFileSync(f, "utf8").split("\n");
      const fields = lines[0].split("\x1f");
      fields[3] = "";
      lines[0] = fields.join("\x1f");
      fs.writeFileSync(f, lines.join("\n"));
      refile(d, "commits.txt");
    });
    ok(has(trailer2, /^coverage: the log shows a gap the manifest omits: \{"kind":"untrailed-commit","sha":"[0-9a-f]{40}","subject":"/), "...and, with the manifest refreshed, check 9 (a tampered commit trailer fails)");

    // Everything the verifier needs is in the bundle: delete the repository and run its own copy.
    const away = mkDir("kukulu-away-");
    const kept = path.join(away, "bundle");
    fs.cpSync(real, kept, { recursive: true });
    fs.rmSync(built, { recursive: true, force: true });
    const alone = spawnSync(process.execPath, ["verify.mjs", "."], { cwd: kept, encoding: "utf8", env: { PATH: process.env.PATH } });
    eq(alone.status, 0, "the bundle's verify.mjs runs alone with the repo deleted");
    like(alone.stdout, /verify-attestation: PASS\n$/, "...and prints PASS");
    const aloneKey = spawnSync(process.execPath, ["verify.mjs", ".", "--key", fingerprint], { cwd: kept, encoding: "utf8", env: { PATH: process.env.PATH } });
    eq(aloneKey.status, 0, "...also with --key");
  }

  // the archive moves the bundle
  {
    const repo = copyOf(flight);
    await live(repo, async ({ call }) => {
      const a = await call("kukulu_attest");
      ok(!a.error, "(setup) a bundle exists to archive");
      const moved = await call("kukulu_flight_archive");
      ok(!moved.error, "kukulu_flight_archive runs on an attested flight" + (moved.error ? ": " + moved.error : ""));
      ok(!hasFile(repo, "docs/attestation") && hasFile(repo, "docs/flights/w1/attestation/manifest.json") && hasFile(repo, "docs/flights/w1/attestation/verify.mjs"), "the archive moves docs/attestation/ into the flight's directory");
      ok(moved.moved.includes("docs/attestation"), "...and reports it among the files moved");
      eq(git(repo, ["status", "--porcelain", "--untracked-files=all"]).split("\n").filter((l) => l && !l.endsWith("log.jsonl")).join("\n"), "", "...leaving a clean tree");
      eq(git(repo, ["log", "-1", "--format=%s"]), "chore: archive flight w1", "...in the archive commit");
      ok(V.verifyBundle(path.join(repo, "docs", "flights", "w1", "attestation")).ok, "...and the moved bundle still verifies");
    }, flight);
  }
}

// ---------------------------------------------------------------- the verifier and the module agree

{
  // The same entries and commits.txt, scored by both implementations of F-02's gap definitions.
  let now = Date.parse("2026-01-01T00:00:00.000Z");
  const sha = (c) => c.repeat(40);
  const commits = [`${sha("b")}\x1fG\x1fP0-01: fine\x1fimplement\x1fP0-01`, `${sha("c")}\x1fG\x1fhand fix\x1f\x1f`, `${sha("d")}\x1fN\x1fP0-02: x\x1fimplement\x1fP0-02`, `${sha("e")}\x1fB\x1fP0-03: y\x1fimplement\x1fP0-03`].join("\n") + "\n";
  const g = fresh({
    clock: () => now,
    commits,
    extra: (log) => {
      const e = { stage: "controller", role: "operator" };
      CR.appendEntry(log, { kind: "gate", ...e, data: { checks: 7, ok: true } });
      CR.appendEntry(log, { kind: "gate", ...e, data: { checks: 7, ok: true } });
      CR.appendEntry(log, { kind: "human", ...e, target: "by hand", data: { kind: "intervention" } });
      now += 7.25 * 3600 * 1000;
      CR.appendEntry(log, { kind: "human", ...e, target: "carry on", data: { kind: "instruction" } });
    },
  });
  const entries = CR.readEntries(path.join(g.dir, "log.jsonl"));
  const fromModule = CR.coverageGaps(entries, commits.split("\n"), { idleGapHours: 4 });
  ok(fromModule.length === 6, "the module finds the six planted gaps (test setup)");
  rewriteManifest(g.dir, g.key, (mf) => { mf.coverage.gaps = fromModule; });
  const verdict = V.verifyBundle(g.dir);
  ok(verdict.ok, "the verifier and mcp/cleanroom.mjs compute identical gaps");
  eq(verdict.notes.filter((n) => n.startsWith("coverage gap: ")).map((n) => n.slice(14)).join("|"), fromModule.map((x) => JSON.stringify(x)).join("|"), "...in the same order");
}

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
  const h = lines.slice();
  const { hash: _was, ...hb } = JSON.parse(h[2].replace('"decision":"denied"', '"decision":"allowed"').replace(/"target":"[^"]*"/, '"target":"/p/evil.rs"'));
  h[2] = JSON.stringify({ ...hb, hash: CR.entryHash(hb.prev, hb) });
  same(h, "a rehashed edit");
  eq(V.verifyChain(h).firstBad?.line, 4, "...which both name at the next line");
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
