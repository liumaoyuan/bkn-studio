/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import type {
  CopilotIr,
  CopilotIrActionType,
  CopilotIrConceptGroup,
  CopilotIrObjectType,
  CopilotIrProperty,
  CopilotIrRelation,
  CopilotIrRiskType,
} from "@/modules/knowledge-network/services/ontology-copilot.service";

type UnknownRecord = Record<string, unknown>;

export type KnBaseNetwork = {
  id: string;
  name: string;
  description?: string;
};

export type KnToIrInput = {
  network: KnBaseNetwork;
  objectTypes: unknown[];
  relationTypes: unknown[];
  actionTypes?: unknown[];
  riskTypes?: unknown[];
  conceptGroups?: unknown[];
  /** 关系键映射（mock 数据单独存放），key 为关系 id。 */
  relationMappings?: Record<string, Array<{ sourceProperty: string; targetProperty: string }>>;
};

const PROPERTY_TYPE_MAP: Record<string, CopilotIrProperty["type"]> = {
  integer: "integer",
  "unsigned integer": "integer",
  int: "integer",
  bigint: "integer",
  float: "number",
  double: "number",
  decimal: "number",
  number: "number",
  boolean: "boolean",
  bool: "boolean",
  date: "datetime",
  datetime: "datetime",
  timestamp: "datetime",
  time: "datetime",
};

const PROPERTY_TYPE_ALIASES: Record<string, CopilotIrProperty["type"]> = {
  string: "string",
  keyword: "string",
  text: "string",
  json: "string",
  binary: "string",
  vector: "string",
  point: "string",
  shape: "string",
  ip: "string",
};

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed ? trimmed : undefined;
}

function readField(record: UnknownRecord, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

function readText(record: UnknownRecord, camel: string, snake: string): string | undefined {
  return asText(readField(record, camel, snake));
}

export function mapKnPropertyType(raw: unknown): CopilotIrProperty["type"] {
  const key = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  return PROPERTY_TYPE_MAP[key] ?? PROPERTY_TYPE_ALIASES[key] ?? "string";
}

function readProperties(raw: unknown): CopilotIrProperty[] {
  const properties: CopilotIrProperty[] = [];

  for (const item of asArray(raw)) {
    const record = asRecord(item);

    if (!record) {
      continue;
    }

    const name = readText(record, "name", "name") ?? readText(record, "id", "id");

    if (!name) {
      continue;
    }

    properties.push({
      name,
      displayName: readText(record, "displayName", "display_name"),
      type: mapKnPropertyType(readField(record, "type", "type")),
      description:
        readText(record, "comment", "comment") ?? readText(record, "description", "description"),
      mappedField: readText(record, "mappedField", "mapped_field"),
    });
  }

  return properties;
}

function readPrimaryKey(
  record: UnknownRecord,
  properties: CopilotIrProperty[],
): string | undefined {
  const raw = readField(record, "primaryKeys", "primary_keys");
  const first = Array.isArray(raw) ? asText(raw[0]) : asText(raw);

  if (first) {
    return first;
  }

  const fallback = readText(record, "primaryKey", "primary_key");

  if (fallback) {
    return fallback;
  }

  return properties.some((property) => property.name === "id") ? "id" : undefined;
}

function readObjectType(raw: unknown): CopilotIrObjectType | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  const id = readText(record, "id", "id");
  const name = readText(record, "name", "name");

  if (!id || !name) {
    return null;
  }

  const properties = readProperties(readField(record, "dataProperties", "data_properties"));

  return {
    id,
    name,
    description:
      readText(record, "comment", "comment") ?? readText(record, "description", "description"),
    sourceTable: readText(record, "sourceTable", "source_table"),
    properties,
    primaryKey: readPrimaryKey(record, properties),
    displayKey: readText(record, "displayKey", "display_key"),
  };
}

function normalizeMappingEntry(
  entry: unknown,
): { sourceProperty: string; targetProperty: string } | null {
  const record = asRecord(entry);

  if (!record) {
    return null;
  }

  const sourceProperty =
    readText(record, "sourceProperty", "source_property") ??
    readText(
      asRecord(readField(record, "sourceProperty", "source_property")) ?? {},
      "name",
      "name",
    );
  const targetValue = readField(record, "targetProperty", "target_property");
  const targetProperty =
    asText(targetValue) ?? readText(asRecord(targetValue) ?? {}, "name", "name");

  if (!sourceProperty || !targetProperty) {
    return null;
  }

  return { sourceProperty, targetProperty };
}

function normalizeMappings(
  raw: unknown,
): Array<{ sourceProperty: string; targetProperty: string }> {
  return asArray(raw)
    .map(normalizeMappingEntry)
    .filter((item): item is { sourceProperty: string; targetProperty: string } => item !== null);
}

function normalizeTestMappingEntry(
  entry: unknown,
): { sourceProperty: string; targetProperty: string } | null {
  const record = asRecord(entry);

  if (!record) {
    return null;
  }

  const sourceProperty = readText(record, "sourcePropertyName", "source_property_name");
  const targetProperty = readText(record, "targetPropertyName", "target_property_name");

  if (!sourceProperty || !targetProperty) {
    return null;
  }

  return { sourceProperty, targetProperty };
}

