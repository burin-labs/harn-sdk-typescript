# harn-sdk-typescript

TypeScript SDK for the [Harn Agents API](https://github.com/burin-labs/harn-cloud/issues/72).

The package ships as `@burin-labs/harn` on the npm alpha track. It vendors the canonical OpenAPI 3.1 contract in `spec/openapi.yaml` and generates TypeScript schema/path types with `openapi-typescript`.

## Install

```sh
pnpm add @burin-labs/harn@alpha
```

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

## Included Surface

- Typed resource aliases generated from `spec/openapi.yaml`.
- `HarnClient` wrappers for every v1 REST operation.
- API key, bearer token, browser OIDC, and OAuth2 device-flow auth helpers.
- SSE parsing for browser and Node `fetch` streams.
- WebSocket URL/connection helpers for task event streams.
- Polling and webhook helpers for approval-required task states.
- Tool definition helpers for agent-side handler code.
- Examples in `examples/` for quickstart, streaming, device auth, approvals, tool handling, and webhook receive.

## Development

```sh
pnpm install
pnpm generate:types
pnpm typecheck
pnpm check:examples
pnpm test
pnpm build
```

The generated OpenAPI types live in `src/generated/openapi.ts`. Regenerate them after updating `spec/openapi.yaml`.

## Publishing

Release and npm setup instructions live in [`docs/PUBLISHING.md`](docs/PUBLISHING.md). The short version: first publish creates the npm package page, then configure npm trusted publishing for `.github/workflows/publish.yml` and use the GitHub release workflows for routine version bumps and publishes.

## License

Apache-2.0
