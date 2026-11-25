/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { getStoredAccessToken } from "@/framework/auth/token-store";

const SPACES_PATH = "/api/copilot/data/spaces";
const DATASETS_PATH = "/api/copilot/data/datasets";
const PREVIEW_PATH = "/api/copilot/data/preview";
const IMPORT_PATH = "/api/copilot/data/import";

function withAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = getStoredAccessToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: withAuthHeaders() });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const rawError =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
    const fallback = /^\s*</.test(text)
      ? `服务暂时不可用（HTTP ${response.status}），请稍后重试`
      : text.slice(0, 200);
    const message = typeof rawError === "string" ? rawError : fallback;
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export type DataImportSpace = {
  id: string;
  name: string;
  databaseLabel: string;
  isDefault: boolean;
};

export type DataImportDataset = {
  id: string;
  name: string;
  dataType: string;
  description: string;
  recordCount: number;
  targetTable: string;
  lastIngestedAt?: string;
};

export type DataImportFieldType = "string" | "number" | "boolean" | "datetime";

export type DataImportFieldMapping = {
  sourceColumn: string;
  propertyName: string;
  type: DataImportFieldType;
};

export type DataImportObjectMapping = {
  objectTypeId: string;
  objectTypeName: string;
  primaryKeyColumn?: string;
  fields: DataImportFieldMapping[];
};

export type DataImportMapping = {
  objects: DataImportObjectMapping[];
};

export type DataImportObjectType = {
  id: string;
  name: string;
  properties: Array<{ name: string; displayName: string; type: string }>;
};

export type DataImportStats = {
  rows: number;
  documents: number;
  skipped: number;
  issueCount: number;
  byObjectType?: Record<string, number>;
  skippedReasons?: Record<string, number>;
};

export type DataImportIssue = { row: number; field?: string; message: string };

export type DataImportSourceKind = "file" | "dataset" | "table";

export type DataImportWriteMode = "replace" | "upsert";

export type DataImportWriteOptions = {
  writeMode?: DataImportWriteMode;
  watermarkField?: string;
  watermarkValue?: string;
};

export type DataImportLastImport = {
  finishedAt: string;
  writeMode?: DataImportWriteMode;
  watermark?: { field: string; value?: string };
};

export type DataImportPreview = {
  dataset: DataImportDataset;
  mapping: DataImportMapping;
  objectTypes: DataImportObjectType[];
  warnings: string[];
  stats: DataImportStats;
  documents: Record<string, Array<Record<string, unknown>>>;
  issues: DataImportIssue[];
  watermarkCandidates?: string[];
  lastImport?: DataImportLastImport;
};

export type DataImportObjectReport = {
  objectTypeId: string;
  objectTypeName: string;
  written: number;
  failed: number;
  bound: boolean;
  resourceId?: string;
  resourceName?: string;
  watermark?: string;
  error?: string;
};

export type DataImportRelationReport = {
  relationTypeId: string;
  relationTypeName: string;
  sourceObjectTypeId: string;
  targetObjectTypeId: string;
  edgeCount: number;
  samples: Array<{ sourceId: string; targetId: string }>;
  note?: string;
};

export type DataImportReport = {
  ok: boolean;
  networkId: string;
  datasetId: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  objects: DataImportObjectReport[];
  relations?: DataImportRelationReport[];
  issues: DataImportIssue[];
  writeMode?: DataImportWriteMode;
  watermark?: { field: string; value?: string };
  sourceLabel?: string;
  routing?: {
    total: number;
    assigned: number;
    skipped: number;
    byObjectType: Record<string, number>;
    skippedReasons?: Record<string, number>;
    deduped?: number;
  };
  error?: string;
};

export async function listDataImportSpaces(): Promise<DataImportSpace[]> {
  const payload = await requestJson<{ ok: boolean; spaces?: DataImportSpace[] }>(SPACES_PATH, {
    method: "GET",
  });
  return payload.spaces ?? [];
}

