/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import {
  buildControlDatabaseConnectionUrl,
  buildPostgresqlConnectionUrl,
} from "./mysql-connection-url";

describe("control database connection URLs", () => {
  it("builds a PostgreSQL URL with the default port", () => {
    expect(
      buildPostgresqlConnectionUrl({
        databaseName: "data_ingestion",
        host: "postgres.internal",
        password: "p@ss",
        port: 0,
        username: "data_app",
      }),
    ).toBe("postgresql+psycopg://data_app:p%40ss@postgres.internal:5432/data_ingestion");
  });

  it("keeps MySQL and PostgreSQL selection explicit", () => {
    const input = {
      databaseName: "data_ingestion",
      host: "db.internal",
      password: "secret",
      port: 5432,
      username: "data_app",
    };

    expect(buildControlDatabaseConnectionUrl(input, "postgresql")).toContain(
      "postgresql+psycopg://",
    );
    expect(buildControlDatabaseConnectionUrl({ ...input, port: 3306 }, "mysql")).toContain(
      "mysql+pymysql://",
    );
  });
});
