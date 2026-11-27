/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { ApartmentOutlined } from "@ant-design/icons";
import { Alert, Drawer, Empty, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getDataProvenance,
  type DataProvenance,
  type DataProvenanceBatch,
  type DataProvenanceField,
  type DataProvenanceObject,
  type DataProvenanceRelation,
} from "../../services/data-import.service";

import styles from "./DataProvenanceDrawer.module.css";

type DataProvenanceDrawerProps = {
  networkId: string;
  onClose: () => void;
  open: boolean;
};

function formatTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function DataProvenanceDrawer({ networkId, onClose, open }: DataProvenanceDrawerProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<DataProvenance | null>(null);

  const load = useCallback(async () => {
    if (!networkId) return;
    setLoading(true);
    setError(null);
    try {
      setProvenance(await getDataProvenance(networkId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProvenance(null);
    } finally {
      setLoading(false);
    }
  }, [networkId]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const fieldColumns: ColumnsType<DataProvenanceField> = [
    {
      title: t("knowledgeNetwork.dataProvenanceField"),
      dataIndex: "propertyName",
      key: "propertyName",
      width: 220,
    },
    {
      title: t("knowledgeNetwork.dataProvenanceColumn"),
      dataIndex: "sourceColumn",
      key: "sourceColumn",
      render: (value?: string) => value || "--",
    },
    {
      title: t("knowledgeNetwork.dataImportType"),
      dataIndex: "type",
      key: "type",
      width: 120,
      render: (value?: string) => value || "--",
    },
  ];

  const objectColumns: ColumnsType<DataProvenanceObject> = [
    {
      title: t("knowledgeNetwork.dataProvenanceObjectType"),
      dataIndex: "objectTypeName",
      key: "objectTypeName",
      width: 150,
    },
    {
      title: t("knowledgeNetwork.dataProvenanceResource"),
      dataIndex: "resourceName",
      key: "resourceName",
      width: 200,
      render: (value: string | undefined) =>
        value ? (
          <span>{value}</span>
        ) : (
          <Tag color="warning">{t("knowledgeNetwork.dataProvenanceNotBound")}</Tag>
        ),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceSource"),
      dataIndex: "sourceLabel",
      key: "sourceLabel",
      render: (value?: string) => value || "--",
    },
    {
      title: t("knowledgeNetwork.dataProvenanceImportedAt"),
      dataIndex: "importedAt",
      key: "importedAt",
      width: 180,
      render: (value?: string) => formatTime(value),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceWritten"),
      dataIndex: "written",
      key: "written",
      width: 90,
      render: (value?: number) => (typeof value === "number" ? value : "--"),
    },
  ];

  const relationColumns: ColumnsType<DataProvenanceRelation> = [
    {
      title: t("knowledgeNetwork.dataProvenanceRelationType"),
      dataIndex: "relationTypeName",
      key: "relationTypeName",
      width: 170,
    },
    {
      title: t("knowledgeNetwork.dataProvenanceRelationEndpoints"),
      key: "endpoints",
      render: (_, row) => (
        <span>
          {row.sourceObjectTypeId ?? "--"} → {row.targetObjectTypeId ?? "--"}
        </span>
      ),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceJoin"),
      key: "join",
      render: (_, row) => (
        <span>
          {row.sourceProperty ?? "--"} → {row.targetProperty ?? "--"}
        </span>
      ),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceEdges"),
      dataIndex: "edgeCount",
      key: "edgeCount",
      width: 90,
      render: (value?: number) => (typeof value === "number" ? value : "--"),
    },
  ];

  const batchColumns: ColumnsType<DataProvenanceBatch> = [
    {
      title: t("knowledgeNetwork.dataProvenanceBatchTime"),
      dataIndex: "finishedAt",
      key: "finishedAt",
      width: 180,
      render: (value?: string) => formatTime(value),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceBatchSource"),
      dataIndex: "sourceLabel",
      key: "sourceLabel",
    },
    {
      title: t("knowledgeNetwork.dataProvenanceBatchMode"),
      dataIndex: "writeMode",
      key: "writeMode",
      width: 130,
      render: (value?: string) =>
        value ? (
          <Tag color={value === "upsert" ? "processing" : "default"}>
            {value === "upsert"
              ? t("knowledgeNetwork.dataImportWriteModeUpsert")
              : t("knowledgeNetwork.dataImportWriteModeReplace")}
          </Tag>
        ) : (
          "--"
        ),
    },
    {
      title: t("knowledgeNetwork.dataProvenanceBatchRows"),
      key: "rows",
      width: 140,
      render: (_, row) => `${row.written} / ${row.failed}`,
    },
    {
      title: t("knowledgeNetwork.dataProvenanceRelations"),
      key: "relations",
      render: (_, row) =>
        row.relations.length > 0
          ? row.relations.map((item) => `${item.relationTypeName} ${item.edgeCount}`).join("，")
          : "--",
    },
  ];

  const hasData = Boolean(
    provenance && (provenance.objects.length > 0 || provenance.batches.length > 0),
  );

  return (
    <Drawer
      destroyOnClose
      onClose={onClose}
      open={open}
      title={
        <span className={styles.title}>
          <ApartmentOutlined />
          {t("knowledgeNetwork.dataProvenanceTitle")}
        </span>
      }
      width={820}
    >
      <p className={styles.subtitle}>{t("knowledgeNetwork.dataProvenanceSubtitle")}</p>
      {loading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : error ? (
        <Alert message={t("knowledgeNetwork.dataProvenanceLoadFailed", { error })} type="error" />
      ) : !hasData ? (
        <Empty description={t("knowledgeNetwork.dataProvenanceEmpty")} />
      ) : (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("knowledgeNetwork.dataProvenanceObjects")}</h3>
            <Table
              columns={objectColumns}
              dataSource={provenance?.objects ?? []}
              expandable={{
                expandedRowRender: (row) => (
                  <Table
                    columns={fieldColumns}
                    dataSource={row.fields}
                    pagination={false}
                    rowKey="propertyName"
                    size="small"
                  />
                ),
                rowExpandable: (row) => row.fields.length > 0,
              }}
              pagination={false}
              rowKey="objectTypeId"
              size="small"
            />
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {t("knowledgeNetwork.dataProvenanceRelationTitle")}
            </h3>
            <Table
              columns={relationColumns}
              dataSource={provenance?.relations ?? []}
              pagination={false}
              rowKey="relationTypeId"
              size="small"
            />
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("knowledgeNetwork.dataProvenanceBatches")}</h3>
            <Table
              columns={batchColumns}
              dataSource={provenance?.batches ?? []}
              pagination={false}
              rowKey={(row) => `${row.sourceLabel}-${row.finishedAt ?? ""}`}
              size="small"
            />
          </section>
        </>
      )}
    </Drawer>
  );
}
