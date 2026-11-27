/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunForSpace: vi.fn(),
  listAllPipelineExecutionsForSpace: vi.fn(),
  listAllRunsForSpace: vi.fn(),
  listDataSpaces: vi.fn(),
  listDatasetsForSpace: vi.fn(),
  listPipelineExecutionsForSpacePage: vi.fn(),
  listRunsForSpacePage: vi.fn(),
  services: {
    message: {
      error: vi.fn(),
      success: vi.fn(),
    },
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/framework/context/use-app-services", () => ({
  useAppServices: () => mocks.services,
}));

vi.mock("@/modules/data-ingestion/services/data-ingestion.service", () => ({
  dataIngestionService: {
    getRunForSpace: mocks.getRunForSpace,
    listAllPipelineExecutionsForSpace: mocks.listAllPipelineExecutionsForSpace,
    listAllRunsForSpace: mocks.listAllRunsForSpace,
    listDataSpaces: mocks.listDataSpaces,
    listDatasetsForSpace: mocks.listDatasetsForSpace,
    listPipelineExecutionsForSpacePage: mocks.listPipelineExecutionsForSpacePage,
    listRunsForSpacePage: mocks.listRunsForSpacePage,
  },
}));

import { IngestionRunTaskPanel } from "./IngestionRunTaskPanel";

function run(status: string) {
  return {
    id: "run-1",
    dataset_id: "dataset-1",
    source_id: null,
    template_code: "tabular_standard",
    status,
    original_name: "data.csv",
    file_type: "csv",
    file_size: 10,
    fetched_count: 1,
    inserted_count: status === "success" ? 1 : 0,
    updated_count: 0,
    duplicate_count: 0,
    error_count: 0,
    error_message: "",
    started_at: null,
    finished_at: status === "success" ? "2026-11-24T00:00:01Z" : null,
    created_at: "2026-11-24T00:00:00Z",
  };
}

describe("IngestionRunTaskPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    mocks.listDataSpaces.mockResolvedValue([
      {
        id: "space-1",
        name: "main",
        slug: "main",
        database_label: "MariaDB",
        is_default: true,
        status: "ready",
        last_error: "",
        created_at: "2026-11-24T00:00:00Z",
      },
    ]);
    mocks.listDatasetsForSpace.mockResolvedValue([{ id: "dataset-1", name: "dataset" }]);
    mocks.listAllPipelineExecutionsForSpace.mockResolvedValue([]);
    mocks.listRunsForSpacePage.mockResolvedValue({
      items: [run("success")],
      page: 1,
      page_size: 200,
      total: 1,
    });
    mocks.listPipelineExecutionsForSpacePage.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 200,
      total: 0,
    });
  });

  it("refreshes active runs and exposes their completed state", async () => {
    mocks.listAllRunsForSpace.mockResolvedValue([run("queued")]);

    render(<IngestionRunTaskPanel />);
    expect(await screen.findByText("dataIngestion.status.queued")).toBeInTheDocument();
    expect(screen.getByText("dataIngestion.runs.autoRefreshing")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 2_100));
    });

    expect(
      await screen.findByText("dataIngestion.status.success", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("dataIngestion.runs.autoRefreshing")).not.toBeInTheDocument();
    expect(mocks.listRunsForSpacePage).toHaveBeenCalledWith(
      "space-1",
      expect.objectContaining({ page: 1, pageSize: 200 }),
    );
  });
});
