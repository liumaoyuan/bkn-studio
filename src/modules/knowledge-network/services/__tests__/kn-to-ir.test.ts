/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { describe, expect, it } from "vitest";

import { knToCopilotIr, mapKnPropertyType } from "@/modules/knowledge-network/services/kn-to-ir";

const network = { id: "kn_risk", name: "领域风控知识网络", description: "风控本体" };

describe("knToCopilotIr", () => {
  it("converts platform records (snake_case) into a copilot draft", () => {
    const ir = knToCopilotIr({
      network,
      objectTypes: [
        {
          id: "risk_order",
          name: "风险订单",
          comment: "命中风控策略的订单",
          data_properties: [
            { name: "order_id", display_name: "订单编号", type: "keyword", comment: "唯一标识" },
            { name: "amount", display_name: "金额", type: "decimal" },
            { name: "created_at", display_name: "创建时间", type: "timestamp" },
          ],
          primary_keys: ["order_id"],
          display_key: "order_id",
        },
        {
          id: "risk_device",
          name: "风险设备",
          data_properties: [{ name: "device_no", display_name: "设备编号", type: "string" }],
        },
      ],
      relationTypes: [
        {
          id: "order_on_device",
          name: "订单发生在设备",
          source_object_type_id: "risk_order",
          target_object_type_id: "risk_device",
          mapping_rules: [
            { source_property: { name: "order_id" }, target_property: { name: "device_no" } },
          ],
        },
        {
          id: "broken_relation",
          name: "脏数据关系",
          source_object_type_id: "risk_order",
          target_object_type_id: "missing",
        },
      ],
      actionTypes: [
        {
          id: "block_order",
          name: "拦截订单",
          action_type: "modify",
          object_type_id: "risk_order",
          risk_level: "high",
          requires_approval: true,
          condition: { field: "amount", operation: ">", value: "10000" },
        },
      ],
      riskTypes: [
        {
          id: "order_risk",
          name: "订单金额异常",
          comment: "金额超过阈值",
          policies: ["金额超过 1 万需要人工复核", "同一订单 1 小时内多次触发则拦截"],
        },
      ],
      conceptGroups: [
        { id: "cg_risk", name: "核心风险主体", object_type_ids: ["risk_order", "risk_device"] },
      ],
    });

    expect(ir.networkId).toBe("kn_risk");
    expect(ir.networkName).toBe("领域风控知识网络");
    expect(ir.objectTypes).toHaveLength(2);
    expect(ir.objectTypes[0]?.primaryKey).toBe("order_id");
    expect(ir.objectTypes[0]?.properties.map((property) => property.type)).toEqual([
      "string",
      "number",
      "datetime",
    ]);
    expect(ir.objectTypes[0]?.properties[0]?.displayName).toBe("订单编号");

    // 端点缺失的关系会被丢弃，避免把坏数据带进草案。
    expect(ir.relations).toHaveLength(1);
    expect(ir.relations[0]?.mapping).toEqual([
      { sourceProperty: "order_id", targetProperty: "device_no" },
    ]);

    expect(ir.actionTypes?.[0]).toMatchObject({
      id: "block_order",
      actionType: "modify",
      boundObject: "risk_order",
      riskLevel: "high",
      requiresApproval: true,
      trigger: { field: "amount", operation: ">", value: "10000" },
    });
    expect(ir.riskTypes?.[0]?.policies).toHaveLength(2);
    expect(ir.conceptGroups?.[0]?.objectTypes).toEqual(["risk_order", "risk_device"]);
  });

  it("reads camelCase records and mock relation mappings", () => {
    const ir = knToCopilotIr({
      network,
      objectTypes: [
        {
          id: "risk_order",
          name: "风险订单",
          dataProperties: [{ name: "order_id", displayName: "订单编号", type: "integer" }],
          primaryKeys: ["order_id"],
        },
        { id: "risk_device", name: "风险设备", dataProperties: [] },
      ],
      relationTypes: [
        {
          id: "order_on_device",
          name: "订单发生在设备",
          sourceObjectTypeId: "risk_order",
          targetObjectTypeId: "risk_device",
        },
      ],
      relationMappings: {
        order_on_device: [{ sourceProperty: "order_id", targetProperty: "device_no" }],
      },
    });

    expect(ir.objectTypes[0]?.properties[0]?.type).toBe("integer");
    expect(ir.relations[0]?.mapping).toEqual([
      { sourceProperty: "order_id", targetProperty: "device_no" },
    ]);
  });

  it("falls back to id when the platform record has no primary key", () => {
    const ir = knToCopilotIr({
      network,
      objectTypes: [
        {
          id: "risk_order",
          name: "风险订单",
          data_properties: [{ name: "id", type: "string" }],
        },
      ],
      relationTypes: [],
    });

    expect(ir.objectTypes[0]?.primaryKey).toBe("id");
  });

  it("maps platform property types into copilot types", () => {
    expect(mapKnPropertyType("float")).toBe("number");
    expect(mapKnPropertyType("unsigned integer")).toBe("integer");
    expect(mapKnPropertyType("timestamp")).toBe("datetime");
    expect(mapKnPropertyType("keyword")).toBe("string");
    expect(mapKnPropertyType(undefined)).toBe("string");
  });
});
