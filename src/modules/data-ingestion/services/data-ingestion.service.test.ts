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

  it("checks and initializes the control database without a data space", async () => {
    await dataIngestionService.getControlDatabaseStatus();
    await dataIngestionService.testControlDatabase({
      database_url: "mysql+pymysql://user:secret@db:3306/data_ingestion",
      create_database: true,
    });
    await dataIngestionService.configureControlDatabase({
      database_url: "mysql+pymysql://user:secret@db:3306/data_ingestion",
      create_database: true,
      bootstrap_database_url: "mysql+pymysql://admin:secret@db:3306/mysql",
    });

    expect(http.get).toHaveBeenNthCalledWith(1, "/data-ingestion/bootstrap/status");
    expect(http.post).toHaveBeenNthCalledWith(1, "/data-ingestion/bootstrap/test", {
      database_url: "mysql+pymysql://user:secret@db:3306/data_ingestion",
      create_database: true,
    });
    expect(http.post).toHaveBeenNthCalledWith(2, "/data-ingestion/bootstrap/control-database", {
      database_url: "mysql+pymysql://user:secret@db:3306/data_ingestion",
      create_database: true,
      bootstrap_database_url: "mysql+pymysql://admin:secret@db:3306/mysql",
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

  it("updates an existing data source in the selected space", async () => {
    await dataIngestionService.updateSource("source-1", {
      name: "Edited source",
      source_type: "api",
      config: { url: "https://api.example.test/data" },
    });

    expect(http.put).toHaveBeenCalledWith(
      "/data-ingestion/sources/source-1",
      {
        name: "Edited source",
        source_type: "api",
        config: { url: "https://api.example.test/data" },
      },
      {
        headers: { "x-data-ingestion-space": "default" },
      },
    );
  });

  it("lists and deletes persisted user pipeline executions", async () => {
    await dataIngestionService.listPipelineExecutions();
    await dataIngestionService.deletePipelineExecution("execution-1");

    expect(http.get).toHaveBeenCalledWith("/data-ingestion/capabilities/pipeline-executions", {
      headers: { "x-data-ingestion-space": "default" },
      params: { limit: 200 },
    });
    expect(http.delete).toHaveBeenCalledWith(
      "/data-ingestion/capabilities/pipeline-executions/execution-1",
      { headers: { "x-data-ingestion-space": "default" } },
    );
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

  it("rejects scoped requests when no data space is selected", () => {
    setDataIngestionSpace("");

    expect(() => dataIngestionService.overview()).toThrow("请选择数据空间");
    expect(http.get).not.toHaveBeenCalled();
  });
});
