/** A declared application failure is a typed result, separate from a runtime fault. */
export class ApplicationFailure<E> {
  constructor(readonly error: E, readonly outcome?: "error" | "rejected") {}
}

export interface HandlerContext {
  readonly signal: AbortSignal;
}

export type Handler<I, O> = (input: I, context: HandlerContext) => O | Promise<O>;

/** Retain inferred returns so excess output properties cannot hide behind function assignment. */
export type ExactValue<Value, Expected> = Expected extends unknown
  ? Value extends Expected
    ? Expected extends ApplicationFailure<infer E>
      ? Value extends ApplicationFailure<infer V> ? ApplicationFailure<ExactValue<V, E>> : never
      : Value extends readonly unknown[]
        ? Expected extends readonly unknown[]
          ? { [K in keyof Value]: K extends keyof Expected ? ExactValue<Value[K], Expected[K]> : Value[K] }
          : never
        : Value extends object
          ? Expected extends object
            ? Value & { [K in Exclude<keyof Value, keyof Expected>]: never }
              & { [K in keyof Value]: K extends keyof Expected ? ExactValue<Value[K], Exclude<Expected[K], undefined>> : never }
            : never
          : Value
    : never
  : never;

type AnyHandler = (...args: never[]) => unknown;

export type ExactHandlers<Actual, Expected> = {
  [K in keyof Actual]: K extends keyof Expected
    ? Actual[K] extends AnyHandler
      ? Expected[K] extends AnyHandler
        ? (...args: Parameters<Actual[K]>) =>
            ExactValue<Awaited<ReturnType<Actual[K]>>, Awaited<ReturnType<Expected[K]>>>
            | Promise<ExactValue<Awaited<ReturnType<Actual[K]>>, Awaited<ReturnType<Expected[K]>>>>
        : never
      : never
    : never;
};
