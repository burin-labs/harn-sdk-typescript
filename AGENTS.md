# AGENTS.md - Harn TypeScript SDK

This repo is the TypeScript SDK for the Harn Agents API. Keep changes small,
typed, and easy to audit.

## Setup

- Use `pnpm`.
- CI uses pnpm `10.31.0` and Node `22`/`24`. Node `20` is end-of-life; the
  supported floor is `engines.node` in `package.json`.
- pnpm settings (`overrides`, `onlyBuiltDependencies`) live in
  `pnpm-workspace.yaml`. pnpm no longer reads the `pnpm` field in
  `package.json`.
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

<!-- BEGIN HARN SHARED AGENT CONTRACT: managed by harn-bump-fleet -->

## Ecosystem working agreement

- Pursue the ambitious product outcome; make the seams boring with small typed
  interfaces, explicit invariants, and deterministic projections.
- Give each behavior one semantic owner. Generate or parity-test other surfaces
  instead of maintaining competing implementations.
- Work autonomously inside approved scope. Pause for destructive, production,
  high-spend, ambiguous, or authority-expanding actions—not routine reversible work.
- Treat stop, wait, stand down, and pivot as control events for long-lived work.
- Match evidence to the claim. Use the smallest owning product-path check;
  add a falsifier for contested, load-bearing, or potentially vacuous claims.
  Record relevant controls, recovery, and blind spots without repeating proof.
- Evidence follows source and artifact identity, not the branch name. Reuse
  verified branch or merge-candidate evidence after landing when relevant code,
  build inputs, and dependencies are unchanged. Repeat affected checks only
  for a relevant change, observed failure, deployment, or packaging difference.
- "Ship" means integrated on owning main with terminal integration checks and
  applicable release or deployment checks complete. Confirm the landed change
  and merge result; do not rebuild or recapture screenshots solely for main.
- Ship a ready PR by adding the `ship` label when the repo has a Smart Ship
  caller (`.github/workflows/smart-ship.yml`); otherwise land through the merge
  queue with `gh pr merge --squash --auto`. Never `gh pr merge --admin`.
  Incidents use the org override labels `bypass-ci`, `bypass-merge-queue`, or
  `force-merge`.

<!-- END HARN SHARED AGENT CONTRACT -->
