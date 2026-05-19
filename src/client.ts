import type { AuthProvider } from "./auth.js";
import { HarnApiError } from "./errors.js";
import { streamJsonSse } from "./streaming.js";
import type {
  AppendMessageRequest,
  AppendTaskMessageRequest,
  Artifact,
  ArtifactList,
  Branch,
  BranchList,
  CancelTaskRequest,
  Connector,
  ConnectorList,
  CreateBranchRequest,
  CreateMemoryRequest,
  CreatePersonaRequest,
  CreateSessionRequest,
  CreateVaultRequest,
  CreateWorkspaceRequest,
  Discovery,
  Event,
  EventList,
  ForkSessionRequest,
  HarnAgentCard,
  Memory,
  MemoryList,
  Message,
  MessageList,
  Outcome,
  OutcomeList,
  Persona,
  PersonaList,
  Quota,
  QuotaList,
  Receipt,
  ReceiptList,
  ReceiptVerification,
  RegisterArtifactRequest,
  ReplayTaskRequest,
  Session,
  SessionList,
  Skill,
  SkillList,
  SubmitTaskRequest,
  Task,
  TaskList,
  UpdatePersonaRequest,
  UpdateSessionRequest,
  UpdateWorkspaceRequest,
  Vault,
  VaultList,
  VerifyReceiptRequest,
  Workspace,
  WorkspaceList,
} from "./types.js";

export const HARN_PROTOCOL_VERSION = "agents-protocol-2026-04-25";

export interface HarnClientOptions {
  baseUrl?: string | URL;
  apiKey?: string;
  accessToken?: string | (() => string | Promise<string>);
  auth?: AuthProvider;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  protocolVersion?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
  idempotencyKey?: string;
}

export interface ListOptions extends RequestOptions {
  limit?: number;
  cursor?: string;
}

export interface StreamOptions extends RequestOptions {
  lastEventId?: string;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type Query = Record<string, string | number | boolean | null | undefined>;

export class HarnClient {
  readonly baseUrl: URL;
  readonly protocolVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: HeadersInit | undefined;
  private readonly auth: AuthProvider | undefined;

  constructor(options: HarnClientOptions = {}) {
    this.baseUrl = new URL(options.baseUrl ?? "https://api.harnlang.com");
    this.protocolVersion = options.protocolVersion ?? HARN_PROTOCOL_VERSION;
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!this.fetchImpl) {
      throw new Error("A fetch implementation is required in this runtime.");
    }
    this.defaultHeaders = options.headers;
    this.auth = options.auth ?? authFromTokenOptions(options);
  }

  getProtocolDiscovery(options?: RequestOptions): Promise<Discovery> {
    return this.request("GET", "/v1", { ...options, protocol: false });
  }

  getAgentCard(options?: RequestOptions): Promise<HarnAgentCard> {
    return this.request("GET", "/v1/agent-card", { ...options, protocol: false });
  }

  listPersonas(options?: ListOptions): Promise<PersonaList> {
    return this.request("GET", "/v1/personas", { ...options, query: pageQuery(options) });
  }

  createPersona(body: CreatePersonaRequest, options?: RequestOptions): Promise<Persona> {
    return this.request("POST", "/v1/personas", { ...options, body });
  }

  getPersona(personaId: string, options?: RequestOptions): Promise<Persona> {
    return this.request("GET", "/v1/personas/{persona_id}", {
      ...options,
      path: { persona_id: personaId },
    });
  }

  updatePersona(personaId: string, body: UpdatePersonaRequest, options?: RequestOptions): Promise<Persona> {
    return this.request("PATCH", "/v1/personas/{persona_id}", {
      ...options,
      path: { persona_id: personaId },
      body,
    });
  }

  listWorkspaces(options?: ListOptions): Promise<WorkspaceList> {
    return this.request("GET", "/v1/workspaces", { ...options, query: pageQuery(options) });
  }

