/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
  writable: true,
});

const approveAgentToolMock = vi.hoisted(() => vi.fn());
const getAgentManifestMock = vi.hoisted(() => vi.fn());
const getAgentSessionMock = vi.hoisted(() => vi.fn());
const getAgentSkillMock = vi.hoisted(() => vi.fn());
const getAgentStatusMock = vi.hoisted(() => vi.fn());
const listAgentSessionsMock = vi.hoisted(() => vi.fn());
const messageMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/framework/context/use-app-services", () => ({
  useAppServices: () => ({ message: messageMock }),
}));

vi.mock("@/modules/data-ingestion/services/data-ingestion.service", () => ({
  dataIngestionService: {
    getAgentManifest: getAgentManifestMock,
    getAgentSession: getAgentSessionMock,
    getAgentSkill: getAgentSkillMock,
    getAgentStatus: getAgentStatusMock,
    listAgentSessions: listAgentSessionsMock,
    streamApproveAgentTool: approveAgentToolMock,
  },
}));

import { IngestionAgentPanel } from "./IngestionAgentPanel";

const session = {
  created_at: "2026-11-25T14:00:00Z",
  id: "session-1",
  status: "awaiting_approval",
  title: "三管线入库验证",
  updated_at: "2026-11-25T14:00:01Z",
};

const sessionDetail = {
  ...session,
  approvals: [
    {
      arguments: {
        dataset_id: "dataset-1",
        file_path: "/data/codex-e2e/sample.csv",
        template_code: "tabular_standard",
      },
      created_at: "2026-11-25T14:00:01Z",
      id: "approval-1",
      message_id: "message-1",
      reason: "写入数据库属于需要人工确认的操作",
      resolved_at: null,
      result: {},
      session_id: session.id,
      status: "pending",
      tool_call_id: "call-1",
      tool_name: "ingest_local_file",
    },
  ],
  memories: [],
  messages: [],
};

describe("IngestionAgentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentManifestMock.mockResolvedValue({
      description: "Agent",
      dsh: {},
      id: "agent-1",
      mcp: { configured: true, endpoint: "/mcp" },
      name: "数据入库 Agent",
      permissions: {},
      preset: {},
      skill: {},
      tools: [],
      workflow: [],
    });
    getAgentSkillMock.mockResolvedValue({
      content: "",
      loaded: true,
      name: "multisource-ingestion",
      path: "/skill",
    });
    getAgentStatusMock.mockResolvedValue({
      configured: true,
      default_model_id: "model-1",
      default_model_name: "Default model",
      managed_by: "model-resources",
    });
    listAgentSessionsMock.mockResolvedValue([session]);
    getAgentSessionMock.mockResolvedValue(sessionDetail);
    approveAgentToolMock.mockResolvedValue({
      error: "",
      session: {
        ...sessionDetail,
        approvals: [{ ...sessionDetail.approvals[0], status: "approved" }],
        status: "idle",
      },
    });
  });

  it("refreshes parent data after an Agent write is approved", async () => {
    const onDataChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={["/data-ingestion/agent"]}>
        <IngestionAgentPanel onDataChanged={onDataChanged} />
      </MemoryRouter>,
    );

    const approvalTool = await screen.findByText("ingest_local_file");
    const approveButton = approvalTool.closest(".ant-alert")?.querySelector("button");
    expect(approveButton).toHaveTextContent("批准");
    fireEvent.click(approveButton!);

    await waitFor(() => expect(onDataChanged).toHaveBeenCalledTimes(1));
    expect(approveAgentToolMock).toHaveBeenCalledWith(
      "session-1",
      "approval-1",
      "",
      expect.any(Function),
    );
  });
});
