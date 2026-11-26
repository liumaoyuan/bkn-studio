/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { http } from "@/framework/request/http";
import { getStoredAccessToken } from "@/framework/auth/token-store";

/** 平台模型模式下，copilot 请求需要带上当前登录用户的令牌。 */
function withAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = getStoredAccessToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

export type CopilotChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CopilotStreamEvent =
  | { type: "status"; stage?: string; text?: string }
  | { type: "delta"; text: string }
  | { type: "done"; ir?: CopilotIr; warnings?: string[]; applied?: string[]; note?: string }
  | { type: "error"; message?: string };

export type StreamCopilotChatOptions = {
  sessionId: string;
  messages: CopilotChatMessage[];
  draft?: CopilotIr | null;
  signal?: AbortSignal;
  onEvent: (event: CopilotStreamEvent) => void;
};

/** 证据引用：该条目在输入材料中的出处（后端确定性检索得到）。 */
export type CopilotEvidence = {
  source: string;
  location?: string;
  quote: string;
};

export type CopilotEvidenceStats = {
  objects: number;
  objectsWithEvidence: number;
  properties: number;
  propertiesWithEvidence: number;
  relations: number;
  relationsWithEvidence: number;
  actions: number;
  actionsWithEvidence: number;
  risks: number;
  risksWithEvidence: number;
};

export type CopilotIrProperty = {
  name: string;
  displayName?: string;
  type: "string" | "integer" | "number" | "boolean" | "datetime";
  description?: string;
  /** 推断出的来源列名（后端规则匹配上传表的表头）??*/
  mappedField?: string;
  evidence?: CopilotEvidence[];
};

export type CopilotIrObjectType = {
  id: string;
  name: string;
  description?: string;
  /** 推断出的来源表名（后端规则匹配上传的工作表）。 */
  sourceTable?: string;
  properties: CopilotIrProperty[];
  primaryKey?: string;
  displayKey?: string;
  evidence?: CopilotEvidence[];
};

export type CopilotIrRelation = {
  id: string;
  name: string;
  source: string;
  target: string;
  description?: string;
  mapping?: Array<{ sourceProperty: string; targetProperty: string }>;
  evidence?: CopilotEvidence[];
};

export type CopilotIrActionType = {
  id: string;
  name: string;
  description?: string;
  actionType: "add" | "modify" | "delete";
  boundObject: string;
  riskLevel?: "low" | "medium" | "high";
  requiresApproval?: boolean;
  enabled?: boolean;
  trigger?: { field: string; operation: string; value?: string };
  evidence?: CopilotEvidence[];
};

export type CopilotIrRiskType = {
  id: string;
  name: string;
  description?: string;
  policies: string[];
  evidence?: CopilotEvidence[];
};

export type CopilotIrConceptGroup = {
  id: string;
  name: string;
  description?: string;
  objectTypes: string[];
};

export type CopilotIr = {
  networkId: string;
  networkName: string;
  description?: string;
  objectTypes: CopilotIrObjectType[];
  relations: CopilotIrRelation[];
  actionTypes?: CopilotIrActionType[];
  riskTypes?: CopilotIrRiskType[];
  conceptGroups?: CopilotIrConceptGroup[];
};

export type AnalyzeCopilotOptions = {
  text: string;
  /** 设计报告类文件（文档/PDF/PPT/Markdown 等）。 */
  reportFiles?: File[];
  /** 数据类文件（Excel/CSV/JSON/SQL 等）。 */
  dataFiles?: File[];
  networkName?: string;
};

/** 数据绑定推断统计（来源表/字段/主键/关系键映射）。 */
export type CopilotBindingStats = {
  tables: number;
  objects: number;
  boundObjects: number;
  properties: number;
  mappedProperties: number;
  inferredPrimaryKeys: number;
  inferredRelations: number;
};

export type CopilotBindingObjectDetail = {
  objectId: string;
  objectName: string;
  table: string;
  primaryKey?: { property: string; column: string };
  properties: Array<{ property: string; column: string; type: string }>;
};

export type CopilotBindingRelationDetail = {
  relationId: string;
  relationName: string;
  sourceTable?: string;
  targetTable?: string;
  mapping: Array<{ sourceProperty: string; targetProperty: string }>;
};

export type CopilotBindingDetails = {
  objects: CopilotBindingObjectDetail[];
  relations: CopilotBindingRelationDetail[];
};

