# Recorded container-engine output

Data for the fake `docker` in `test/harness.mjs` (`mkFakeDocker`). Tests copy
the files they need into the fake's directory; nothing here is run.

- `version.txt`: the first line `docker --version` prints, which `doctor` shows.
- `inspect.json`: what `docker inspect kukulu-<id>` prints for a running
  sandbox container (container name `kukulu-0123456789abcdef`, `Id` `c0ffee`
  and zeros): `State.Running`
  true, `Image` `sha256:` and 64 zeros, `HostConfig.NetworkMode` `none`, and
  `Mounts` matching the `containerArgs` list for the local-only template with
  the plugin root `/opt/kukulu`. The project root is written `__ROOT__`, which
  a test replaces with the real project path before copying the file in.
- `Containerfile.it`: the minimal image the opt-in integration step of
  `test/sandbox.mjs` builds (`KUKULU_SANDBOX_IT=1`, docker on `PATH`). It has
  `git`, `ca-certificates`, `curl` and a `kukulu` user with the build-arg uid
  (the host user's, so the bind-mounted project is writable), and no Claude Code.
