# AGENTS.md - Harn TypeScript SDK

This repo is the TypeScript SDK for the Harn Agents API. Keep changes small,
typed, and easy to audit.

## Setup

- Use `pnpm`.
- CI uses pnpm `10.31.0` and Node `20`/`22`.
- The npm publish job uses Node `24` so npm can attach provenance.
- Use `pnpm install --frozen-lockfile` for CI parity. Use `pnpm install` only
  when a lockfile change is part of the task.

## Generated API types

- `spec/openapi.yaml` is the source for API shapes.
- Run `pnpm generate:types` after editing `spec/openapi.yaml`.
- Do not hand-edit `src/generated/openapi.ts`.

## Checks

Run the relevant subset while iterating. Before a PR that touches code, API
types, examples, or workflows, run the full set:

```sh
pnpm typecheck
pnpm check:examples
pnpm check:tests
pnpm test
pnpm build
```

For release or package-metadata changes, also run:

```sh
pnpm pack:dry-run
```

## Docs

- Keep `README.md`, `docs/PUBLISHING.md`, `package.json`, and
  `.github/workflows/` in sync.
- Use plain, concrete prose. Prefer sentence-case headings.
- Avoid date-relative release instructions or commit-specific prose.

## Publishing

`docs/PUBLISHING.md` owns npm release instructions. Keep it aligned with:

- `.github/workflows/version-bump.yml`
- `.github/workflows/tag-release.yml`
- `.github/workflows/publish.yml`
- `scripts/release-metadata.mjs`