export function normalizeRelationMappings(
  raw: unknown,
): Array<{ sourceProperty: string; targetProperty: string }> {
  const direct = normalizeMappings(raw);

  if (direct.length > 0) {
    return direct;
  }

  return asArray(raw)
    .map(normalizeTestMappingEntry)
    .filter((item): item is { sourceProperty: string; targetProperty: string } => item !== null);
}

export function knToCopilotIr(input: KnToIrInput): CopilotIr {
  const objectTypes = input.objectTypes
    .map(readObjectType)
    .filter((item): item is CopilotIrObjectType => item !== null);
  const objectIds = new Set(objectTypes.map((item) => item.id));

  const relations: CopilotIrRelation[] = [];

  for (const raw of input.relationTypes) {
    const record = asRecord(raw);

    if (!record) {
      continue;
    }

    const id = readText(record, "id", "id");
    const name = readText(record, "name", "name");
    const source = readText(record, "sourceObjectTypeId", "source_object_type_id");
    const target = readText(record, "targetObjectTypeId", "target_object_type_id");

    if (!id || !name || !source || !target || !objectIds.has(source) || !objectIds.has(target)) {
      continue;
    }

    const mappingFromRules = normalizeMappings(readField(record, "mappingRules", "mapping_rules"));
    const mappingFromRuntime = input.relationMappings?.[id] ?? [];

    relations.push({
      id,
      name,
      source,
      target,
      description: readText(record, "description", "description"),
      mapping: mappingFromRules.length > 0 ? mappingFromRules : mappingFromRuntime,
    });
  }

  const actionTypes: CopilotIrActionType[] = [];

  for (const raw of input.actionTypes ?? []) {
    const record = asRecord(raw);

    if (!record) {
      continue;
    }

    const id = readText(record, "id", "id");
    const name = readText(record, "name", "name");
    const boundObject =
      readText(record, "boundObject", "bound_object") ??
      readText(record, "objectTypeId", "object_type_id");

    if (!id || !name || !boundObject || !objectIds.has(boundObject)) {
      continue;
    }

    const rawActionType = readText(record, "actionType", "action_type");
    const actionType =
      rawActionType === "modify" || rawActionType === "delete" ? rawActionType : "add";
    const riskLevel = readText(record, "riskLevel", "risk_level");
    const triggerRecord =
      asRecord(readField(record, "trigger", "trigger")) ??
      asRecord(readField(record, "condition", "condition"));
    const field = triggerRecord ? readText(triggerRecord, "field", "field") : undefined;

    actionTypes.push({
      id,
      name,
      description:
        readText(record, "comment", "comment") ?? readText(record, "description", "description"),
      actionType,
      boundObject,
      riskLevel:
        riskLevel === "low" || riskLevel === "medium" || riskLevel === "high"
          ? riskLevel
          : undefined,
      requiresApproval:
        typeof readField(record, "requiresApproval", "requires_approval") === "boolean"
          ? (readField(record, "requiresApproval", "requires_approval") as boolean)
          : undefined,
      enabled:
        typeof readField(record, "enabled", "enabled") === "boolean"
          ? (readField(record, "enabled", "enabled") as boolean)
          : undefined,
      trigger: field
        ? {
            field,
            operation: triggerRecord
              ? (readText(triggerRecord, "operation", "operation") ?? "==")
              : "==",
            value: triggerRecord ? readText(triggerRecord, "value", "value") : undefined,
          }
        : undefined,
    });
  }

  const riskTypes: CopilotIrRiskType[] = [];

  for (const raw of input.riskTypes ?? []) {
    const record = asRecord(raw);

    if (!record) {
      continue;
    }

    const id = readText(record, "id", "id");
    const name = readText(record, "name", "name");

    if (!id || !name) {
      continue;
    }

    const rawPolicies =
      readField(record, "policies", "policies") ??
      readField(record, "controlPolicies", "control_policies");

    riskTypes.push({
      id,
      name,
      description:
        readText(record, "comment", "comment") ?? readText(record, "description", "description"),
      policies: asArray(rawPolicies)
        .map((item) => asText(item))
        .filter((item): item is string => Boolean(item)),
    });
  }

  const conceptGroups: CopilotIrConceptGroup[] = [];

  for (const raw of input.conceptGroups ?? []) {
    const record = asRecord(raw);

    if (!record) {
      continue;
    }

    const id = readText(record, "id", "id");
    const name = readText(record, "name", "name");

    if (!id || !name) {
      continue;
    }

    const rawIds =
      readField(record, "objectTypeIds", "object_type_ids") ??
      readField(record, "objectTypes", "object_types");
    const ids = asArray(rawIds)
      .map((item) => (typeof item === "string" ? item : readText(asRecord(item) ?? {}, "id", "id")))
      .filter((item): item is string => Boolean(item) && objectIds.has(item as string));

    conceptGroups.push({
      id,
      name,
      description: readText(record, "description", "description"),
      objectTypes: ids,
    });
  }

  return {
    networkId: input.network.id,
    networkName: input.network.name,
    description: input.network.description,
    objectTypes,
    relations,
    actionTypes,
    riskTypes,
    conceptGroups,
  };
}