export async function listDataImportDatasets(spaceId: string): Promise<DataImportDataset[]> {
  const payload = await requestJson<{ ok: boolean; datasets?: DataImportDataset[] }>(
    `${DATASETS_PATH}?spaceId=${encodeURIComponent(spaceId)}`,
    { method: "GET" },
  );
  return payload.datasets ?? [];
}

export async function previewDataImport(input: {
  spaceId: string;
  datasetId: string;
  networkId: string;
  mapping?: DataImportMapping;
}): Promise<DataImportPreview> {
  const payload = await requestJson<{ ok: boolean } & DataImportPreview>(PREVIEW_PATH, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return payload;
}

function withAuthOnly(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getStoredAccessToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestMultipart<T>(url: string, form: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: withAuthOnly(), body: form });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const rawError =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
    const fallback = /^\s*</.test(text)
      ? `服务暂时不可用（HTTP ${response.status}），请稍后重试`
      : text.slice(0, 200);
    const message = typeof rawError === "string" ? rawError : fallback;
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export type DataImportFilePreview = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: number;
  sampleRows: Array<Record<string, unknown>>;
  mapping: DataImportMapping;
  objectTypes: DataImportObjectType[];
  warnings: string[];
  stats: DataImportStats;
  documents: Record<string, Array<Record<string, unknown>>>;
  issues: DataImportIssue[];
  watermarkCandidates?: string[];
  lastImport?: DataImportLastImport;
};

export async function previewDataFile(input: {
  file: File;
  networkId: string;
}): Promise<DataImportFilePreview> {
  const form = new FormData();
  form.append("networkId", input.networkId);
  form.append("file", input.file, input.file.name);
  const payload = await requestMultipart<{ ok: boolean } & DataImportFilePreview>(
    "/api/copilot/data/file/preview",
    form,
  );
  return payload;
}

export async function runDataFileImport(input: {
  file: File;
  networkId: string;
  mapping: DataImportMapping;
  options?: DataImportWriteOptions;
}): Promise<DataImportReport> {
  const form = new FormData();
  form.append("networkId", input.networkId);
  form.append("mapping", JSON.stringify(input.mapping));
  if (input.options?.writeMode) form.append("writeMode", input.options.writeMode);
  if (input.options?.watermarkField) form.append("watermarkField", input.options.watermarkField);
  if (input.options?.watermarkValue) form.append("watermarkValue", input.options.watermarkValue);
  form.append("file", input.file, input.file.name);
  const payload = await requestMultipart<{ ok: boolean; report: DataImportReport }>(
    "/api/copilot/data/file/import",
    form,
  );
  return payload.report;
}

export async function runDataImport(input: {
  spaceId: string;
  datasetId: string;
  networkId: string;
  mapping: DataImportMapping;
  options?: DataImportWriteOptions;
}): Promise<DataImportReport> {
  const payload = await requestJson<{ ok: boolean; report: DataImportReport }>(IMPORT_PATH, {
    method: "POST",
    body: JSON.stringify({
      spaceId: input.spaceId,
      datasetId: input.datasetId,
      networkId: input.networkId,
      mapping: input.mapping,
      ...(input.options ?? {}),
    }),
  });
  return payload.report;
}

const RELATION_MAPPINGS_PATH = "/api/copilot/data/relation-mappings";
const RELATION_MAPPING_PATH = "/api/copilot/data/relation-mapping";

export type DataImportRelationMapping = {
  id: string;
  name: string;
  type?: string;
  sourceObjectTypeId: string;
  targetObjectTypeId: string;
  sourceProperty: string;
  targetProperty: string;
};

export async function listDataImportRelationMappings(
  networkId: string,
): Promise<DataImportRelationMapping[]> {
  const payload = await requestJson<{ ok: boolean; items?: DataImportRelationMapping[] }>(
    `${RELATION_MAPPINGS_PATH}?networkId=${encodeURIComponent(networkId)}`,
    { method: "GET" },
  );
  return payload.items ?? [];
}

export async function saveDataImportRelationMapping(input: {
  networkId: string;
  relationTypeId: string;
  sourceProperty: string;
  targetProperty: string;
}): Promise<DataImportRelationMapping> {
  const payload = await requestJson<{ ok: boolean; item: DataImportRelationMapping }>(
    RELATION_MAPPING_PATH,
    { method: "POST", body: JSON.stringify(input) },
  );
  return payload.item;
}

