/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import type { AxiosRequestConfig } from "axios";

import { http } from "@/framework/request/http";
import { getRuntimeConfig } from "@/framework/runtime/config";
import {
  sanitizeDownloadFilename,
  triggerBrowserDownload,
} from "@/framework/download/file-download";
import type {
  DataIngestionAgentManifest,
  DataIngestionAgentSession,
  DataIngestionAgentSessionDetail,
  DataIngestionAgentStreamEvent,
  DataIngestionAgentStreamResult,
  DataIngestionAgentSkill,
  DataIngestionAgentStatus,
  DataIngestionAutoScanJob,
  DataIngestionControlDatabaseRequest,
  DataIngestionControlDatabaseStatus,
  DataIngestionControlDatabaseTestResult,
  DataIngestionCustomMcpTool,
  DataIngestionCustomSkill,
  DataIngestionDatabaseCatalog,
  DataIngestionDataSource,
  DataIngestionDataset,
  DataIngestionDatasetContract,
  DataIngestionDatasetPublication,
  DataIngestionDatasetRecord,
  DataIngestionDatasetSchema,
  DataIngestionQualityReport,
  DataIngestionInspection,
  DataIngestionOverview,
  DataIngestionPipelineTemplate,
  DataIngestionPipelineRunResult,
  DataIngestionPipelineExecution,
  DataIngestionProvenanceBackfillResult,
  DataIngestionQualityCheck,
  DataIngestionRun,
  DataIngestionRunListItem,
  DataIngestionSpace,
  DataIngestionStorageInfo,
} from "@/modules/data-ingestion/types/data-ingestion";

const PREFIX = "/data-ingestion";
let activeDataSpaceId = "";

function readableMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

export function setDataIngestionSpace(spaceId: string) {
  activeDataSpaceId = spaceId.trim();
}

function scopedConfig(config: AxiosRequestConfig = {}): AxiosRequestConfig {
  if (!activeDataSpaceId) {
    throw new Error("请选择数据空间");
  }
  return {
    ...config,
    headers: {
      ...config.headers,
      "x-data-ingestion-space": activeDataSpaceId,
    },
  };
}

const scopedHttp = {
  get: <T>(url: string, config?: AxiosRequestConfig) => http.get<T>(url, scopedConfig(config)),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    http.post<T>(url, data, scopedConfig(config)),
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    http.put<T>(url, data, scopedConfig(config)),
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    http.delete<T>(url, scopedConfig(config)),
};

async function openAgentStream(path: string, init: RequestInit, retry = true): Promise<Response> {
  if (!activeDataSpaceId) {
    throw new Error("请选择数据空间");
  }
  const runtimeConfig = getRuntimeConfig();
  const token = runtimeConfig.auth.tokenManager.getAccessToken();
  const baseUrl = runtimeConfig.apiBaseUrl.replace(/\/$/, "");
  const headers = new Headers(init.headers);
  headers.set("Accept", "text/event-stream");
  headers.set("Accept-Language", runtimeConfig.locale);
  headers.set("x-data-ingestion-space", activeDataSpaceId);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${baseUrl}${PREFIX}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (response.status === 401 && retry) {
    try {
      const refreshedToken = await runtimeConfig.auth.tokenManager.refreshAccessToken();
      if (refreshedToken) {
        return openAgentStream(path, init, false);
      }
    } catch {
      runtimeConfig.auth.tokenManager.onAuthFailure?.();
    }
    runtimeConfig.auth.tokenManager.onAuthFailure?.();
  }
  if (!response.ok) {
    const body = await response.text();
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
      detail = readableMessage(parsed.detail ?? parsed.message) || body;
    } catch {
      // Keep the original response body.
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response;
}

async function* readAgentStream(response: Response): AsyncGenerator<DataIngestionAgentStreamEvent> {
  if (!response.body) {
    throw new Error("流式响应不可用");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function parseBlock(block: string): DataIngestionAgentStreamEvent | null {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) {
      return null;
    }
    return JSON.parse(data) as DataIngestionAgentStreamEvent;
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
      const event = parseBlock(block);
      if (event) {
        yield event;
      }
      boundary = buffer.search(/\r?\n\r?\n/);
    }
    if (done) {
      const event = parseBlock(buffer);
      if (event) {
        yield event;
      }
      break;
    }
  }
}

