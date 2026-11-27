/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { http } from "@/framework/request/http";
import {
  mockActionTypes,
  mockConceptGroups,
  mockKnowledgeNetworks,
  mockObjectTypes,
  mockRelationTypeMappings,
  mockRelationTypes,
} from "@/modules/knowledge-network/services/mock/state";
import { useMock, wait } from "@/modules/knowledge-network/services/shared/runtime";
import {
  knToCopilotIr,
  normalizeRelationMappings,
  type KnBaseNetwork,
} from "@/modules/knowledge-network/services/kn-to-ir";
import type { CopilotIr } from "@/modules/knowledge-network/services/ontology-copilot.service";

export type CopilotBaseNetwork = KnBaseNetwork;

export type CopilotBaseDraft = {
  network: CopilotBaseNetwork;
  ir: CopilotIr;
};

const KN_BASE = "/bkn-backend/v1/knowledge-networks";

type EntriesResponse = {
  entries?: unknown[];
};

function readEntries(data: unknown): unknown[] {
  const record = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};

  return Array.isArray(record.entries) ? record.entries : [];
}

function readSingleEntry(data: unknown): Record<string, unknown> | null {
  const record =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;

  if (!record) {
    return null;
  }

  const entry = record.entry;

  if (typeof entry === "object" && entry !== null) {
    return entry as Record<string, unknown>;
  }

  return record;
}

function toBaseNetwork(raw: unknown): CopilotBaseNetwork | null {
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const id = typeof record?.id === "string" ? record.id : "";
  const name = typeof record?.name === "string" ? record.name : "";

  if (!id || !name) {
    return null;
  }

  const description = typeof record?.comment === "string" ? record.comment : undefined;

  return { id, name, description };
}

async function fetchEntries(path: string): Promise<unknown[]> {
  const response = await http.get<EntriesResponse>(path, {
    params: { limit: 1000, offset: 0 },
    skipErrorToast: true,
  });

  return readEntries(response.data);
}

/** 列出可作为「增量演化」底稿的知识网络。 */
export async function listCopilotBaseNetworks(): Promise<CopilotBaseNetwork[]> {
  if (useMock) {
    return wait(
      mockKnowledgeNetworks.map((network) => ({
        id: network.id,
        name: network.name,
        description: network.description,
      })),
    );
  }

  const response = await http.get<EntriesResponse>(KN_BASE, {
    params: { limit: 200, offset: 0 },
    skipErrorToast: true,
  });

  return readEntries(response.data)
    .map(toBaseNetwork)
    .filter((item): item is CopilotBaseNetwork => item !== null);
}

/** 读取平台已有知识网络，转换成 copilot 的草案 IR。 */
export async function loadCopilotBaseDraft(networkId: string): Promise<CopilotBaseDraft> {
  if (useMock) {
    const network = mockKnowledgeNetworks.find((item) => item.id === networkId);

    if (!network) {
      throw new Error("网络不存在");
    }

    const relationMappings: Record<
      string,
      Array<{ sourceProperty: string; targetProperty: string }>
    > = {};

    for (const [relationId, mappings] of Object.entries(
      mockRelationTypeMappings[networkId] ?? {},
    )) {
      relationMappings[relationId] = normalizeRelationMappings(mappings);
    }

    const base: CopilotBaseNetwork = {
      id: network.id,
      name: network.name,
      description: network.description,
    };
    const ir = knToCopilotIr({
      network: base,
      objectTypes: mockObjectTypes[networkId] ?? [],
      relationTypes: mockRelationTypes[networkId] ?? [],
      actionTypes: mockActionTypes[networkId] ?? [],
      riskTypes: [],
      conceptGroups: mockConceptGroups[networkId] ?? [],
      relationMappings,
    });

    return wait({ network: base, ir });
  }

  const encodedId = encodeURIComponent(networkId);
  const base = `${KN_BASE}/${encodedId}`;

  const [detailResponse, objectTypes, relationTypes, actionTypes, riskTypes, conceptGroups] =
    await Promise.all([
      http.get<unknown>(base, { skipErrorToast: true }),
      fetchEntries(`${base}/object-types`),
      fetchEntries(`${base}/relation-types`),
      fetchEntries(`${base}/action-types`).catch(() => []),
      fetchEntries(`${base}/risk-types`).catch(() => []),
      fetchEntries(`${base}/concept-groups`).catch(() => []),
    ]);

  const network = toBaseNetwork(readSingleEntry(detailResponse.data));

  if (!network) {
    throw new Error("未能读取该知识网络的信息");
  }

  return {
    network,
    ir: knToCopilotIr({
      network,
      objectTypes,
      relationTypes,
      actionTypes,
      riskTypes,
      conceptGroups,
    }),
  };
}
