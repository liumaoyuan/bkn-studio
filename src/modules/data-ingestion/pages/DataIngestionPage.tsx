/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { useNavigate, useParams } from "react-router-dom";

import type { DataIngestionView } from "@/modules/data-ingestion/types/data-ingestion";
import { DataIngestionWorkbenchScene } from "@/modules/data-ingestion/scenes/DataIngestionWorkbenchScene";

const VIEW_PATHS: Record<DataIngestionView, string> = {
  overview: "/data-ingestion",
  import: "/data-ingestion/import",
  pipelines: "/data-ingestion/pipelines",
  sources: "/data-ingestion/sources",
  runs: "/data-ingestion/runs",
  catalog: "/data-ingestion/catalog",
  "auto-scan": "/data-ingestion/auto-scan",
  agent: "/data-ingestion/agent",
};

export function DataIngestionPage({ activeView }: { activeView: DataIngestionView }) {
  const navigate = useNavigate();
  const { runId } = useParams();

  return (
    <DataIngestionWorkbenchScene
      activeView={activeView}
      onBack={() => {
        void navigate("/data-ingestion/runs");
      }}
      onOpenRun={(nextRunId) => {
        void navigate(`/data-ingestion/runs/${nextRunId}`);
      }}
      onViewChange={(view) => {
        void navigate(VIEW_PATHS[view]);
      }}
      runId={runId}
    />
  );
}