/** 数据库结构输入（DDL / dump）解析统计。 */
export type CopilotSchemaStats = {
  dialect: "mysql" | "postgres" | "oracle" | "mssql" | "unknown";
  tables: number;
  columns: number;
  foreignKeys: number;
  commentedTables: number;
  commentedColumns: number;
  hasComments: boolean;
};

export type AnalyzeCopilotResult =
  | {
      ok: true;
      mode: "llm" | "heuristic";
      /** 模型调用失败时的错误信息（mode 降级为 heuristic 时才有）。 */
      llmError?: string;
      ir: CopilotIr;
      warnings: string[];
      binding?: CopilotBindingStats;
      bindingDetails?: CopilotBindingDetails;
      evidence?: CopilotEvidenceStats;
      /** 只有数据库结构输入时才有??*/
      schema?: CopilotSchemaStats;
      /** 需要用户确认的问题（数据库结构输入时由模型生成）。 */
      openQuestions?: string[];
      /** 直连数据库内省时：读到的表数量与数据库版本。 */
      scannedTables?: number;
      serverVersion?: string;
    }
  | { ok: false; errors: string[] };

const CHAT_PATH = "/api/copilot/chat";
const ANALYZE_PATH = "/api/copilot/analyze";
const DOWNLOAD_PATH = "/api/copilot/compile/download";
const BINDING_KIT_PATH = "/api/copilot/compile/binding-kit/download";
const SETTINGS_PATH = "/api/copilot/settings";
const KN_PAYLOAD_PATH = "/api/copilot/compile/kn-payload";
const SETTINGS_TEST_PATH = "/api/copilot/settings/test";
const INTROSPECT_PATH = "/api/copilot/introspect";
const INTROSPECT_TEST_PATH = "/api/copilot/introspect/test";

/** 直连数据库内省的连接参数（只读）??*/
export type CopilotIntrospectTarget = {
  dialect: "mysql" | "postgres";
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  schema?: string;
};

/** 模型连接配置（服务端返回掩码后的 key）。 */
export type CopilotModelMode = "manual" | "platform" | "none";

export type CopilotModelSettings = {
  source: "file" | "env" | "none";
  mode: CopilotModelMode;
  platformModel: string;
  platformModelName: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
};

export type CopilotModelSettingsInput = {
  mode?: CopilotModelMode;
  platformModel?: string;
  platformModelName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type CopilotPlatformModel = {
  id: string;
  name: string;
  series?: string;
  maxModelLen?: number;
  isDefault?: boolean;
};

function parseEvent(raw: string): CopilotStreamEvent | null {
  const dataLines = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  try {
    return JSON.parse(dataLines.join("\n")) as CopilotStreamEvent;
  } catch {
    return null;
  }
}

/** 以 SSE 流式方式调用本地 copilot 服务。 */
export async function streamCopilotChat({
  sessionId,
  messages,
  draft,
  signal,
  onEvent,
}: StreamCopilotChatOptions): Promise<void> {
  const response = await fetch(CHAT_PATH, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sessionId, messages, draft: draft ?? null }),
    signal,
  });

  if (!response.ok || !response.body) {
    onEvent({ type: "error", message: `HTTP ${response.status}` });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const event = parseEvent(part);
      if (event) {
        onEvent(event);
      }
    }
  }

  const tail = buffer.trim() ? parseEvent(buffer) : null;
  if (tail) {
    onEvent(tail);
  }
}

/** 上传文件/文本，让 copilot 服务抽取本体草案??*/
export async function analyzeCopilot({
  text,
  reportFiles = [],
  dataFiles = [],
  networkName,
}: AnalyzeCopilotOptions): Promise<AnalyzeCopilotResult> {
  const form = new FormData();
  form.append("text", text);
  if (networkName) {
    form.append("networkName", networkName);
  }
  for (const file of reportFiles) {
    form.append("reportFiles", file, file.name);
  }
  for (const file of dataFiles) {
    form.append("dataFiles", file, file.name);
  }

  const response = await fetch(ANALYZE_PATH, {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    mode?: "llm" | "heuristic";
    llmError?: string;
    ir?: CopilotIr;
    warnings?: string[];
    errors?: string[];
    binding?: CopilotBindingStats;
    bindingDetails?: CopilotBindingDetails;
    evidence?: CopilotEvidenceStats;
    schema?: CopilotSchemaStats;
    openQuestions?: string[];
  };

  if (!response.ok || !payload.ok || !payload.ir) {
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  }

  return {
    ok: true,
    mode: payload.mode ?? "heuristic",
    llmError: payload.llmError,
    ir: payload.ir,
    warnings: payload.warnings ?? [],
    binding: payload.binding,
    bindingDetails: payload.bindingDetails,
    evidence: payload.evidence,
    schema: payload.schema,
    openQuestions: payload.openQuestions,
  };
}

export type CopilotIrIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  fixed?: boolean;
};

