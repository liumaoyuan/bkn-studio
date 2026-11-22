/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import { dataIngestionNavigation } from "@/modules/data-ingestion/navigation";
import { dataIngestionRoutes } from "@/modules/data-ingestion/routes";
import { dataIngestionModuleManifest } from "@/modules/data-ingestion/module.manifest";

describe("data-ingestion module registration", () => {
  it("registers all workbench views and run details", () => {
    expect(dataIngestionRoutes.map((route) => route.path)).toEqual([
      "data-ingestion",
      "data-ingestion/import",
      "data-ingestion/pipelines",
      "data-ingestion/sources",
      "data-ingestion/runs",
      "data-ingestion/runs/:runId",
      "data-ingestion/catalog",
      "data-ingestion/auto-scan",
      "data-ingestion/agent",
    ]);
  });

  it("adds one navigation entry under the data group", () => {
    expect(dataIngestionNavigation.parentKey).toBe("general-business-knowledge-network");
    expect(dataIngestionNavigation.items).toHaveLength(1);
    expect(dataIngestionNavigation.items[0].permission).toBe("data_ingestion:view");
  });

  it("declares the same permission points used by navigation and controls", () => {
    expect(dataIngestionModuleManifest.permissions).toEqual(
      expect.arrayContaining([
        "data_ingestion:view",
        "data_ingestion:create",
        "data_ingestion:modify",
        "data_ingestion:delete",
        "data_ingestion:task_manage",
        "data_ingestion:agent_use",
        "data_ingestion:mcp_execute",
      ]),
    );
  });
});
