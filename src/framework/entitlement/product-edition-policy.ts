/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { CAPABILITIES } from "@/framework/entitlement/capabilities";
import type { Edition } from "@/framework/entitlement/edition";
import type { Entitlement } from "@/framework/entitlement/types";

/**
 * This distribution exposes Community features only. Keep commercial catalogue and
 * licensing code available for upstream compatibility, but never let it enable UI or
 * routes in this build.
 */
export const COMMERCIAL_EDITIONS_ENABLED = false;

const COMMERCIAL_CAPABILITIES = new Set<string>(Object.values(CAPABILITIES));

export function isCommercialEdition(edition: Edition): boolean {
  return edition !== "community";
}

export function isCommercialCapability(capability: string): boolean {
  return COMMERCIAL_CAPABILITIES.has(capability);
}

export function applyProductEditionPolicy(entitlement: Entitlement): Entitlement {
  if (COMMERCIAL_EDITIONS_ENABLED) {
    return entitlement;
  }

  return {
    capabilities: entitlement.capabilities.filter(
      (capability) => !isCommercialCapability(capability),
    ),
    edition: "community",
    extensions: [],
    features: [],
    licensed: false,
    limits: {},
    state: "fallback_community",
  };
}
