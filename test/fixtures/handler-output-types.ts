import { ApplicationFailure, type ExactHandlers, type Handler } from "../../src/bindings.js";

type Output = { readonly value: string; readonly nested: { readonly count: number }; readonly optional?: string | null };
type Handlers = { echo: Handler<{ readonly value: string }, Output | ApplicationFailure<{ readonly reason: string }>> };

function defineHandlers<const H extends Handlers>(handlers: H & ExactHandlers<H, Handlers>): H { return handlers; }

defineHandlers({ echo: input => ({ value: input.value, nested: { count: 1 } }) });
defineHandlers({ echo: async input => ({ value: input.value, nested: { count: 1 } }) });
defineHandlers({ echo: () => new ApplicationFailure({ reason: "conflict" }) });
defineHandlers({ echo: () => ({ value: "x", nested: { count: 1 }, optional: null }) });

// @ts-expect-error Closed generated outputs refuse extra top-level fields.
defineHandlers({ echo: () => ({ value: "x", nested: { count: 1 }, extra: true }) });
// @ts-expect-error Closed generated outputs refuse extra nested fields.
defineHandlers({ echo: () => ({ value: "x", nested: { count: 1, extra: true } }) });
// @ts-expect-error Async handlers retain the same closed output contract.
defineHandlers({ echo: async () => ({ value: "x", nested: { count: 1 }, extra: true }) });
// @ts-expect-error Application errors retain their declared closed shape.
defineHandlers({ echo: () => new ApplicationFailure({ reason: "conflict", extra: true }) });
// @ts-expect-error An optional wire field is absent or a typed value, never explicit undefined.
defineHandlers({ echo: () => ({ value: "x", nested: { count: 1 }, optional: undefined }) });
// @ts-expect-error Every declared operation requires a handler.
defineHandlers({});
// @ts-expect-error Unknown operations cannot silently join the binding.
defineHandlers({ echo: () => ({ value: "x", nested: { count: 1 } }), unknown: () => null });
