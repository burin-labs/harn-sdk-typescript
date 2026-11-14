# Generate typed Harn bindings

Use a Harn CLI with `harn codegen` support and Node.js 22.12 or later. Build
and install this SDK package before running its generator.

## Generate a client and native handlers

Point the generator at the Harn file that owns your exported functions:

```sh
harn-typescript-codegen --file server.harn --out generated --role both
harn-typescript-codegen --file server.harn --out generated --role both --check
```

Harn compiles and validates the contract, confines the renderer, checks repeat
output, and publishes the files. `--check` compares the generated files without
writing them. Use `--surface script` for a script-published tool registry,
`--select NAME` to select operations, and `--ir FILE` to require an exact frozen
contract. `--harn PATH` selects the CLI executable.

Use `--role client` or `--role server` when you need only one role. The generated
`identity` exports the catalog, binding, and IR digests. Keep the generated files
together; their runtime codecs and handler declarations use that same contract.

For an existing IR, validate it through Harn and write a generated artifact
response to stdout:

```sh
harn-typescript-codegen --input contract.ir.json --role both > artifacts.json
```

This mode does not publish files. The SDK consumes the normalized wire graph;
it does not infer types or codecs from JSON Schema or parse Harn source.

## Call exported functions

Create the generated client with the existing authenticated transport:

```ts
import { HarnClient } from "@burin-labs/harn";
import { Client } from "./generated/client.js";

const client = new Client(new HarnClient({ baseUrl: "http://127.0.0.1:8765" }));
const result = await client.echo({ input: payload });
```

Each method validates arguments and decodes its declared result. A declared
application failure returns `ApplicationFailure<E>` as typed data. Transport,
protocol, and undeclared handler failures throw SDK errors. Harn may select task
completion; the same method collects the final result without replaying the
invocation. Pass `{ signal }` to cancel a direct request or its selected task.

Generated client methods and server handler keys use the same TypeScript names.
Reserved words gain an underscore; colliding identifiers, JavaScript object
members, and the client's `transport` property gain a stable suffix derived from
the operation's semantic ID. The generated client and server files record these
names. The server projects them back to the original MCP tool names.

Full-width Harn integers use `bigint`. Bytes use `Uint8Array`, decimals use
`HarnDecimal`, and sets use `ReadonlySet`. Decimal scale survives the wire
round trip. Optional fields may be absent; nullable fields may contain `null`.
Present `undefined` fields are rejected. Runtime codecs reject additional
properties in closed records and preserve structural set membership.

The [Express example](../examples/express-generated-tools.ts) calls a nested
operation from Harn's shared fixture. Start its Harn server, then the app:

```sh
harn serve mcp --surface exports --transport http --bind 127.0.0.1:8765 examples/pathological/source/server.harn
HARN_GENERATED_EXAMPLE_MAIN=1 pnpm exec tsx examples/express-generated-tools.ts
curl http://127.0.0.1:3000/typed-echo
```

## Serve native handlers

Import the generated exact handler map:

```ts
import { ApplicationFailure } from "@burin-labs/harn";
import { defineHandlers, serve } from "./generated/server.js";

const handlers = defineHandlers({
  echo: ({ input }, { signal }) => {
    signal.throwIfAborted();
    return input;
  },
  mutate: ({ input }) => input,
  reject: () => new ApplicationFailure({
    enum: "Failure" as const, variant: "Rejected" as const, fields: ["rejected"] as const,
  }),
  scheduled: ({ input }) => input,
});
serve(handlers, { maxConcurrency: 2 });
```

Supply every operation in your generated contract. Missing, extra, duplicate,
wrong-input, and wrong-output handlers fail compilation. The runtime also checks
the operation census and validates input before handler entry and output after
completion. Replace the former `defineTool` and `runTool` declarations with this
generated map. General message-part helpers remain available.

The worker speaks ordinary MCP on stdin/stdout and advertises the exact native
binding profile. Keep logs on stderr. Pass the context's `AbortSignal` to
cancellable operations. Harn verifies the worker against an independently
validated contract and retains governance, authorization, task scheduling,
cancellation, and process lifetime ownership. The Node-only server is exported
from `@burin-labs/harn/native`; browser clients do not import it.

See [the complete shared-fixture worker](../examples/tool-handler.ts) for all
four operations and a declared application rejection.
