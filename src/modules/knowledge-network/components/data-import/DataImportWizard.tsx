/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  Alert,
  Checkbox,
  Collapse,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Steps,
  Table,
  Tag,
  Upload,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UploadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";
import {
  listDataImportDatasets,
  listDataImportSpaces,
  listDataImportConnections,
  listDataImportRelationMappings,
  listDataImportTables,
  previewDataConnection,
  previewDataFile,
  previewDataImport,
  runDataConnectionImport,
  runDataFileImport,
  runDataImport,
  saveDataImportRelationMapping,
  type DataImportConnection,
  type DataImportDataset,
  type DataImportLastImport,
  type DataImportTable,
  type DataImportFilePreview,
  type DataImportMapping,
  type DataImportObjectMapping,
  type DataImportPreview,
  type DataImportRelationMapping,
  type DataImportRelationReport,
  type DataImportReport,
  type DataImportSpace,
  type DataImportWriteMode,
  type DataImportWriteOptions,
} from "@/modules/knowledge-network/services/data-import.service";

import styles from "./DataImportWizard.module.css";

export type DataImportWizardProps = {
  networkId: string;
  onClose: () => void;
  onImported?: (report: DataImportReport) => void;
  open: boolean;
};

export function DataImportWizard({ networkId, onClose, onImported, open }: DataImportWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [spaces, setSpaces] = useState<DataImportSpace[]>([]);
  const [datasets, setDatasets] = useState<DataImportDataset[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [sourceMode, setSourceMode] = useState<"dataset" | "file" | "connection">("dataset");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<DataImportFilePreview | null>(null);
  const [connections, setConnections] = useState<DataImportConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [tables, setTables] = useState<DataImportTable[]>([]);
  const [tableId, setTableId] = useState("");
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DataImportPreview | null>(null);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [preferredHint, setPreferredHint] = useState(false);
  const [propertyNames, setPropertyNames] = useState<Record<string, Record<string, string>>>({});
  const [report, setReport] = useState<DataImportReport | null>(null);
  const [writeMode, setWriteMode] = useState<DataImportWriteMode>("replace");
  const [watermarkField, setWatermarkField] = useState("");
  const [watermarkCandidates, setWatermarkCandidates] = useState<string[]>([]);
  const [lastImport, setLastImport] = useState<DataImportLastImport | null>(null);
  const [relationMappings, setRelationMappings] = useState<DataImportRelationMapping[]>([]);
  const [relationDraft, setRelationDraft] = useState<
    Record<string, { source: string; target: string }>
  >({});
  const [savingRelationId, setSavingRelationId] = useState("");

  const resetState = useCallback(() => {
    setStep(0);
    setDatasets([]);
    setDatasetId("");
    setFile(null);
    setFilePreview(null);
    setSourceMode("dataset");
    setPreview(null);
    setReport(null);
    setError("");
    setExcluded({});
    setPreferredHint(false);
    setPropertyNames({});
    setWriteMode("replace");
    setWatermarkField("");
    setWatermarkCandidates([]);
    setLastImport(null);
  }, []);

  const loadSpaces = useCallback(async () => {
    setLoadingSpaces(true);
    setError("");
    try {
      const items = await listDataImportSpaces();
      setSpaces(items);
      const preferred = items.find((item) => item.isDefault) ?? items[0];
      setSpaceId((current) => current || preferred?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoadingSpaces(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    resetState();
    void loadSpaces();
  }, [loadSpaces, open, resetState]);

  useEffect(() => {
    if (!open || !spaceId) {
      return;
    }
    let cancelled = false;
    setLoadingDatasets(true);
    setDatasetId("");
    setDatasets([]);
    void listDataImportDatasets(spaceId)
      .then((items) => {
        if (!cancelled) {
          setDatasets(items);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDatasets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, spaceId]);

  const selectedDataset = useMemo(
    () => datasets.find((item) => item.id === datasetId) ?? null,
    [datasetId, datasets],
  );

  useEffect(() => {
    if (sourceMode !== "connection" || connections.length > 0) return;
    setLoadingConnections(true);
    void listDataImportConnections().then((result) => {
      if (result.ok) setConnections(result.connections);
      else setError(result.error);
      setLoadingConnections(false);
    });
  }, [connections.length, sourceMode]);

  useEffect(() => {
    if (!connectionId) {
      setTables([]);
      setTableId("");
      return;
    }
    setLoadingTables(true);
    void listDataImportTables(connectionId).then((result) => {
      if (result.ok) setTables(result.tables);
      else setError(result.error);
      setLoadingTables(false);
    });
  }, [connectionId]);

  const applyPreview = (source: DataImportPreview) => {
    setPreview(source);
    const nextExcluded: Record<string, boolean> = {};
    const nextPropertyNames: Record<string, Record<string, string>> = {};
    const maxFields = source.mapping.objects.reduce(
      (max, objectMapping) => Math.max(max, objectMapping.fields.length),
      0,
    );
    let hiddenMatches = 0;
    for (const objectMapping of source.mapping.objects) {
      const preferred =
        objectMapping.fields.length > 0 && objectMapping.fields.length === maxFields;
      nextExcluded[objectMapping.objectTypeId] = !preferred;
      if (!preferred && objectMapping.fields.length > 0) {
        hiddenMatches += 1;
      }
      const fieldNames: Record<string, string> = {};
      for (const field of objectMapping.fields) {
        fieldNames[field.sourceColumn] = field.propertyName;
      }
      nextPropertyNames[objectMapping.objectTypeId] = fieldNames;
    }
    setExcluded(nextExcluded);
    setPropertyNames(nextPropertyNames);
    setPreferredHint(hiddenMatches > 0);
    setStep(1);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError("");
    try {
      if (sourceMode === "file") {
        if (!file) return;
        const result = await previewDataFile({ file, networkId });
        setFilePreview(result);
        setWatermarkCandidates(result.watermarkCandidates ?? []);
        setLastImport(result.lastImport ?? null);
        applyPreview({
          dataset: {
            id: "file",
            name: result.fileName,
            dataType: "file",
            description: "",
            recordCount: result.rows,
            targetTable: result.sheetName,
          },
          mapping: result.mapping,
          objectTypes: result.objectTypes,
          warnings: result.warnings,
          stats: result.stats,
          documents: result.documents,
          issues: result.issues,
        });
        return;
      }
      if (sourceMode === "connection") {
        if (!connectionId || !tableId) return;
        const table = tables.find((item) => item.id === tableId);
        const result = await previewDataConnection({
          networkId,
          catalogId: connectionId,
          resourceId: tableId,
          tableName: table?.name ?? tableId,
        });
        setWatermarkCandidates(result.watermarkCandidates ?? []);
        setLastImport(result.lastImport ?? null);
        applyPreview({
          dataset: {
            id: tableId,
            name: table?.name ?? tableId,
            dataType: "table",
            description: "",
            recordCount: result.rows,
            targetTable: table?.sourceIdentifier ?? table?.name ?? tableId,
          },
          mapping: result.mapping,
          objectTypes: result.objectTypes,
          warnings: result.warnings,
          stats: result.stats,
          documents: result.documents,
          issues: result.issues,
        });
        return;
      }
      if (!spaceId || !datasetId) return;
      const result = await previewDataImport({ spaceId, datasetId, networkId });
      setWatermarkCandidates(result.watermarkCandidates ?? []);
      setLastImport(result.lastImport ?? null);
      applyPreview(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : String(previewError));
    } finally {
      setPreviewing(false);
    }
  };

  const buildMapping = (source: DataImportPreview): DataImportMapping => {
    const objects: DataImportObjectMapping[] = source.mapping.objects
      .filter((objectMapping) => !excluded[objectMapping.objectTypeId])
      .map((objectMapping) => ({
        ...objectMapping,
        fields: objectMapping.fields.map((field) => ({
          ...field,
          propertyName:
            propertyNames[objectMapping.objectTypeId]?.[field.sourceColumn]?.trim() ||
            field.propertyName,
        })),
      }));
    return { objects };
  };

  const handleImport = async () => {
    if (!preview) {
      return;
    }
    if (sourceMode === "dataset" && (!spaceId || !datasetId)) {
      return;
    }
    if (sourceMode === "file" && !file) {
      return;
    }
    if (sourceMode === "connection" && (!connectionId || !tableId)) {
      return;
    }
    const mapping = buildMapping(preview);
    if (mapping.objects.length === 0) {
      setError(t("knowledgeNetwork.dataImportNothingSelected"));
      return;
    }
    const options: DataImportWriteOptions = { writeMode };
    if (writeMode === "upsert" && watermarkField) {
      options.watermarkField = watermarkField;
      options.watermarkValue = lastImport?.watermark?.value ?? "";
    }
    setImporting(true);
    setError("");
    try {
      const result =
        sourceMode === "file" && file
          ? await runDataFileImport({ file, networkId, mapping, options })
          : sourceMode === "connection" && connectionId && tableId
            ? await runDataConnectionImport({
                networkId,
                catalogId: connectionId,
                resourceId: tableId,
                tableName: tables.find((item) => item.id === tableId)?.name ?? tableId,
                mapping,
                options,
              })
            : await runDataImport({ spaceId, datasetId, networkId, mapping, options });
      setReport(result);
      setStep(2);
      onImported?.(result);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (step !== 1 || !networkId) return undefined;
    let active = true;
    void listDataImportRelationMappings(networkId)
      .then((items) => {
        if (!active) return;
        setRelationMappings(items);
        setRelationDraft((current) => {
          const next = { ...current };
          for (const item of items) {
            if (!next[item.id])
              next[item.id] = { source: item.sourceProperty, target: item.targetProperty };
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [networkId, step]);

  const watermarkFallback = useMemo(() => {
    const names = new Set<string>();
    for (const objectMapping of preview?.mapping.objects ?? []) {
      for (const field of objectMapping.fields) {
        if (field.type === "datetime" || field.type === "number") names.add(field.propertyName);
      }
    }
    return Array.from(names);
  }, [preview]);

  const relationRows = useMemo(() => {
    const objectIds = new Set(preview?.mapping.objects.map((item) => item.objectTypeId) ?? []);
    return relationMappings.filter(
      (item) => objectIds.has(item.sourceObjectTypeId) && objectIds.has(item.targetObjectTypeId),
    );
  }, [relationMappings, preview]);

  const propertyOptions = useCallback(
    (objectTypeId: string) => {
      const names = new Set<string>();
      const objectType = preview?.objectTypes.find((item) => item.id === objectTypeId);
      for (const property of objectType?.properties ?? []) names.add(property.name);
      const objectMapping = preview?.mapping.objects.find(
        (item) => item.objectTypeId === objectTypeId,
      );
      for (const field of objectMapping?.fields ?? []) {
        names.add(propertyNames[objectTypeId]?.[field.sourceColumn]?.trim() || field.propertyName);
      }
      return Array.from(names)
        .filter(Boolean)
        .map((name) => ({ value: name, label: name }));
    },
    [preview, propertyNames],
  );

  const handleSaveRelation = async (relation: DataImportRelationMapping) => {
    const draft = relationDraft[relation.id] ?? {
      source: relation.sourceProperty,
      target: relation.targetProperty,
    };
    if (!draft.source || !draft.target) return;
    setSavingRelationId(relation.id);
    setError("");
    try {
      const item = await saveDataImportRelationMapping({
        networkId,
        relationTypeId: relation.id,
        sourceProperty: draft.source,
        targetProperty: draft.target,
      });
      setRelationMappings((current) =>
        current.map((entry) => (entry.id === item.id ? item : entry)),
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingRelationId("");
    }
  };

  const mappingItems = useMemo(() => {
    if (!preview) {
      return [];
    }
    return preview.mapping.objects.map((objectMapping) => {
      const columns = [
        {
          key: "sourceColumn",
          dataIndex: "sourceColumn",
          title: t("knowledgeNetwork.dataImportSourceColumn"),
        },
        {
          key: "propertyName",
          render: (_value: unknown, field: { sourceColumn: string }) => (
            <Input
              onChange={(event) => {
                const value = event.target.value;
                setPropertyNames((current) => ({
                  ...current,
                  [objectMapping.objectTypeId]: {
                    ...current[objectMapping.objectTypeId],
                    [field.sourceColumn]: value,
                  },
                }));
              }}
              size="small"
              value={propertyNames[objectMapping.objectTypeId]?.[field.sourceColumn] ?? ""}
            />
          ),
          title: t("knowledgeNetwork.dataImportPropertyName"),
        },
        {
          key: "type",
          render: (_value: unknown, field: { type: string }) => <Tag>{field.type}</Tag>,
          title: t("knowledgeNetwork.dataImportType"),
        },
      ];
      return {
        key: objectMapping.objectTypeId,
        label: (
          <div className={styles.mappingTitle}>
            <Checkbox
              checked={!excluded[objectMapping.objectTypeId]}
              onChange={(event) => {
                const checked = event.target.checked;
                setExcluded((current) => ({
                  ...current,
                  [objectMapping.objectTypeId]: !checked,
                }));
              }}
            >
              {objectMapping.objectTypeName}
            </Checkbox>
            <span className={styles.metaText}>
              {t("knowledgeNetwork.dataImportFieldCount", { count: objectMapping.fields.length })}
            </span>
            {objectMapping.primaryKeyColumn ? (
              <Tag color="blue">
                {t("knowledgeNetwork.dataImportPrimaryKey", {
                  column: objectMapping.primaryKeyColumn,
                })}
              </Tag>
            ) : null}
          </div>
        ),
        children: (
          <Table
            columns={columns}
            dataSource={objectMapping.fields}
            pagination={false}
            rowKey={(field) => field.sourceColumn}
            size="small"
          />
        ),
      };
    });
  }, [excluded, preview, propertyNames, t]);

  const relationColumns = useMemo(
    () => [
      {
        key: "name",
        title: t("knowledgeNetwork.dataImportRelationType"),
        dataIndex: "relationTypeName",
      },
      {
        key: "endpoints",
        title: t("knowledgeNetwork.dataImportRelationEndpoints"),
        render: (_: unknown, item: DataImportRelationReport) =>
          `${item.sourceObjectTypeId} → ${item.targetObjectTypeId}`,
      },
      {
        key: "edges",
        title: t("knowledgeNetwork.dataImportRelationEdges"),
        dataIndex: "edgeCount",
      },
      {
        key: "samples",
        title: t("knowledgeNetwork.dataImportRelationSample"),
        render: (_: unknown, item: DataImportRelationReport) =>
          item.samples.length > 0
            ? item.samples.map((sample) => `${sample.sourceId} → ${sample.targetId}`).join("；")
            : (item.note ?? "--"),
      },
    ],
    [t],
  );

  const reportColumns = useMemo(
    () => [
      {
        dataIndex: "objectTypeName",
        key: "objectTypeName",
        title: t("knowledgeNetwork.dataImportObjectType"),
      },
      {
        dataIndex: "written",
        key: "written",
        title: t("knowledgeNetwork.dataImportWritten"),
        width: 90,
      },
      {
        dataIndex: "failed",
        key: "failed",
        title: t("knowledgeNetwork.dataImportFailed"),
        width: 90,
      },
      {
        key: "bound",
        render: (_value: unknown, item: { bound: boolean }) =>
          item.bound ? (
            <Tag color="green">{t("knowledgeNetwork.dataImportBound")}</Tag>
          ) : (
            <Tag>--</Tag>
          ),
        title: t("knowledgeNetwork.dataImportDataBound"),
        width: 120,
      },
      {
        key: "error",
        render: (_value: unknown, item: { error?: string }) => item.error ?? "--",
        title: t("knowledgeNetwork.dataImportError"),
      },
    ],
    [t],
  );

  const steps = [
    { title: t("knowledgeNetwork.dataImportStepSource") },
    { title: t("knowledgeNetwork.dataImportStepMapping") },
    { title: t("knowledgeNetwork.dataImportStepResult") },
  ];

  const stats = preview?.stats;

  return (
    <Modal
      footer={null}
      onCancel={onClose}
      open={open}
      title={t("knowledgeNetwork.dataImportTitle")}
      width={860}
    >
      <p className={styles.intro}>{t("knowledgeNetwork.dataImportSubtitle")}</p>
      <Steps current={step} items={steps} size="small" />

      {error ? <Alert className={styles.alert} message={error} showIcon type="error" /> : null}

      {step === 0 ? (
        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>{t("knowledgeNetwork.dataImportSourceType")}</span>
            <Select
              onChange={(value: "dataset" | "file" | "connection") => setSourceMode(value)}
              options={[
                { label: t("knowledgeNetwork.dataImportSourceDataset"), value: "dataset" },
                { label: t("knowledgeNetwork.dataImportSourceFile"), value: "file" },
                { label: t("knowledgeNetwork.dataImportSourceConnection"), value: "connection" },
              ]}
              value={sourceMode}
            />
          </label>
          {sourceMode === "dataset" ? (
            <>
              <label className={styles.field}>
                <span className={styles.label}>{t("knowledgeNetwork.dataImportSpace")}</span>
                <Select
                  loading={loadingSpaces}
                  onChange={(value: string) => setSpaceId(value)}
                  options={spaces.map((item) => ({
                    label: `${item.name}（${item.databaseLabel}）`,
                    value: item.id,
                  }))}
                  placeholder={t("knowledgeNetwork.dataImportSpacePlaceholder")}
                  value={spaceId || undefined}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t("knowledgeNetwork.dataImportDataset")}</span>
                <Select
                  disabled={!spaceId}
                  loading={loadingDatasets}
                  notFoundContent={
                    loadingDatasets ? (
                      <Spin size="small" />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )
                  }
                  onChange={(value: string) => setDatasetId(value)}
                  options={datasets.map((item) => ({
                    label: `${item.name}（${item.recordCount} 条）`,
                    value: item.id,
                  }))}
                  placeholder={t("knowledgeNetwork.dataImportDatasetPlaceholder")}
                  showSearch
                  optionFilterProp="label"
                  value={datasetId || undefined}
                />
              </label>
              {selectedDataset ? (
                <div className={styles.datasetMeta}>
                  <Tag>{selectedDataset.dataType}</Tag>
                  <span className={styles.metaText}>
                    {t("knowledgeNetwork.dataImportDatasetMeta", {
                      count: selectedDataset.recordCount,
                      table: selectedDataset.targetTable || "--",
                    })}
                  </span>
                </div>
              ) : null}
            </>
          ) : sourceMode === "connection" ? (
            <>
              <label className={styles.field}>
                <span className={styles.label}>{t("knowledgeNetwork.dataImportConnection")}</span>
                <Select
                  loading={loadingConnections}
                  onChange={(value: string) => setConnectionId(value)}
                  options={connections.map((item) => ({
                    label: item.database ? `${item.name}（${item.database}）` : item.name,
                    value: item.id,
                  }))}
                  placeholder={t("knowledgeNetwork.dataImportConnectionPlaceholder")}
                  value={connectionId || undefined}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t("knowledgeNetwork.dataImportTable")}</span>
                <Select
                  disabled={!connectionId}
                  loading={loadingTables}
                  notFoundContent={
                    loadingTables ? (
                      <Spin size="small" />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    )
                  }
                  onChange={(value: string) => setTableId(value)}
                  options={tables.map((item) => ({
                    label: item.sourceIdentifier
                      ? `${item.name}（${item.sourceIdentifier}）`
                      : item.name,
                    value: item.id,
                  }))}
                  placeholder={t("knowledgeNetwork.dataImportTablePlaceholder")}
                  showSearch
                  optionFilterProp="label"
                  value={tableId || undefined}
                />
              </label>
            </>
          ) : (
            <>
              <Upload.Dragger
                accept=".xlsx,.xls,.csv,.tsv"
                beforeUpload={(nextFile) => {
                  setFile(nextFile);
                  setFilePreview(null);
                  return false;
                }}
                fileList={
                  file ? [{ uid: file.name, name: file.name, status: "done" as const }] : []
                }
                maxCount={1}
                onRemove={() => {
                  setFile(null);
                  setFilePreview(null);
                }}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined />
                </p>
                <p className="ant-upload-text">{t("knowledgeNetwork.dataImportFileHint")}</p>
                <p className="ant-upload-hint">{t("knowledgeNetwork.dataImportFileAccept")}</p>
              </Upload.Dragger>
              {filePreview ? (
                <div className={styles.datasetMeta}>
                  <Tag color="blue">{filePreview.sheetName}</Tag>
                  <span className={styles.metaText}>
                    {t("knowledgeNetwork.dataImportFileMeta", { rows: filePreview.rows })}
                  </span>
                </div>
              ) : null}
            </>
          )}
          <div className={styles.actions}>
            <span className={styles.spacer} />
            <AppButton onClick={onClose} size="small" type="text">
              {t("knowledgeNetwork.dataImportCancel")}
            </AppButton>
            <AppButton
              disabled={
                sourceMode === "dataset"
                  ? !datasetId
                  : sourceMode === "connection"
                    ? !tableId
                    : !file
              }
              loading={previewing}
              onClick={() => void handlePreview()}
              size="small"
              type="primary"
            >
              {t("knowledgeNetwork.dataImportNext")}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === 1 && preview ? (
        <div className={styles.body}>
          <div className={styles.statsRow}>
            <Tag color="blue">
              {t("knowledgeNetwork.dataImportStatsRows", { count: stats?.rows ?? 0 })}
            </Tag>
            <Tag color="green">
              {t("knowledgeNetwork.dataImportStatsDocuments", { count: stats?.documents ?? 0 })}
            </Tag>
            <Tag>
              {t("knowledgeNetwork.dataImportStatsSkipped", { count: stats?.skipped ?? 0 })}
            </Tag>
          </div>
          {preview.warnings.length > 0 ? (
            <Alert
              className={styles.alert}
              description={
                <ul className={styles.issueList}>
                  {preview.warnings.slice(0, 5).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              }
              message={t("knowledgeNetwork.dataImportWarnings")}
              showIcon
              type="warning"
            />
          ) : null}
          {preferredHint ? (
            <Alert
              className={styles.alert}
              message={t("knowledgeNetwork.dataImportPreferredHint")}
              showIcon
              type="info"
            />
          ) : null}
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>{t("knowledgeNetwork.dataImportWriteMode")}</div>
            <Select
              onChange={(value) => setWriteMode(value)}
              options={[
                { value: "replace", label: t("knowledgeNetwork.dataImportWriteModeReplace") },
                { value: "upsert", label: t("knowledgeNetwork.dataImportWriteModeUpsert") },
              ]}
              style={{ width: 280 }}
              value={writeMode}
            />
            {writeMode === "upsert" ? (
              <span style={{ marginLeft: 12 }}>
                {t("knowledgeNetwork.dataImportWatermark")}
                <Select
                  allowClear
                  onChange={(value) => setWatermarkField(value ?? "")}
                  options={(watermarkCandidates.length > 0
                    ? watermarkCandidates
                    : watermarkFallback
                  ).map((name) => ({
                    value: name,
                    label: name,
                  }))}
                  placeholder={t("knowledgeNetwork.dataImportWatermarkPlaceholder")}
                  style={{ width: 220, marginLeft: 6 }}
                  value={watermarkField || undefined}
                />
              </span>
            ) : null}
            {writeMode === "upsert" && !watermarkField ? (
              <div style={{ color: "#d46b08", fontSize: 12, marginTop: 6 }}>
                {t("knowledgeNetwork.dataImportWatermarkFallback")}
              </div>
            ) : null}
            {writeMode === "upsert" && lastImport?.watermark?.value ? (
              <div style={{ color: "#8c8c8c", fontSize: 12, marginTop: 6 }}>
                {t("knowledgeNetwork.dataImportLastWatermark", {
                  value: lastImport.watermark.value,
                  at: lastImport.finishedAt,
                })}
              </div>
            ) : null}
          </div>
          {relationRows.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <div>{t("knowledgeNetwork.dataImportRelationMapping")}</div>
              <div style={{ color: "#8c8c8c", fontSize: 12, marginBottom: 6 }}>
                {t("knowledgeNetwork.dataImportRelationMappingHint")}
              </div>
              {relationRows.map((relation) => {
                const draft = relationDraft[relation.id] ?? {
                  source: relation.sourceProperty,
                  target: relation.targetProperty,
                };
                return (
                  <div
                    key={relation.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}
                  >
                    <span style={{ minWidth: 120 }}>{relation.name}</span>
                    <Select
                      onChange={(value) =>
                        setRelationDraft((current) => ({
                          ...current,
                          [relation.id]: { ...draft, source: value },
                        }))
                      }
                      options={propertyOptions(relation.sourceObjectTypeId)}
                      placeholder={t("knowledgeNetwork.dataImportRelationSource")}
                      style={{ width: 170 }}
                      value={draft.source || undefined}
                    />
                    <span>→</span>
                    <Select
                      onChange={(value) =>
                        setRelationDraft((current) => ({
                          ...current,
                          [relation.id]: { ...draft, target: value },
                        }))
                      }
                      options={propertyOptions(relation.targetObjectTypeId)}
                      placeholder={t("knowledgeNetwork.dataImportRelationTarget")}
                      style={{ width: 170 }}
                      value={draft.target || undefined}
                    />
                    <AppButton
                      loading={savingRelationId === relation.id}
                      onClick={() => void handleSaveRelation(relation)}
                      size="small"
                      type="link"
                    >
                      {t("knowledgeNetwork.dataImportSaveMapping")}
                    </AppButton>
                  </div>
                );
              })}
            </div>
          ) : null}
          <Collapse
            defaultActiveKey={preview.mapping.objects.map((item) => item.objectTypeId)}
            items={mappingItems}
          />
          {preview.issues.length > 0 ? (
            <Alert
              className={styles.alert}
              description={
                <ul className={styles.issueList}>
                  {preview.issues.slice(0, 5).map((issue, index) => (
                    <li key={`${issue.row}-${index}`}>
                      {t("knowledgeNetwork.dataImportIssueRow", { row: issue.row })} {issue.message}
                    </li>
                  ))}
                </ul>
              }
              message={t("knowledgeNetwork.dataImportIssues")}
              showIcon
              type="info"
            />
          ) : null}
          <div className={styles.actions}>
            <AppButton onClick={() => setStep(0)} size="small" type="text">
              {t("knowledgeNetwork.dataImportBack")}
            </AppButton>
            <span className={styles.spacer} />
            <AppButton
              loading={importing}
              onClick={() => void handleImport()}
              size="small"
              type="primary"
            >
              {importing
                ? t("knowledgeNetwork.dataImportImporting")
                : t("knowledgeNetwork.dataImportStart")}
            </AppButton>
          </div>
        </div>
      ) : null}

      {step === 2 && report ? (
        <div className={styles.body}>
          <Alert
            message={
              report.ok
                ? t("knowledgeNetwork.dataImportReportOk", {
                    seconds: (report.elapsedMs / 1000).toFixed(1),
                  })
                : t("knowledgeNetwork.dataImportReportFail")
            }
            showIcon
            type={report.ok ? "success" : "error"}
          />
          <Table
            columns={reportColumns}
            dataSource={report.objects}
            pagination={false}
            rowKey={(item) => item.objectTypeId}
            size="small"
            style={{ marginTop: 16 }}
          />

          {report.relations && report.relations.length > 0 ? (
            <Table
              columns={relationColumns}
              dataSource={report.relations}
              pagination={false}
              rowKey={(item) => item.relationTypeId}
              size="small"
              style={{ marginTop: 16 }}
              title={() => t("knowledgeNetwork.dataImportRelations")}
            />
          ) : null}
          {report.issues.length > 0 ? (
            <Alert
              className={styles.alert}
              description={
                <ul className={styles.issueList}>
                  {report.issues.slice(0, 5).map((issue, index) => (
                    <li key={`${issue.row}-${index}`}>
                      {t("knowledgeNetwork.dataImportIssueRow", { row: issue.row })} {issue.message}
                    </li>
                  ))}
                </ul>
              }
              message={t("knowledgeNetwork.dataImportIssues")}
              showIcon
              type="info"
            />
          ) : null}
          <div className={styles.actions}>
            <span className={styles.spacer} />
            <AppButton onClick={() => setStep(1)} size="small" type="text">
              {t("knowledgeNetwork.dataImportBackToMapping")}
            </AppButton>
            <AppButton onClick={onClose} size="small" type="primary">
              {t("knowledgeNetwork.dataImportDone")}
            </AppButton>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
