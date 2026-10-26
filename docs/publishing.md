# Publishing an attestation bundle

A finished clean-room flight ends in `docs/attestation/`, a signed bundle that anyone can check offline (see [cleanroom.md](./cleanroom.md#verifying-offline)). Publishing it means putting a copy where others can fetch it, and telling them the signer's fingerprint by a route that is not the bundle.

## Procedure

1. **Build the bundle.** Run `kukulu_attest` after `kukulu_summary_commit` (and `kukulu_similarity`, when the flight scored). It verifies the bundle with its own `verify.mjs` before it commits anything.
2. **Make the publishable copy.**

   ```text
   node scripts/publish-bundle.mjs docs/attestation --key sha256:<fingerprint> --out <dir>
   ```

   The script runs the bundle's verifier with `--key`, accepts exit 0 (or exit 3, a control bundle), and refuses with `publish-bundle: <bundle> does not verify: <reason>` otherwise. It then writes `<dir>/<flight>/` holding every file byte for byte, a `SHA256SUMS` in `sha256sum -c` format (sorted by path, not listing itself or `VERIFY.txt`), and a `VERIFY.txt` that names the flight, the mode, the enforcement level, the signer, the command and the expected exit status. It refuses when `<dir>/<flight>` already exists, and writes nothing in that case. It never uses the network.
3. **Host it anywhere static.** The copy is plain files: a git repository, an object store, a release asset. Nothing about the host is trusted.
4. **Publish the fingerprint by another route.** Put the signer's fingerprint in the project's README, a signed tag or a DNS TXT record. A bundle can carry any key it likes, so a reader who takes the fingerprint from the bundle checks only that it is self-consistent.
5. **Re-check from a second machine.** Fetch the published directory and run

   ```text
   node scripts/publish-bundle.mjs --check <published-dir> --key sha256:<fingerprint>
   ```

   It confirms that every `SHA256SUMS` line matches its file and that no file is unlisted, then runs the verifier with the expected exit status. `publish-bundle: ok <dir>` means the copy is intact. A reader without this repository runs `node verify.mjs . --key sha256:<fingerprint>` inside the directory, which is the line in `VERIFY.txt`.

A control bundle (a positive-control flight, see [cleanroom.md](./cleanroom.md#control-mode)) publishes the same way. Its `VERIFY.txt` says `expected exit status: 3, with the last line CONTROL (positive)`, because the verifier never reports a control bundle as a clean-room pass.

## Showing it on kukulu.tech

A page on kukulu.tech for a sample bundle is a site change. It goes through the owner's `docs/site/copy-changes.json`, after the flight, and is not part of publishing the bundle.
