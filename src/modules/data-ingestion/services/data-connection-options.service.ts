/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  getCatalog,
  hasCatalogOperation,
  listCatalogs,
  type CatalogHealthStatus,
} from "@/shared/catalog";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";

const SUPPORTED_DATABASE_CONNECTORS = ["mariadb", "mysql"] as const;

export interface DatabaseConnectionOption {
  connectorType: string;
  defaults?: Partial<DatabaseConnectionDefaults>;
  healthStatus: CatalogHealthStatus;
  id: string;
  kind: "connection" | "control" | "space";
  name: string;
  source: "data-connect" | "data-ingestion";
}

export interface DatabaseConnectionDefaults {
  databaseName: string;
  host: string;
  port: number;
  username: string;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function firstDatabase(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringValue).find(Boolean) || "";
  }
  return stringValue(value);
}

function parseDatabaseLabel(label: string): Partial<DatabaseConnectionDefaults> | undefined {
  try {
    const parsed = new URL(label);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!parsed.hostname || !databaseName) {
      return undefined;
    }
    return {
      databaseName,
      host: parsed.hostname.replace(/^\[|\]$/g, ""),
      port: numberValue(parsed.port, 3306),
    };
  } catch {
    return undefined;
  }
}

export async function listDatabaseConnectionOptions(): Promise<DatabaseConnectionOption[]> {
  const results = await Promise.allSettled(
    SUPPORTED_DATABASE_CONNECTORS.map((connectorType) =>
      listCatalogs(
        {
          connectorType,
          enabled: true,
          keyword: "",
          page: 1,
          pageSize: 100,
          sort: "name",
          type: "physical",
        },
        { skipErrorToast: true },
      ),
    ),
  );

  const availableResults = results
    .filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof listCatalogs>>> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  const options = new Map<string, DatabaseConnectionOption>();
  for (const item of availableResults.flatMap((result) => result.items)) {
    if (!hasCatalogOperation(item, "view_detail")) {
      continue;
    }
    options.set(item.id, {
      connectorType: item.connectorType,
      healthStatus: item.healthStatus,
      id: item.id,
      kind: "connection",
      name: item.name,
      source: "data-connect",
    });
  }

  const [controlDatabaseResult, dataSpacesResult] = await Promise.allSettled([
    dataIngestionService.getControlDatabaseStatus(),
    dataIngestionService.listDataSpaces(),
  ]);

  if (controlDatabaseResult.status === "fulfilled") {
    const status = controlDatabaseResult.value;
    const defaults = parseDatabaseLabel(status.database_label);
    if (status.configured && defaults) {
      options.set("data-ingestion:control", {
        connectorType: status.database_label.startsWith("mariadb") ? "mariadb" : "mysql",
        defaults,
        healthStatus: "unchecked",
        id: "data-ingestion:control",
        kind: "control",
        name: defaults.databaseName || status.database_label,
        source: "data-ingestion",
      });
    }
  }

  if (dataSpacesResult.status === "fulfilled") {
    for (const space of dataSpacesResult.value) {
      const defaults = parseDatabaseLabel(space.database_label);
      if (!defaults) {
        continue;
      }
      options.set(`data-ingestion:space:${space.id}`, {
        connectorType: space.database_label.startsWith("mariadb") ? "mariadb" : "mysql",
        defaults,
        healthStatus: space.status === "ready" ? "healthy" : "unhealthy",
        id: `data-ingestion:space:${space.id}`,
        kind: "space",
        name: space.name,
        source: "data-ingestion",
      });
    }
  }

  if (options.size === 0 && availableResults.length === 0) {
    throw new Error("No database connection source is available");
  }

  return [...options.values()].sort((left, right) => {
    if (left.kind === "control" && right.kind !== "control") {
      return -1;
    }
    if (right.kind === "control" && left.kind !== "control") {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function getDatabaseConnectionDefaults(
  connectionId: string,
): Promise<DatabaseConnectionDefaults> {
  const connection = await getCatalog(connectionId, { skipErrorToast: true });
  if (!connection || connection.type !== "physical") {
    throw new Error("Database connection was not found");
  }
  if (!SUPPORTED_DATABASE_CONNECTORS.includes(connection.connectorType as "mariadb" | "mysql")) {
    throw new Error("Database connection type is not supported");
  }

  const config = connection.connectorConfig;
  const host = stringValue(config.host);
  const username = stringValue(config.username);
  if (!host || !username) {
    throw new Error("Database connection is incomplete");
  }

  return {
    databaseName: firstDatabase(config.database) || firstDatabase(config.databases),
    host,
    port: numberValue(config.port, 3306),
    username,
  };
}
