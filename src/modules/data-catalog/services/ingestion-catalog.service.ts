/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import i18n from "@/app/locales/i18n";
import { http } from "@/framework/request/http";
import type {
  CatalogResource,
  ResourceListQuery,
  ResourcePreviewQuery,
  ResourcePreviewResult,
} from "@/modules/data-catalog/types/data-catalog";
import {
  catalogMatchesIngestionEndpoint,
  parseIngestionDatabaseEndpoint,
} from "@/modules/data-ingestion/services/ingestion-catalog-sync.service";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import { getCatalog, listCatalogs, type CatalogRecord } from "@/shared/catalog";

export const DATA_INGESTION_CATALOG_ID = "data-ingestion";
const RESOURCE_PREFIX = "data-ingestion:dataset:";

type ControlDatabaseStatus = {
  configured: boolean;
  database_label: string;
};

type IngestionSpace = {
  id: string;
  name: string;
  database_label: string;
};

type IngestionDataset = {
  created_at: string;
  data_type: string;
  description: string;
  id: string;
  last_ingested_at: string | null;
  name: string;
  record_count: number;
  slug: string;
  target_table: string;
};

type IngestionDatasetSchema = {
  fields: Array<{
    data_type: string;
    name: string;
    nullable: boolean;
  }>;
};

type IngestionRecordsResponse = {
  items: Array<{
    payload: Record<string, unknown>;
  }>;
  total: number;
};

type SpaceDataset = {
  dataset: IngestionDataset;
  space: IngestionSpace;
};

type IngestionCatalogBinding = {
  databaseLabel: string;
  spaceId: string;
  spaceName: string;
  catalogId: string | null;
};

export const matchIngestionSpaceCatalog = (
  space: Pick<IngestionSpace, "name" | "database_label">,
  catalogs: CatalogRecord[],
) => {
  const endpoint = parseIngestionDatabaseEndpoint(space.database_label ?? "");
  const matched = catalogs.find((catalog) =>
    catalogMatchesIngestionEndpoint(catalog, endpoint, space.name),
  );
  return matched?.id ?? null;
};

/**
 * 数据空间 -> 平台数据连接（catalog）的映射。
 * 数据空间绑定的是某个 MySQL 连接上的库，数据集应该出现在那个连接下，而不是伪造一个「数据入库」目录。
 */
export async function listIngestionCatalogBindings(): Promise<IngestionCatalogBinding[]> {
  const spaces = await listControlSpaces().catch(() => []);
  if (spaces.length === 0) {
    return [];
  }
  const loadPhysicalCatalogs = async () => {
    const summaries = await listCatalogs(
      { direction: "asc", keyword: "", page: 1, pageSize: 200, type: "physical" },
      { skipErrorToast: true },
    )
      .then((result) => result.items)
      .catch(() => []);
    // 列表接口不返回 connector_config，必须逐个拉详情才能按库名匹配数据空间。
    return Promise.all(
      summaries.map((summary) =>
        getCatalog(summary.id, { skipErrorToast: true })
          .then((detail) => detail ?? summary)
          .catch(() => summary),
      ),
    );
  };
  const buildBindings = (catalogs: CatalogRecord[]) =>
    spaces.map((space) => ({
      databaseLabel: space.database_label ?? "",
      spaceId: space.id,
      spaceName: space.name,
      catalogId: matchIngestionSpaceCatalog(space, catalogs),
    }));

  let bindings = buildBindings(await loadPhysicalCatalogs());
  const unbound = bindings.filter((binding) => binding.catalogId === null);
  if (unbound.length > 0) {
    // Existing spaces created before catalog sync existed repair themselves once the
    // current user has task-manage permission. Permission failures remain a fallback
    // to the built-in ingestion view instead of breaking the data catalog.
    const results = await Promise.allSettled(
      unbound.map(async (binding) => dataIngestionService.syncDataSpaceCatalog(binding.spaceId)),
    );
    if (results.some((result) => result.status === "fulfilled")) {
      bindings = buildBindings(await loadPhysicalCatalogs());
    }
  }
  return bindings;
}