  createWorkspace(body: CreateWorkspaceRequest, options?: RequestOptions): Promise<Workspace> {
    return this.request("POST", "/v1/workspaces", { ...options, body });
  }

  getWorkspace(workspaceId: string, options?: RequestOptions): Promise<Workspace> {
    return this.request("GET", "/v1/workspaces/{workspace_id}", {
      ...options,
      path: { workspace_id: workspaceId },
    });
  }

  updateWorkspace(workspaceId: string, body: UpdateWorkspaceRequest, options?: RequestOptions): Promise<Workspace> {
    return this.request("PATCH", "/v1/workspaces/{workspace_id}", {
      ...options,
      path: { workspace_id: workspaceId },
      body,
    });
  }

  listSessions(options?: ListOptions & { workspaceId?: string }): Promise<SessionList> {
    return this.request("GET", "/v1/sessions", {
      ...options,
      query: listQuery(options, { workspace_id: options?.workspaceId }),
    });
  }

  createSession(body: CreateSessionRequest, options?: RequestOptions): Promise<Session> {
    return this.request("POST", "/v1/sessions", { ...options, body });
  }

  getSession(sessionId: string, options?: RequestOptions): Promise<Session> {
    return this.request("GET", "/v1/sessions/{session_id}", {
      ...options,
      path: { session_id: sessionId },
    });
  }

  updateSession(sessionId: string, body: UpdateSessionRequest, options?: RequestOptions): Promise<Session> {
    return this.request("PATCH", "/v1/sessions/{session_id}", {
      ...options,
      path: { session_id: sessionId },
      body,
    });
  }

  closeSession(sessionId: string, options?: RequestOptions): Promise<Session> {
    return this.request("POST", "/v1/sessions/{session_id}/close", {
      ...options,
      path: { session_id: sessionId },
    });
  }

  forkSession(sessionId: string, body: ForkSessionRequest = {}, options?: RequestOptions): Promise<Session> {
    return this.request("POST", "/v1/sessions/{session_id}/fork", {
      ...options,
      path: { session_id: sessionId },
      body,
    });
  }

  listSessionMessages(sessionId: string, options?: ListOptions): Promise<MessageList> {
    return this.request("GET", "/v1/sessions/{session_id}/messages", {
      ...options,
      path: { session_id: sessionId },
      query: pageQuery(options),
    });
  }

  appendSessionMessage(sessionId: string, body: AppendMessageRequest, options?: RequestOptions): Promise<Message> {
    return this.request("POST", "/v1/sessions/{session_id}/messages", {
      ...options,
      path: { session_id: sessionId },
      body,
    });
  }

  listSessionTasks(sessionId: string, options?: ListOptions): Promise<TaskList> {
    return this.request("GET", "/v1/sessions/{session_id}/tasks", {
      ...options,
      path: { session_id: sessionId },
      query: pageQuery(options),
    });
  }

  submitSessionTask(sessionId: string, body: SubmitTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.request("POST", "/v1/sessions/{session_id}/tasks", {
      ...options,
      path: { session_id: sessionId },
      body,
    });
  }

  listSessionBranches(sessionId: string, options?: ListOptions): Promise<BranchList> {
    return this.request("GET", "/v1/sessions/{session_id}/branches", {
      ...options,
      path: { session_id: sessionId },
      query: pageQuery(options),
    });
  }

  createSessionBranch(sessionId: string, body: CreateBranchRequest, options?: RequestOptions): Promise<Branch> {
    return this.request("POST", "/v1/sessions/{session_id}/branches", {
      ...options,
      path: { session_id: sessionId },
      body,
    });
  }

  listSessionEvents(
    sessionId: string,
    options?: RequestOptions & { afterEventId?: string; limit?: number },
  ): Promise<EventList> {
    return this.request("GET", "/v1/sessions/{session_id}/events", {
      ...options,
      path: { session_id: sessionId },
      query: { after_event_id: options?.afterEventId, limit: options?.limit },
    });
  }

