// The bundle scripts of 0.8.0: scripts/model-identity.mjs here; publish-bundle
// and compare-bundles join it in later tasks. Each runs as a real process.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finish, ok, eq, like, ROOT } from "./harness.mjs";

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

finish();
