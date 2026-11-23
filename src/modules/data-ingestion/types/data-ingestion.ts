/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

export type DataIngestionView =
  "overview" | "import" | "pipelines" | "sources" | "runs" | "catalog" | "auto-scan" | "agent";

export type JsonObject = Record<string, unknown>;

export interface DataIngestionControlDatabaseStatus {
  configured: boolean;
  initialized: boolean;
  source: string;
  database_label: string;
  error: string;
  bootstrap_enabled: boolean;
}

export interface DataIngestionControlDatabaseRequest {
  database_url: string;
  create_database: boolean;
  bootstrap_database_url?: string;
}

export interface DataIngestionControlDatabaseTestResult {
  connected: boolean;
  database_exists: boolean;
  database_name: string;
  database_label: string;
}

export interface DataIngestionSpace {
  id: string;
  name: string;
  slug: string;
  database_label: string;
  is_default: boolean;
  status: string;
  last_error: string;
  created_at: string;
}

export interface DataIngestionDataSource {
  id: string;
  name: string;
  source_type: string;
  config: JsonObject;
  status: string;
  last_checked_at: string | null;
  created_at: string;
}

export interface DataIngestionDataset {
  id: string;
  name: string;
  slug: string;
  description: string;
  data_type: string;
  target_table: string;
  record_count: number;
  last_ingested_at: string | null;
  created_at: string;
}

export interface DataIngestionStage {
  id: string;
  sequence: number;
  stage_key: string;
  name: string;
  status: string;
  input_count: number;
  output_count: number;
  duration_ms: number;
  summary: JsonObject;
  logs: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface DataIngestionPipelineTemplate {
  id: string;
  code: string;
  name: string;
  description: string;
  supported_types: string[];
  steps: Array<{
    key: string;
    name: string;
    kind: string;
    description: string;
    input: string;
    output: string;
    implementation: string;
    parameters: JsonObject;
    artifact: string;
    retryable: boolean;
  }>;
  enabled: boolean;
}

export interface DataIngestionRun {
  id: string;
  dataset_id: string;
  source_id: string | null;
  template_code: string;
  status: string;
  original_name: string;
  file_type: string;
  media_type: string;
  file_size: number;
  fingerprint: string;
  fetched_count: number;
  inserted_count: number;
  duplicate_count: number;
  error_count: number;
  error_message: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  stages: DataIngestionStage[];
}

export type DataIngestionRunListItem = Omit<
  DataIngestionRun,
  "media_type" | "fingerprint" | "stages"
>;

export interface DataIngestionDatasetRecord {
  id: string;
  dataset_id: string;
  run_id: string;
  data_type: string;
  payload: JsonObject;
  asset_path: string;
  created_at: string;
}

export interface DataIngestionSheetPreview {
  name: string;
  index: number;
  state: string;
  is_active: boolean;
  columns: string[];
  rows: JsonObject[];
  metadata: JsonObject;
  warnings: string[];
}

export interface DataIngestionInspection {
  filename: string;
  file_type: string;
  media_type: string;
  size: number;
  recommended_pipeline: string;
  preview_type: string;
  columns: string[];
  rows: JsonObject[];
  metadata: JsonObject;
  warnings: string[];
  sheets: DataIngestionSheetPreview[];
}

export interface DataIngestionOverview {
  datasets: number;
  records: number;
  runs: number;
  success_runs: number;
  active_runs: number;
  success_rate: number;
  recent_runs: DataIngestionRunListItem[];
}

export interface DataIngestionStorageInfo {
  backend: string;
  space_id?: string;
  space_name?: string;
  root?: string;
  endpoint?: string;
  bucket?: string;
  prefix?: string;
  database_backend: string;
  database_label?: string;
  raw_storage: string;
  artifact_storage: string;
}

export interface DataIngestionAutoScanJob {
  id: string;
  name: string;
  source_id: string;
  source_name: string;
  source_type: string;
  dataset_id: string;
  dataset_name: string;
  template_code: string;
  scan_type: string;
  path: string;
  recursive: boolean;
  file_pattern: string;
  interval_seconds: number;
  schedule_type: string;
  schedule_time: string;
  weekdays: number[];
  cron_expression: string;
  timezone: string;
  enabled: boolean;
  status: string;
  last_scan_at: string | null;
  next_scan_at: string | null;
  last_error: string;
  last_run_id: string | null;
  processed_count: number;
  scan_state: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface DataIngestionAgentStatus {
  configured: boolean;
  managed_by: string;
  default_model_id: string;
  default_model_name: string;
  error?: string;
}

export interface DataIngestionAgentManifest {
  id: string;
  name: string;
  description: string;
  preset: JsonObject;
  mcp: JsonObject;
  skill: JsonObject;
  dsh: JsonObject;
  permissions: JsonObject;
  workflow: string[];
  tools: Array<{
    name: string;
    display_name: string;
    description: string;
    read_only: boolean;
    requires_approval: boolean;
    qualifiedName: string;
  }>;
}

export interface DataIngestionAgentSkill {
  name: string;
  path: string;
  content: string;
  loaded: boolean;
}

export interface DataIngestionAgentSession {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DataIngestionAgentMessage {
  id: string;
  role: string;
  content: string;
  tool_calls: JsonObject[];
  tool_call_id: string;
  name: string;
  created_at: string;
}

export interface DataIngestionAgentApproval {
  id: string;
  session_id: string;
  message_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments: JsonObject;
  status: string;
  reason: string;
  result: JsonObject;
  created_at: string;
  resolved_at: string | null;
}

export interface DataIngestionAgentMemory {
  id: string;
  memory_key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface DataIngestionAgentSessionDetail extends DataIngestionAgentSession {
  messages: DataIngestionAgentMessage[];
  approvals: DataIngestionAgentApproval[];
  memories: DataIngestionAgentMemory[];
}