async function consumeAgentStream(
  response: Response,
  onEvent: (event: DataIngestionAgentStreamEvent) => void,
): Promise<DataIngestionAgentStreamResult> {
  let session: DataIngestionAgentSessionDetail | null = null;
  let error = "";
  for await (const event of readAgentStream(response)) {
    onEvent(event);
    const eventSession = "session" in event ? event.session : null;
    if (
      eventSession &&
      typeof eventSession === "object" &&
      "messages" in eventSession &&
      "approvals" in eventSession
    ) {
      session = eventSession as DataIngestionAgentSessionDetail;
    }
    if (event.type === "error") {
      error = readableMessage(event.message) || "Agent 执行失败";
    }
  }
  return { error, session };
}

export const dataIngestionService = {
  getControlDatabaseStatus: () =>
    http.get<DataIngestionControlDatabaseStatus>(`${PREFIX}/bootstrap/status`).then((r) => r.data),

  testControlDatabase: (payload: DataIngestionControlDatabaseRequest) =>
    http
      .post<DataIngestionControlDatabaseTestResult>(`${PREFIX}/bootstrap/test`, payload)
      .then((r) => r.data),

  configureControlDatabase: (payload: DataIngestionControlDatabaseRequest) =>
    http
      .post<DataIngestionControlDatabaseStatus>(`${PREFIX}/bootstrap/control-database`, payload)
      .then((r) => r.data),

  listDataSpaces: () => http.get<DataIngestionSpace[]>(`${PREFIX}/spaces`).then((r) => r.data),

  createDataSpace: (payload: { name: string; slug: string; database_url: string }) =>
    http.post<DataIngestionSpace>(`${PREFIX}/spaces`, payload).then((r) => r.data),

  testDataSpace: (spaceId: string) =>
    http
      .post<{ id: string; status: string; database_label: string }>(
        `${PREFIX}/spaces/${spaceId}/test`,
      )
      .then((r) => r.data),

  syncDataSpaceCatalog: (spaceId: string) =>
    http
      .post<{
        catalog_id: string;
        created: boolean;
        discovery_started: boolean;
        database_label: string;
      }>(`${PREFIX}/spaces/${encodeURIComponent(spaceId)}/catalog-sync`)
      .then((r) => r.data),

  overview: () => scopedHttp.get<DataIngestionOverview>(`${PREFIX}/overview`).then((r) => r.data),

  listSources: () =>
    scopedHttp.get<DataIngestionDataSource[]>(`${PREFIX}/sources`).then((r) => r.data),

  createSource: (payload: { name: string; source_type: string; config: Record<string, unknown> }) =>
    scopedHttp.post<DataIngestionDataSource>(`${PREFIX}/sources`, payload).then((r) => r.data),

  updateSource: (
    sourceId: string,
    payload: Partial<{ name: string; source_type: string; config: Record<string, unknown> }>,
  ) =>
    scopedHttp
      .put<DataIngestionDataSource>(`${PREFIX}/sources/${encodeURIComponent(sourceId)}`, payload)
      .then((r) => r.data),

  testSource: (sourceId: string) =>
    scopedHttp
      .post<DataIngestionDataSource & { test_result?: Record<string, unknown> }>(
        `${PREFIX}/sources/${sourceId}/test`,
      )
      .then((r) => r.data),

  inspectSourceDatabase: (payload: {
    source_id?: string;
    source_type: string;
    config: Record<string, unknown>;
    table_name?: string;
  }) =>
    scopedHttp
      .post<DataIngestionDatabaseCatalog>(`${PREFIX}/sources/database-catalog`, payload)
      .then((r) => r.data),

  deleteSource: (sourceId: string) =>
    scopedHttp.delete(`${PREFIX}/sources/${encodeURIComponent(sourceId)}`),

  listDatasets: (q = "") =>
    scopedHttp
      .get<DataIngestionDataset[]>(`${PREFIX}/datasets`, {
        params: { q: q || undefined },
      })
      .then((r) => r.data),

  createDataset: (payload: {
    name: string;
    description: string;
    data_type: string;
    storage_mode?: "auto" | "shared" | "dedicated";
    upsert_keys?: string[];
  }) => {
    const body = new FormData();
    body.append("name", payload.name);
    body.append("description", payload.description);
    body.append("data_type", payload.data_type);
    body.append("storage_mode", payload.storage_mode ?? "dedicated");
    body.append("upsert_keys", (payload.upsert_keys ?? []).join(","));
    return scopedHttp.post<DataIngestionDataset>(`${PREFIX}/datasets`, body).then((r) => r.data);
  },

  updateDataset: (
    datasetId: string,
    payload: {
      name?: string;
      description?: string;
      data_type?: string;
      upsert_keys?: string[];
    },
  ) =>
    scopedHttp
      .put<DataIngestionDataset>(`${PREFIX}/datasets/${encodeURIComponent(datasetId)}`, payload)
      .then((r) => r.data),

  deleteDataset: (datasetId: string) =>
    scopedHttp.delete(`${PREFIX}/datasets/${encodeURIComponent(datasetId)}`),

  getDatasetSchema: (datasetId: string, sampleSize = 200) =>
    scopedHttp
      .get<DataIngestionDatasetSchema>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/schema`,
        { params: { sample_size: sampleSize } },
      )
      .then((r) => r.data),

  getDatasetQuality: (datasetId: string, sampleSize = 200) =>
    scopedHttp
      .get<DataIngestionQualityReport>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/quality`,
        { params: { sample_size: sampleSize } },
      )
      .then((r) => r.data),

  startFullDatasetQualityCheck: (datasetId: string) =>
    scopedHttp
      .post<DataIngestionQualityCheck>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/quality-checks`,
      )
      .then((r) => r.data),

  getLatestFullDatasetQualityCheck: (datasetId: string) =>
    scopedHttp
      .get<DataIngestionQualityCheck>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/quality-checks/latest`,
      )
      .then((r) => r.data),

  backfillDatasetProvenance: (datasetId: string) =>
    scopedHttp
      .post<DataIngestionProvenanceBackfillResult>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/provenance/backfill`,
      )
      .then((r) => r.data),

  getDatasetContract: (datasetId: string, sampleSize = 200) =>
    scopedHttp
      .get<DataIngestionDatasetContract>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/contract`,
        { params: { sample_size: sampleSize } },
      )
      .then((r) => r.data),

  getDatasetPublication: (datasetId: string) =>
    scopedHttp
      .get<DataIngestionDatasetPublication>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/publication`,
      )
      .then((r) => r.data),

  publishDataset: (datasetId: string) =>
    scopedHttp
      .post<DataIngestionDatasetPublication>(
        `${PREFIX}/datasets/${encodeURIComponent(datasetId)}/publish`,
      )
      .then((r) => r.data),

  listTemplates: () =>
    scopedHttp.get<DataIngestionPipelineTemplate[]>(`${PREFIX}/templates`).then((r) => r.data),

  getTemplate: (templateCode: string) =>
    scopedHttp
      .get<DataIngestionPipelineTemplate>(`${PREFIX}/templates/${encodeURIComponent(templateCode)}`)
      .then((r) => r.data),

  createPipeline: (payload: {
    code: string;
    name: string;
    description: string;
    supported_types: string[];
    steps: Record<string, unknown>[];
    enabled: boolean;
  }) =>
    scopedHttp
      .post<DataIngestionPipelineTemplate>(`${PREFIX}/capabilities/pipelines`, payload)
      .then((r) => r.data),

  updatePipeline: (
    pipelineId: string,
    payload: Partial<{
      name: string;
      description: string;
      supported_types: string[];
      steps: Record<string, unknown>[];
      enabled: boolean;
    }>,
  ) =>
    scopedHttp
      .put<DataIngestionPipelineTemplate>(
        `${PREFIX}/capabilities/pipelines/${encodeURIComponent(pipelineId)}`,
        payload,
      )
      .then((r) => r.data),

  deletePipeline: (pipelineId: string) =>
    scopedHttp.delete(`${PREFIX}/capabilities/pipelines/${encodeURIComponent(pipelineId)}`),

  runUserPipeline: (
    pipelineId: string,
    inputs: Record<string, unknown> = {},
    stepInputs: Record<string, Record<string, unknown>> = {},
  ) =>
    scopedHttp
      .post<DataIngestionPipelineRunResult>(
        `${PREFIX}/capabilities/pipelines/${encodeURIComponent(pipelineId)}/run`,
        {
          inputs,
          step_inputs: stepInputs,
        },
      )
      .then((r) => r.data),

  listPipelineExecutions: () =>
    scopedHttp
      .get<DataIngestionPipelineExecution[]>(`${PREFIX}/capabilities/pipeline-executions`, {
        params: { limit: 200 },
      })
      .then((r) => r.data),

  listPipelineExecutionsForSpace: (spaceId: string) =>
    http
      .get<DataIngestionPipelineExecution[]>(`${PREFIX}/capabilities/pipeline-executions`, {
        headers: { "x-data-ingestion-space": spaceId },
        params: { limit: 200 },
      })
      .then((r) => r.data),

  listPipelineExecutionsForSpacePage: (spaceId: string, page = 1, pageSize = 200) =>
    http
      .get<{
        items: DataIngestionPipelineExecution[];
        page: number;
        page_size: number;
        total: number;
      }>(`${PREFIX}/capabilities/pipeline-executions/page`, {
        headers: { "x-data-ingestion-space": spaceId },
        params: { page, page_size: pageSize },
      })
      .then((r) => r.data),

  async listAllPipelineExecutionsForSpace(spaceId: string) {
    const items: DataIngestionPipelineExecution[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await dataIngestionService.listPipelineExecutionsForSpacePage(
        spaceId,
        page,
        200,
      );
      items.push(...result.items);
      total = result.total;
      if (!result.items.length) {
        break;
      }
      page += 1;
    } while (items.length < total);
    return items;
  },

  deletePipelineExecution: (executionId: string) =>
    scopedHttp.delete(
      `${PREFIX}/capabilities/pipeline-executions/${encodeURIComponent(executionId)}`,
    ),

  deletePipelineExecutionForSpace: (spaceId: string, executionId: string) =>
    http.delete(`${PREFIX}/capabilities/pipeline-executions/${encodeURIComponent(executionId)}`, {
      headers: { "x-data-ingestion-space": spaceId },
    }),

  getStorageInfo: () =>
    scopedHttp.get<DataIngestionStorageInfo>(`${PREFIX}/storage/info`).then((r) => r.data),

  inspectUpload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return scopedHttp
      .post<DataIngestionInspection>(`${PREFIX}/uploads/inspect`, body)
      .then((r) => r.data);
  },

  createRun: (payload: {
    file: File;
    datasetId: string;
    templateCode: string;
    sourceId?: string;
  }) => {
    const body = new FormData();
    body.append("file", payload.file);
    body.append("dataset_id", payload.datasetId);
    body.append("template_code", payload.templateCode);
    if (payload.sourceId) {
      body.append("source_id", payload.sourceId);
    }
    return scopedHttp.post<DataIngestionRun>(`${PREFIX}/runs`, body).then((r) => r.data);
  },

  listRuns: (params?: { status?: string; datasetId?: string; limit?: number }) =>
    scopedHttp
      .get<DataIngestionRunListItem[]>(`${PREFIX}/runs`, {
        params: {
          status: params?.status,
          dataset_id: params?.datasetId,
          limit: params?.limit ?? 100,
        },
      })
      .then((r) => r.data),

  listRunsForSpace: (
    spaceId: string,
    params?: { status?: string; datasetId?: string; limit?: number },
  ) =>
    http
      .get<DataIngestionRunListItem[]>(`${PREFIX}/runs`, {
        headers: { "x-data-ingestion-space": spaceId },
        params: {
          status: params?.status,
          dataset_id: params?.datasetId,
          limit: params?.limit ?? 100,
        },
      })
      .then((r) => r.data),

  listRunsForSpacePage: (
    spaceId: string,
    params?: {
      page?: number;
      pageSize?: number;
      status?: string;
      datasetId?: string;
    },
  ) =>
    http
      .get<{
        items: DataIngestionRunListItem[];
        page: number;
        page_size: number;
        total: number;
      }>(`${PREFIX}/runs/page`, {
        headers: { "x-data-ingestion-space": spaceId },
        params: {
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 200,
          status: params?.status || undefined,
          dataset_id: params?.datasetId || undefined,
        },
      })
      .then((r) => r.data),

  async listAllRunsForSpace(spaceId: string, params?: { status?: string; datasetId?: string }) {
    const items: DataIngestionRunListItem[] = [];
    let page = 1;
    let total = 0;
    do {
      const result = await dataIngestionService.listRunsForSpacePage(spaceId, {
        ...params,
        page,
        pageSize: 200,
      });
      items.push(...result.items);
      total = result.total;
      if (!result.items.length) {
        break;
      }
      page += 1;
    } while (items.length < total);
    return items;
  },

  listDatasetsForSpace: (spaceId: string) =>
    http
      .get<DataIngestionDataset[]>(`${PREFIX}/datasets`, {
        headers: { "x-data-ingestion-space": spaceId },
      })
      .then((r) => r.data),

  getRunForSpace: (spaceId: string, runId: string) =>
    http
      .get<DataIngestionRun>(`${PREFIX}/runs/${encodeURIComponent(runId)}`, {
        headers: { "x-data-ingestion-space": spaceId },
      })
      .then((r) => r.data),

  deleteRun: (runId: string) => scopedHttp.delete(`${PREFIX}/runs/${encodeURIComponent(runId)}`),

  deleteRunForSpace: (spaceId: string, runId: string) =>
    http.delete(`${PREFIX}/runs/${encodeURIComponent(runId)}`, {
      headers: { "x-data-ingestion-space": spaceId },
    }),

  getRun: (runId: string) =>
    scopedHttp.get<DataIngestionRun>(`${PREFIX}/runs/${runId}`).then((r) => r.data),

  retryRun: (runId: string) =>
    scopedHttp.post<DataIngestionRun>(`${PREFIX}/runs/${runId}/retry`).then((r) => r.data),

  downloadRunAsset: (runId: string, filename: string) =>
    scopedHttp
      .get<Blob>(`${PREFIX}/runs/${runId}/asset`, { responseType: "blob" })
      .then((response) => {
        triggerBrowserDownload(response.data, sanitizeDownloadFilename(filename, `run-${runId}`));
      }),

  getRunAssetBlob: (runId: string) =>
    scopedHttp
      .get<Blob>(`${PREFIX}/runs/${encodeURIComponent(runId)}/asset`, { responseType: "blob" })
      .then((response) => response.data),

  getRunAssetPreview: (runId: string) =>
    scopedHttp
      .get<Blob>(`${PREFIX}/runs/${encodeURIComponent(runId)}/asset/preview`, {
        responseType: "blob",
      })
      .then((response) => response.data),

  listRecords: (datasetId: string, params?: { page?: number; pageSize?: number; query?: string }) =>
    scopedHttp
      .get<{
        total: number;
        page: number;
        page_size: number;
        items: DataIngestionDatasetRecord[];
      }>(`${PREFIX}/datasets/${datasetId}/records`, {
        params: {
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 20,
          q: params?.query || undefined,
        },
      })
      .then((r) => r.data),

  listScanJobs: () =>
    scopedHttp.get<DataIngestionAutoScanJob[]>(`${PREFIX}/auto-scan/jobs`).then((r) => r.data),

  createScanJob: (payload: Record<string, unknown>) =>
    scopedHttp
      .post<DataIngestionAutoScanJob>(`${PREFIX}/auto-scan/jobs`, payload)
      .then((r) => r.data),

  updateScanJob: (jobId: string, payload: Record<string, unknown>) =>
    scopedHttp
      .put<DataIngestionAutoScanJob>(`${PREFIX}/auto-scan/jobs/${jobId}`, payload)
      .then((r) => r.data),

  runScanJob: (jobId: string) =>
    scopedHttp
      .post<DataIngestionAutoScanJob>(`${PREFIX}/auto-scan/jobs/${jobId}/run?wait=false`)
      .then((r) => r.data),

  runSourceIngestion: async (payload: {
    datasetId: string;
    name: string;
    path?: string;
    scanType: string;
    sourceId: string;
    templateCode: string;
  }) => {
    const job = await scopedHttp
      .post<DataIngestionAutoScanJob>(`${PREFIX}/auto-scan/jobs`, {
        dataset_id: payload.datasetId,
        enabled: true,
        file_pattern: "*",
        interval_seconds: 86_400,
        name: payload.name,
        path: payload.path || "",
        recursive: true,
        scan_type: payload.scanType,
        source_id: payload.sourceId,
        template_code: payload.templateCode,
      })
      .then((response) => response.data);
    try {
      const completedJob = await scopedHttp
        .post<DataIngestionAutoScanJob>(
          `${PREFIX}/auto-scan/jobs/${job.id}/run?drain=${
            payload.scanType === "database" ? "false" : "true"
          }`,
        )
        .then((response) => response.data);
      const run = completedJob.last_run_id
        ? await scopedHttp
            .get<DataIngestionRun>(`${PREFIX}/runs/${encodeURIComponent(completedJob.last_run_id)}`)
            .then((response) => response.data)
        : null;
      return {
        job: completedJob,
        run,
        unchanged: completedJob.scan_state?.unchanged === true,
      };
    } finally {
      await scopedHttp
        .delete<{ deleted: boolean }>(`${PREFIX}/auto-scan/jobs/${job.id}`)
        .catch(() => undefined);
    }
  },

  deleteScanJob: (jobId: string) =>
    scopedHttp.delete<{ deleted: boolean }>(`${PREFIX}/auto-scan/jobs/${jobId}`),

  getAgentManifest: () =>
    scopedHttp.get<DataIngestionAgentManifest>(`${PREFIX}/agent/manifest`).then((r) => r.data),

  getAgentSkill: () =>
    scopedHttp.get<DataIngestionAgentSkill>(`${PREFIX}/agent/skill`).then((r) => r.data),

  listCustomMcpTools: () =>
    scopedHttp
      .get<DataIngestionCustomMcpTool[]>(`${PREFIX}/capabilities/mcp-tools`)
      .then((r) => r.data),

  createCustomMcpTool: (payload: {
    name: string;
    display_name: string;
    description: string;
    read_only: boolean;
    requires_approval: boolean;
    tool_type: "http";
    config: Record<string, unknown>;
    enabled: boolean;
  }) =>
    scopedHttp
      .post<DataIngestionCustomMcpTool>(`${PREFIX}/capabilities/mcp-tools`, payload)
      .then((r) => r.data),

  updateCustomMcpTool: (
    toolId: string,
    payload: Partial<{
      display_name: string;
      description: string;
      read_only: boolean;
      requires_approval: boolean;
      config: Record<string, unknown>;
      enabled: boolean;
    }>,
  ) =>
    scopedHttp
      .put<DataIngestionCustomMcpTool>(
        `${PREFIX}/capabilities/mcp-tools/${encodeURIComponent(toolId)}`,
        payload,
      )
      .then((r) => r.data),

  deleteCustomMcpTool: (toolId: string) =>
    scopedHttp.delete(`${PREFIX}/capabilities/mcp-tools/${encodeURIComponent(toolId)}`),

  listCustomSkills: () =>
    scopedHttp.get<DataIngestionCustomSkill[]>(`${PREFIX}/capabilities/skills`).then((r) => r.data),

  createCustomSkill: (payload: {
    name: string;
    display_name: string;
    description: string;
    content: string;
    enabled: boolean;
  }) =>
    scopedHttp
      .post<DataIngestionCustomSkill>(`${PREFIX}/capabilities/skills`, payload)
      .then((r) => r.data),

  updateCustomSkill: (
    skillId: string,
    payload: Partial<{
      display_name: string;
      description: string;
      content: string;
      enabled: boolean;
    }>,
  ) =>
    scopedHttp
      .put<DataIngestionCustomSkill>(
        `${PREFIX}/capabilities/skills/${encodeURIComponent(skillId)}`,
        payload,
      )
      .then((r) => r.data),

  deleteCustomSkill: (skillId: string) =>
    scopedHttp.delete(`${PREFIX}/capabilities/skills/${encodeURIComponent(skillId)}`),

  getAgentStatus: () =>
    scopedHttp.get<DataIngestionAgentStatus>(`${PREFIX}/agent/status`).then((r) => r.data),

  listAgentSessions: () =>
    scopedHttp.get<DataIngestionAgentSession[]>(`${PREFIX}/agent/sessions`).then((r) => r.data),

  createAgentSession: (title = "") =>
    scopedHttp
      .post<DataIngestionAgentSession>(`${PREFIX}/agent/sessions`, { title })
      .then((r) => r.data),

  getAgentSession: (sessionId: string) =>
    scopedHttp
      .get<DataIngestionAgentSessionDetail>(`${PREFIX}/agent/sessions/${sessionId}`)
      .then((r) => r.data),

  deleteAgentSession: (sessionId: string) =>
    scopedHttp.delete(`${PREFIX}/agent/sessions/${sessionId}`),

  sendAgentMessage: (sessionId: string, content: string) =>
    scopedHttp
      .post<DataIngestionAgentSessionDetail>(`${PREFIX}/agent/sessions/${sessionId}/messages`, {
        content,
      })
      .then((r) => r.data),

  streamAgentMessage: async (
    sessionId: string,
    content: string,
    onEvent: (event: DataIngestionAgentStreamEvent) => void,
  ) => {
    const response = await openAgentStream(`/agent/sessions/${sessionId}/messages/stream`, {
      body: JSON.stringify({ content }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return consumeAgentStream(response, onEvent);
  },

  sendAgentMessageWithAttachment: (sessionId: string, content: string, file: File) => {
    const body = new FormData();
    body.append("content", content);
    body.append("file", file);
    return scopedHttp
      .post<DataIngestionAgentSessionDetail>(
        `${PREFIX}/agent/sessions/${sessionId}/messages/attachment`,
        body,
      )
      .then((r) => r.data);
  },

  streamAgentMessageWithAttachment: async (
    sessionId: string,
    content: string,
    file: File,
    onEvent: (event: DataIngestionAgentStreamEvent) => void,
  ) => {
    const body = new FormData();
    body.append("content", content);
    body.append("file", file);
    const response = await openAgentStream(
      `/agent/sessions/${sessionId}/messages/attachment/stream`,
      {
        body,
        method: "POST",
      },
    );
    return consumeAgentStream(response, onEvent);
  },

  approveAgentTool: (sessionId: string, approvalId: string, reason: string) =>
    scopedHttp
      .post<DataIngestionAgentSessionDetail>(
        `${PREFIX}/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
        { reason },
      )
      .then((r) => r.data),

  streamApproveAgentTool: async (
    sessionId: string,
    approvalId: string,
    reason: string,
    onEvent: (event: DataIngestionAgentStreamEvent) => void,
  ) => {
    const response = await openAgentStream(
      `/agent/sessions/${sessionId}/approvals/${approvalId}/approve/stream`,
      {
        body: JSON.stringify({ reason }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return consumeAgentStream(response, onEvent);
  },

  rejectAgentTool: (sessionId: string, approvalId: string, reason: string) =>
    scopedHttp
      .post<DataIngestionAgentSessionDetail>(
        `${PREFIX}/agent/sessions/${sessionId}/approvals/${approvalId}/reject`,
        { reason },
      )
      .then((r) => r.data),

  streamRejectAgentTool: async (
    sessionId: string,
    approvalId: string,
    reason: string,
    onEvent: (event: DataIngestionAgentStreamEvent) => void,
  ) => {
    const response = await openAgentStream(
      `/agent/sessions/${sessionId}/approvals/${approvalId}/reject/stream`,
      {
        body: JSON.stringify({ reason }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    return consumeAgentStream(response, onEvent);
  },

  addAgentMemory: (sessionId: string, key: string, value: string) =>
    scopedHttp.post(`${PREFIX}/agent/sessions/${sessionId}/memories`, { key, value }),

  deleteAgentMemory: (sessionId: string, memoryId: string) =>
    scopedHttp.delete(`${PREFIX}/agent/sessions/${sessionId}/memories/${memoryId}`),
};
