# Recorded bundles

Data for `test/attest.mjs`. A bundle here holds a public key and signatures
only, never a private key.

- `v0-7-2/`: a small attestation bundle in the shape 0.7.2 wrote: no
  `enforcement` and no `roles` in the manifest, `coverage.knownLimits` empty.
  It was generated once with the test harness's `buildBundle` before the
  enforcement level existed, with a throwaway key. Its signer fingerprint is
  `sha256:0561a28f9799e9f209ffbddfc810e9da44f81017d4aafde13db056232c013d8d`.
  The verifier must keep accepting it, with the note
  `enforcement absent (bundle from 0.7.x); read as hook`.
