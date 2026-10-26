# Recorded container-engine output

Data for the fake `docker` in `test/harness.mjs` (`mkFakeDocker`). Tests copy
the files they need into the fake's directory; nothing here is run.

- `version.txt`: the first line `docker --version` prints, which `doctor` shows.
- `inspect.json`: what `docker inspect kukulu-<id>` prints for a running
  sandbox container (container name `kukulu-0123456789abcdef`): `State.Running`
  true, `Image` `sha256:` and 64 zeros, `HostConfig.NetworkMode` `none`, and
  `Mounts` matching the `containerArgs` list for the local-only template with
  the plugin root `/opt/kukulu`. The project root is written `__ROOT__`, which
  a test replaces with the real project path before copying the file in.