  streamSessionEvents(sessionId: string, options?: StreamOptions): AsyncIterable<Event> {
    return this.streamEventsPath("/v1/sessions/{session_id}/events/stream", {
      ...options,
      path: { session_id: sessionId },
    });
  }

  listTasks(options?: ListOptions & { workspaceId?: string; sessionId?: string }): Promise<TaskList> {
    return this.request("GET", "/v1/tasks", {
      ...options,
      query: listQuery(options, { workspace_id: options?.workspaceId, session_id: options?.sessionId }),
    });
  }

  submitTask(body: SubmitTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.request("POST", "/v1/tasks", { ...options, body });
  }

  getTask(taskId: string, options?: RequestOptions): Promise<Task> {
    return this.request("GET", "/v1/tasks/{task_id}", { ...options, path: { task_id: taskId } });
  }

  cancelTask(taskId: string, body: CancelTaskRequest = {}, options?: RequestOptions): Promise<Task> {
    return this.request("POST", "/v1/tasks/{task_id}/cancel", {
      ...options,
      path: { task_id: taskId },
      body,
    });
  }

  replayTask(taskId: string, body: ReplayTaskRequest, options?: RequestOptions): Promise<Task> {
    return this.request("POST", "/v1/tasks/{task_id}/replay", {
      ...options,
      path: { task_id: taskId },
      body,
    });
  }

  appendTaskMessage(taskId: string, body: AppendTaskMessageRequest, options?: RequestOptions): Promise<Message> {
    return this.request("POST", "/v1/tasks/{task_id}/messages", {
      ...options,
      path: { task_id: taskId },
      body,
    });
  }

  listTaskEvents(taskId: string, options?: RequestOptions & { afterEventId?: string; limit?: number }): Promise<EventList> {
    return this.request("GET", "/v1/tasks/{task_id}/events", {
      ...options,
      path: { task_id: taskId },
      query: { after_event_id: options?.afterEventId, limit: options?.limit },
    });
  }

  streamTaskEvents(taskId: string, options?: StreamOptions): AsyncIterable<Event> {
    return this.streamEventsPath("/v1/tasks/{task_id}/stream", {
      ...options,
      path: { task_id: taskId },
    });
  }

  listTaskReceipts(taskId: string, options?: ListOptions): Promise<ReceiptList> {
    return this.request("GET", "/v1/tasks/{task_id}/receipts", {
      ...options,
      path: { task_id: taskId },
      query: pageQuery(options),
    });
  }

  getBranch(branchId: string, options?: RequestOptions): Promise<Branch> {
    return this.request("GET", "/v1/branches/{branch_id}", { ...options, path: { branch_id: branchId } });
  }

  getMessage(messageId: string, options?: RequestOptions): Promise<Message> {
    return this.request("GET", "/v1/messages/{message_id}", { ...options, path: { message_id: messageId } });
  }

  listArtifacts(
    options?: ListOptions & { workspaceId?: string; sessionId?: string; taskId?: string },
  ): Promise<ArtifactList> {
    return this.request("GET", "/v1/artifacts", {
      ...options,
      query: listQuery(options, {
        workspace_id: options?.workspaceId,
        session_id: options?.sessionId,
        task_id: options?.taskId,
      }),
    });
  }

  registerArtifact(body: RegisterArtifactRequest, options?: RequestOptions): Promise<Artifact> {
    return this.request("POST", "/v1/artifacts", { ...options, body });
  }

  getArtifact(artifactId: string, options?: RequestOptions): Promise<Artifact> {
    return this.request("GET", "/v1/artifacts/{artifact_id}", {
      ...options,
      path: { artifact_id: artifactId },
    });
  }

  downloadArtifactContent(artifactId: string, options?: RequestOptions): Promise<Response> {
    return this.rawRequest("GET", "/v1/artifacts/{artifact_id}/content", {
      ...options,
      path: { artifact_id: artifactId },
      accept: "application/octet-stream",
    });
  }

