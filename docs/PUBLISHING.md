# Publishing

This repo publishes `@burin-labs/harn` to npm from GitHub Actions.

## First Publish

npm does not have a separate package-create button for this case. A scoped package page is created by the first successful publish of a package whose `package.json` name is under that scope.

Because npm trusted publishing is configured from an existing package's settings page, bootstrap the first version with one of these paths:

1. Manual local publish:

   ```sh
   npm login
   npm whoami
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm check:examples
   pnpm test
   pnpm build
   npm pack --dry-run
   npm publish --access public --tag alpha
   ```

2. One-time GitHub Actions token publish:

   - Create a granular npm automation token with publish access to the `@burin-labs` scope.
   - Add it as `NPM_TOKEN` on the GitHub `npm` environment or repo secrets.
   - Push a release tag or run the `Publish to npm` workflow for an existing tag.
   - Delete the token after trusted publishing is configured.

For scoped packages, `--access public` is required; otherwise npm defaults scoped packages to private visibility.

## Configure Trusted Publishing

After the first publish creates the package page:

1. Open the package settings for `@burin-labs/harn` on npm.
2. Add a trusted publisher:
   - Provider: GitHub Actions
   - GitHub organization/user: `burin-labs`
   - Repository: `harn-sdk-typescript`
   - Workflow filename: `publish.yml`
   - Environment: `npm`
3. In GitHub, configure the `npm` environment with required reviewers.
4. Remove the `NPM_TOKEN` secret if it was used for bootstrap.

Trusted publishing uses OIDC, so routine releases do not need long-lived npm tokens.

## Routine Release

1. Run the `Version Bump PR` workflow.
   - Use `prerelease` with `preid=alpha` for alpha releases.
   - Use `patch`, `minor`, or `major` for stable releases.
   - Or set `explicit_version` to an exact semver string.
2. Review and merge the generated release PR.
3. Run the `Create Release Tag` workflow with the merged version, for example `0.1.0-alpha.1`.
4. The pushed `vX.Y.Z` tag triggers `Publish to npm`.

The publish workflow derives the npm dist-tag from the package version:

- Stable versions publish as `latest`.
- Prerelease versions publish to their prerelease identifier, for example `0.1.0-alpha.1` publishes as `alpha`.

## Local Release Helpers

The local scripts are intentionally thin wrappers:

```sh
pnpm version:alpha
pnpm version:patch
pnpm version:minor
pnpm version:major
pnpm pack:dry-run
pnpm publish:alpha
pnpm publish:latest
```

Prefer the GitHub workflows for official releases so the published artifact has provenance and a reproducible CI trail.

## Recovery

If a publish fails because trusted publishing is not configured yet, use the first-publish bootstrap path above. If a publish fails after the tag already exists, fix the workflow or npm configuration and rerun `Publish to npm` with the existing tag.
