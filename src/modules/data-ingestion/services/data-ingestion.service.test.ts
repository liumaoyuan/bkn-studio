/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/framework/request/http", () => ({ http }));

import {
  dataIngestionService,
  setDataIngestionSpace,
} from "@/modules/data-ingestion/services/data-ingestion.service";

describe("data-ingestion service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDataIngestionSpace("default");
    http.get.mockResolvedValue({ data: [] });
    http.post.mockResolvedValue({ data: {} });
    http.put.mockResolvedValue({ data: {} });
    http.delete.mockResolvedValue({ data: {} });
  });

  it("uses the dedicated gateway prefix", async () => {
    await dataIngestionService.listDatasets("marine");

    expect(http.get).toHaveBeenCalledWith("/data-ingestion/datasets", {
      headers: { "x-data-ingestion-space": "default" },
      params: { q: "marine" },
    });
  });

  it("uploads files as multipart form data without overriding auth headers", async () => {
    const file = new File(["a,b\n1,2"], "sample.csv", { type: "text/csv" });

    await dataIngestionService.createRun({
      file,
      datasetId: "dataset-1",
      templateCode: "tabular_standard",
    });

    const [path, body] = http.post.mock.calls[0] as [string, FormData];
    expect(path).toBe("/data-ingestion/runs");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("dataset_id")).toBe("dataset-1");
    expect(body.get("template_code")).toBe("tabular_standard");
  });

  it("reads the Agent status from the platform model integration", async () => {
    await dataIngestionService.getAgentStatus();

    expect(http.get).toHaveBeenCalledWith("/data-ingestion/agent/status", {
      headers: { "x-data-ingestion-space": "default" },
    });
  });

  it("routes scoped requests to the selected data space", async () => {
    setDataIngestionSpace("marine");

    await dataIngestionService.getAgentStatus();

    expect(http.get).toHaveBeenCalledWith("/data-ingestion/agent/status", {
      headers: { "x-data-ingestion-space": "marine" },
    });
  });
});
