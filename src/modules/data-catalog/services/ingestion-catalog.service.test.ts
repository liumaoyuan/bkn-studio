/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getIngestionCatalogResources,
  listIngestionCatalogResources,
  previewIngestionCatalogResource,
} from "@/modules/data-catalog/services/ingestion-catalog.service";

const httpGetMock = vi.hoisted(() => vi.fn());

vi.mock("@/framework/request/http", () => ({
  http: {
    get: httpGetMock,
  },
}));

const dataset = {
  created_at: "2026-11-23T08:00:00Z",
  data_type: "tabular",
  description: "Imported marine observations",
  id: "dataset-1",
  last_ingested_at: "2026-11-23T09:00:00Z",
  name: "Marine observations",
  record_count: 12,
  slug: "marine-observations",
  target_table: "marine_observations",
};

describe("ingestion catalog adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpGetMock.mockImplementation((url: string) => {
      if (url === "/data-ingestion/bootstrap/status") {
        return Promise.resolve({
          data: {
            configured: true,
            database_label: "mysql://db:3306/bkn",
          },
        });
      }
      if (url === "/data-ingestion/spaces") {
        return Promise.resolve({
          data: [{ id: "default", name: "Default data space" }],
        });
      }
      if (url === "/data-ingestion/datasets") {
        return Promise.resolve({ data: [dataset] });
      }
      if (url === "/data-ingestion/datasets/dataset-1/schema") {
        return Promise.resolve({
          data: {
            fields: [
              { data_type: "string", name: "station", nullable: false },
              { data_type: "number", name: "temperature", nullable: true },
            ],
          },
        });
      }
      if (url === "/data-ingestion/datasets/dataset-1/records") {
        return Promise.resolve({
          data: {
            items: [{ payload: { station: "A1", temperature: 22.4 } }],
            total: 12,
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
  });

  it("maps ingestion datasets into the unified catalog resource shape", async () => {
    const result = await listIngestionCatalogResources({
      catalogId: "data-ingestion",
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      catalogId: "data-ingestion",
      category: "dataset",
      id: "data-ingestion:dataset:default:dataset-1",
      name: "Marine observations",
      rowCount: 12,
    });
  });

  it("hydrates the dataset schema for the resource detail page", async () => {
    const resources = await getIngestionCatalogResources([
      "data-ingestion:dataset:default:dataset-1",
    ]);

    expect(resources).toHaveLength(1);
    expect(resources[0]?.columnCount).toBe(2);
    expect(resources[0]?.schema).toEqual([
      { name: "station", type: "string" },
      { name: "temperature", type: "number" },
    ]);
  });

  it("uses ingestion records for the unified data preview", async () => {
    const result = await previewIngestionCatalogResource(
      "data-ingestion:dataset:default:dataset-1",
      { limit: 20, offset: 0 },
    );

    expect(result).toEqual({
      querySource: "source",
      rows: [{ station: "A1", temperature: 22.4 }],
      total: 12,
    });
  });
});
