/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { App } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/app/locales/i18n";
import type { CopilotIr } from "@/modules/knowledge-network/services/ontology-copilot.service";

import { OntologyCopilotDrawer } from "./OntologyCopilotDrawer";

vi.setConfig({ testTimeout: 30000 });

const {
  streamCopilotChat,
  analyzeCopilot,
  downloadCopilotBindingKit,
  downloadCopilotPackage,
  compileCopilotKnPayload,
  importKnowledgeNetwork,
  getCopilotModelSettings,
  saveCopilotModelSettings,
  clearCopilotModelSettings,
  testCopilotModelSettings,
  listCopilotPlatformModels,
  listCopilotBaseNetworks,
  loadCopilotBaseDraft,
  introspectCopilotDatabase,
  testCopilotDatabaseConnection,
  compileCopilotAttachPlan,
  attachCopilotDataSource,
  createCopilotAlignmentViews,
  compileCopilotIndexPlan,
  applyCopilotIndexPlan,
  listCopilotEmbeddingModels,
  listCopilotIngestionDatasets,
  buildCopilotIngestionSample,
} = vi.hoisted(() => ({
  streamCopilotChat:
    vi.fn<
      (options: {
        draft?: unknown;
        onEvent: (event: {
          type: "delta" | "done" | "error";
          text?: string;
          ir?: unknown;
          note?: string;
        }) => void;
      }) => Promise<void>
    >(),
  analyzeCopilot: vi.fn(),
  downloadCopilotBindingKit: vi.fn(),
  downloadCopilotPackage: vi.fn(),
  compileCopilotKnPayload: vi.fn(),
  importKnowledgeNetwork: vi.fn(),
  getCopilotModelSettings: vi.fn(),
  saveCopilotModelSettings: vi.fn(),
  clearCopilotModelSettings: vi.fn(),
  testCopilotModelSettings: vi.fn(),
  listCopilotPlatformModels: vi.fn(),
  listCopilotBaseNetworks: vi.fn(),
  loadCopilotBaseDraft: vi.fn(),
  introspectCopilotDatabase: vi.fn(),
  testCopilotDatabaseConnection: vi.fn(),
  compileCopilotAttachPlan: vi.fn(),
  attachCopilotDataSource: vi.fn(),
  createCopilotAlignmentViews: vi.fn(),
  compileCopilotIndexPlan: vi.fn(),
  applyCopilotIndexPlan: vi.fn(),
  listCopilotEmbeddingModels: vi.fn(),
  listCopilotIngestionDatasets: vi.fn(),
  buildCopilotIngestionSample: vi.fn(),
}));

vi.mock("@/modules/knowledge-network/services/ontology-copilot.service", () => ({
  streamCopilotChat,
  analyzeCopilot,
  analyzeCopilotStream: analyzeCopilot,
  downloadCopilotBindingKit,
  downloadCopilotPackage,
  compileCopilotKnPayload,
  getCopilotModelSettings,
  saveCopilotModelSettings,
  clearCopilotModelSettings,
  testCopilotModelSettings,
  listCopilotPlatformModels,
  introspectCopilotDatabase,
  testCopilotDatabaseConnection,
  compileCopilotAttachPlan,
  attachCopilotDataSource,
  createCopilotAlignmentViews,
  compileCopilotIndexPlan,
  applyCopilotIndexPlan,
  listCopilotEmbeddingModels,
  createCopilotSessionId: () => "test-session",
}));

vi.mock("@/modules/knowledge-network/services/copilot-ingestion.service", () => ({
  listCopilotIngestionDatasets,
  buildCopilotIngestionSample,
}));

vi.mock("@/modules/knowledge-network/services/network.service", () => ({
  importKnowledgeNetwork,
}));

vi.mock("@/modules/knowledge-network/services/copilot-base.service", () => ({
  listCopilotBaseNetworks,
  loadCopilotBaseDraft,
}));

const ir: CopilotIr = {
  networkId: "kn_demo",
  networkName: "设备运维网络",
  objectTypes: [
    { id: "device", name: "设备", properties: [] },
    { id: "fault", name: "故障", properties: [] },
  ],
  relations: [{ id: "device_has_fault", name: "设备发生故障", source: "device", target: "fault" }],
};

