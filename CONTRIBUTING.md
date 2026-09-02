# Contributing to the Harn TypeScript SDK

This guide is for anyone changing `@burin-labs/harn`, the TypeScript client for
the Harn Agents API. It covers setup, the checks to run, and how a release
reaches npm.

The SDK is pre-1.0 and is not on npm yet, so its surface can still change
between versions. If you depend on it today, pin a commit.

## Set up a checkout

```sh
git clone https://github.com/burin-labs/harn-sdk-typescript.git
cd harn-sdk-typescript
pnpm install --frozen-lockfile
```

Use pnpm. The lockfile is committed and CI installs with `--frozen-lockfile`,
so an install that rewrites it fails the build.

## Run the checks

Run the narrowest check that covers what you changed, then broaden before you
open a pull request.

```sh
pnpm typecheck        # the library itself
pnpm test             # vitest
pnpm check:examples   # examples/ compile against the built types
pnpm check:tests      # test/ typechecks
pnpm build            # tsc into dist/
pnpm pack:dry-run     # what npm would actually publish
```

`pnpm check:examples` is the one people skip and the one that catches the most.
The examples import the package the way a consumer does, so a change that
breaks the public type surface fails there while `pnpm typecheck` stays green.

## Generated types are not editable

`src/generated/openapi.ts` is generated from the vendored OpenAPI contract in
`spec/`. Regenerate it rather than editing it:

```sh
pnpm generate:types
```

A hand-edit survives review and then disappears at the next regeneration, and
the symptom is a runtime decoding failure rather than a failing test. When the
Harn runtime ships new protocol artifacts, update the spec and regenerate in
the same pull request.

Hand-written code owns `HarnClient`, the auth helpers, SSE and WebSocket
streaming, the approval and webhook helpers, and the tool definition helpers.
Those are the files to change for behavior.

## Security defaults you should not weaken

Four behaviors exist because of the 2026-05-23 security sweep. Changing any of
them needs a stated reason in the pull request:

- The bearer token is pinned to the host in `baseUrl`. A request that resolves
  to a different host, including after a redirect, does not carry
  `Authorization`.
- `baseUrl` must be `https://`, except `localhost` and `127.0.0.1`. Anything
  else throws at construction.
- Overriding `baseUrl` while a token or `auth` provider is set logs a warning.
- `parseApprovalWebhook` verifies the signature over the timestamp and the raw
  body. It needs the exact bytes your framework received, before JSON parsing.

Add a test alongside any change to these.

## Release and publish

1. Land the change on `main` with CI green.
2. Bump the version with `pnpm version:alpha`, `version:patch`,
   `version:minor`, or `version:major`, and add the matching section to
   `CHANGELOG.md`.
3. Follow [docs/PUBLISHING.md](docs/PUBLISHING.md) for the npm release itself.

`prepack` runs `pnpm build`, so the published tarball is always built from the
committed source. Run `pnpm pack:dry-run` before publishing and read the file
list: `package.json` restricts it to `dist`, `spec/openapi.yaml`, the README,
and the license, and an accidental widening is easiest to catch there.

Nothing is on npm yet, so the first publish also creates the package name.
Publish the first version under the `alpha` tag, not `latest`.

## Pull request titles and descriptions

Title every pull request `[Area] Sentence case description`, for example
`[Client] Pin the bearer token to the base URL host`. Use one of `Client`,
`Protocol`, `Examples`, `Docs`, `CI`, `Tests`, or `Release`.

Keep the description to three to five sentences: what changed, why, the one
risk, and how you verified it. `.github/pull_request_template.md` carries the
prompts.

## Labels

`.github/labels.yml` records the label vocabulary. Priority, status, and effort
come from the org taxonomy in
[burin-labs/.github](https://github.com/burin-labs/.github); `area/*` is local
to this repository. Reuse `bug`, `enhancement`, and `documentation` for type
rather than adding a `type/*` prefix.

## Reporting a bug

Open an issue at
<https://github.com/burin-labs/harn-sdk-typescript/issues/new>. Include the SDK
commit, the runtime (Node version or browser), and the request or stream that
misbehaved. Never paste a token, an API key, or a webhook signing secret into
an issue.
