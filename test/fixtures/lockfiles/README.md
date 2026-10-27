# Lockfile fixtures

Hand-written minimal forms of each lockfile `mcp/cleanroom.mjs` reads
(`Cargo.lock`, `package-lock.json`, `npm-shrinkwrap.json`, `uv.lock`,
`poetry.lock`, `requirements.txt`, `requirements-dev.txt`). They are not real
projects and no tool produced them; they hold just enough structure to test the
parsers. The package names are chosen to exercise name normalization and
`deny.packages`.