  listEvents(
    options?: RequestOptions & {
      workspaceId?: string;
      sessionId?: string;
      taskId?: string;
      afterEventId?: string;
      limit?: number;
    },
  ): Promise<EventList> {
    return this.request("GET", "/v1/events", {
      ...options,
      query: {
        workspace_id: options?.workspaceId,
        session_id: options?.sessionId,
        task_id: options?.taskId,
        after_event_id: options?.afterEventId,
        limit: options?.limit,
      },
    });
  }

  getEvent(eventId: string, options?: RequestOptions): Promise<Event> {
    return this.request("GET", "/v1/events/{event_id}", { ...options, path: { event_id: eventId } });
  }

  streamEvents(
    options?: StreamOptions & { workspaceId?: string; sessionId?: string; taskId?: string },
  ): AsyncIterable<Event> {
    return this.streamEventsPath("/v1/events/stream", {
      ...options,
      query: {
        workspace_id: options?.workspaceId,
        session_id: options?.sessionId,
        task_id: options?.taskId,
      },
    });
  }

  getReceipt(receiptId: string, options?: RequestOptions): Promise<Receipt> {
    return this.request("GET", "/v1/receipts/{receipt_id}", { ...options, path: { receipt_id: receiptId } });
  }

  verifyReceipt(
    receiptId: string,
    body: VerifyReceiptRequest = {},
    options?: RequestOptions,
  ): Promise<ReceiptVerification> {
    return this.request("POST", "/v1/receipts/{receipt_id}/verify", {
      ...options,
      path: { receipt_id: receiptId },
      body,
    });
  }

  listMemories(options?: ListOptions & { workspaceId?: string; sessionId?: string }): Promise<MemoryList> {
    return this.request("GET", "/v1/memories", {
      ...options,
      query: listQuery(options, { workspace_id: options?.workspaceId, session_id: options?.sessionId }),
    });
  }

  createMemory(body: CreateMemoryRequest, options?: RequestOptions): Promise<Memory> {
    return this.request("POST", "/v1/memories", { ...options, body });
  }

  getMemory(memoryId: string, options?: RequestOptions): Promise<Memory> {
    return this.request("GET", "/v1/memories/{memory_id}", { ...options, path: { memory_id: memoryId } });
  }

  deleteMemory(memoryId: string, options?: RequestOptions): Promise<Memory> {
    return this.request("DELETE", "/v1/memories/{memory_id}", { ...options, path: { memory_id: memoryId } });
  }

  listVaults(options?: ListOptions & { workspaceId?: string }): Promise<VaultList> {
    return this.request("GET", "/v1/vaults", {
      ...options,
      query: listQuery(options, { workspace_id: options?.workspaceId }),
    });
  }

  createVault(body: CreateVaultRequest, options?: RequestOptions): Promise<Vault> {
    return this.request("POST", "/v1/vaults", { ...options, body });
  }

  getVault(vaultId: string, options?: RequestOptions): Promise<Vault> {
    return this.request("GET", "/v1/vaults/{vault_id}", { ...options, path: { vault_id: vaultId } });
  }

  listConnectors(options?: ListOptions & { workspaceId?: string }): Promise<ConnectorList> {
    return this.request("GET", "/v1/connectors", {
      ...options,
      query: listQuery(options, { workspace_id: options?.workspaceId }),
    });
  }

  getConnector(connectorId: string, options?: RequestOptions): Promise<Connector> {
    return this.request("GET", "/v1/connectors/{connector_id}", {
      ...options,
      path: { connector_id: connectorId },
    });
  }

  listSkills(options?: ListOptions): Promise<SkillList> {
    return this.request("GET", "/v1/skills", { ...options, query: pageQuery(options) });
  }

  getSkill(skillId: string, options?: RequestOptions): Promise<Skill> {
    return this.request("GET", "/v1/skills/{skill_id}", { ...options, path: { skill_id: skillId } });
  }

