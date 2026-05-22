export { HarnClient, HARN_PROTOCOL_VERSION } from "./client.js";
export { HarnApiError } from "./errors.js";
export {
  apiKeyAuth,
  bearerTokenAuth,
  browserOidcAuth,
  oauth2DeviceFlow,
  staticHeadersAuth,
} from "./auth.js";
export {
  connectTaskEventsWebSocket,
  parseSseStream,
  streamJsonSse,
  taskEventsWebSocketUrl,
} from "./streaming.js";
export {
  APPROVAL_STATUSES,
  TERMINAL_TASK_STATUSES,
  isApprovalRequired,
  isTerminalTaskStatus,
  parseApprovalWebhook,
  pollForApproval,
  waitForTask,
} from "./approvals.js";
export {
  defineTool,
  runTool,
  textPart,
  toolCallPart,
  toolResultPart,
} from "./tools.js";
export type {
  AuthProvider,
  HarnAuthContext,
  OAuth2DeviceAuthorization,
  OAuth2DeviceFlowOptions,
  OAuth2DevicePollOptions,
  OAuth2DeviceToken,
} from "./auth.js";
export type {
  HarnClientOptions,
  ListOptions,
  RequestOptions,
  StreamOptions,
  WorkspaceFileOptions,
} from "./client.js";
export type { SseEvent } from "./streaming.js";
export type {
  ApprovalWebhook,
  ApprovalWebhookOptions,
  PollForApprovalOptions,
  WaitForTaskOptions,
} from "./approvals.js";
export type {
  HarnTool,
  HarnToolContext,
  ToolHandler,
  ToolResult,
} from "./tools.js";
export type * from "./types.js";
export type { components, operations, paths } from "./generated/openapi.js";