describe("OntologyCopilotDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 草案会自动存到 localStorage；用例之间必须清掉，否则后一个用例会把前一个的草案恢复出来。
    window.localStorage.clear();
  });

  it("streams assistant output into the message list", async () => {
    streamCopilotChat.mockImplementation(({ onEvent }) => {
      onEvent({ type: "delta", text: "候选对象：" });
      onEvent({ type: "delta", text: "设备、故障" });
      onEvent({ type: "done" });
      return Promise.resolve();
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "围绕设备与故障建模" } });
    // antd 会在两个汉字的按钮文案中插入空格（「发 送」），所以按关键字匹配而不是精确文本。
    fireEvent.click(screen.getByRole("button", { name: /发\s*送|Send/ }));

    await waitFor(() => expect(screen.getByText("候选对象：设备、故障")).toBeInTheDocument());
    expect(streamCopilotChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        messages: [{ content: "围绕设备与故障建模", role: "user" }],
      }),
    );
  });

  it("generates a draft and downloads the package", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByText("设备运维网络")).toBeInTheDocument());
    expect(screen.getByDisplayValue("设备")).toBeInTheDocument();
    expect(analyzeCopilot).toHaveBeenCalledWith(expect.objectContaining({ text: "设备与故障" }));

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotDownload")));
    await waitFor(() => expect(downloadCopilotPackage).toHaveBeenCalledWith(ir));
  });
  it("shows inferred data bindings when the draft carries source tables", async () => {
    const boundIr = {
      ...ir,
      objectTypes: [
        {
          id: "device",
          name: "设备",
          sourceTable: "10-设备台账",
          properties: [
            {
              name: "device_code",
              displayName: "设备编号",
              type: "string",
              mappedField: "设备编号",
            },
          ],
        },
        { id: "fault", name: "故障", properties: [] },
      ],
    };
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir: boundIr, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() =>
      expect(
        screen.getByText(i18n.t("knowledgeNetwork.copilotBindingHint", { bound: 1, total: 2 })),
      ).toBeInTheDocument(),
    );
  });

  it("downloads the data access kit from the binding box", async () => {
    const boundIr = {
      ...ir,
      objectTypes: [
        {
          id: "device",
          name: "设备",
          sourceTable: "10-设备台账",
          properties: [
            {
              name: "device_code",
              displayName: "设备编号",
              type: "string",
              mappedField: "设备编号",
            },
          ],
        },
        { id: "fault", name: "故障", properties: [] },
      ],
    };
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "heuristic",
      ir: boundIr,
      warnings: [],
      binding: {
        tables: 1,
        objects: 2,
        boundObjects: 1,
        properties: 1,
        mappedProperties: 1,
        inferredPrimaryKeys: 1,
        inferredRelations: 0,
      },
      bindingDetails: {
        objects: [
          {
            objectId: "device",
            objectName: "设备",
            table: "10-设备台账",
            primaryKey: { property: "device_code", column: "设备编号" },
            properties: [{ property: "device_code", column: "设备编号", type: "string" }],
          },
        ],
        relations: [],
      },
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    const kitButton = await screen.findByText(i18n.t("knowledgeNetwork.copilotBindingKit"));
    fireEvent.click(kitButton);
    await waitFor(() => expect(downloadCopilotBindingKit).toHaveBeenCalledWith(boundIr));
  });

  it("shows action and risk types when the draft carries four elements", async () => {
    const fourElementIr = {
      ...ir,
      actionTypes: [
        {
          id: "act_fault",
          name: "标记故障已处理",
          actionType: "modify" as const,
          boundObject: "fault",
        },
        { id: "act_watch", name: "关闭告警", actionType: "modify" as const, boundObject: "device" },
      ],
      riskTypes: [
        {
          id: "risk_overdue",
          name: "工单超期未关闭",
          policies: ["超过 24 小时升级", "超过 48 小时通报"],
        },
      ],
    };
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "heuristic",
      ir: fourElementIr,
      warnings: [],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() =>
      expect(
        screen.getByText(i18n.t("knowledgeNetwork.copilotActionTypes", { count: 2 })),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(i18n.t("knowledgeNetwork.copilotRiskTypes", { count: 1 })),
    ).toBeInTheDocument();
    // 行动/风险名称现在是可编辑输入框，用 displayValue 断言。
    expect(screen.getByDisplayValue("标记故障已处理")).toBeInTheDocument();
    expect(screen.getByDisplayValue("工单超期未关闭")).toBeInTheDocument();

    // 改名一个行动
    fireEvent.change(screen.getByDisplayValue("标记故障已处理"), {
      target: { value: "标记故障处理完成" },
    });
    expect(screen.getByDisplayValue("标记故障处理完成")).toBeInTheDocument();

    // 删除最后一个风险（按钮顺序：对象 2、关系 1、行动 2、风险 1）
    const deleteButtons = screen.getAllByRole("button", { name: /^删除/ });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    expect(screen.queryByDisplayValue("工单超期未关闭")).not.toBeInTheDocument();
  });
  it("renames and removes draft entries before downloading", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));

    const deviceInput = await screen.findByDisplayValue("设备");
    fireEvent.change(deviceInput, { target: { value: "设备台账" } });
    expect(screen.getByDisplayValue("设备台账")).toBeInTheDocument();

    // 两个对象各一个删除按钮、一条关系一个删除按钮，删除最后一条关系。
    const deleteButtons = screen.getAllByRole("button", { name: /^删除/ });
    expect(deleteButtons).toHaveLength(3);
    fireEvent.click(deleteButtons[2]);

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotDownload")));
    await waitFor(() => expect(downloadCopilotPackage).toHaveBeenCalled());

    const payload = downloadCopilotPackage.mock.calls[0][0] as typeof ir;
    expect(payload.objectTypes.map((item) => item.name)).toContain("设备台账");
    expect(payload.relations).toHaveLength(0);
  });
  it("filters draft entries by keyword", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));
    await screen.findByDisplayValue("设备");

    const search = screen.getByPlaceholderText(i18n.t("knowledgeNetwork.copilotDraftSearch"));
    fireEvent.change(search, { target: { value: "故障" } });

    await waitFor(() => expect(screen.queryByDisplayValue("设备")).not.toBeInTheDocument());
    expect(screen.getAllByDisplayValue(/故障/).length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: "不存在的东西" } });
    await waitFor(() =>
      expect(screen.getAllByText(i18n.t("knowledgeNetwork.copilotNoMatch")).length).toBeGreaterThan(
        0,
      ),
    );

    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
  });

  it("batch selects and deletes draft entries", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));
    await screen.findByDisplayValue("设备");

    const checkboxes = screen.getAllByRole("checkbox");
    // [0]=对象全选, [1]=设备, [2]=故障, [3]=关系全选, [4]=唯一关系
    fireEvent.click(checkboxes[1]);
    expect(
      screen.getByText(i18n.t("knowledgeNetwork.copilotSelected", { count: 1 })),
    ).toBeInTheDocument();

    const deleteSelected = screen
      .getAllByText(i18n.t("knowledgeNetwork.copilotDeleteSelected"))
      .map((node) => node.closest("button"))
      .find((node): node is HTMLButtonElement => Boolean(node));
    if (!deleteSelected) {
      throw new Error("delete-selected button not found");
    }
    fireEvent.click(deleteSelected);

    await waitFor(() => expect(screen.queryByDisplayValue("设备")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue("设备发生故障")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("故障")).toBeInTheDocument();

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotDownload")));
    await waitFor(() => expect(downloadCopilotPackage).toHaveBeenCalled());
    const payload = downloadCopilotPackage.mock.calls[0][0] as typeof ir;
    expect(payload.objectTypes.map((item) => item.id)).toEqual(["fault"]);
    expect(payload.relations).toHaveLength(0);
  });

  it("filters objects by property scope", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));
    await screen.findByDisplayValue("设备");

    // 打开「全部对象」下拉，选择「有属性」；mock 数据没有属性 → 空结果
    const scopeSelect = screen.getAllByRole("combobox")[0];
    fireEvent.mouseDown(scopeSelect);
    const option = await screen.findByText(i18n.t("knowledgeNetwork.copilotScopeWithProps"));
    fireEvent.click(option);

    await waitFor(() =>
      expect(screen.getAllByText(i18n.t("knowledgeNetwork.copilotNoMatch")).length).toBeGreaterThan(
        0,
      ),
    );
  });

  it("adds objects/relations and recomputes ids from ascii names", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));
    await screen.findByDisplayValue("设备");

    // 改成 ASCII 名称 → id 应重算，关系端点跟着改
    fireEvent.change(screen.getByDisplayValue("设备"), { target: { value: "device_asset" } });
    await waitFor(() => expect(screen.getByDisplayValue("device_asset")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /新增对象/ }));
    await waitFor(() => expect(screen.getByDisplayValue("新对象 3")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /新增关系/ }));
    await waitFor(() => expect(screen.getByDisplayValue("新关系 2")).toBeInTheDocument());

    expect(screen.getByDisplayValue("device_asset")).toBeInTheDocument();

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotDownload")));
    await waitFor(() => expect(downloadCopilotPackage).toHaveBeenCalled());

    const payload = downloadCopilotPackage.mock.calls[0][0] as typeof ir;
    expect(payload.objectTypes.map((item) => item.id)).toEqual(["device_asset", "fault", "obj_3"]);
    expect(payload.relations).toHaveLength(2);
    expect(payload.relations[0]).toMatchObject({
      id: "device_asset_fault",
      source: "device_asset",
      target: "fault",
    });
    expect(payload.relations[1]).toMatchObject({ source: "device_asset", target: "fault" });
  }, 30000);

  it("applies a draft returned by the chat stream", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });
    const updatedIr = {
      ...ir,
      objectTypes: [...ir.objectTypes, { id: "spare_part", name: "备件", properties: [] }],
    };
    streamCopilotChat.mockImplementation(({ onEvent }) => {
      onEvent({ type: "delta", text: "已新增备件对象。" });
      onEvent({ type: "done", ir: updatedIr });
      return Promise.resolve();
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByRole("button", { name: /生成本体草案/ }));
    await screen.findByDisplayValue("设备");

    fireEvent.change(input, { target: { value: "再加一个备件对象" } });
    fireEvent.click(screen.getByRole("button", { name: /发\s*送|Send/ }));

    await waitFor(() => expect(screen.getByDisplayValue("备件")).toBeInTheDocument());
    // 发送时应把当前草案带给后端
    const chatCall = streamCopilotChat.mock.calls.at(-1)?.[0];
    expect(chatCall?.draft).toMatchObject({ networkId: "kn_demo" });
  });

  it("saves model settings from the drawer header", async () => {
    listCopilotPlatformModels.mockResolvedValue({
      ok: true,
      models: [{ id: "deepseek", name: "deepseek", isDefault: true }],
    });
    getCopilotModelSettings.mockResolvedValue({
      source: "env",
      mode: "manual",
      platformModel: "",
      platformModelName: "",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKeyMasked: "sk-9***5f5e",
    });
    saveCopilotModelSettings.mockResolvedValue({
      ok: true,
      settings: {
        source: "file",
        mode: "manual",
        platformModel: "",
        platformModelName: "",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKeyMasked: "sk-9***5f5e",
      },
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: i18n.t("knowledgeNetwork.copilotSettings") }),
    );

    // antd 会在两个汉字的按钮文案中插入空格（「保 存」），用宽松匹配。
    const saveButton = await screen.findByRole("button", { name: /保\s*存|Save/ });
    fireEvent.click(saveButton);

    await waitFor(() => expect(saveCopilotModelSettings).toHaveBeenCalledTimes(1));
    expect(saveCopilotModelSettings).toHaveBeenCalledWith({
      mode: "manual",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: undefined,
    });
    await waitFor(() =>
      expect(screen.getByText(i18n.t("knowledgeNetwork.copilotSettingsSaved"))).toBeInTheDocument(),
    );
  });
  it("clears the draft and conversation", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.change(
      screen.getByPlaceholderText(i18n.t("knowledgeNetwork.copilotInputPlaceholder")),
      {
        target: { value: "设备故障工单" },
      },
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(i18n.t("knowledgeNetwork.copilotGenerate")),
      }),
    );

    // 草案生成后能看到对象输入框
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());

    fireEvent.click(await screen.findByRole("button", { name: /清\s*空|Clear/ }));

    await waitFor(() => expect(screen.queryByDisplayValue("设备")).not.toBeInTheDocument());
    expect(screen.queryByText(/个对象类型/)).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(i18n.t("knowledgeNetwork.copilotInputPlaceholder")),
    ).toHaveValue("");
  });

  it("imports the draft into the platform", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });
    compileCopilotKnPayload.mockResolvedValue({
      ok: true,
      payload: { id: ir.networkId, name: ir.networkName, branch: "main" },
    });
    importKnowledgeNetwork.mockResolvedValue(undefined);
    compileCopilotIndexPlan.mockResolvedValue({
      ok: true,
      plan: {
        suggestions: [
          {
            objectId: "device",
            objectName: "设备",
            resourceName: "t_device",
            primaryKeyField: "device_id",
            fulltextFields: ["device_name"],
            vectorFields: [],
          },
        ],
        summary: { objects: 1, fulltextFields: 1, vectorFields: 0 },
        warnings: [],
      },
    });
    listCopilotEmbeddingModels.mockResolvedValue([]);
    applyCopilotIndexPlan.mockResolvedValue({
      tasks: [
        {
          objectId: "device",
          objectName: "设备",
          resourceName: "t_device",
          status: "completed",
          fulltextFields: ["device_name"],
          vectorFields: [],
        },
      ],
      warnings: [],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByText("设备运维网络")).toBeInTheDocument());
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotImport")));

    await waitFor(() =>
      expect(importKnowledgeNetwork).toHaveBeenCalledWith(
        expect.objectContaining({ id: ir.networkId }),
        undefined,
        "detach",
      ),
    );
    expect(
      screen.getByText(i18n.t("knowledgeNetwork.copilotImportOk", { name: ir.networkName })),
    ).toBeInTheDocument();
  });

  it("loads an existing network and imports with overwrite", async () => {
    const baseIr: CopilotIr = {
      networkId: "kn_domain_risk",
      networkName: "领域风控知识网络",
      objectTypes: [
        { id: "risk_order", name: "风险订单", properties: [{ name: "order_id", type: "string" }] },
      ],
      relations: [],
    };
    listCopilotBaseNetworks.mockResolvedValue([{ id: "kn_domain_risk", name: "领域风控知识网络" }]);
    loadCopilotBaseDraft.mockResolvedValue({
      network: { id: "kn_domain_risk", name: "领域风控知识网络" },
      ir: baseIr,
    });
    compileCopilotKnPayload.mockResolvedValue({
      ok: true,
      payload: { id: baseIr.networkId, name: baseIr.networkName, branch: "main" },
    });
    importKnowledgeNetwork.mockResolvedValue(undefined);
    compileCopilotIndexPlan.mockResolvedValue({
      ok: true,
      plan: {
        suggestions: [
          {
            objectId: "device",
            objectName: "设备",
            resourceName: "t_device",
            primaryKeyField: "device_id",
            fulltextFields: ["device_name"],
            vectorFields: [],
          },
        ],
        summary: { objects: 1, fulltextFields: 1, vectorFields: 0 },
        warnings: [],
      },
    });
    listCopilotEmbeddingModels.mockResolvedValue([]);
    applyCopilotIndexPlan.mockResolvedValue({
      tasks: [
        {
          objectId: "device",
          objectName: "设备",
          resourceName: "t_device",
          status: "completed",
          fulltextFields: ["device_name"],
          vectorFields: [],
        },
      ],
      warnings: [],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotBaseButton")));
    await waitFor(() => expect(listCopilotBaseNetworks).toHaveBeenCalled());

    fireEvent.mouseDown(await screen.findByRole("combobox"));
    const options = await screen.findAllByText("领域风控知识网络");
    fireEvent.click(options[options.length - 1]);

    fireEvent.click(screen.getByRole("button", { name: /载\s*入/ }));

    await waitFor(() =>
      expect(
        screen.getByText(i18n.t("knowledgeNetwork.copilotBaseTag", { name: "领域风控知识网络" })),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotUpdateExisting")));

    await waitFor(() =>
      expect(importKnowledgeNetwork).toHaveBeenCalledWith(
        expect.objectContaining({ id: baseIr.networkId }),
        "overwrite",
        "detach",
      ),
    );
    expect(
      screen.getByText(
        i18n.t("knowledgeNetwork.copilotImportOverwriteOk", { name: baseIr.networkName }),
      ),
    ).toBeInTheDocument();
  }, 30000);

  it("saves the incremental draft as a new network", async () => {
    const baseIr: CopilotIr = {
      networkId: "kn_domain_risk",
      networkName: "领域风控知识网络",
      objectTypes: [{ id: "risk_order", name: "风险订单", properties: [] }],
      relations: [],
    };
    listCopilotBaseNetworks.mockResolvedValue([{ id: "kn_domain_risk", name: "领域风控知识网络" }]);
    loadCopilotBaseDraft.mockResolvedValue({
      network: { id: "kn_domain_risk", name: "领域风控知识网络" },
      ir: baseIr,
    });
    compileCopilotKnPayload.mockResolvedValue({
      ok: true,
      payload: { id: baseIr.networkId, name: baseIr.networkName, branch: "main" },
    });
    let capturedPayload: { id?: string; name?: string } | null = null;
    importKnowledgeNetwork.mockImplementation(
      (payload: { id?: string; name?: string }): Promise<void> => {
        capturedPayload = payload;
        return Promise.resolve();
      },
    );

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotBaseButton")));
    await waitFor(() => expect(listCopilotBaseNetworks).toHaveBeenCalled());
    fireEvent.mouseDown(await screen.findByRole("combobox"));
    const options = await screen.findAllByText("领域风控知识网络");
    fireEvent.click(options[options.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: /载\s*入/ }));

    await waitFor(() =>
      expect(
        screen.getByText(i18n.t("knowledgeNetwork.copilotBaseTag", { name: "领域风控知识网络" })),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotSaveAsNew")));

    await waitFor(() => expect(capturedPayload).not.toBeNull());

    const payload = capturedPayload as unknown as { id?: string; name?: string };
    expect(payload.id).toMatch(/^kn_domain_risk_copy_/);
    expect(payload.name).toBe(
      i18n.t("knowledgeNetwork.copilotCopyName", { name: "领域风控知识网络" }),
    );
    expect(importKnowledgeNetwork).toHaveBeenCalledWith(expect.anything(), undefined, "detach");
  }, 30000);

  it("undoes and redoes draft edits", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());

    const undoButton = screen.getByRole("button", {
      name: i18n.t("knowledgeNetwork.copilotUndo"),
    });
    const redoButton = screen.getByRole("button", {
      name: i18n.t("knowledgeNetwork.copilotRedo"),
    });
    // 生成草案这一步不算「修改」，没有历史可撤销。
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();

    fireEvent.change(screen.getByDisplayValue("设备"), { target: { value: "装置" } });
    await waitFor(() => expect(screen.getByDisplayValue("装置")).toBeInTheDocument());
    await waitFor(() => expect(undoButton).toBeEnabled());

    fireEvent.click(undoButton);
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(redoButton).toBeEnabled();

    fireEvent.click(redoButton);
    await waitFor(() => expect(screen.getByDisplayValue("装置")).toBeInTheDocument());
  });

  it("restores the last draft when the drawer is reopened", async () => {
    analyzeCopilot.mockResolvedValue({ ok: true, mode: "heuristic", ir, warnings: [] });

    const first = render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "设备与故障" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());

    first.unmount();

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    await waitFor(() =>
      expect(screen.getByText(i18n.t("knowledgeNetwork.copilotDraftTitle"))).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("设备")).toBeInTheDocument();
  });

  it("shows input health warnings after analysis", async () => {
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "heuristic",
      ir,
      warnings: [
        "这个 PDF 没有可提取的文字层（大概率是扫描件）。请上传电子版 PDF，或先做 OCR 再上传。",
      ],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "需要解析 PDF" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(screen.getByText(/没有可提取的文字层/)).toBeInTheDocument();
  });

  it("shows evidence coverage after analysis", async () => {
    const evidenceIr = {
      ...ir,
      objectTypes: ir.objectTypes.map((object, index) =>
        index === 0
          ? {
              ...object,
              evidence: [
                {
                  source: "设计报告.md",
                  quote: "设备台账记录所有设备信息。",
                },
              ],
              properties: object.properties.map((property, propertyIndex) =>
                propertyIndex === 0
                  ? {
                      ...property,
                      evidence: [{ source: "设计报告.md", quote: "设备编号是唯一标识。" }],
                    }
                  : property,
              ),
            }
          : object,
      ),
    };
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "heuristic",
      ir: evidenceIr,
      warnings: [],
      evidence: {
        objects: 2,
        objectsWithEvidence: 1,
        properties: 2,
        propertiesWithEvidence: 1,
        relations: 1,
        relationsWithEvidence: 0,
        actions: 0,
        actionsWithEvidence: 0,
        risks: 0,
        risksWithEvidence: 0,
      },
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "根据报告生成" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(screen.getByText(/证据引用：对象 1\/2/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotEvidenceShow")));
    expect(screen.getByText(/设计报告\.md/)).toBeInTheDocument();
  });

  it("warns when the model fails and the draft came from rule-based fallback", async () => {
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "heuristic",
      llmError: "connect ETIMEDOUT 1.2.3.4:443",
      ir,
      warnings: [],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "根据报告生成" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(screen.getByText(i18n.t("knowledgeNetwork.copilotFallbackTitle"))).toBeInTheDocument();
    expect(screen.getByText(/connect ETIMEDOUT/)).toBeInTheDocument();
    // antd 会在两个汉字之间自动插入空格，用正则匹配「重 试 / Retry」。
    expect(screen.getByRole("button", { name: /重\s*试|Retry/i })).toBeInTheDocument();
  });

  it("shows schema stats and open questions for database-only input", async () => {
    analyzeCopilot.mockResolvedValue({
      ok: true,
      mode: "llm",
      ir,
      warnings: [],
      schema: {
        dialect: "mysql",
        tables: 6,
        columns: 39,
        foreignKeys: 5,
        commentedTables: 6,
        commentedColumns: 39,
        hasComments: true,
      },
      openQuestions: ["t_work_order.assignee_no 指向的维修人员是否有独立人员表？"],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    const input = await screen.findByPlaceholderText(
      i18n.t("knowledgeNetwork.copilotInputPlaceholder"),
    );
    fireEvent.change(input, { target: { value: "只有数据库结构" } });
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotGenerate")));

    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(
      screen.getByText(
        i18n.t("knowledgeNetwork.copilotSchemaTitle", { dialect: "mysql", tables: 6, columns: 39 }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/带注释：6\/6 张表/)).toBeInTheDocument();
    expect(screen.getByText(/维修人员是否有独立人员表/)).toBeInTheDocument();
  });
  it("reads a live database schema into a draft", async () => {
    testCopilotDatabaseConnection.mockResolvedValue({
      ok: true,
      serverVersion: "11.4.2-MariaDB",
      tables: 6,
    });
    introspectCopilotDatabase.mockResolvedValue({
      ok: true,
      mode: "llm",
      ir,
      warnings: [],
      schema: { dialect: "mysql", tables: 6, columns: 39, commentedTables: 6, foreignKeys: 5 },
      openQuestions: ["维修人员是否有独立人员表"],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.click(await screen.findByText(i18n.t("knowledgeNetwork.copilotIntrospectOpen")));

    const dialog = await screen.findByText(i18n.t("knowledgeNetwork.copilotIntrospectTitle"));
    expect(dialog).toBeInTheDocument();

    const fields = [
      ["Host", "10.0.0.8"],
      ["Database", "erp"],
      ["User", "reader"],
      ["Password", "secret"],
    ] as const;
    for (const [key, value] of fields) {
      const input = screen.getByPlaceholderText(i18n.t(`knowledgeNetwork.copilotIntrospect${key}`));
      fireEvent.change(input, { target: { value } });
    }

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIntrospectTest")));
    await waitFor(() =>
      expect(
        screen.getByText(
          i18n.t("knowledgeNetwork.copilotIntrospectTestOk", {
            version: "11.4.2-MariaDB",
            tables: 6,
          }),
        ),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIntrospectRun")));
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
    expect(introspectCopilotDatabase).toHaveBeenCalledWith(
      expect.objectContaining({
        dialect: "mysql",
        host: "10.0.0.8",
        database: "erp",
        user: "reader",
      }),
    );
    expect(screen.getByText("设备运维网络")).toBeInTheDocument();
  });
  it("auto-attaches a data source and imports the draft", async () => {
    testCopilotDatabaseConnection.mockResolvedValue({
      ok: true,
      serverVersion: "8.0.27",
      tables: 2,
    });
    introspectCopilotDatabase.mockResolvedValue({
      ok: true,
      mode: "llm",
      ir,
      warnings: [],
      schema: { dialect: "mysql", tables: 2, columns: 6, commentedTables: 0, foreignKeys: 1 },
      openQuestions: [],
    });
    compileCopilotAttachPlan.mockResolvedValue({
      ok: true,
      plan: {
        dialect: "mysql",
        catalog: {
          name: "设备运维网络 数据源",
          connectorType: "mysql",
          connectorConfig: {},
          description: "",
          tags: [],
        },
        resources: [
          {
            name: "t_device",
            sourceIdentifier: "t_device",
            category: "table",
            description: "",
            schemaDefinition: [],
            indexConfig: { primaryKeyFields: ["device_id"], incrementalFields: [] },
          },
        ],
        bindings: [
          {
            objectId: "device",
            objectName: "设备",
            resourceName: "t_device",
            primaryKey: "device_id",
            properties: [{ property: "device_id", column: "device_id" }],
          },
        ],
        warnings: [],
      },
    });
    createCopilotAlignmentViews.mockResolvedValue({ created: ["v_device"], failed: [] });
    attachCopilotDataSource.mockResolvedValue({
      catalogId: "cat-1",
      catalogName: "设备运维网络 数据源",
      resourceIds: { device: "res-device" },
      createdResources: 1,
      reusedResources: 0,
    });
    compileCopilotKnPayload.mockResolvedValue({ ok: true, payload: { id: "kn_demo" } });
    importKnowledgeNetwork.mockResolvedValue(undefined);
    compileCopilotIndexPlan.mockResolvedValue({
      ok: true,
      plan: {
        suggestions: [
          {
            objectId: "device",
            objectName: "设备",
            resourceName: "t_device",
            primaryKeyField: "device_id",
            fulltextFields: ["device_name"],
            vectorFields: [],
          },
        ],
        summary: { objects: 1, fulltextFields: 1, vectorFields: 0 },
        warnings: [],
      },
    });
    listCopilotEmbeddingModels.mockResolvedValue([]);
    applyCopilotIndexPlan.mockResolvedValue({
      tasks: [
        {
          objectId: "device",
          objectName: "设备",
          resourceName: "t_device",
          status: "completed",
          fulltextFields: ["device_name"],
          vectorFields: [],
        },
      ],
      warnings: [],
    });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );

    fireEvent.click(await screen.findByText(i18n.t("knowledgeNetwork.copilotIntrospectOpen")));
    const fields = [
      ["Host", "192.168.202.100"],
      ["Database", "industrial_ops"],
      ["User", "root"],
      ["Password", "123456"],
    ] as const;
    for (const [key, value] of fields) {
      fireEvent.change(
        screen.getByPlaceholderText(i18n.t(`knowledgeNetwork.copilotIntrospect${key}`)),
        {
          target: { value },
        },
      );
    }

    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIntrospectRun")));

    await waitFor(() => expect(introspectCopilotDatabase).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    await waitFor(() => expect(compileCopilotAttachPlan).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    await waitFor(() => expect(attachCopilotDataSource).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    await waitFor(() => expect(screen.getByText(/已创建 1 个对齐视图/)).toBeInTheDocument());
    expect(createCopilotAlignmentViews).toHaveBeenCalledWith(
      expect.objectContaining({ dialect: "mysql" }),
      [
        {
          viewName: "v_device",
          tableName: "t_device",
          columns: [{ property: "device_id", column: "device_id" }],
        },
      ],
    );
    expect(attachCopilotDataSource).toHaveBeenCalledWith(expect.anything(), {
      nameOverrides: { device: "v_device" },
    });
    expect(compileCopilotKnPayload).toHaveBeenCalledWith(ir, {
      resourceBindings: { device: { id: "res-device", name: "v_device" } },
    });
    expect(importKnowledgeNetwork).toHaveBeenCalledTimes(1);

    const indexTitle = await screen.findByText(/检索索引建议/);
    expect(indexTitle).toBeInTheDocument();
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIndexBuild")));
    await waitFor(() => expect(applyCopilotIndexPlan).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    expect(applyCopilotIndexPlan).toHaveBeenCalledWith(
      expect.objectContaining({ summary: { objects: 1, fulltextFields: 1, vectorFields: 0 } }),
      {
        embeddingModel: undefined,
      },
    );
    await waitFor(() => expect(screen.getByText(/索引任务完成/)).toBeInTheDocument());
  });

  it("generates a draft from a data ingestion dataset", async () => {
    listCopilotIngestionDatasets.mockResolvedValue({
      spaceName: "默认数据空间",
      datasets: [
        {
          id: "ds-marine",
          name: "海洋观测",
          description: "",
          dataType: "tabular",
          recordCount: 10,
        },
      ],
    });
    buildCopilotIngestionSample.mockResolvedValue({
      fileName: "海洋观测.csv",
      file: new File(["station_id,water_temp\nS1,24.5"], "海洋观测.csv", { type: "text/csv" }),
      rows: 10,
      columns: ["station_id", "water_temp"],
    });
    analyzeCopilot.mockResolvedValue({ ok: true, ir, mode: "llm", warnings: [] });

    render(
      <App>
        <OntologyCopilotDrawer onClose={() => undefined} open />
      </App>,
    );
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIngestionOpen")));

    await waitFor(() => expect(listCopilotIngestionDatasets).toHaveBeenCalledTimes(1));
    await screen.findByText(i18n.t("knowledgeNetwork.copilotIngestionTitle"));
    fireEvent.click(screen.getByText(i18n.t("knowledgeNetwork.copilotIngestionRun")));

    await waitFor(() => expect(analyzeCopilot).toHaveBeenCalledTimes(1));
    const payload = analyzeCopilot.mock.calls[0][0] as { dataFiles?: File[]; text: string };
    expect(payload.dataFiles?.map((file) => file.name)).toEqual(["海洋观测.csv"]);
    expect(payload.text).toContain("海洋观测");
    await waitFor(() => expect(screen.getByDisplayValue("设备")).toBeInTheDocument());
  });
});
