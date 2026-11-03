/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import { moduleRoutes } from "@/app/router/module-routes";

describe("Community-only module routes", () => {
  it("does not register professional or enterprise-only pages", () => {
    const paths = moduleRoutes.map((route) => route.path);

    expect(paths).not.toContain("system/subscription");
    expect(paths).not.toContain("observability/business-provenance");
  });
});
