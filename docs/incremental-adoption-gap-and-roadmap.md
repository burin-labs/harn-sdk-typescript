# ADR: Incremental adoption from TypeScript and Python

- Status: Proposed
- Date: 2026-08-25
- Scope: `harn-sdk-typescript` and `harn-sdk-python`
- Runtime baseline: released Harn `v0.10.116`

## Bottom line

The SDKs do not yet offer a competitive function-by-function adoption path.
They are API clients for Harn resources. They do not turn exported `.harn`
functions and types into normal TypeScript or Python calls.

Do not start a second Harn type parser in either SDK. Released Harn already
owns function discovery and execution through its MCP export surface. It emits
input schemas and structured results, but `v0.10.116` does not emit output
schemas. Typed function code generation is therefore premature until Harn
provides that canonical projection and ships it in a release. This is tracked
in [harn#7306](https://github.com/burin-labs/harn/issues/7306).

There is also a release-baseline problem to fix first. Both SDKs track 72 API
operations. Harn `v0.10.116` defines 85. Its release did not publish the SDK
codegen artifacts promised by the release workflow. This is tracked in
[harn#7308](https://github.com/burin-labs/harn/issues/7308).

Decision: first align both SDKs with the generated `v0.10.116` protocol
artifacts. Then pause function codegen until a released Harn contract includes
resolved input and output schemas. TypeScript should lead after that contract
exists. Python should consume the same language-neutral contract.

## What exists today

This survey used TypeScript commit `e5c8605`, Python commit `92d0317`, and Harn
release `v0.10.116` at commit `3ed08af`. The Harn release was published on
2026-08-25. No code from Harn main was used.

### TypeScript SDK

- `spec/openapi.yaml` generates API resource and path types.
- `HarnClient` has typed wrappers for the 72 operations in that local spec.
- SSE task events are exposed as `AsyncIterable<Event>`.
- Tasks, events, receipts, outcomes, and replay provide useful run records.
- Tests exercise the HTTP wrappers, SSE parser, auth, and security defaults.
- Examples are command-line scripts. There is no Express or other existing-app
  route that is run by a test.
- There is no `.harn` function discovery, function client generation, output
  model generation, semantic partial type, function test adapter, or editor
  codegen hook.
- The package declared by this repo was not present in the public npm registry
  when checked on 2026-08-25.

Result: a strong typed REST base, but not an embedded Harn function client.

### Python SDK

- `HarnClient` and `AsyncHarnClient` cover the same 72 operations.
- Most request bodies and responses are `dict[str, Any]`, `Any`, or `object`.
  The small Pydantic surface covers errors, pagination, and stream envelopes,
  not Harn API resources or user functions.
- SSE, task events, receipts, outcomes, replay, and a tool decorator are
  present.
- Tests exercise sync and async routing, SSE, auth, and security defaults.
- Examples are command-line scripts. There is no tested FastAPI route.
- There is no generated OpenAPI client in the repo and no generated `.harn`
  function or model surface.
- `harn-sdk` was not present in the public PyPI index when checked on
  2026-08-25, even though the README shows `pip install harn-sdk`.

Result: broad API reach, but weaker typing than TypeScript and no embedded Harn
function client.

### Released contract drift

The TypeScript OpenAPI file has SHA-256
`9f126adb40dc8971614f49a999c4fbdebc01f9b1ec447cbfd802a093b47cdcbd`.
The OpenAPI file in Harn `v0.10.116` has SHA-256
`279739bbe7aff1242dcdb68d6061776277927701b8e0da3fd1d80120b200557a`.

The released contract adds these 13 operations:

- `attachSessionClient`
- `checkPermission`
- `createPermissionRule`
- `detachSessionClient`
- `getPermissionHistory`
- `getPermissionPolicy`
- `getProviderCatalog`
- `heartbeatSessionClient`
- `installPermissionPolicy`
- `listPermissionRules`
- `listSessionLiveClients`
- `revokePermissionRule`
- `takeoverSessionClient`

This drift does not cause the function-codegen gap, but it makes the current
SDKs an unsafe base for new generated work.

## What BAML documents

BAML's current home page says teams should not rewrite their codebase. It says
functions and types cross a bridge into the host language, and lists Python,
TypeScript, Go, Rust, Java, Kotlin, C#, C++, and Swift targets. Its older client
documentation describes generated Python Pydantic and TypeScript clients from
source declarations. The two public surfaces use different terms, but both
sell the same outcome: add one typed function to an existing app.

BAML also documents:

- host-language types generated from its source types;
- generated partial types for structured streaming;
- source-level test cases, assertions, command-line tests, and an editor
  playground;
- automatic function traces, custom trace wrappers, tags, and a local
  collector for raw requests, responses, usage, and timing;
- editor syntax support, test controls, jump-to-definition, and code generation
  on save.

These are documentation findings, not measured product results. BAML was not
installed or benchmarked. Claims about breadth, reliability, speed, or ease are
directional until a reproducible comparison runs the same example in both
products.

## Gap matrix

`Parity` means the documented user outcome exists. `Present but weaker` means
some building block exists, but the user must still write or maintain the
missing bridge. `Absent` means this repo has no matching adoption surface.

| Capability | BAML public story | TypeScript SDK | Python SDK |
|---|---|---|---|
| Add one function to an existing app | Generated or bridged host call | Absent | Absent |
| Generate clients from source declarations | Function methods and types come from BAML source | Absent | Absent |
| Map source types to host types | Generated TypeScript types and Python Pydantic models | Present but weaker: API resource types only | Absent: user and API data are mostly untyped dictionaries |
| Install from the language registry | Public npm and Python install steps are documented | Absent from npm | Absent from PyPI |
| Stream structured partial results | Generated partial models and final validated model | Present but weaker: typed event envelope with general payload | Present but weaker: event data is a dictionary, string, or null |
| Test a declared function | Source tests, assertions, CLI runner, editor playground | Present but weaker: SDK unit tests only | Present but weaker: SDK unit tests only |
| Trace a declared function | Automatic function traces, tags, collector, hosted view | Present but weaker: events, receipts, outcomes, and replay | Present but weaker: the same records with weaker types |
| Put it in an existing web app | Public FastAPI and Next.js examples are linked | Present but weaker: untested scripts, no Express route | Present but weaker: untested scripts, no FastAPI route |
| Editor loop | Syntax, tests, navigation, generation on save | Absent from this repo | Absent from this repo |

The Harn runtime and editor may provide features outside these SDK repos. This
matrix does not claim those products lack testing, tracing, debugging, or
editor support. It asks whether an existing TypeScript or Python app receives a
small, typed, generated adoption path from these SDKs today.

## Canonical path found in Harn `v0.10.116`

A release-pinned probe established this path:

1. `harn serve mcp --surface exports example.harn` discovered an exported
   `pub fn greet(name: string) -> Greeting`.
2. MCP `tools/list` returned an `inputSchema` with the required string field
   `name`.
3. MCP `tools/call` returned `structuredContent` with the `Greeting` value.
4. The tool descriptor did not contain `outputSchema`.

The liveness signal was the successful `tools/call` result. The falsifier was
an output schema in `tools/list`; it was absent. `harn graph --json` only gave a
string function signature, while `harn parse --json` gave syntax nodes. An SDK
generator would have to rebuild name and type resolution to combine them. That
would create a second semantic owner.

Harn's released portable kernel can also compile a named function and execute
it with JSON input, but its documented support is limited to portable behavior.
It is useful for a later local fast path, not the first general embedding
contract.

## Ordered increments

Size is an engineering estimate after prerequisites are ready: small is up to
3 days, medium is about 1 week, large is 2 to 3 weeks, and extra-large needs an
upstream contract or spans several releases.

| Order | Increment and user story | Owning repo | Size | Runnable proof |
|---:|---|---|---:|---|
| 1 | **Pin the released protocol.** As an SDK user, I get the API surface from Harn `v0.10.116`, not a stale copy. | TypeScript and Python SDKs; artifact availability is [harn#7308](https://github.com/burin-labs/harn/issues/7308) | Medium | Artifact manifests name Harn `0.10.116` and the released OpenAPI hash; generated clients expose all 85 operations; mock-server tests call every operation in both languages. |
| 2 | **Publish a resolved function contract.** As a generator, I receive canonical input and output schemas for every exported function. | Harn, tracked by [harn#7306](https://github.com/burin-labs/harn/issues/7306); no SDK implementation before a release | Upstream prerequisite | A nested, imported Harn type appears in MCP `inputSchema` and `outputSchema`; a real call's `structuredContent` validates against the output schema. |
| 3 | **Generate the TypeScript function client.** As an Express developer, I generate one client and call one Harn function with normal typed arguments and results. | TypeScript SDK | Large | A checked-in Express example runs generation from `.harn`, compiles without hand-written mirror types, starts the released Harn MCP export, calls the function through an HTTP route, and asserts the JSON response. A compile-fail fixture rejects a wrong argument. |
| 4 | **Generate the Python projection from the same contract.** As a FastAPI developer, I get typed models and sync/async calls that match TypeScript. | Python SDK | Large | A FastAPI example runs generation from the same `.harn` fixture, calls the function, validates the Pydantic result, and is executed by pytest. A static check rejects a wrong argument. |
| 5 | **Ship and document registry installs.** As an app developer, I can install the SDK and generator through my normal package manager. | TypeScript and Python SDKs | Medium | Clean temporary Express and FastAPI apps install packed artifacts, run generation, and execute the route tests. Actual npm/PyPI publication remains a separate approval. |
| 6 | **Add typed semantic streaming.** As a UI developer, I receive generated partial models while a function runs and a complete validated model at the end. | Harn contract first, then both SDKs | Extra-large | One declaration with nested optional and atomic fields drives generated partial types in both languages; repeated route tests observe at least one partial and the final value, and validate every payload against the released schemas. |
| 7 | **Join calls to testing and tracing.** As an adopter, I can run a declared Harn test from my app repo and correlate a generated function call with its Harn events, receipt, outcome, and trace. | Both SDKs; Harn owns any missing correlation contract | Large | The Express and FastAPI examples run one Harn test in CI, make one generated call, and use its stable identifier to retrieve the matching records. Assertions prove the function path fired. |
| 8 | **Connect the editor loop.** As an editor user, saving a `.harn` declaration refreshes the generated client and navigation crosses the language boundary. | Harn editor tooling; SDKs expose only a stable generator command | Medium after codegen | An editor integration test changes a function field, runs the same generator command used by CI, and verifies the host-language type changes. Do not build a second editor extension in either SDK. |

## Contract rules for later phases

- `.harn` declarations are the only owner of function input and output types.
- SDKs consume a released, versioned Harn projection. They do not parse Harn
  signatures, resolve imports, or keep hand-written mirror models.
- Generated TypeScript and Python names come from one language-neutral naming
  table with golden fixtures.
- Generation is deterministic and has a `--check` mode for CI.
- Generated files carry the Harn version and contract digest.
- Unsupported Harn types fail generation with a precise source location. They
  never become `any`, `Any`, or `object` silently.
- The first transport is Harn's exported-function MCP surface. A portable local
  fast path may follow only when it preserves the same client contract.
- Every increment includes a runnable existing-app example and a test that
  executes it. Screenshots are not evidence.

## Risks and blind spots

- The BAML comparison is based on its public documentation and current web
  copy. No BAML runtime behavior was reproduced.
- Documentation source dates below are the latest source changes found in the
  public repository. Except for the home-page launch, the rendered pages do not
  show publication dates.
- Harn `v0.10.116` has a working MCP function path, but this survey tested one
  pure nested-record result. Imported types, unions, generics, async behavior,
  cancellation, errors, and streaming still need contract fixtures.
- Package names are reserved in repository metadata but were not found in the
  public registries. No package was published during this work.

## Sources and dates

- [BAML home page](https://boundaryml.com/) — incremental-adoption and bridge
  claims published in the current home-page launch on 2026-08-08
  ([source commit](https://github.com/BoundaryML/baml/commit/029f72533a54917345346fa6add73c50d9daaf31)).
- [What is `baml_client`?](https://docs.boundaryml.com/guide/introduction/baml_client)
  — generated clients and host-language type mapping. Publication date is not
  shown; source last changed 2025-08-18
  ([source commit](https://github.com/BoundaryML/baml/commit/16d3612c79bf89e8f1e0da440f48c749a0cba91f)).
- [BAML streaming](https://docs.boundaryml.com/guide/baml-basics/streaming) —
  generated partial types and semantic streaming attributes. Publication date
  is not shown; source last changed 2026-03-02
  ([source commit](https://github.com/BoundaryML/baml/commit/86f864df75fef06b5589edd96c3e1fb91abe8acd)).
- [Testing functions](https://docs.boundaryml.com/guide/baml-basics/testing-functions)
  — source tests, assertions, CLI tests, and playground. Publication date is
  not shown; source last changed 2025-12-20
  ([source commit](https://github.com/BoundaryML/baml/commit/65b0d1f395e86c4e7485bc7637073bf1ae8ce99a)).
- [Boundary Studio observability](https://docs.boundaryml.com/guide/boundary-cloud/observability/tracking-usage)
  — automatic traces, custom traces, and tags. Publication date is not shown;
  source last changed 2026-02-23
  ([source commit](https://github.com/BoundaryML/baml/commit/0bd7db3838d6620f4c4be672695fc308a628d2a4)).
- [BAML Collector](https://docs.boundaryml.com/ref/baml_client/collector) — raw
  requests, responses, usage, and timing. Publication date is not shown; source
  last changed 2026-08-12
  ([source commit](https://github.com/BoundaryML/baml/commit/56d4c509641ec4e5e3bc7f6efc11d2446e06f75e)).
- [BAML VS Code extension](https://docs.boundaryml.com/guide/installation-editors/vs-code-extension)
  — syntax, tests, navigation, and generation on save. Publication date is not
  shown; source last changed 2025-07-11
  ([source commit](https://github.com/BoundaryML/baml/commit/a7974fb8294f17d1d496adc9e4cef2ec9e31a5bc)).
- [Harn `v0.10.116` release](https://github.com/burin-labs/harn/releases/tag/v0.10.116)
  — published 2026-08-25; source of the pinned runtime and OpenAPI comparison.
