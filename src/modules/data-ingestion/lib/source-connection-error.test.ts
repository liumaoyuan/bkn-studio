/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import { classifySourceConnectionError } from "@/modules/data-ingestion/lib/source-connection-error";

describe("classifySourceConnectionError", () => {
  it("identifies MySQL authentication failures so the UI can call out a password error", () => {
    expect(
      classifySourceConnectionError(
        "OperationalError: (1045, \"Access denied for user 'root'@'192.168.236.1' (using password: YES)\")",
      ),
    ).toBe("auth");
  });

  it("separates missing databases and network failures", () => {
    expect(classifySourceConnectionError("(1049, \"Unknown database 'sales'\")")).toBe("database");
    expect(classifySourceConnectionError('(2003, "Can\'t connect to MySQL server")')).toBe(
      "network",
    );
  });

  it("recognizes PostgreSQL authentication and missing database errors", () => {
    expect(
      classifySourceConnectionError('FATAL: password authentication failed for user "openbkn"'),
    ).toBe("auth");
    expect(classifySourceConnectionError('database "sales" does not exist')).toBe("database");
  });
});
