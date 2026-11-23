/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { getCatalog, listCatalogs, type CatalogRecord } from "@/shared/catalog";

export type IngestionDatabaseConnector = "mysql" | "mariadb";

export interface IngestionDatabaseEndpoint {
  connectorType: IngestionDatabaseConnector;
  databaseName: string;
  host: string;
  port: number;
}

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function connectorType(value: string): IngestionDatabaseConnector {
  return value.trim().toLowerCase().startsWith("mariadb") ? "mariadb" : "mysql";
}

function portValue(value: unknown, fallback = 3306) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function databaseValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(normalized).find(Boolean) ?? "";
  }
  return normalized(value);
}

export function parseIngestionDatabaseEndpoint(label: string): IngestionDatabaseEndpoint | null {
  try {
    const parsed = new URL(label.trim());
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim();
    const host = parsed.hostname.replace(/^\[|\]$/g, "").trim();
    if (!host || !databaseName) {
      return null;
    }
    return {
      connectorType: connectorType(label),
      databaseName,
      host,
      port: portValue(parsed.port, 3306),
    };
  } catch {
    return null;
  }
}

export function catalogMatchesIngestionEndpoint(
  catalog: CatalogRecord,
  endpoint: IngestionDatabaseEndpoint | null,
  fallbackName = "",
) {
  if (!endpoint) {
    return normalized(catalog.name) === normalized(fallbackName);
  }
  const config = catalog.connectorConfig;
  const catalogDatabase = databaseValue(config.database);
  const catalogHost = normalized(config.host);
  const catalogPort = portValue(config.port, endpoint.port);
  return (
    catalogDatabase === normalized(endpoint.databaseName) &&
    (!catalogHost || catalogHost === normalized(endpoint.host)) &&
    catalogPort === endpoint.port
  );
}

async function listDatabaseCatalogs() {
  const results = await Promise.allSettled(
    (["mysql", "mariadb"] as const).map((type) =>
      listCatalogs(
        {
          connectorType: type,
          direction: "asc",
          keyword: "",
          page: 1,
          pageSize: 200,
          sort: "name",
          type: "physical",
        },
        { skipErrorToast: true },
      ),
    ),
  );
  const summaries = results
    .filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof listCatalogs>>> =>
        result.status === "fulfilled",
    )
    .flatMap((result) => result.value.items);
  const unique = new Map(summaries.map((item) => [item.id, item]));
  return Promise.all(
    [...unique.values()].map((summary) =>
      getCatalog(summary.id, { skipErrorToast: true })
        .then((detail) => detail ?? summary)
        .catch(() => summary),
    ),
  );
}

export async function findIngestionCatalog(
  endpoint: IngestionDatabaseEndpoint | null,
  fallbackName = "",
) {
  const catalogs = await listDatabaseCatalogs();
  return catalogs.find((catalog) =>
    catalogMatchesIngestionEndpoint(catalog, endpoint, fallbackName),
  );
}
