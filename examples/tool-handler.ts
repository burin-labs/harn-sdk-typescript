import { ApplicationFailure } from "@burin-labs/harn";
import { defineHandlers, serve } from "./pathological/generated/server.js";

const handlers = defineHandlers({
  echo: ({ input }, { signal }) => { signal.throwIfAborted(); return input; },
  mutate: ({ input }, { signal }) => { signal.throwIfAborted(); return input; },
  reject: () => new ApplicationFailure({ enum: "Failure" as const, variant: "Rejected" as const, fields: ["rejected"] as const }),
  scheduled: ({ input }, { signal }) => { signal.throwIfAborted(); return input; },
});

serve(handlers, { maxConcurrency: 2 });
