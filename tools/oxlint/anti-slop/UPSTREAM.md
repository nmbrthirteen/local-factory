# Anti-slop upstream

- Source: https://github.com/dmmulroy/anti-slop
- Commit: 13909c9e07590f5a85d93c62712259fe14a883f7
- Installed with: `skills/install-anti-slop/scripts/install.mjs`, copied from `skills/install-anti-slop/assets/anti-slop`
- Installed path: `tools/oxlint/anti-slop/` (entry point `index.ts`, rules in `rules/`, helpers in `shared/`)
- Nested provenance: `vendor/eslint-stylistic/UPSTREAM.md` and `vendor/eslint-stylistic/LICENSE` travel with the readability rule
- Opt-in Effect plugin: copied in `effect/` but not registered, because the repository does not depend on `effect`

## Deviations

- Plugin files: none. The copy is identical to the upstream assets at the commit above.
- Configuration: `.oxlintrc.json` registers the generic plugin and enables the 19 rules from the install skill at `error`.
- Ignores: the agent directories from the install skill plus `.factory`, `agents`, `dist`, `node_modules`, and this directory.
- Biome ignores this directory in `biome.json` so the formatter leaves the vendored files byte-identical to upstream.
- Dependencies: `oxlint` and `@oxlint/plugins` are pinned at 1.78.0 in `devDependencies`.
