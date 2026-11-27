/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  dataIngestionService,
  setDataIngestionSpace,
} from "@/modules/data-ingestion/services/data-ingestion.service";

/** 「智能构建」抽屉可选的数据入库数据集。 */
export interface CopilotIngestionDataset {
  id: string;
  name: string;
  description: string;
  dataType: string;
  recordCount: number;
}

export interface CopilotIngestionDatasetList {
  spaceName: string;
  datasets: CopilotIngestionDataset[];
}

export interface CopilotIngestionSample {
  fileName: string;
  file: File;
  rows: number;
  columns: string[];
}

const SAMPLE_LIMIT = 200;

const readySpace = async () => {
  const spaces = await dataIngestionService.listDataSpaces();
  const space =
    spaces.find((item) => item.is_default) ?? spaces.find((item) => item.status === "ready");
  if (!space) {
    throw new Error("数据入库还没有可用的数据空间");
  }
  setDataIngestionSpace(space.id);
  return space;
};

/** 列出数据入库里已经完成入库的数据集，供本体抽取选用。 */
export async function listCopilotIngestionDatasets(): Promise<CopilotIngestionDatasetList> {
  const space = await readySpace();
  const datasets = await dataIngestionService.listDatasets();
  return {
    spaceName: space.name,
    datasets: datasets
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? "",
        dataType: item.data_type,
        recordCount: item.record_count,
      }))
      .sort((left, right) => right.recordCount - left.recordCount),
  };
}

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

/**
 * 把数据集前若干条规范记录转成 CSV 文件，直接复用「导入数据表」的分析链路。
 * 只在浏览器内存里拼装样例，不落盘、不写平台数据。
 */
export async function buildCopilotIngestionSample(
  dataset: CopilotIngestionDataset,
): Promise<CopilotIngestionSample> {
  await readySpace();
  const page = await dataIngestionService.listRecords(dataset.id, {
    page: 1,
    pageSize: SAMPLE_LIMIT,
  });
  const records = page.items ?? [];
  if (records.length === 0) {
    throw new Error("该数据集还没有记录，请先完成入库");
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.payload ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  if (columns.length === 0) {
    throw new Error("该数据集的记录没有可用的字段");
  }

  const lines = [columns.map(csvCell).join(",")];
  for (const record of records) {
    const payload = record.payload ?? {};
    lines.push(columns.map((column) => csvCell(payload[column])).join(","));
  }

  const fileName = `${dataset.name || "dataset"}.csv`;
  return {
    fileName,
    file: new File([`\uFEFF${lines.join("\n")}`], fileName, { type: "text/csv" }),
    rows: records.length,
    columns,
  };
}
