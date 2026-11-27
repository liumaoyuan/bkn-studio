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

  it("sends an Agent attachment together with the user message", async () => {
    const file = new File(["name,amount\nbooks,20"], "orders.csv", { type: "text/csv" });

    await dataIngestionService.sendAgentMessageWithAttachment(
      "session-1",
      "请入库到订单数据集",
      file,
    );

    const [path, body] = http.post.mock.calls[0] as [string, FormData];
    expect(path).toBe("/data-ingestion/agent/sessions/session-1/messages/attachment");
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("content")).toBe("请入库到订单数据集");
    expect(body.get("file")).toBe(file);
  });

  it("runs a configured data source once without leaving a scan plan behind", async () => {
    const completedJob = {
      id: "job-1",
      last_error: "",
      last_run_id: "run-1",
    };
    const run = { id: "run-1", status: "success" };
    http.post
      .mockResolvedValueOnce({ data: { id: "job-1" } })
      .mockResolvedValueOnce({ data: completedJob });
    http.get.mockResolvedValueOnce({ data: run });

    await expect(
      dataIngestionService.runSourceIngestion({
        datasetId: "dataset-1",
        name: "Manual ingestion",
        path: "/data/imports",
        scanType: "local",
        sourceId: "source-1",
        templateCode: "tabular_standard",
      }),
    ).resolves.toEqual({ job: completedJob, run, unchanged: false });

    expect(http.post).toHaveBeenNthCalledWith(
      1,
      "/data-ingestion/auto-scan/jobs",
      {
        dataset_id: "dataset-1",
        enabled: true,
        file_pattern: "*",
        interval_seconds: 86_400,
        name: "Manual ingestion",
        path: "/data/imports",
        recursive: true,
        scan_type: "local",
        source_id: "source-1",
        template_code: "tabular_standard",
      },
      { headers: { "x-data-ingestion-space": "default" } },
    );
    expect(http.post).toHaveBeenNthCalledWith(
      2,
      "/data-ingestion/auto-scan/jobs/job-1/run?drain=true",
      undefined,
      { headers: { "x-data-ingestion-space": "default" } },
    );
    expect(http.get).toHaveBeenCalledWith("/data-ingestion/runs/run-1", {
      headers: { "x-data-ingestion-space": "default" },
    });
    expect(http.delete).toHaveBeenCalledWith("/data-ingestion/auto-scan/jobs/job-1", {
      headers: { "x-data-ingestion-space": "default" },
    });
  });

  it("reports an unchanged database table without creating another run", async () => {
    const completedJob = {
      id: "job-db",
      last_error: "",
      last_run_id: null,
      scan_state: { unchanged: true },
    };
    http.post
      .mockResolvedValueOnce({ data: { id: "job-db" } })
      .mockResolvedValueOnce({ data: completedJob });

    await expect(
      dataIngestionService.runSourceIngestion({
        datasetId: "dataset-1",
        name: "Database ingestion",
        scanType: "database",
        sourceId: "source-db",
        templateCode: "tabular_standard",
      }),
    ).resolves.toEqual({ job: completedJob, run: null, unchanged: true });

    expect(http.post).toHaveBeenNthCalledWith(
      2,
      "/data-ingestion/auto-scan/jobs/job-db/run?drain=false",
      undefined,
      { headers: { "x-data-ingestion-space": "default" } },
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it("starts an auto-scan without waiting for completion", async () => {
    http.post.mockResolvedValueOnce({
      data: { id: "job-1", status: "queued" },
    });

    await dataIngestionService.runScanJob("job-1");

    expect(http.post).toHaveBeenCalledWith(
      "/data-ingestion/auto-scan/jobs/job-1/run?wait=false",
      undefined,
      { headers: { "x-data-ingestion-space": "default" } },
    );
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

  it("reads database tables and columns for the simple source wizard", async () => {
    await dataIngestionService.inspectSourceDatabase({
      source_type: "mysql",
      table_name: "orders",
      config: { host: "db", database: "sales" },
    });

    expect(http.post).toHaveBeenCalledWith(
      "/data-ingestion/sources/database-catalog",
      {
        source_type: "mysql",
        table_name: "orders",
        config: { host: "db", database: "sales" },
      },
      {
        headers: { "x-data-ingestion-space": "default" },
      },
    );
  });

  it("reads and publishes the dataset delivery contract", async () => {
    await dataIngestionService.getDatasetContract("dataset-1", 100);
    await dataIngestionService.publishDataset("dataset-1");

    expect(http.get).toHaveBeenCalledWith("/data-ingestion/datasets/dataset-1/contract", {
      headers: { "x-data-ingestion-space": "default" },
      params: { sample_size: 100 },
    });
    expect(http.post).toHaveBeenCalledWith(
      "/data-ingestion/datasets/dataset-1/publish",
      undefined,
      {
        headers: { "x-data-ingestion-space": "default" },
      },
    );
  });

  it("starts full quality checks and backfills provenance", async () => {
    await dataIngestionService.startFullDatasetQualityCheck("dataset-1");
    await dataIngestionService.getLatestFullDatasetQualityCheck("dataset-1");
    await dataIngestionService.backfillDatasetProvenance("dataset-1");

    expect(http.post).toHaveBeenNthCalledWith(
      1,
      "/data-ingestion/datasets/dataset-1/quality-checks",
      undefined,
      { headers: { "x-data-ingestion-space": "default" } },
    );
    expect(http.get).toHaveBeenCalledWith(
      "/data-ingestion/datasets/dataset-1/quality-checks/latest",
      { headers: { "x-data-ingestion-space": "default" } },
    );
    expect(http.post).toHaveBeenNthCalledWith(
      2,
      "/data-ingestion/datasets/dataset-1/provenance/backfill",
      undefined,
      { headers: { "x-data-ingestion-space": "default" } },
    );
  });

  it("loads original assets and browser-safe image previews", async () => {
    const original = new Blob(["original"], { type: "application/pdf" });
    const preview = new Blob(["preview"], { type: "image/jpeg" });
    http.get.mockResolvedValueOnce({ data: original }).mockResolvedValueOnce({ data: preview });

    await expect(dataIngestionService.getRunAssetBlob("run-1")).resolves.toBe(original);
    await expect(dataIngestionService.getRunAssetPreview("run-1")).resolves.toBe(preview);

    expect(http.get).toHaveBeenNthCalledWith(1, "/data-ingestion/runs/run-1/asset", {
      headers: { "x-data-ingestion-space": "default" },
      responseType: "blob",
    });
    expect(http.get).toHaveBeenNthCalledWith(2, "/data-ingestion/runs/run-1/asset/preview", {
      headers: { "x-data-ingestion-space": "default" },
      responseType: "blob",
    });
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
