# harn-sdk-typescript

TypeScript SDK for the Harn Agents API.

The package name is `@burin-labs/harn`. This repo vendors the OpenAPI 3.1
contract in `spec/openapi.yaml` and generates TypeScript schema/path types with
`openapi-typescript`.

## Install

After the first alpha is published:

```sh
pnpm add @burin-labs/harn@alpha
```

For SDK development, clone this repo and run `pnpm install`.

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

## What is included

- Typed resource aliases generated from `spec/openapi.yaml`.
- `HarnClient` wrappers for every v1 REST operation.
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
pnpm install
pnpm generate:types
pnpm typecheck
pnpm check:examples
pnpm check:tests
pnpm test
pnpm build
```

The generated OpenAPI types live in `src/generated/openapi.ts`. Regenerate them
after updating `spec/openapi.yaml`.

## Publishing

Release and npm setup instructions live in
[`docs/PUBLISHING.md`](docs/PUBLISHING.md).

## License

Apache-2.0
