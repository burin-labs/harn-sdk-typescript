# harn-sdk-typescript

TypeScript SDK for the Harn Agents API.

The package name is `@burin-labs/harn`. This repo vendors the OpenAPI 3.1
contract and generated TypeScript protocol client from Harn v0.10.116.

## Install

`@burin-labs/harn` is not published on npm yet. Use a local checkout for SDK
development:

```sh
git clone https://github.com/burin-labs/harn-sdk-typescript.git
cd harn-sdk-typescript
pnpm install --frozen-lockfile
```

The [publishing guide](docs/PUBLISHING.md) covers the first public npm release,
and [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the checks to run, and
which files are generated.

## Quickstart

```ts
import { HarnClient, textPart } from "@burin-labs/harn";

const client = new HarnClient({
  baseUrl: "http://localhost:8080",
  apiKey: process.env.HARN_API_KEY,
});

const task = await client.submitTask({
  session_id: "session_123",
  input: {
    role: "user",
    parts: [textPart("Summarize the release blockers.")],
  },
});

for await (const event of client.streamTaskEvents(task.id)) {
  console.log(event.event, event.payload);
}
```

## Add Harn to an existing app

The generated protocol client exposes all 85 operations from Harn v0.10.116.
Import only the operation and response types needed by one route:

```ts
import {
  createHarnProtocolClient,
} from "@burin-labs/harn";
import { getProviderCatalog } from "@burin-labs/harn/protocol";

const harn = createHarnProtocolClient({
  baseUrl: process.env.HARN_BASE_URL,
  accessToken: process.env.HARN_ACCESS_TOKEN,
});

app.get("/models", async (_request, response) => {
  const result = await getProviderCatalog({
    client: harn,
  });
  response.status(result.response?.status ?? 200).json(result.data ?? result.error);
});
```

See [`examples/express-provider-catalog.ts`](examples/express-provider-catalog.ts)
for a runnable Express app. It is executed by the test suite with an injected
transport, so it does not need credentials or a live Harn server.

## What is included

- Typed resource aliases generated from `spec/openapi.yaml`.
- Release-generated functions and host-language types for all 85 protocol
  operations under `@burin-labs/harn/protocol`.
- Compatibility `HarnClient` wrappers for the original 72-operation surface.
- Local Harn runtime discovery helpers for health, version, capabilities, and
  local control-plane tools.
- Workspace UTF-8 file read/write helpers.
- API key, bearer token, browser OIDC, and OAuth2 device-flow auth helpers.
- SSE parsing for browser and Node `fetch` streams.
- WebSocket URL/connection helpers for task event streams.
- Polling and webhook helpers for approval-required task states, including
  Harn Cloud outbound webhook signature verification.
- Session truncation and local permission-request response helpers.
- Tool definition helpers for agent-side handler code.
- Examples in `examples/` for quickstart, streaming, device auth, approvals,
  tool handling, and webhook receive.

## Authentication safety defaults

As of the 2026-05-23 security sweep:

- The bearer token is **host-pinned** to `baseUrl`. If a request URL ends up at
  a different host (for example because you passed an absolute URL or the
  custom `auth` provider received a redirected URL), the `Authorization` header
  is not attached. This prevents accidental cross-host bearer leaks.
- `baseUrl` must use `https://`. `http://` is allowed only for `localhost` /
  `127.0.0.1` for local development; any other plain-`http://` URL throws at
  construction.
- A `console.warn` fires when you override `baseUrl` while a token or `auth`
  provider is configured — bearer tokens issued for one host should not be
  reused against another by accident.
- `apiKey` and `apiKeyAuth` are deprecated aliases of `accessToken` /
  `bearerTokenAuth` (the Harn API has a single bearer scheme). They will
  continue to work; new code should prefer the explicit names.

## Harn Cloud webhooks

`parseApprovalWebhook` verifies Harn Cloud outbound webhook deliveries when you
pass the endpoint signing secret, `X-Harn-Signature`, and an optional replay
tolerance:

```ts
const webhook = await parseApprovalWebhook(rawBody, {
  secret: process.env.HARN_WEBHOOK_SECRET,
  signature: request.headers.get("x-harn-signature"),
  toleranceSeconds: 300,
});
```

Signatures cover the timestamp and raw request body. Pass the exact body bytes
received from your HTTP framework, before JSON parsing.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check:protocol
pnpm generate:types
pnpm typecheck
pnpm check:examples
pnpm check:tests
pnpm test
pnpm build
pnpm check:built-package
pnpm pack:dry-run
```

The release-generated protocol client lives in `src/generated/protocol/`.
Do not hand-edit it. Its manifest and operation coverage are checked by
`pnpm check:protocol`; see
[`docs/PROTOCOL_GENERATION.md`](docs/PROTOCOL_GENERATION.md). The compatibility
types in `src/generated/openapi.ts` are regenerated from the same pinned spec.

## Publishing

Release and npm setup instructions live in
[`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## License

Apache-2.0
