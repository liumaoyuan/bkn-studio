/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

export const dataIngestionModuleManifest = {
  id: "data-ingestion",
  name: "Data Ingestion",
  permissions: [
    "data_ingestion:view",
    "data_ingestion:create",
    "data_ingestion:modify",
    "data_ingestion:delete",
    "data_ingestion:task_manage",
    "data_ingestion:agent_use",
    "data_ingestion:mcp_execute",
  ],
  requiresShell: true,
  supportsEmbedded: true,
  supportsReadOnly: false,
  services: [
    "data-ingestion/bootstrap",
    "data-ingestion/spaces",
    "data-ingestion/overview",
    "data-ingestion/sources",
    "data-ingestion/datasets",
    "data-ingestion/templates",
    "data-ingestion/capabilities",
    "data-ingestion/uploads",
    "data-ingestion/runs",
    "data-ingestion/auto-scan",
    "data-ingestion/agent",
  ],
  scenes: [
    {
      id: "data-ingestion.workbench",
      exportName: "DataIngestionWorkbenchScene",
      description:
        "Multi-source file ingestion, staged processing, scheduled scans, catalog browsing, Agent, and MCP.",
      inputs: ["activeView", "onViewChange", "onOpenRun?"],
    },
  ],
} as const;
