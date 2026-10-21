# Run faster local type checks

After `pnpm install --frozen-lockfile`, run:

```sh
pnpm typecheck:tsrs
pnpm check:examples:tsrs
pnpm check:tests:tsrs
```

These commands use [oxc-project/tsrs](https://github.com/oxc-project/tsrs),
the Rust port of the TypeScript 7 type checker. The dependency is pinned to
`0.18.0-ts7.1.0-dev.20260929`. Each command checks its existing project with
`--noEmit` and two checker threads, limiting local CPU use.

The pinned release ships binaries for Apple Silicon and Linux x64/arm64
(glibc and musl). Windows and Intel Macs should use `pnpm typecheck`,
`pnpm check:examples`, and `pnpm check:tests`.

Run those original checks before submitting a PR. They remain the CI gates.
tsrs targets a newer TypeScript version than this SDK, so local tsrs success
does not prove compatibility with the SDK's supported TypeScript version.
`pnpm build` and `prepack` continue to use TypeScript for JavaScript,
declarations, and source maps. Code generation keeps its TypeScript API.

## Adoption evidence

At base `eb69609c7`, TypeScript 6.0.3 and the pinned tsrs passed all three
projects. Five measured runs per command, after one warm-up each, alternated
compiler order on burinlabs0 (macOS arm64). Dependencies were already installed;
timings include launching each package's `node_modules/.bin` executable and
exclude the pnpm wrapper. Every run exited zero. Median wall times:

| Project | TypeScript | tsrs, two checkers | Speedup |
| --- | ---: | ---: | ---: |
| `tsconfig.json --noEmit` | 0.714 s | 0.149 s | 4.8x |
| `tsconfig.examples.json --noEmit` | 0.689 s | 0.135 s | 5.1x |
| `tsconfig.test.json --noEmit` | 0.703 s | 0.133 s | 5.3x |

A temporary source file with an invalid assignment, missing property, and
invalid return produced the same diagnostic codes, locations, and messages
with both checkers. This is a focused smoke test, not a conformance claim.
All 35 SDK tests, the existing build, built-package check, and package dry-run
passed. An emit comparison produced 116 files from each tool, but two
declaration files and 19 map files differed. Emission is outside this pilot.

Reproduce the timing comparison with each installed executable, using the
three projects above:

```sh
./node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
./node_modules/.bin/tsrs -p tsconfig.json --noEmit --pretty false --checkers 2
```

Upstream describes stable TypeScript 7.1 conformance as a goal, documents
diagnostic ordering and instantiation-depth differences, and has incomplete
language-server coverage. Keep the pilot local until platform coverage and
the SDK's required diagnostics are verified on a candidate version. See
[compatibility](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md)
and [usage](https://github.com/oxc-project/tsrs/blob/main/docs/USAGE.md).