function scopedConfig(spaceId: string) {
  return {
    headers: {
      "x-data-ingestion-space": spaceId,
    },
    skipErrorToast: true,
  };
}

function resourceId(spaceId: string, datasetId: string) {
  return `${RESOURCE_PREFIX}${encodeURIComponent(spaceId)}:${encodeURIComponent(datasetId)}`;
}

function parseResourceId(id: string): { datasetId: string; spaceId: string } | null {
  if (!id.startsWith(RESOURCE_PREFIX)) {
    return null;
  }
  const [spaceId, datasetId] = id
    .slice(RESOURCE_PREFIX.length)
    .split(":")
    .map((value) => decodeURIComponent(value));
  return spaceId && datasetId ? { datasetId, spaceId } : null;
}

export async function listControlSpaces(): Promise<IngestionSpace[]> {
  const status = await http
    .get<ControlDatabaseStatus>("/data-ingestion/bootstrap/status", {
      skipErrorToast: true,
    })
    .then((response) => response.data);
  if (!status.configured) {
    return [];
  }
  return http
    .get<IngestionSpace[]>("/data-ingestion/spaces", { skipErrorToast: true })
    .then((response) => response.data);
}

async function listDatasetsForSpace(space: IngestionSpace, keyword: string) {
  const datasets = await http
    .get<IngestionDataset[]>("/data-ingestion/datasets", {
      ...scopedConfig(space.id),
      params: { q: keyword.trim() || undefined },
    })
    .then((response) => response.data);
  return datasets.map((dataset) => ({ dataset, space }));
}

async function listAllDatasets(keyword = ""): Promise<SpaceDataset[]> {
  const spaces = await listControlSpaces();
  return (await Promise.all(spaces.map((space) => listDatasetsForSpace(space, keyword)))).flat();
}

function mapDataset(item: SpaceDataset, catalogId: string): CatalogResource {
  const updatedAt = item.dataset.last_ingested_at || item.dataset.created_at;
  return {
    catalogId,
    category: "dataset",
    columnCount: null,
    createTime: item.dataset.created_at,
    description: item.dataset.description,
    enabled: true,
    expectedUpdateTime: Date.parse(updatedAt) || 0,
    id: resourceId(item.space.id, item.dataset.id),
    localIndexStatus: "unavailable",
    name: item.dataset.name,
    operations: ["view_detail", "query_data"],
    rowCount: item.dataset.record_count,
    schema: [],
    sourceIdentifier: `${item.space.name} / ${item.dataset.slug}`,
    tags: [item.dataset.data_type],
    updateTime: updatedAt,
  };
}

export async function getIngestionCatalogRecord(keyword = ""): Promise<CatalogRecord | null> {
  try {
    const bindings = await listIngestionCatalogBindings();
    const unbound = bindings.find((binding) => binding.catalogId === null);
    if (!unbound) {
      // 所有数据空间都已绑定到数据连接，不再显示临时目录。
      return null;
    }
    const endpoint = parseIngestionDatabaseEndpoint(unbound.databaseLabel);
    const connectorType = endpoint?.connectorType ?? "mysql";
    const catalogName = endpoint?.databaseName ?? unbound.spaceName;
    const name = i18n.t("dataCatalog.ingestionCatalog.name");
    if (
      keyword.trim() &&
      !name.toLowerCase().includes(keyword.trim().toLowerCase()) &&
      !DATA_INGESTION_CATALOG_ID.includes(keyword.trim().toLowerCase())
    ) {
      return null;
    }
    return {
      builtin: true,
      category: "table",
      connectorConfig: {},
      connectorType,
      createTime: "",
      creatorName: "",
      description: i18n.t("dataCatalog.ingestionCatalog.description"),
      enabled: true,
      expectedUpdateTime: 0,
      healthCheckResult: "",
      healthStatus: "healthy",
      id: DATA_INGESTION_CATALOG_ID,
      lastCheckTime: "",
      metadata: {},
      mode: "local",
      name: catalogName || name,
      operations: ["view_detail"],
      schemas: [],
      status: "enabled",
      tags: [i18n.t("dataCatalog.ingestionCatalog.tag")],
      type: "physical",
      updateTime: "",
      updaterName: "",
    };
  } catch {
    return null;
  }
}

