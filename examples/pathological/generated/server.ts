// Generated from harn-codegen/1.0. Do not edit.
import type { Handler, ExactHandlers, ApplicationFailure } from "@burin-labs/harn";
import { serveGenerated, type NativeServerOptions } from "@burin-labs/harn/native";
import { binding } from "./contract.js";
import type * as T from "./types.js";

export interface Handlers {
  readonly echo: Handler<T.EchoInput, T.Payload>;
  readonly mutate: Handler<T.EchoInput, T.Payload>;
  readonly reject: Handler<T.EchoInput, T.Payload | ApplicationFailure<T.Failure>>;
  readonly scheduled: Handler<T.EchoInput, T.Payload>;
}

export function defineHandlers<H extends Handlers>(handlers: H & ExactHandlers<H, Handlers>): H { return handlers; }
export function serve<H extends Handlers>(handlers: H & ExactHandlers<H, Handlers>, options: NativeServerOptions) {
  return serveGenerated(binding, {
    ["echo"]: handlers.echo,
    ["mutate"]: handlers.mutate,
    ["reject"]: handlers.reject,
    ["scheduled"]: handlers.scheduled,
  }, options);
}
