/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License. See LICENSE for the full text.
 */

export type SourceConnectionErrorKind = "auth" | "database" | "network" | "generic";

export function classifySourceConnectionError(detail: string): SourceConnectionErrorKind {
  if (/Access denied|password authentication failed|\(1045\)|\b28P01\b/i.test(detail)) {
    return "auth";
  }
  if (/Unknown database|database .* does not exist|\(1049\)|\b3D000\b/i.test(detail)) {
    return "database";
  }
  if (
    /Can't connect|connection refused|could not translate host name|timed out|timeout expired|server closed the connection|\(2003\)/i.test(
      detail,
    )
  ) {
    return "network";
  }
  return "generic";
}
