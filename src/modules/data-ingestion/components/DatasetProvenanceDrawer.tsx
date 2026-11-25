/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionDataSource,
  DataIngestionDataset,
  DataIngestionDatasetRecord,
  DataIngestionRun,
} from "@/modules/data-ingestion/types/data-ingestion";

import styles from "./DatasetProvenanceDrawer.module.css";

const { Text } = Typography;
const PAGE_SIZE = 10;

interface DatasetProvenanceDrawerProps {
  dataset: DataIngestionDataset | null;
  initialRecord?: DataIngestionDatasetRecord | null;
  onClose: () => void;
  open: boolean;
  sources: DataIngestionDataSource[];
  spaceName: string;
}

function formatTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2) ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}

function formatScalar(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return formatJson(value);
}

export function DatasetProvenanceDrawer({
  dataset,
  initialRecord = null,
  onClose,
  open,
  sources,
  spaceName,
}: DatasetProvenanceDrawerProps) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [records, setRecords] = useState<DataIngestionDatasetRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<DataIngestionDatasetRecord | null>(null);
  const [selectedRun, setSelectedRun] = useState<DataIngestionRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [assetUrl, setAssetUrl] = useState("");
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [downloadingAsset, setDownloadingAsset] = useState(false);

  const datasetId = dataset?.id ?? "";

  const loadRecords = useCallback(
    async (page = 1) => {
      if (!datasetId) {
        setRecords([]);
        setRecordsTotal(0);
        return;
      }
      setRecordsLoading(true);
      setRecordsError("");
      try {
        const result = await dataIngestionService.listRecords(datasetId, {
          page,
          pageSize: PAGE_SIZE,
        });
        setRecords(result.items);
        setRecordsTotal(result.total);
        setRecordsPage(page);
      } catch (error) {
        setRecordsError(extractRequestErrorMessage(error));
      } finally {
        setRecordsLoading(false);
      }
    },
    [datasetId],
  );

  useEffect(() => {
    if (!open || !datasetId) {
      return;
    }
    setRecordsPage(1);
    setSelectedRun(null);
    setRunError("");
    setSelectedRecord(initialRecord);
    void loadRecords(1);
  }, [datasetId, initialRecord, loadRecords, open]);

  useEffect(() => {
    if (!selectedRecord?.run_id) {
      setSelectedRun(null);
      setRunError("");
      return;
    }
    let active = true;
    setRunLoading(true);
    setRunError("");
    void dataIngestionService
      .getRun(selectedRecord.run_id)
      .then((run) => {
        if (active) {
          setSelectedRun(run);
        }
      })
      .catch((error) => {
        if (active) {
          setSelectedRun(null);
          setRunError(extractRequestErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) {
          setRunLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedRecord?.run_id]);

  const locator = selectedRecord?.source_locator ?? {};
  const effectiveSourceId = selectedRecord?.source_id || selectedRun?.source_id || "";
  const effectiveSourceObject =
    selectedRecord?.source_object || selectedRun?.source_object || selectedRun?.original_name || "";
  const sheetName =
    typeof selectedRecord?.payload.__sheet_name === "string"
      ? selectedRecord.payload.__sheet_name
      : "";
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === effectiveSourceId),
    [effectiveSourceId, sources],
  );
  const locatorRow =
    locator.row_number === null || locator.row_number === undefined
      ? null
      : formatScalar(locator.row_number);
  const hasLocator = Object.keys(locator).length > 0;
  const fileName =
    typeof selectedRecord?.payload.filename === "string"
      ? selectedRecord.payload.filename
      : selectedRun?.original_name || effectiveSourceObject || "asset";
  const mediaType =
    selectedRun?.media_type ||
    (typeof selectedRecord?.payload.media_type === "string"
      ? selectedRecord.payload.media_type
      : "");
  const textPreview =
    typeof selectedRecord?.payload.text_preview === "string"
      ? selectedRecord.payload.text_preview
      : "";
  const isImageAsset = selectedRecord?.data_type === "image";
  const isVideoAsset = selectedRecord?.data_type === "video";
  const isDocumentAsset = selectedRecord?.data_type === "document";
  const isPdfAsset =
    isDocumentAsset && (mediaType === "application/pdf" || /\.pdf$/i.test(fileName));
  const inlineAssetKind = !selectedRecord?.asset_path
    ? "none"
    : isImageAsset
      ? "image"
      : isPdfAsset
        ? "pdf"
        : isVideoAsset
          ? "video"
          : "none";
  const hasAssetRecord = isImageAsset || isVideoAsset || isDocumentAsset;

  useEffect(() => {
    if (!open) {
      setAssetUrl("");
      setAssetError("");
      setAssetLoading(false);
      return;
    }
    if (!selectedRecord?.run_id || !selectedRecord.asset_path || inlineAssetKind === "none") {
      setAssetUrl("");
      setAssetError("");
      setAssetLoading(false);
      return;
    }
    let active = true;
    let objectUrl = "";
    setAssetUrl("");
    setAssetError("");
    setAssetLoading(true);
    const request =
      inlineAssetKind === "image"
        ? dataIngestionService.getRunAssetPreview(selectedRecord.run_id)
        : dataIngestionService.getRunAssetBlob(selectedRecord.run_id);
    void request
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setAssetUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      })
      .catch((error) => {
        if (active) {
          setAssetError(extractRequestErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) {
          setAssetLoading(false);
        }
      });
    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [inlineAssetKind, open, selectedRecord?.asset_path, selectedRecord?.run_id]);

  async function backfillProvenance() {
    if (!datasetId) {
      return;
    }
    setBackfilling(true);
    try {
      const result = await dataIngestionService.backfillDatasetProvenance(datasetId);
      message.success(
        t("dataIngestion.provenance.backfilled", {
          count: result.updated_records,
        }),
      );
      await loadRecords(recordsPage);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setBackfilling(false);
    }
  }

  async function downloadSelectedAsset() {
    if (!selectedRecord?.run_id) {
      return;
    }
    setDownloadingAsset(true);
    try {
      await dataIngestionService.downloadRunAsset(selectedRecord.run_id, fileName);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setDownloadingAsset(false);
    }
  }

  const recordColumns = useMemo<ColumnsType<DataIngestionDatasetRecord>>(
    () => [
      {
        title: t("dataIngestion.provenance.stableRecordId"),
        dataIndex: "stable_record_id",
        key: "stableRecordId",
        width: 190,
        render: (value: string) => (
          <Text code title={value}>
            {value ? value.slice(0, 16) : "-"}
          </Text>
        ),
      },
      {
        title: t("dataIngestion.provenance.sourceObject"),
        dataIndex: "source_object",
        key: "sourceObject",
        ellipsis: true,
        render: (value: string) => value || "-",
      },
      {
        title: t("dataIngestion.provenance.ingestionTask"),
        dataIndex: "run_id",
        key: "runId",
        width: 190,
        render: (value: string) => <Text code>{value || "-"}</Text>,
      },
      {
        title: t("dataIngestion.provenance.ingestedAt"),
        dataIndex: "created_at",
        key: "createdAt",
        width: 180,
        render: formatTime,
      },
      {
        title: t("dataIngestion.provenance.action"),
        key: "action",
        fixed: "right",
        width: 110,
        render: (_, record) => (
          <Button onClick={() => setSelectedRecord(record)} type="link">
            {t("dataIngestion.provenance.viewDetail")}
          </Button>
        ),
      },
    ],
    [t],
  );

  const recordDetail = selectedRecord ? (
    <Card
      extra={
        effectiveSourceId ? (
          <Text code>{effectiveSourceId}</Text>
        ) : (
          <Tag color="default">{t("dataIngestion.provenance.noSourceId")}</Tag>
        )
      }
      title={t("dataIngestion.provenance.recordDetail")}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {!hasLocator ? (
          <Alert
            action={
              <Button loading={backfilling} onClick={() => void backfillProvenance()}>
                {t("dataIngestion.contract.backfillProvenance")}
              </Button>
            }
            description={
              effectiveSourceObject || sheetName
                ? t("dataIngestion.provenance.recoverableHint", {
                    object: effectiveSourceObject || "-",
                    sheet: sheetName || "-",
                  })
                : undefined
            }
            message={t("dataIngestion.provenance.missingLocator")}
            showIcon
            type="warning"
          />
        ) : null}

        <Timeline
          items={[
            {
              color: "blue",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{t("dataIngestion.provenance.stepSpace")}</Text>
                  <Text>{spaceName || "-"}</Text>
                </Space>
              ),
            },
            {
              color: selectedSource ? "green" : "gray",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{t("dataIngestion.provenance.stepSource")}</Text>
                  <Text>{selectedSource?.name || effectiveSourceId || "-"}</Text>
                  {selectedSource ? <Tag>{selectedSource.source_type}</Tag> : null}
                </Space>
              ),
            },
            {
              color: effectiveSourceObject ? "green" : "gray",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{t("dataIngestion.provenance.stepObject")}</Text>
                  <Text copyable={Boolean(effectiveSourceObject)}>
                    {effectiveSourceObject || "-"}
                  </Text>
                </Space>
              ),
            },
            {
              color: hasLocator ? "green" : "gray",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{t("dataIngestion.provenance.stepRecord")}</Text>
                  <Text code>{selectedRecord.stable_record_id || selectedRecord.id}</Text>
                  <Text type="secondary">
                    {locatorRow
                      ? t("dataIngestion.provenance.rowNumber", {
                          row: locatorRow,
                        })
                      : sheetName
                        ? t("dataIngestion.provenance.sheetOnly", {
                            sheet: sheetName,
                          })
                        : t("dataIngestion.provenance.locatorRecorded")}
                  </Text>
                </Space>
              ),
            },
            {
              color: selectedRun?.status === "failed" ? "red" : "blue",
              children: (
                <Space direction="vertical" size={1}>
                  <Text strong>{t("dataIngestion.provenance.stepRun")}</Text>
                  <Text code copyable>
                    {selectedRecord.run_id}
                  </Text>
                  {runLoading ? <Spin size="small" /> : null}
                  {selectedRun ? (
                    <Space wrap>
                      <Tag color={selectedRun.status === "success" ? "green" : "blue"}>
                        {selectedRun.status}
                      </Tag>
                      <Text>{selectedRun.template_code}</Text>
                      <Text type="secondary">{formatTime(selectedRun.created_at)}</Text>
                    </Space>
                  ) : null}
                  {runError ? <Alert message={runError} showIcon type="warning" /> : null}
                </Space>
              ),
            },
            {
              color: "blue",
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{t("dataIngestion.provenance.stepDataset")}</Text>
                  <Text>{dataset?.name || "-"}</Text>
                  {dataset?.physical_table ? <Text code>{dataset.physical_table}</Text> : null}
                </Space>
              ),
            },
          ]}
        />

        {hasAssetRecord ? (
          <Card
            extra={
              <Button
                disabled={!selectedRecord.asset_path}
                icon={<DownloadOutlined />}
                loading={downloadingAsset}
                onClick={() => void downloadSelectedAsset()}
              >
                {t("dataIngestion.provenance.downloadOriginal")}
              </Button>
            }
            size="small"
            title={t("dataIngestion.provenance.originalAsset")}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label={t("dataIngestion.provenance.fileName")}>
                  {fileName}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.provenance.mediaType")}>
                  <Text code>{mediaType || "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.provenance.fileSize")}>
                  {selectedRun?.file_size ? `${Math.round(selectedRun.file_size / 1024)} KB` : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.provenance.sha256")}>
                  <Text code copyable={Boolean(selectedRun?.fingerprint)}>
                    {selectedRun?.fingerprint || "-"}
                  </Text>
                </Descriptions.Item>
              </Descriptions>

              {!selectedRecord.asset_path ? (
                <Alert
                  message={t("dataIngestion.provenance.assetUnavailable")}
                  showIcon
                  type="warning"
                />
              ) : assetError ? (
                <Alert message={assetError} showIcon type="error" />
              ) : assetLoading && inlineAssetKind !== "none" ? (
                <div className={styles.previewLoading}>
                  <Spin />
                </div>
              ) : inlineAssetKind === "image" && assetUrl ? (
                <img className={styles.assetImage} alt={fileName} src={assetUrl} />
              ) : inlineAssetKind === "pdf" && assetUrl ? (
                <iframe
                  className={styles.assetDocumentFrame}
                  src={assetUrl}
                  title={t("dataIngestion.provenance.pdfPreview")}
                />
              ) : inlineAssetKind === "video" && assetUrl ? (
                <video className={styles.assetVideo} controls src={assetUrl} />
              ) : isDocumentAsset && !isPdfAsset ? (
                <Alert
                  message={t("dataIngestion.provenance.documentPreviewHint")}
                  showIcon
                  type="info"
                />
              ) : null}

              {isDocumentAsset ? (
                <div>
                  <Text strong>{t("dataIngestion.provenance.extractedText")}</Text>
                  {textPreview ? (
                    <pre className={styles.documentText}>{textPreview}</pre>
                  ) : (
                    <Empty
                      description={t("dataIngestion.provenance.noExtractedText")}
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                  )}
                </div>
              ) : null}
            </Space>
          </Card>
        ) : null}

        <Descriptions
          bordered
          column={2}
          size="small"
          title={t("dataIngestion.provenance.evidence")}
        >
          <Descriptions.Item label={t("dataIngestion.provenance.stableRecordId")}>
            <Text code copyable>
              {selectedRecord.stable_record_id || "-"}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.recordKey")}>
            <Text code>{selectedRecord.record_key || "-"}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.sourceId")}>
            <Text code>{effectiveSourceId || "-"}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.sourceObject")}>
            <Text copyable={Boolean(effectiveSourceObject)}>{effectiveSourceObject || "-"}</Text>
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.dataType")}>
            {selectedRecord.data_type || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.ingestedAt")}>
            {formatTime(selectedRecord.created_at)}
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.incrementalRange")} span={2}>
            {selectedRun
              ? `${selectedRun.incremental_cursor_before || "-"} → ${
                  selectedRun.incremental_cursor_after || "-"
                }`
              : "-"}
          </Descriptions.Item>
        </Descriptions>

        <Card size="small" title={t("dataIngestion.provenance.locator")}>
          {Object.keys(locator).length ? (
            <Descriptions bordered column={2} size="small">
              {Object.entries(locator).map(([key, value]) => (
                <Descriptions.Item key={key} label={key}>
                  <Text code>{formatScalar(value)}</Text>
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <Empty
              description={t("dataIngestion.provenance.noLocator")}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
          <pre className={styles.codeBlock}>{formatJson(locator)}</pre>
        </Card>

        <Card size="small" title={t("dataIngestion.provenance.payload")}>
          <pre className={styles.codeBlock}>{formatJson(selectedRecord.payload)}</pre>
        </Card>
      </Space>
    </Card>
  ) : null;

  return (
    <Drawer
      destroyOnClose
      onClose={onClose}
      open={open}
      title={`${t("dataIngestion.provenance.title")} · ${dataset?.name ?? ""}`}
      width="min(1180px, 96vw)"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          description={t("dataIngestion.provenance.description")}
          message={t("dataIngestion.provenance.entryHint")}
          showIcon
          type="info"
        />

        <Descriptions bordered column={3} size="small">
          <Descriptions.Item label={t("dataIngestion.provenance.space")}>
            {spaceName || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.dataset")}>
            {dataset?.name || "-"}
          </Descriptions.Item>
          <Descriptions.Item label={t("dataIngestion.provenance.storage")}>
            <Space size={6}>
              <Tag>{dataset?.storage_mode || "-"}</Tag>
              {dataset?.physical_table ? <Text code>{dataset.physical_table}</Text> : null}
            </Space>
          </Descriptions.Item>
        </Descriptions>

        <Card
          extra={
            <Button
              icon={<ReloadOutlined />}
              loading={recordsLoading}
              onClick={() => void loadRecords(recordsPage)}
            >
              {t("dataIngestion.actions.refresh")}
            </Button>
          }
          title={t("dataIngestion.provenance.recordsTitle")}
        >
          {recordsError ? <Alert message={recordsError} showIcon type="error" /> : null}
          <Table
            columns={recordColumns}
            dataSource={records}
            loading={recordsLoading}
            locale={{ emptyText: t("dataIngestion.provenance.empty") }}
            pagination={{
              current: recordsPage,
              pageSize: PAGE_SIZE,
              total: recordsTotal,
              onChange: (page) => void loadRecords(page),
            }}
            rowKey="id"
            scroll={{ x: 900 }}
            size="small"
          />
        </Card>

        {recordDetail}
      </Space>
    </Drawer>
  );
}
