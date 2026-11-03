/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/framework/entitlement/capabilities";
import { applyProductEditionPolicy } from "@/framework/entitlement/product-edition-policy";
import type { Entitlement } from "@/framework/entitlement/types";

describe("product edition policy", () => {
  it("forces commercial entitlements back to the Community feature set", () => {
    const enterprise: Entitlement = {
      capabilities: [CAPABILITIES.RBAC_BASIC, "semantic_task"],
      edition: "enterprise",
      extensions: [CAPABILITIES.RBAC_BASIC],
      features: [CAPABILITIES.RBAC_BASIC, "semantic_task"],
      licensed: true,
      limits: { max_users: -1 },
      state: "valid",
    };

    expect(applyProductEditionPolicy(enterprise)).toEqual({
      capabilities: ["semantic_task"],
      edition: "community",
      extensions: [],
      features: [],
      licensed: false,
      limits: {},
      state: "fallback_community",
    });
  });
});