export type DataImportConnection = {
  id: string;
  name: string;
  connectorType: string;
  database?: string;
};

export type DataImportTable = {
  id: string;
  name: string;
  category: string;
  sourceIdentifier: string;
  fields: string[];
};

export async function listDataImportConnections(): Promise<
  { ok: true; connections: DataImportConnection[] } | { ok: false; error: string }
> {
  try {
    const payload = await requestJson<{
      ok: boolean;
      connections?: DataImportConnection[];
      error?: string;
    }>("/api/copilot/data/connections", { method: "GET", headers: withAuthOnly() });
    return { ok: true, connections: payload.connections ?? [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "连接列表获取失败" };
  }
}

export async function listDataImportTables(
  catalogId: string,
): Promise<{ ok: true; tables: DataImportTable[] } | { ok: false; error: string }> {
  try {
    const payload = await requestJson<{ ok: boolean; tables?: DataImportTable[]; error?: string }>(
      `/api/copilot/data/connections/${encodeURIComponent(catalogId)}/tables`,
      { method: "GET", headers: withAuthOnly() },
    );
    return { ok: true, tables: payload.tables ?? [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "表列表获取失败" };
  }
}

export type DataImportConnectionPreview = DataImportPreview & {
  tableName: string;
  rows: number;
};

export async function previewDataConnection(input: {
  networkId: string;
  catalogId: string;
  resourceId: string;
  tableName: string;
}): Promise<DataImportConnectionPreview> {
  const payload = await requestJson<{ ok: boolean } & DataImportConnectionPreview>(
    "/api/copilot/data/connection/preview",
    {
      method: "POST",
      headers: { ...withAuthOnly(), "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return payload;
}

export async function runDataConnectionImport(input: {
  networkId: string;
  catalogId: string;
  resourceId: string;
  tableName: string;
  mapping: DataImportMapping;
  options?: DataImportWriteOptions;
}): Promise<DataImportReport> {
  const payload = await requestJson<{ ok: boolean; report: DataImportReport }>(
    "/api/copilot/data/connection/import",
    {
      method: "POST",
      headers: { ...withAuthOnly(), "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return payload.report;
}

export type DataProvenanceField = {
  propertyName: string;
  sourceColumn?: string;
  type?: string;
  mapped?: boolean;
};

export type DataProvenanceObject = {
  objectTypeId: string;
  objectTypeName: string;
  resourceId?: string;
  resourceName?: string;
  bound: boolean;
  sourceLabel?: string;
  sourceKind?: DataImportSourceKind;
  sourceName?: string;
  importedAt?: string;
  writeMode?: DataImportWriteMode;
  written?: number;
  fields: DataProvenanceField[];
};

export type DataProvenanceBatch = {
  sourceLabel: string;
  sourceKind?: DataImportSourceKind;
  sourceName?: string;
  writeMode?: DataImportWriteMode;
  finishedAt?: string;
  elapsedMs?: number;
  written: number;
  failed: number;
  objects: Array<{ objectTypeName: string; written: number; failed: number }>;
  relations: Array<{ relationTypeName: string; edgeCount: number }>;
};

export type DataProvenanceRelation = {
  relationTypeId: string;
  relationTypeName: string;
  sourceObjectTypeId?: string;
  targetObjectTypeId?: string;
  sourceProperty?: string;
  targetProperty?: string;
  edgeCount?: number;
};

export type DataProvenance = {
  networkId: string;
  generatedAt: string;
  objects: DataProvenanceObject[];
  batches: DataProvenanceBatch[];
  relations: DataProvenanceRelation[];
};

export async function getDataProvenance(networkId: string): Promise<DataProvenance> {
  const payload = await requestJson<{ ok: boolean; provenance: DataProvenance }>(
    `/api/copilot/data/provenance?networkId=${encodeURIComponent(networkId)}`,
    { headers: withAuthOnly() },
  );
  return payload.provenance;
}
