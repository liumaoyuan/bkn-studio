/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditionBadge } from "@/framework/entitlement/EditionBadge";
import { CAPABILITIES } from "@/framework/entitlement/capabilities";
import type { Entitlement } from "@/framework/entitlement/types";

const contextState = vi.hoisted(() => ({ snapshot: null as Entitlement | null }));

vi.mock("@/framework/entitlement/use-entitlement", () => ({
  useEntitlementContext: () => contextState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
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
  contextState.snapshot = null;
});

describe("EditionBadge", () => {
  it("hides commercial edition badges in the Community-only frontend", () => {
    contextState.snapshot = entitlement({
      capabilities: [CAPABILITIES.RBAC_BASIC],
      edition: "professional",
      extensions: [CAPABILITIES.RBAC_BASIC],
      licensed: true,
      state: "valid",
    });

    render(<EditionBadge capability={CAPABILITIES.RBAC_BASIC} edition="professional" />);

    expect(screen.queryByText("common.entitlement.editionsShort.professional")).toBeNull();
  });

  it("hides a commercial badge even when the backend still reports an enterprise licence", () => {
    contextState.snapshot = entitlement({
      edition: "enterprise",
      extensions: [CAPABILITIES.PERM_OBJECT_LEVEL],
      licensed: true,
      state: "valid",
    });

    render(
      <EditionBadge alwaysShow capability={CAPABILITIES.PERM_OBJECT_LEVEL} edition="enterprise" />,
    );

    expect(screen.queryByText("common.entitlement.editionsShort.enterprise")).toBeNull();
  });
});
