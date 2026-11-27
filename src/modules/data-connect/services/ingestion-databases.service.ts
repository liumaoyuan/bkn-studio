/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { http } from "@/framework/request/http";

type ControlDatabaseStatus = {
  configured: boolean;
  database_label: string;
};

type IngestionSpace = {
  database_label: string;
  id: string;
  is_default: boolean;
  name: string;
  status: string;
};

export interface IngestionDatabaseEntry {
  databaseLabel: string;
  id: string;
  kind: "control" | "space";
  name: string;
  roles: Array<"control" | "default-space" | "space">;
  status: string;
}

function parseDatabaseName(label: string) {
  try {
    const parsed = new URL(label);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || label;
  } catch {
    return label;
  }
}

export async function listIngestionDatabases(): Promise<IngestionDatabaseEntry[]> {
  const [statusResult, spacesResult] = await Promise.allSettled([
    http
      .get<ControlDatabaseStatus>("/data-ingestion/bootstrap/status", {
        skipErrorToast: true,
      })
      .then((response) => response.data),
    http
      .get<IngestionSpace[]>("/data-ingestion/spaces", { skipErrorToast: true })
      .then((response) => response.data),
  ]);

  const entries = new Map<string, IngestionDatabaseEntry>();
  const controlStatus =
    statusResult.status === "fulfilled" && statusResult.value.configured
      ? statusResult.value
      : null;

  if (controlStatus?.database_label) {
    entries.set(controlStatus.database_label, {
      databaseLabel: controlStatus.database_label,
      id: "ingestion:control",
      kind: "control",
      name: parseDatabaseName(controlStatus.database_label),
      roles: ["control"],
      status: "ready",
    });
  }

  if (spacesResult.status === "fulfilled") {
    for (const space of spacesResult.value) {
      const existing = entries.get(space.database_label);
      if (existing) {
        existing.roles = [
          ...new Set([
            ...existing.roles,
            space.is_default ? ("default-space" as const) : ("space" as const),
          ]),
        ];
        if (space.is_default) {
          existing.name = space.name;
        }
        continue;
      }
      entries.set(space.database_label, {
        databaseLabel: space.database_label,
        id: `ingestion:space:${space.id}`,
        kind: "space",
        name: space.name,
        roles: [space.is_default ? "default-space" : "space"],
        status: space.status,
      });
    }
  }

  if (
    entries.size === 0 &&
    statusResult.status === "rejected" &&
    spacesResult.status === "rejected"
  ) {
    throw statusResult.reason;
  }

  return [...entries.values()];
}
