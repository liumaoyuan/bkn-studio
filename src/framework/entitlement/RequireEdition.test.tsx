/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/framework/entitlement/capabilities";
import { RequireEdition } from "@/framework/entitlement/RequireEdition";
import type { Entitlement } from "@/framework/entitlement/types";

const contextState = vi.hoisted(() => ({
  loading: false,
  snapshot: null as Entitlement | null,
}));

vi.mock("@/framework/entitlement/use-entitlement", () => ({
  useEntitlementContext: () => contextState,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-i18next")>();
  return { ...original, useTranslation: () => ({ t: (key: string) => key }) };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...original,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: "/", search: "", hash: "", key: "k", state: null }),
  };
});

function entitlement(overrides: Partial<Entitlement>): Entitlement {
  return {
    capabilities: [],
    edition: "community",
    extensions: [],
    features: [],
    licensed: false,
    limits: {},
    state: "unlicensed",
    ...overrides,
  };
}

beforeEach(() => {
  contextState.loading = false;
  contextState.snapshot = null;
});

describe("RequireEdition · Community-only frontend", () => {
  it.each([
    [CAPABILITIES.RBAC_BASIC, "professional" as const],
    [CAPABILITIES.PERM_OBJECT_LEVEL, "enterprise" as const],
  ])("renders not found for %s", (capability, minEdition) => {
    contextState.snapshot = entitlement({
      capabilities: [capability],
      edition: "enterprise",
      extensions: [capability],
      licensed: true,
      state: "valid",
    });

    render(
      <RequireEdition capability={capability} minEdition={minEdition}>
        <p>protected</p>
      </RequireEdition>,
    );

    expect(screen.getByText("common.pageNotFound")).toBeTruthy();
    expect(screen.queryByText("protected")).toBeNull();
  });

  it("does not mount paid content while the entitlement snapshot is loading", () => {
    contextState.loading = true;

    render(
      <RequireEdition
        capability={CAPABILITIES.BUSINESS_PROVENANCE}
        minEdition="enterprise"
        mountLockedContent={false}
      >
        <p>protected live content</p>
      </RequireEdition>,
    );

    expect(screen.getByText("common.pageNotFound")).toBeTruthy();
    expect(screen.queryByText("protected live content")).toBeNull();
  });
});