export async function listIngestionCatalogResources(
  query: ResourceListQuery,
): Promise<{ items: CatalogResource[]; total: number }> {
  if (query.category && query.category !== "dataset") {
    return { items: [], total: 0 };
  }
  const bindings = await listIngestionCatalogBindings();
  // 传了真实 catalogId 时，只返回绑定到该数据连接的数据集；否则只返回尚未绑定连接的（兼容旧目录）。
  const targetedCatalogId =
    query.catalogId && query.catalogId !== DATA_INGESTION_CATALOG_ID ? query.catalogId : null;
  const allowedSpaceIds = new Set(
    bindings
      .filter((binding) =>
        targetedCatalogId ? binding.catalogId === targetedCatalogId : binding.catalogId === null,
      )
      .map((binding) => binding.spaceId),
  );
  const datasets = (await listAllDatasets(query.keyword))
    .filter((item) => allowedSpaceIds.has(item.space.id))
    .map((item) => mapDataset(item, targetedCatalogId ?? DATA_INGESTION_CATALOG_ID));
  datasets.sort((left, right) => left.name.localeCompare(right.name));
  if (query.direction === "desc") {
    datasets.reverse();
  }
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit ?? 500;
  return {
    items: limit === -1 ? datasets.slice(offset) : datasets.slice(offset, offset + limit),
    total: datasets.length,
  };
}

export async function getIngestionCatalogResources(ids: string[]): Promise<CatalogResource[]> {
  const requested = new Set(ids.filter((id) => parseResourceId(id)));
  if (requested.size === 0) {
    return [];
  }
  const all = await listAllDatasets();
  const bindings = await listIngestionCatalogBindings();
  const catalogBySpace = new Map(
    bindings.map((binding) => [binding.spaceId, binding.catalogId ?? DATA_INGESTION_CATALOG_ID]),
  );
  const matches = all.filter((item) => requested.has(resourceId(item.space.id, item.dataset.id)));
  return Promise.all(
    matches.map(async (item) => {
      const [schema, resource] = await Promise.all([
        http
          .get<IngestionDatasetSchema>(
            `/data-ingestion/datasets/${encodeURIComponent(item.dataset.id)}/schema`,
            scopedConfig(item.space.id),
          )
          .then((response) => response.data),
        Promise.resolve(
          mapDataset(item, catalogBySpace.get(item.space.id) ?? DATA_INGESTION_CATALOG_ID),
        ),
      ]);
      return {
        ...resource,
        columnCount: schema.fields.length,
        schema: schema.fields.map((field) => ({
          name: field.name,
          type: field.data_type,
        })),
      };
    }),
  );
}

export async function previewIngestionCatalogResource(
  id: string,
  query: ResourcePreviewQuery,
): Promise<ResourcePreviewResult> {
  const parsed = parseResourceId(id);
  if (!parsed) {
    return { rows: [], total: 0 };
  }
  const response = await http
    .get<IngestionRecordsResponse>(
      `/data-ingestion/datasets/${encodeURIComponent(parsed.datasetId)}/records`,
      {
        ...scopedConfig(parsed.spaceId),
        params: {
          page: Math.floor(query.offset / Math.max(1, query.limit)) + 1,
          page_size: query.limit,
        },
      },
    )
    .then((result) => result.data);
  return {
    querySource: "source",
    rows: response.items.map((item) => item.payload),
    total: response.total,
  };
}