  listOutcomes(options?: ListOptions & { taskId?: string }): Promise<OutcomeList> {
    return this.request("GET", "/v1/outcomes", {
      ...options,
      query: listQuery(options, { task_id: options?.taskId }),
    });
  }

  getOutcome(outcomeId: string, options?: RequestOptions): Promise<Outcome> {
    return this.request("GET", "/v1/outcomes/{outcome_id}", { ...options, path: { outcome_id: outcomeId } });
  }

  listQuotas(options?: ListOptions): Promise<QuotaList> {
    return this.request("GET", "/v1/quotas", { ...options, query: pageQuery(options) });
  }

  getQuota(quotaId: string, options?: RequestOptions): Promise<Quota> {
    return this.request("GET", "/v1/quotas/{quota_id}", { ...options, path: { quota_id: quotaId } });
  }

  private async *streamEventsPath(
    pathTemplate: string,
    options: RequestOptions & {
      path?: Record<string, string>;
      query?: Query;
      lastEventId?: string;
    } = {},
  ): AsyncIterable<Event> {
    const response = await this.rawRequest("GET", pathTemplate, {
      ...options,
      accept: "text/event-stream",
      headers: mergeHeaders(options.headers, options.lastEventId ? { "Last-Event-ID": options.lastEventId } : undefined),
    });
    if (!response.body) {
      throw new Error("The Harn API returned a streaming response without a body.");
    }
    for await (const event of streamJsonSse<Event>(response.body)) {
      yield event.data;
    }
  }

  private async request<T>(
    method: HttpMethod,
    pathTemplate: string,
    options: InternalRequestOptions = {},
  ): Promise<T> {
    const response = await this.rawRequest(method, pathTemplate, options);
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async rawRequest(
    method: HttpMethod,
    pathTemplate: string,
    options: InternalRequestOptions = {},
  ): Promise<Response> {
    const url = this.buildUrl(pathTemplate, options.path, options.query);
    const headers = new Headers();
    appendHeaders(headers, this.defaultHeaders);
    appendHeaders(headers, options.headers);
    appendHeaders(headers, { Accept: options.accept ?? "application/json" });

    if (options.protocol !== false) {
      headers.set("Harn-Agents-Protocol-Version", this.protocolVersion);
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (this.auth) {
      appendHeaders(headers, await this.auth({ url, method }));
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new HarnApiError(response, await response.json().catch(() => undefined));
    }
    return response;
  }

  private buildUrl(pathTemplate: string, path: Record<string, string> = {}, query: Query = {}): URL {
    let resolvedPath = pathTemplate;
    for (const [name, value] of Object.entries(path)) {
      resolvedPath = resolvedPath.replace(`{${name}}`, encodeURIComponent(value));
    }

    const url = new URL(resolvedPath, this.baseUrl);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(name, String(value));
      }
    }
    return url;
  }
}

interface InternalRequestOptions extends RequestOptions {
  accept?: string;
  body?: unknown;
  path?: Record<string, string>;
  protocol?: boolean;
  query?: Query;
}

function authFromTokenOptions(options: HarnClientOptions): AuthProvider | undefined {
  const token = options.accessToken ?? options.apiKey;
  if (!token) {
    return undefined;
  }
  return async () => ({
    Authorization: `Bearer ${typeof token === "function" ? await token() : token}`,
  });
}

function pageQuery(options?: ListOptions): Query {
  return { limit: options?.limit, cursor: options?.cursor };
}

function listQuery(options: ListOptions | undefined, query: Query): Query {
  return { ...query, ...pageQuery(options) };
}

function mergeHeaders(...inputs: (HeadersInit | undefined)[]): Headers {
  const headers = new Headers();
  for (const input of inputs) {
    appendHeaders(headers, input);
  }
  return headers;
}

function appendHeaders(target: Headers, input: HeadersInit | undefined): void {
  if (!input) {
    return;
  }
  new Headers(input).forEach((value, name) => target.set(name, value));
}
