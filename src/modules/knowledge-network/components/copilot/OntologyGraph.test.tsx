/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import i18n from "@/app/locales/i18n";
import type { CopilotIr } from "@/modules/knowledge-network/services/ontology-copilot.service";

import { OntologyGraph } from "./OntologyGraph";

const ir: CopilotIr = {
  networkId: "kn_graph",
  networkName: "设备运维知识网络",
  objectTypes: [
    {
      id: "device",
      name: "设备",
      properties: [
        { name: "device_id", displayName: "设备编号", type: "string" },
        { name: "device_name", displayName: "设备名称", type: "string" },
      ],
      evidence: [{ source: "设备运维数据包.xlsx", quote: "设备台账" }],
    },
    {
      id: "component",
      name: "部件",
      properties: [{ name: "component_id", displayName: "部件编号", type: "string" }],
    },
  ],
  relations: [
    { id: "device_has_component", name: "包含部件", source: "device", target: "component" },
  ],
  conceptGroups: [{ id: "cg_equipment", name: "设备组", objectTypes: ["device", "component"] }],
};

describe("OntologyGraph", () => {
  it("renders object types as nodes and relations as edges", () => {
    render(<OntologyGraph ir={ir} />);

    expect(screen.getByTestId("ontology-graph")).toBeInTheDocument();
    expect(screen.getByText("设备")).toBeInTheDocument();
    expect(screen.getByText("部件")).toBeInTheDocument();
    expect(screen.getByText("包含部件")).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("knowledgeNetwork.copilotGraphNodeMeta", { count: 2 })),
    ).toBeInTheDocument();
  });

  it("shows node detail when a node is clicked", () => {
    render(<OntologyGraph ir={ir} />);

    fireEvent.click(screen.getByText("设备"));

    expect(
      screen.getByText(
        i18n.t("knowledgeNetwork.copilotGraphNodeInfo", {
          name: "设备",
          properties: 2,
          evidence: 1,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("shows edge detail when a relation is clicked", () => {
    render(<OntologyGraph ir={ir} />);

    fireEvent.click(screen.getByText("包含部件"));

    expect(
      screen.getByText(
        i18n.t("knowledgeNetwork.copilotGraphEdgeInfo", {
          name: "包含部件",
          source: "设备",
          target: "部件",
        }),
      ),
    ).toBeInTheDocument();
  });
});
