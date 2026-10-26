// Hash a model's weight files into one reproducible digest (SPEC A-03). Run it
// on the inference host and paste the `weights:` line into the global file's
// runners.<name>.identities. Reads files only; writes nothing.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const USAGE = "usage: node scripts/model-identity.mjs <file-or-dir>... [--image sha256:<64 hex>] [--json]";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Hash a file in chunks, so a multi-gigabyte shard never has to fit in memory. */
function hashFile(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n = fs.readSync(fd, buf, 0, buf.length, null); n > 0; n = fs.readSync(fd, buf, 0, buf.length, null)) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else if (st.isFile()) out.push({ rel: path.relative(base, full).split(path.sep).join("/"), full });
  }
}

/**
 * The digest of a set of files and directories: one `<sha256>  <rel>` line per
 * file, sorted by relative path, hashed together. Returns `{ files, weights }`.
 * A missing path throws an Error whose `code` is ENOENT.
 */
export function identityOf(paths) {
  const entries = [];
  for (const arg of paths) {
    const real = fs.realpathSync(arg);
    const st = fs.statSync(real);
    if (st.isDirectory()) walk(real, real, entries);
    else entries.push({ rel: path.basename(real), full: real });
  }
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const files = entries.map((e) => ({ path: e.rel, sha256: hashFile(e.full) }));
  const text = files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  return { files, weights: `sha256:${sha256(Buffer.from(text, "utf8"))}` };
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const paths = [];
  let image = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--image") image = argv[++i] ?? "";
    else paths.push(argv[i]);
  }
  if (!paths.length || (image !== null && !DIGEST.test(image))) {
    io.err(`${USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = identityOf(paths);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const missing = paths.find((p) => !fs.existsSync(p)) ?? paths[0];
    io.err(`model-identity: ${missing}: no such file or directory\n`);
    return 2;
  }
  if (json) {
    io.out(`${JSON.stringify({ files: result.files, weights: result.weights, image }, null, 2)}\n`);
  } else {
    io.out(result.files.map((f) => `${f.sha256}  ${f.path}\n`).join(""));
    io.out(`weights: ${result.weights}\n`);
    if (image !== null) io.out(`image: ${image}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
