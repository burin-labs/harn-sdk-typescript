// Generated from harn-codegen/1.0. Do not edit.
import type { HarnClient, McpRequestOptions, ApplicationFailure } from "@burin-labs/harn";
import { invokeGenerated } from "@burin-labs/harn/bindings";
import { binding } from "./contract.js";
import type * as T from "./types.js";

export class Client {
  constructor(readonly transport: HarnClient) {}
  echo(input: T.EchoInput, options?: McpRequestOptions): Promise<T.Payload> {
    return invokeGenerated(binding, "operation:echo", this.transport, input, options);
  }
  mutate(input: T.EchoInput, options?: McpRequestOptions): Promise<T.Payload> {
    return invokeGenerated(binding, "operation:mutate", this.transport, input, options);
  }
  reject(input: T.EchoInput, options?: McpRequestOptions): Promise<T.Payload | ApplicationFailure<T.Failure>> {
    return invokeGenerated(binding, "operation:reject", this.transport, input, options);
  }
  scheduled(input: T.EchoInput, options?: McpRequestOptions): Promise<T.Payload> {
    return invokeGenerated(binding, "operation:scheduled", this.transport, input, options);
  }
}
