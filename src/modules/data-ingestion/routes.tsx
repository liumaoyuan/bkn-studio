/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, type RouteObject } from "react-router-dom";

import type { AppRouteContribution } from "@/app/router/types";
import { RouteLoading } from "@/app/router/RouteLoading";
import { RequirePermission } from "@/framework/permission/RequirePermission";

const DataIngestionPage = lazy(async () => {
  const module = await import("@/modules/data-ingestion/pages/DataIngestionPage");
  return { default: module.DataIngestionPage };
});

function page(element: ReactNode) {
  return (
    <RequirePermission permissions="data_ingestion:view">
      <Suspense fallback={<RouteLoading />}>{element}</Suspense>
    </RequirePermission>
  );
}

const pageHandles = {
  overview: "dataIngestion.tabs.overview",
  import: "dataIngestion.tabs.import",
  pipelines: "dataIngestion.tabs.pipelines",
  sources: "dataIngestion.tabs.sources",
  catalog: "dataIngestion.tabs.catalog",
  autoScan: "dataIngestion.tabs.autoScan",
  agent: "dataIngestion.tabs.agent",
} as const;

function handle(titleKey: string, menuKey = "data-ingestion") {
  return {
    console: {
      titleKey,
      descriptionKey: "dataIngestion.description",
      menuKey,
    },
  };
}

export const dataIngestionRoutes: RouteObject[] = [
  {
    path: "data-ingestion",
    handle: handle(pageHandles.overview),
    element: page(<DataIngestionPage activeView="overview" />),
  },
  {
    path: "data-ingestion/import",
    handle: handle(pageHandles.import),
    element: page(<DataIngestionPage activeView="import" />),
  },
  {
    path: "data-ingestion/pipelines",
    handle: handle(pageHandles.pipelines),
    element: page(<DataIngestionPage activeView="pipelines" />),
  },
  {
    path: "data-ingestion/sources",
    handle: handle(pageHandles.sources),
    element: page(<DataIngestionPage activeView="sources" />),
  },
  {
    path: "data-ingestion/runs",
    element: page(<Navigate replace to="/task-management?tab=data-ingestion" />),
  },
  {
    path: "data-ingestion/runs/:runId",
    element: page(<Navigate replace to="/task-management?tab=data-ingestion" />),
  },
  {
    path: "data-ingestion/catalog",
    handle: handle(pageHandles.catalog),
    element: page(<DataIngestionPage activeView="catalog" />),
  },
  {
    path: "data-ingestion/auto-scan",
    handle: handle(pageHandles.autoScan),
    element: page(<DataIngestionPage activeView="auto-scan" />),
  },
  {
    path: "data-ingestion/agent",
    handle: handle(pageHandles.agent),
    element: page(<DataIngestionPage activeView="agent" />),
  },
];

export const dataIngestionRouteContribution: AppRouteContribution = {
  moduleId: "data-ingestion",
  routes: dataIngestionRoutes,
};