export type CopilotIrCheckResult =
  | {
      ok: true;
      ir: CopilotIr;
      changed: boolean;
      issues: CopilotIrIssue[];
      summary: { errors: number; warnings: number; fixed: number };
    }
  | { ok: false; errors: string[] };

/** 对当前草案做确定性自检与修复（P0-B）。 */
export async function checkCopilotIr(ir: CopilotIr): Promise<CopilotIrCheckResult> {
  const response = await fetch("/api/copilot/ir/check", {
    method: "POST",
    headers: { ...withAuthHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ ir }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    ir?: CopilotIr;
    changed?: boolean;
    issues?: CopilotIrIssue[];
    summary?: { errors: number; warnings: number; fixed: number };
    errors?: string[];
  };
  if (!response.ok || !payload.ok || !payload.ir) {
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  }
  return {
    ok: true,
    ir: payload.ir,
    changed: Boolean(payload.changed),
    issues: payload.issues ?? [],
    summary: payload.summary ?? { errors: 0, warnings: 0, fixed: 0 },
  };
}
/** 下载编译好的 .bkn 资源包。 */
export async function downloadCopilotPackage(ir: CopilotIr): Promise<void> {
  const response = await fetch(DOWNLOAD_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${ir.networkId}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 测试数据库连接（只跑一次元数据读取）。 */
export async function testCopilotDatabaseConnection(
  target: CopilotIntrospectTarget,
): Promise<{ ok: true; serverVersion: string; tables: number } | { ok: false; errors: string[] }> {
  try {
    const response = await fetch(INTROSPECT_TEST_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      serverVersion?: string;
      tables?: number;
      errors?: string[];
    };
    if (response.ok && payload.ok) {
      return { ok: true, serverVersion: payload.serverVersion ?? "", tables: payload.tables ?? 0 };
    }
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

/** 直连数据库读取结构并生成本体草案（与上传 DDL 等价，但省掉导出步骤）。 */
export async function introspectCopilotDatabase(
  target: CopilotIntrospectTarget,
  networkName = "",
): Promise<AnalyzeCopilotResult> {
  const response = await fetch(INTROSPECT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, networkName }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || !payload.ok) {
    const errors = Array.isArray(payload.errors)
      ? payload.errors.map(String)
      : [`HTTP ${response.status}`];
    return { ok: false, errors };
  }

  return {
    ok: true,
    mode: payload.mode === "llm" ? "llm" : "heuristic",
    llmError: typeof payload.llmError === "string" ? payload.llmError : undefined,
    ir: payload.ir as CopilotIr,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    binding: payload.binding as CopilotBindingStats | undefined,
    bindingDetails: payload.bindingDetails as CopilotBindingDetails | undefined,
    evidence: payload.evidence as CopilotEvidenceStats | undefined,
    schema: payload.schema as CopilotSchemaStats | undefined,
    openQuestions: Array.isArray(payload.openQuestions) ? payload.openQuestions.map(String) : [],
    scannedTables: typeof payload.scannedTables === "number" ? payload.scannedTables : undefined,
    serverVersion: typeof payload.serverVersion === "string" ? payload.serverVersion : undefined,
  };
}

/** 下载数据接入包（views.sql / binding.json / README.md）。 */
export async function downloadCopilotBindingKit(ir: CopilotIr): Promise<void> {
  const response = await fetch(BINDING_KIT_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${ir.networkId}-binding-kit.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type SettingsPayload = {
  ok?: boolean;
  source?: "file" | "env" | "none";
  mode?: CopilotModelMode;
  platformModel?: string;
  platformModelName?: string;
  baseUrl?: string;
  model?: string;
  apiKeyMasked?: string;
  errors?: string[];
  error?: string;
  latencyMs?: number;
};

function toModelSettings(payload: SettingsPayload): CopilotModelSettings {
  return {
    source: payload.source ?? "none",
    mode: payload.mode ?? "none",
    platformModel: payload.platformModel ?? "",
    platformModelName: payload.platformModelName ?? "",
    baseUrl: payload.baseUrl ?? "",
    model: payload.model ?? "",
    apiKeyMasked: payload.apiKeyMasked ?? "",
  };
}

const PLATFORM_MODELS_PATH = "/api/copilot/platform-models";

/** 读取平台「模型配置」里已配置的模型清单。 */
export async function listCopilotPlatformModels(): Promise<
  { ok: true; models: CopilotPlatformModel[] } | { ok: false; error: string }
> {
  const response = await fetch(PLATFORM_MODELS_PATH, { headers: withAuthHeaders() });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    models?: CopilotPlatformModel[];
    error?: string;
  };
  if (!response.ok || !payload.ok) {
    return { ok: false, error: payload.error ?? `HTTP ${response.status}` };
  }
  return { ok: true, models: payload.models ?? [] };
}

/** 读取当前模型连接配置（key 为掩码）??*/
export async function getCopilotModelSettings(): Promise<CopilotModelSettings> {
  const response = await fetch(SETTINGS_PATH, { headers: withAuthHeaders() });
  const payload = (await response.json()) as SettingsPayload;
  return toModelSettings(payload);
}

/** 保存模型连接配置；apiKey 留空表示沿用已保存的 key。 */
export async function saveCopilotModelSettings(
  input: CopilotModelSettingsInput,
): Promise<{ ok: true; settings: CopilotModelSettings } | { ok: false; errors: string[] }> {
  const response = await fetch(SETTINGS_PATH, {
    method: "PUT",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as SettingsPayload;
  if (!response.ok || !payload.ok) {
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  }
  return { ok: true, settings: toModelSettings(payload) };
}

/** 清除本机保存的配置，回退到环境变量。 */
export async function clearCopilotModelSettings(): Promise<CopilotModelSettings> {
  const response = await fetch(SETTINGS_PATH, { method: "DELETE", headers: withAuthHeaders() });
  const payload = (await response.json()) as SettingsPayload;
  return toModelSettings(payload);
}

/** 测试模型连接（可用表单里的值，也可用已保存的配置）??*/
export async function testCopilotModelSettings(
  input: Partial<CopilotModelSettingsInput>,
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const response = await fetch(SETTINGS_TEST_PATH, {
    method: "POST",
    headers: withAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as SettingsPayload;
  if (!response.ok || !payload.ok) {
    return { ok: false, error: payload.error ?? `HTTP ${response.status}` };
  }
  return { ok: true, latencyMs: payload.latencyMs ?? 0 };
}
export type CopilotAttachPlanResource = {
  name: string;
  sourceIdentifier: string;
  category: "table";
  description: string;
  schemaDefinition: Array<{
    name: string;
    display_name: string;
    type: string;
    original_name: string;
    description: string;
  }>;
  indexConfig: { primaryKeyFields: string[]; incrementalFields: string[] };
};

export type CopilotAttachPlan = {
  dialect: "mysql" | "postgres";
  catalog: {
    name: string;
    connectorType: string;
    connectorConfig: Record<string, unknown>;
    description: string;
    tags: string[];
  };
  resources: CopilotAttachPlanResource[];
  bindings: Array<{
    objectId: string;
    objectName: string;
    resourceName: string;
    primaryKey: string;
    properties: Array<{ property: string; column?: string }>;
  }>;
  warnings: string[];
};

export type CopilotAttachResult = {
  catalogId: string;
  catalogName: string;
  resourceIds: Record<string, string>;
  createdResources: number;
  reusedResources: number;
};

/** 由 copilot-svc 组装「数据源 + 资源 + 对象绑定」计划（不访问平台，纯映射）。 */
export async function compileCopilotAttachPlan(
  ir: CopilotIr,
  target: CopilotIntrospectTarget,
): Promise<{ ok: true; plan: CopilotAttachPlan } | { ok: false; errors: string[] }> {
  const response = await fetch("/api/copilot/compile/attach-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir, target }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
    plan?: CopilotAttachPlan;
  };
  if (!response.ok || !payload.ok || !payload.plan) {
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  }
  return { ok: true, plan: payload.plan };
}

/** 对齐视图定义：把来源列名改成与本体属性名一致（平台靠同名列隐式绑定字段）。 */
export type CopilotAlignmentView = {
  viewName: string;
  tableName: string;
  columns: Array<{ column?: string; property: string }>;
};

export type CopilotAlignmentViewResult = {
  created: string[];
  failed: Array<{ viewName: string; error: string }>;
};

/** 由 copilot-svc 用用户填的连接信息在业务库上建「列名对齐」视图（需要写权限）。 */
export async function createCopilotAlignmentViews(
  target: CopilotIntrospectTarget,
  views: CopilotAlignmentView[],
): Promise<CopilotAlignmentViewResult & { errors?: string[] }> {
  const response = await fetch("/api/copilot/introspect/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, views }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
    created?: string[];
    failed?: Array<{ viewName: string; error: string }>;
  };
  if (!response.ok || !payload.ok) {
    return { created: [], failed: [], errors: payload.errors ?? [`HTTP ${response.status}`] };
  }
  return { created: payload.created ?? [], failed: payload.failed ?? [] };
}

/**
 * 按计划在平台创建（或复用）数据源与资源，返回对象 → 资源 id 的绑定表。
 * 平台调用由前端完成，凭据来自用户刚填的连接信息，因此 copilot-svc 不需要保存数据库口令。
 */
export async function attachCopilotDataSource(
  plan: CopilotAttachPlan,
  options: { nameOverrides?: Record<string, string> } = {},
): Promise<CopilotAttachResult> {
  const catalogName = plan.catalog.name;
  let catalogId = "";

  const catalogList = await http.get<{ entries?: Array<{ id?: string; name?: string }> }>(
    "/vega-backend/v1/catalogs",
    { params: { limit: 200 }, skipErrorToast: true },
  );
  const existing = (catalogList.data.entries ?? []).find((item) => item.name === catalogName);
  if (existing?.id) {
    catalogId = existing.id;
  } else {
    const created = await http.post<{ id?: string }>("/vega-backend/v1/catalogs", {
      connector_config: plan.catalog.connectorConfig,
      connector_type: plan.catalog.connectorType,
      description: plan.catalog.description,
      enabled: true,
      name: catalogName,
      tags: plan.catalog.tags,
    });
    catalogId = created.data.id ?? "";
  }
  if (!catalogId) {
    throw new Error("创建数据源失败：平台未返??catalog id");
  }

  await http
    .post(
      `/vega-backend/v1/catalogs/${catalogId}/discover`,
      { strategy: "full_sync" },
      {
        params: { wait: true },
        timeout: 120_000,
        skipErrorToast: true,
      },
    )
    .catch(() => undefined);

  const byName = new Map<string, string>();
  const collect = (entries: Array<{ id?: string; name?: string; source_identifier?: string }>) => {
    for (const entry of entries) {
      if (!entry.id) continue;
      if (entry.name) byName.set(entry.name, entry.id);
      // source_identifier 形如 `erp_demo`.`t_equip`，表名兜底匹配。
      const tail = (entry.source_identifier ?? "").split(".").pop()?.replace(/`/g, "").trim();
      if (tail && !byName.has(tail)) byName.set(tail, entry.id);
    }
  };

  // 发现任务是异步的：轮询到计划中的资源名都出现为止（最多 60 秒）。
  // 对齐视图模式下，对象绑定的是视图资源（名字来自 nameOverrides），不是原表。
  const resolveName = (objectId: string, fallback: string): string =>
    options.nameOverrides?.[objectId] || fallback;
  const expected = Array.from(
    new Set(plan.bindings.map((binding) => resolveName(binding.objectId, binding.resourceName))),
  );
  const deadline = Date.now() + 60_000;
  while (expected.length > 0) {
    const resourceList = await http.get<{
      entries?: Array<{ id?: string; name?: string; source_identifier?: string }>;
    }>("/vega-backend/v1/resources", {
      params: { catalog_id: catalogId, limit: 500 },
      skipErrorToast: true,
    });
    collect(resourceList.data.entries ?? []);
    if (expected.every((name) => byName.has(name))) break;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const resourceIds: Record<string, string> = {};
  let reusedResources = 0;
  for (const binding of plan.bindings) {
    const name = resolveName(binding.objectId, binding.resourceName);
    const id = byName.get(name) ?? "";
    if (!id) continue;
    reusedResources += 1;
    resourceIds[binding.objectId] = id;
  }

  return { catalogId, catalogName, resourceIds, createdResources: 0, reusedResources };
}

/** 把当前草案编译成平台「导入知识网络」接口所需??payload??*/
export async function compileCopilotKnPayload(
  ir: CopilotIr,
  options: { resourceBindings?: Record<string, { id: string; name?: string }> } = {},
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; errors: string[] }> {
  const response = await fetch(KN_PAYLOAD_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir, resourceBindings: options.resourceBindings }),
  });
  const payload = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
    payload?: Record<string, unknown>;
  };
  if (!response.ok || !payload.ok || !payload.payload) {
    return { ok: false, errors: payload.errors ?? [`HTTP ${response.status}`] };
  }
  return { ok: true, payload: payload.payload };
}

/** 索引建议：按字段名推断哪些字段适合全文/向量检索（后端规则生成）。 */
export type CopilotIndexSuggestion = {
  objectId: string;
  objectName: string;
  resourceName?: string;
  primaryKeyField?: string;
  fulltextFields: string[];
  vectorFields: string[];
  /** 平台建索引任务要求的增量字段（日期/时间或整数列）。 */
  incrementalField?: string;
};

export type CopilotIndexPlan = {
  suggestions: CopilotIndexSuggestion[];
  summary: { objects: number; fulltextFields: number; vectorFields: number };
  warnings: string[];
};

export type CopilotIndexTask = {
  objectId: string;
  objectName: string;
  resourceName: string;
  taskId?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  fulltextFields: string[];
  vectorFields: string[];
  error?: string;
};

export type CopilotIndexResult = {
  tasks: CopilotIndexTask[];
  warnings: string[];
};

const INDEX_PLAN_PATH = "/api/copilot/compile/index-plan";

export type CopilotEmbeddingModel = { id: string; name: string };

/**
 * 列出平台「模型管理 → 小模型」里已配置的 embedding 模型。
 * 向量索引必须先有模型，否则平台无法生成向量字段。
 */
export async function listCopilotEmbeddingModels(): Promise<CopilotEmbeddingModel[]> {
  try {
    const response = await http.get<{
      data?: Array<{ model_id?: string; model_name?: string; model_type?: string }>;
    }>("/mf-model-manager/v1/small-model/list", {
      params: { limit: 100, offset: 0 },
      skipErrorToast: true,
    });
    return (response.data.data ?? [])
      .filter((item) => `${item.model_type ?? ""}`.toLowerCase().includes("embedding"))
      .map((item) => ({ id: item.model_id ?? "", name: item.model_name ?? item.model_id ?? "" }))
      .filter((item) => Boolean(item.id));
  } catch {
    return [];
  }
}

export async function compileCopilotIndexPlan(
  ir: CopilotIr,
): Promise<{ ok: true; plan: CopilotIndexPlan } | { ok: false; errors: string[] }> {
  const response = await fetch(INDEX_PLAN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ir }),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    errors?: string[];
    plan?: CopilotIndexPlan;
  };
  if (!response.ok || !data.ok || !data.plan) {
    return { ok: false, errors: data.errors ?? [`HTTP ${response.status}`] };
  }
  return { ok: true, plan: data.plan };
}

type BackendSchemaField = {
  name?: string;
  display_name?: string;
  type?: string;
  description?: string;
  original_name?: string;
  original_type?: string;
  original_description?: string;
  features?: Array<Record<string, unknown>> | null;
  attributes?: Record<string, unknown> | null;
};

type BackendResourceEntry = {
  id?: string;
  name?: string;
  source_identifier?: string;
  schema_definition?: BackendSchemaField[];
  index_config?: Record<string, unknown>;
  update_time?: number;
};

const indexFeatureName = (prefix: string, field: string) => `${prefix}_${field}`.slice(0, 60);

/**
 * 一键建索引：更新资源 index_config/字段 features 并触发 build task，轮询到结束。
 * 平台调用放在前端，因为浏览器持有 OAuth 令牌；copilot-svc 不保存平台凭据。
 */
export async function applyCopilotIndexPlan(
  plan: CopilotIndexPlan,
  options: { embeddingModel?: string } = {},
): Promise<CopilotIndexResult> {
  const warnings = [...plan.warnings];
  const tasks: CopilotIndexTask[] = [];
  if (plan.suggestions.length === 0) {
    return { tasks, warnings };
  }

  const listResponse = await http.get<{ entries?: BackendResourceEntry[] }>(
    "/vega-backend/v1/resources",
    { params: { limit: 500 }, skipErrorToast: true },
  );
  const byName = new Map<string, string>();
  for (const entry of listResponse.data.entries ?? []) {
    if (!entry.id) continue;
    if (entry.name) byName.set(entry.name, entry.id);
    const tail = (entry.source_identifier ?? "").split(".").pop()?.replace(/`/g, "").trim();
    if (tail && !byName.has(tail)) byName.set(tail, entry.id);
  }

  for (const suggestion of plan.suggestions) {
    const resourceName = suggestion.resourceName ?? "";
    const resourceId = resourceName ? byName.get(resourceName) : undefined;
    if (!resourceId) {
      warnings.push(`对象「${suggestion.objectName}」找不到资源「${resourceName}」，跳过索引`);
      tasks.push({
        objectId: suggestion.objectId,
        objectName: suggestion.objectName,
        resourceName,
        status: "skipped",
        fulltextFields: suggestion.fulltextFields,
        vectorFields: [],
      });
      continue;
    }

    try {
      const detail = await http.get<{ entries?: BackendResourceEntry[] }>(
        `/vega-backend/v1/resources/${resourceId}`,
        { skipErrorToast: true },
      );
      const resource = detail.data.entries?.[0] ?? {};
      const schemaFields = [...(resource.schema_definition ?? [])];
      const features = ["fulltext", "vector"] as const;
      const appliedVectorFields: string[] = [];
      let changed = false;

      for (const field of schemaFields) {
        const fieldName = field.name ?? "";
        if (!fieldName) continue;
        const existing = Array.isArray(field.features) ? field.features : [];
        const nextFeatures = [...existing];
        for (const featureType of features) {
          const hit =
            featureType === "fulltext" ? suggestion.fulltextFields : suggestion.vectorFields;
          if (!hit.includes(fieldName)) continue;
          if (featureType === "vector" && !options.embeddingModel) continue;
          if (nextFeatures.some((item) => item.feature_type === featureType)) continue;
          nextFeatures.push({
            name: indexFeatureName(featureType === "fulltext" ? "ft" : "vec", fieldName),
            display_name: `${field.display_name ?? fieldName} ${featureType === "fulltext" ? "全文" : "向量"}`,
            feature_type: featureType,
            description: "",
            ref_property: "",
            is_default: false,
            is_native: false,
            config: featureType === "vector" ? { model_id: options.embeddingModel } : {},
          });
          changed = true;
          if (featureType === "vector") appliedVectorFields.push(fieldName);
        }
        if (nextFeatures !== existing) {
          field.features = nextFeatures;
        }
      }

      const schemaFieldNames = new Set(schemaFields.map((item) => item.name ?? ""));
      const existingIncremental = Array.isArray(resource.index_config?.incremental_fields)
        ? (resource.index_config?.incremental_fields as string[])
        : [];
      const incrementalField = [
        suggestion.incrementalField,
        existingIncremental[0],
        ...schemaFields
          .filter((item) =>
            ["datetime", "timestamp", "date", "time", "integer", "large integer"].includes(
              `${item.type ?? ""}`.toLowerCase(),
            ),
          )
          .map((item) => item.name ?? ""),
      ].find((item): item is string => {
        if (!item) return false;
        return schemaFieldNames.has(item);
      });
      if (!incrementalField) {
        warnings.push(
          `对象「${suggestion.objectName}」缺少日期/整数列，平台无法建增量索引，已跳过`,
        );
        tasks.push({
          objectId: suggestion.objectId,
          objectName: suggestion.objectName,
          resourceName,
          status: "skipped",
          fulltextFields: suggestion.fulltextFields,
          vectorFields: [],
        });
        continue;
      }

      const indexConfig = {
        ...(resource.index_config ?? {}),
        ...(suggestion.primaryKeyField ? { primary_key_fields: [suggestion.primaryKeyField] } : {}),
        incremental_fields: [incrementalField],
        ...(options.embeddingModel && appliedVectorFields.length > 0
          ? { default_embedding_model: options.embeddingModel }
          : {}),
      };
      if (suggestion.primaryKeyField) {
        changed = true;
      }

      if (changed) {
        const body = {
          catalog_id: (resource as { catalog_id?: string }).catalog_id,
          category: (resource as { category?: string }).category ?? "table",
          description: (resource as { description?: string }).description ?? "",
          enabled: (resource as { enabled?: boolean }).enabled ?? true,
          index_config: indexConfig,
          name: resourceName,
          schema_definition: schemaFields,
          expected_update_time: resource.update_time,
          source_identifier: resource.source_identifier,
        };
        try {
          await http.put(`/vega-backend/v1/resources/${resourceId}`, body);
        } catch (error) {
          if (!isUpdateConflict(error)) throw error;
          // 并发写入：重新取一次资源，用最新的 update_time 再试一次。
          const fresh = await http.get<{ entries?: Array<Record<string, unknown>> }>(
            `/vega-backend/v1/resources/${resourceId}`,
            { skipErrorToast: true },
          );
          const latest = fresh.data.entries?.[0] as
            { update_time?: number; index_config?: Record<string, unknown> } | undefined;
          const latestConfig = latest?.index_config ?? {};
          await http.put(`/vega-backend/v1/resources/${resourceId}`, {
            ...body,
            index_config: {
              ...latestConfig,
              ...indexConfig,
              ...(indexConfig.primary_key_fields
                ? { primary_key_fields: indexConfig.primary_key_fields }
                : {}),
              incremental_fields: indexConfig.incremental_fields,
            },
            expected_update_time: latest?.update_time ?? body.expected_update_time,
          });
        }
      }

      const created = await http.post<{ id?: string }>("/vega-backend/v1/build-tasks", {
        resource_id: resourceId,
        mode: "batch",
        execute_type: "full",
      });
      const taskId = created.data.id ?? "";
      tasks.push({
        objectId: suggestion.objectId,
        objectName: suggestion.objectName,
        resourceName,
        taskId,
        status: "pending",
        fulltextFields: suggestion.fulltextFields,
        vectorFields: appliedVectorFields,
      });
    } catch (error) {
      const message = platformErrorText(error);
      warnings.push(`对象「${suggestion.objectName}」建索引失败：${message}`);
      tasks.push({
        objectId: suggestion.objectId,
        objectName: suggestion.objectName,
        resourceName,
        status: "failed",
        fulltextFields: suggestion.fulltextFields,
        vectorFields: [],
        error: message,
      });
    }
  }

  // 轮询任务状态，最长 120 秒。
  const deadline = Date.now() + 120_000;
  while (tasks.some((task) => task.status === "pending" || task.status === "running")) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    for (const task of tasks) {
      if (!task.taskId || (task.status !== "pending" && task.status !== "running")) continue;
      try {
        const detail = await http.get<{ status?: string; error_msg?: string }>(
          `/vega-backend/v1/build-tasks/${task.taskId}`,
          { skipErrorToast: true },
        );
        const status = `${detail.data.status ?? ""}`;
        if (status === "completed") task.status = "completed";
        else if (status === "failed" || status === "cancelled") {
          task.status = "failed";
          task.error = detail.data.error_msg ?? status;
        } else task.status = "running";
      } catch {
        task.status = "running";
      }
    }
  }

  return { tasks, warnings };
}

/** 平台在资源并发更新时返回 409（VegaBackend.Resource.UpdateConflict）。 */
function isUpdateConflict(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 409;
}

/** 提取平台错误详情（优先 error_details），便于把后端原因透出到界面。 */
function platformErrorText(error: unknown): string {
  const response = (error as { response?: { data?: Record<string, unknown> } } | null)?.response;
  const data = response?.data ?? {};
  const detail = typeof data.error_details === "string" ? data.error_details : "";
  const description = typeof data.description === "string" ? data.description : "";
  const message = error instanceof Error ? error.message : String(error);
  return detail || description || message;
}

export function createCopilotSessionId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `copilot-${Date.now()}`;
}

/** 智能构建流式分析：分阶段事件（抽取对象/关系/行动等）。 */
export type CopilotAnalyzeStep = {
  id: string;
  status: "running" | "done";
  label: string;
  detail?: string;
  ms?: number;
  error?: string;
};

export type AnalyzeCopilotStreamOptions = AnalyzeCopilotOptions & {
  onStep?: (step: CopilotAnalyzeStep) => void;
  signal?: AbortSignal;
};

/** 与 analyzeCopilot 相同，但通过 NDJSON 流式返回阶段进度，便于界面展示构建过程。 */
export async function analyzeCopilotStream({
  onStep,
  signal,
  ...options
}: AnalyzeCopilotStreamOptions): Promise<AnalyzeCopilotResult> {
  const form = new FormData();
  form.append("text", options.text);
  if (options.networkName) {
    form.append("networkName", options.networkName);
  }
  for (const file of options.reportFiles ?? []) {
    form.append("reportFiles", file, file.name);
  }
  for (const file of options.dataFiles ?? []) {
    form.append("dataFiles", file, file.name);
  }

  const response = await fetch("/api/copilot/analyze/stream", {
    method: "POST",
    headers: withAuthHeaders(),
    body: form,
    signal,
  });
  if (!response.ok || !response.body) {
    return { ok: false, errors: [`HTTP ${response.status}`] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AnalyzeCopilotResult | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === "step") {
        onStep?.(event as unknown as CopilotAnalyzeStep);
      } else if (event.type === "result") {
        if (event.ok && event.ir) {
          final = {
            ok: true,
            mode: (event.mode as "llm" | "heuristic" | undefined) ?? "heuristic",
            llmError: event.llmError as string | undefined,
            ir: event.ir as CopilotIr,
            warnings: (event.warnings as string[] | undefined) ?? [],
          };
        } else {
          final = { ok: false, errors: (event.errors as string[] | undefined) ?? ["分析失败"] };
        }
      }
    }
  }

  return final ?? { ok: false, errors: ["未收到分析结果"] };
}
