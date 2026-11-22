/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import type { AxiosRequestConfig } from "axios";

import { http } from "@/framework/request/http";
import {
  sanitizeDownloadFilename,
  triggerBrowserDownload,
} from "@/framework/download/file-download";
import type {
  DataIngestionAgentManifest,
  DataIngestionAgentSession,
  DataIngestionAgentSessionDetail,
  DataIngestionAgentSkill,
  DataIngestionAgentStatus,
  DataIngestionAutoScanJob,
  DataIngestionDataSource,
  DataIngestionDataset,
  DataIngestionDatasetRecord,
  DataIngestionInspection,
  DataIngestionOverview,
  DataIngestionPipelineTemplate,
  DataIngestionRun,
  DataIngestionRunListItem,
  DataIngestionSpace,
  DataIngestionStorageInfo,
} from "@/modules/data-ingestion/types/data-ingestion";

const PREFIX = "/data-ingestion";
let activeDataSpaceId = "default";

export function setDataIngestionSpace(spaceId: string) {
  activeDataSpaceId = spaceId || "default";
}

function scopedConfig(config: AxiosRequestConfig = {}): AxiosRequestConfig {
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

export const dataIngestionService = {
  listDataSpaces: () => http.get<DataIngestionSpace[]>(`${PREFIX}/spaces`).then((r) => r.data),

  createDataSpace: (payload: { name: string; slug: string; database_url: string }) =>
    http.post<DataIngestionSpace>(`${PREFIX}/spaces`, payload).then((r) => r.data),

  testDataSpace: (spaceId: string) =>
    http
      .post<{ id: string; status: string; database_label: string }>(
        `${PREFIX}/spaces/${spaceId}/test`,
      )
      .then((r) => r.data),

  overview: () => scopedHttp.get<DataIngestionOverview>(`${PREFIX}/overview`).then((r) => r.data),

  listSources: () =>
    scopedHttp.get<DataIngestionDataSource[]>(`${PREFIX}/sources`).then((r) => r.data),

  createSource: (payload: { name: string; source_type: string; config: Record<string, unknown> }) =>
    scopedHttp.post<DataIngestionDataSource>(`${PREFIX}/sources`, payload).then((r) => r.data),

  testSource: (sourceId: string) =>
    scopedHttp
      .post<DataIngestionDataSource>(`${PREFIX}/sources/${sourceId}/test`)
      .then((r) => r.data),

  listDatasets: (q = "") =>
    scopedHttp
      .get<DataIngestionDataset[]>(`${PREFIX}/datasets`, {
        params: { q: q || undefined },
      })
      .then((r) => r.data),

  createDataset: (payload: { name: string; description: string; data_type: string }) => {
    const body = new FormData();
    body.append("name", payload.name);
    body.append("description", payload.description);
    body.append("data_type", payload.data_type);
    return scopedHttp.post<DataIngestionDataset>(`${PREFIX}/datasets`, body).then((r) => r.data);
  },

  listTemplates: () =>
    scopedHttp.get<DataIngestionPipelineTemplate[]>(`${PREFIX}/templates`).then((r) => r.data),

  getTemplate: (templateCode: string) =>
    scopedHttp
      .get<DataIngestionPipelineTemplate>(`${PREFIX}/templates/${encodeURIComponent(templateCode)}`)
      .then((r) => r.data),

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
      .post<DataIngestionAutoScanJob>(`${PREFIX}/auto-scan/jobs/${jobId}/run`)
      .then((r) => r.data),

  deleteScanJob: (jobId: string) =>
    scopedHttp.delete<{ deleted: boolean }>(`${PREFIX}/auto-scan/jobs/${jobId}`),

  getAgentManifest: () =>
    scopedHttp.get<DataIngestionAgentManifest>(`${PREFIX}/agent/manifest`).then((r) => r.data),

  getAgentSkill: () =>
    scopedHttp.get<DataIngestionAgentSkill>(`${PREFIX}/agent/skill`).then((r) => r.data),

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

  approveAgentTool: (sessionId: string, approvalId: string, reason: string) =>
    scopedHttp
      .post<DataIngestionAgentSessionDetail>(
        `${PREFIX}/agent/sessions/${sessionId}/approvals/${approvalId}/approve`,
        { reason },
      )
      .then((r) => r.data),

  rejectAgentTool: (sessionId: string, approvalId: string, reason: string) =>
    scopedHttp
      .post<DataIngestionAgentSessionDetail>(
        `${PREFIX}/agent/sessions/${sessionId}/approvals/${approvalId}/reject`,
        { reason },
      )
      .then((r) => r.data),

  addAgentMemory: (sessionId: string, key: string, value: string) =>
    scopedHttp.post(`${PREFIX}/agent/sessions/${sessionId}/memories`, { key, value }),

  deleteAgentMemory: (sessionId: string, memoryId: string) =>
    scopedHttp.delete(`${PREFIX}/agent/sessions/${sessionId}/memories/${memoryId}`),
};
