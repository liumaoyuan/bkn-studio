/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  ApartmentOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Segmented,
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  Spin,
  type TabsProps,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { useAppServices } from "@/framework/context/use-app-services";
import { useRuntimeConfig } from "@/framework/context/use-runtime-config";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { ControlDatabaseSetup } from "@/modules/data-ingestion/components/ControlDatabaseSetup";
import { ControlDatabaseSwitchModal } from "@/modules/data-ingestion/components/ControlDatabaseSwitchModal";
import { DatabaseConnectionPicker } from "@/modules/data-ingestion/components/DatabaseConnectionPicker";
import { DatasetProvenanceDrawer } from "@/modules/data-ingestion/components/DatasetProvenanceDrawer";
import { IngestionAgentPanel } from "@/modules/data-ingestion/components/IngestionAgentPanel";
import {
  PipelineComposerModal,
  PipelineRunModal,
} from "@/modules/data-ingestion/components/PipelineComposer";
import type { DataIngestionWorkbenchSceneProps } from "@/modules/data-ingestion/contracts/scenes";
import {
  buildMysqlConnectionUrl,
  createDataSpaceSlug,
  DEFAULT_MYSQL_PORT,
  normalizeMysqlHost,
} from "@/modules/data-ingestion/lib/mysql-connection-url";
import { classifySourceConnectionError } from "@/modules/data-ingestion/lib/source-connection-error";
import {
  dataIngestionService,
  setDataIngestionSpace,
} from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionAutoScanJob,
  DataIngestionAgentManifest,
  DataIngestionControlDatabaseStatus,
  DataIngestionDatabaseCatalog,
  DataIngestionDataSource,
  DataIngestionDataset,
  DataIngestionDatasetContract,
  DataIngestionDatasetFieldSchema,
  DataIngestionDatasetRecord,
  DataIngestionInspection,
  DataIngestionOverview,
  DataIngestionPipelineRunResult,
  DataIngestionPipelineTemplate,
  DataIngestionQualityCheck,
  DataIngestionRun,
  DataIngestionRunListItem,
  DataIngestionSpace,
  DataIngestionStage,
  DataIngestionStorageInfo,
} from "@/modules/data-ingestion/types/data-ingestion";

import styles from "./DataIngestionWorkbenchScene.module.css";

const { Paragraph, Text, Title } = Typography;
const DEFAULT_PAGE_SIZE = 20;
const MYSQL_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

interface DataSpaceFormValues {
  database_name: string;
  host: string;
  name: string;
  password: string;
  port: number;
  username: string;
}

type ImportMode = "files" | "source";

type UploadQueueStatus =
  "inspecting" | "ready" | "error" | "queued" | "running" | "success" | "failed";

interface UploadQueueItem {
  id: string;
  file: File;
  status: UploadQueueStatus;
  inspection?: DataIngestionInspection;
  error?: string;
  run?: DataIngestionRun;
}

function formatBytes(value: number) {
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTime(value?: string | null) {
  return value ? value.replace("T", " ").replace(/\.\d+Z?$/, "") : "-";
}

function displayValue(value: unknown) {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

interface DocumentTablePreview {
  column_count: number;
  index: number;
  page?: number;
  row_count: number;
  rows: string[][];
}

function documentTablePreviews(metadata: Record<string, unknown>) {
  if (!Array.isArray(metadata.tables)) {
    return [];
  }
  return metadata.tables.flatMap((value, index): DocumentTablePreview[] => {
    if (!value || typeof value !== "object" || !("rows" in value)) {
      return [];
    }
    const table = value as Record<string, unknown>;
    if (!Array.isArray(table.rows)) {
      return [];
    }
    const rows = table.rows
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => row.map((cell) => displayValue(cell)));
    return [
      {
        column_count:
          typeof table.column_count === "number"
            ? table.column_count
            : Math.max(...rows.map((row) => row.length), 0),
        index: typeof table.index === "number" ? table.index : index + 1,
        page: typeof table.page === "number" ? table.page : undefined,
        row_count: typeof table.row_count === "number" ? table.row_count : rows.length,
        rows,
      },
    ];
  });
}

function documentTableRows(table: DocumentTablePreview) {
  return table.rows.slice(1).map((row, rowIndex) => ({
    key: `${table.index}-${rowIndex}`,
    ...Object.fromEntries(row.map((value, columnIndex) => [String(columnIndex), value])),
  }));
}

function stageStatus(stage: DataIngestionStage) {
  if (stage.status === "success") {
    return "finish" as const;
  }
  if (stage.status === "failed") {
    return "error" as const;
  }
  if (stage.status === "running") {
    return "process" as const;
  }
  return "wait" as const;
}

function statusColor(status: string) {
  if (["success", "ready"].includes(status)) {
    return "green";
  }
  if (["failed", "error"].includes(status)) {
    return "red";
  }
  if (["running", "queued", "pending", "awaiting_approval"].includes(status)) {
    return "blue";
  }
  return "default";
}

function scanTypeForSource(source?: DataIngestionDataSource) {
  if (!source || ["upload", "local_dir"].includes(source.source_type)) {
    return "local";
  }
  if (["mysql", "postgres", "postgresql"].includes(source.source_type)) {
    return "database";
  }
  return source.source_type;
}

function emptyScanForm() {
  return {
    name: "",
    source_id: "",
    dataset_id: "",
    template_code: "auto",
    scan_type: "local",
    path: "",
    recursive: true,
    file_pattern: "*",
    interval_seconds: 300,
    schedule_type: "interval",
    schedule_time: "02:00",
    weekdays: [] as number[],
    cron_expression: "",
    timezone: "Asia/Shanghai",
    enabled: true,
  };
}

function emptySourceForm() {
  return {
    body: "{}",
    headers: "{}",
    name: "",
    source_type: "upload",
    method: "GET",
    pagination_type: "none",
    page_param: "page",
    page_size: "100",
    max_pages: "10",
    next_url_path: "",
    host: "",
    port: "",
    path: "",
    username: "",
    password: "",
    database: "",
    private_key: "",
    query_mode: "table" as "table" | "custom",
    sync_mode: "full" as "full" | "incremental",
    table_name: "",
    table_names: [] as string[],
    schema_name: "",
    initial_cursor: "",
    record_path: "",
    use_tls: false,
    watermark_column: "",
  };
}

function scanFormFromJob(job: DataIngestionAutoScanJob) {
  return {
    name: job.name,
    source_id: job.source_id,
    dataset_id: job.dataset_id,
    template_code: job.template_code,
    scan_type: job.scan_type,
    path: job.path,
    recursive: job.recursive,
    file_pattern: job.file_pattern,
    interval_seconds: job.interval_seconds,
    schedule_type: job.schedule_type,
    schedule_time: job.schedule_time,
    weekdays: job.weekdays,
    cron_expression: job.cron_expression,
    timezone: job.timezone,
    enabled: job.enabled,
  };
}

function StageDetail({
  run,
  template,
}: {
  run: DataIngestionRun;
  template?: DataIngestionPipelineTemplate;
}) {
  const { t } = useTranslation();
  const [activeStage, setActiveStage] = useState<DataIngestionStage | null>(run.stages[0] ?? null);

  useEffect(() => {
    setActiveStage((current) => {
      if (current && run.stages.some((stage) => stage.id === current.id)) {
        return run.stages.find((stage) => stage.id === current.id) ?? current;
      }
      return run.stages[0] ?? null;
    });
  }, [run.stages]);

  return (
    <Row gutter={[20, 16]}>
      <Col md={10} xs={24}>
        <Steps
          direction="vertical"
          items={run.stages.map((stage) => ({
            title: stage.name,
            status: stageStatus(stage),
            description: (
              <Button onClick={() => setActiveStage(stage)} size="small" type="link">
                {stage.input_count} → {stage.output_count} · {stage.duration_ms} ms
              </Button>
            ),
          }))}
          size="small"
        />
      </Col>
      <Col md={14} xs={24}>
        {activeStage ? (
          <Card className={styles.stageCard} size="small" title={activeStage.name}>
            {template?.steps.find((step) => step.key === activeStage.stage_key) ? (
              <>
                <Descriptions column={{ md: 2, xs: 1 }} size="small">
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepKind")}>
                    {template.steps.find((step) => step.key === activeStage.stage_key)?.kind}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepImplementation")}>
                    {
                      template.steps.find((step) => step.key === activeStage.stage_key)
                        ?.implementation
                    }
                  </Descriptions.Item>
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepInput")}>
                    {template.steps.find((step) => step.key === activeStage.stage_key)?.input}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepOutput")}>
                    {template.steps.find((step) => step.key === activeStage.stage_key)?.output}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepArtifact")}>
                    {template.steps.find((step) => step.key === activeStage.stage_key)?.artifact ||
                      "-"}
                  </Descriptions.Item>
                  <Descriptions.Item label={t("dataIngestion.pipelines.stepRetryable")}>
                    {template.steps.find((step) => step.key === activeStage.stage_key)?.retryable
                      ? "Yes"
                      : "No"}
                  </Descriptions.Item>
                </Descriptions>
                <Paragraph>
                  {template.steps.find((step) => step.key === activeStage.stage_key)?.description}
                </Paragraph>
                <Divider />
              </>
            ) : null}
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Status">
                <Tag color={statusColor(activeStage.status)}>
                  {t(`dataIngestion.status.${activeStage.status}`)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Duration">{activeStage.duration_ms} ms</Descriptions.Item>
              <Descriptions.Item label="Input">{activeStage.input_count}</Descriptions.Item>
              <Descriptions.Item label="Output">{activeStage.output_count}</Descriptions.Item>
            </Descriptions>
            <Divider />
            <pre className={styles.codeBlock}>{JSON.stringify(activeStage.summary, null, 2)}</pre>
            {activeStage.logs.length ? (
              <ul>
                {activeStage.logs.map((log, index) => (
                  <li key={`${activeStage.id}-log-${index}`}>{log}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : (
          <Empty />
        )}
      </Col>
    </Row>
  );
}

function RunDetailCard({
  run,
  template,
  onBack,
  onRetry,
  onDownload,
  canRetry,
}: {
  run: DataIngestionRun;
  template?: DataIngestionPipelineTemplate;
  onBack?: () => void;
  onRetry?: () => void;
  onDownload?: () => void;
  canRetry: boolean;
}) {
  const { t } = useTranslation();
  const completed = run.stages.filter((stage) => stage.status === "success").length;
  const progress = run.stages.length ? Math.round((completed / run.stages.length) * 100) : 0;

  return (
    <Card
      className={styles.detailCard}
      extra={
        <Space>
          {onDownload ? (
            <Button icon={<DownloadOutlined />} onClick={onDownload}>
              {t("dataIngestion.actions.download")}
            </Button>
          ) : null}
          {onBack ? <Button onClick={onBack}>{t("dataIngestion.actions.close")}</Button> : null}
          <Tag color={statusColor(run.status)}>{t(`dataIngestion.status.${run.status}`)}</Tag>
          {canRetry && run.status === "failed" ? (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              {t("dataIngestion.actions.retry")}
            </Button>
          ) : null}
        </Space>
      }
      title={`${t("dataIngestion.runs.detail")} · ${run.original_name}`}
    >
      <Descriptions column={{ lg: 4, md: 2, xs: 1 }} size="small">
        <Descriptions.Item label="Run ID">
          <Text code>{run.id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.inserted")}>
          {run.inserted_count}
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.duplicates")}>
          {run.duplicate_count}
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.size")}>
          {formatBytes(run.file_size)}
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.createdAt")}>
          {formatTime(run.created_at)}
        </Descriptions.Item>
        <Descriptions.Item label="Dataset">
          <Text code>{run.dataset_id}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="SHA-256">
          <Text copyable ellipsis={{ tooltip: run.fingerprint }}>
            {run.fingerprint || "-"}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="Template">
          <Text code>{run.template_code}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.contract.source")}>
          <Text ellipsis={{ tooltip: run.source_object }}>
            {run.source_object || run.original_name}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.cursorBefore")}>
          <Text code>{run.incremental_cursor_before || "-"}</Text>
        </Descriptions.Item>
        <Descriptions.Item label={t("dataIngestion.runs.cursorAfter")}>
          <Text code>{run.incremental_cursor_after || "-"}</Text>
        </Descriptions.Item>
      </Descriptions>
      <Progress
        percent={progress}
        size="small"
        status={run.status === "failed" ? "exception" : undefined}
      />
      {run.error_message ? (
        <Alert
          description={run.error_message}
          message={t("dataIngestion.runs.error")}
          showIcon
          style={{ marginBottom: 16 }}
          type="error"
        />
      ) : null}
      <StageDetail run={run} template={template} />
    </Card>
  );
}

export function DataIngestionWorkbenchScene({
  activeView,
  onViewChange,
  onOpenRun,
  onOpenCatalogResource,
}: DataIngestionWorkbenchSceneProps) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const runtimeConfig = useRuntimeConfig();
  const [searchParams] = useSearchParams();
  const requestedDatasetId = searchParams.get("dataset")?.trim() || "";
  const requestedDrawer = searchParams.get("drawer")?.trim() || "";
  const requestedSpaceId = searchParams.get("space")?.trim() || "";
  const can = useCallback(
    (permission: string) => runtimeConfig.currentUser.permissions.includes(permission),
    [runtimeConfig.currentUser.permissions],
  );

  const [overview, setOverview] = useState<DataIngestionOverview | null>(null);
  const [storageInfo, setStorageInfo] = useState<DataIngestionStorageInfo | null>(null);
  const [sources, setSources] = useState<DataIngestionDataSource[]>([]);
  const [datasets, setDatasets] = useState<DataIngestionDataset[]>([]);
  const [templates, setTemplates] = useState<DataIngestionPipelineTemplate[]>([]);
  const [scanJobs, setScanJobs] = useState<DataIngestionAutoScanJob[]>([]);
  const [controlDatabaseStatus, setControlDatabaseStatus] =
    useState<DataIngestionControlDatabaseStatus | null>(null);
  const [controlDatabaseLoading, setControlDatabaseLoading] = useState(true);
  const [controlDatabaseError, setControlDatabaseError] = useState("");
  const [controlDatabaseModalOpen, setControlDatabaseModalOpen] = useState(false);
  const [spaces, setSpaces] = useState<DataIngestionSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [spacesReady, setSpacesReady] = useState(false);
  const [spaceModalOpen, setSpaceModalOpen] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const [spaceForm] = Form.useForm<DataSpaceFormValues>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [sourceCatalog, setSourceCatalog] = useState<DataIngestionDatabaseCatalog | null>(null);
  const [sourceCatalogLoading, setSourceCatalogLoading] = useState(false);
  const [sourceCatalogError, setSourceCatalogError] = useState("");

  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [editingDatasetId, setEditingDatasetId] = useState<string | null>(null);
  const [datasetForm, setDatasetForm] = useState({
    name: "",
    description: "",
    data_type: "tabular",
    storage_mode: "auto" as "auto" | "shared" | "dedicated",
    upsert_keys: "",
  });

  const [importMode, setImportMode] = useState<ImportMode>("files");
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([]);
  const [activeUploadId, setActiveUploadId] = useState("");
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [browserPreviewUrl, setBrowserPreviewUrl] = useState("");
  const uploadSequenceRef = useRef(0);
  const uploadKeysRef = useRef(new Set<string>());
  const inspectedUploadCountRef = useRef(0);
  const [selectedDatasetId, setSelectedDatasetId] = useState(requestedDatasetId);
  useEffect(() => {
    if (requestedDatasetId) {
      setSelectedDatasetId(requestedDatasetId);
    }
  }, [requestedDatasetId]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("tabular_standard");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceIngestionSourceId, setSourceIngestionSourceId] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [sourceIngesting, setSourceIngesting] = useState(false);
  const [sourceIngestionRun, setSourceIngestionRun] = useState<DataIngestionRun | null>(null);
  const [sourceIngestionError, setSourceIngestionError] = useState("");
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [drawerRun, setDrawerRun] = useState<DataIngestionRun | null>(null);
  const [pipelineDrawer, setPipelineDrawer] = useState<DataIngestionPipelineTemplate | null>(null);
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<DataIngestionPipelineTemplate | null>(
    null,
  );
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const [runPipelineTarget, setRunPipelineTarget] = useState<DataIngestionPipelineTemplate | null>(
    null,
  );
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineRunResult, setPipelineRunResult] = useState<DataIngestionPipelineRunResult | null>(
    null,
  );
  const [agentManifest, setAgentManifest] = useState<DataIngestionAgentManifest | null>(null);
  const overviewPollInFlightRef = useRef(false);
  const drawerPollInFlightRef = useRef(false);
  const scanJobsPollInFlightRef = useRef(false);
  const qualityCheckPollInFlightRef = useRef(false);
  const autoOpenedDrawerRef = useRef("");

  const [selectedCatalogDatasetId, setSelectedCatalogDatasetId] = useState("");
  const [datasetSearch, setDatasetSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [records, setRecords] = useState<DataIngestionDatasetRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [contractDataset, setContractDataset] = useState<DataIngestionDataset | null>(null);
  const [datasetContract, setDatasetContract] = useState<DataIngestionDatasetContract | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractError, setContractError] = useState("");
  const [publishingDataset, setPublishingDataset] = useState(false);
  const [fullQualityCheck, setFullQualityCheck] = useState<DataIngestionQualityCheck | null>(null);
  const [startingQualityCheck, setStartingQualityCheck] = useState(false);
  const [backfillingProvenance, setBackfillingProvenance] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [provenanceRecord, setProvenanceRecord] = useState<DataIngestionDatasetRecord | null>(null);

  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [editingScanId, setEditingScanId] = useState<string | null>(null);
  const [scanForm, setScanForm] = useState(emptyScanForm);

  const activeUploadItem = uploadItems.find((item) => item.id === activeUploadId);
  const activeUploadFile = activeUploadItem?.file;
  const inspection = activeUploadItem?.inspection ?? null;
  const documentTables = useMemo(
    () => (inspection ? documentTablePreviews(inspection.metadata) : []),
    [inspection],
  );
  const inspecting = uploadItems.some((item) => item.status === "inspecting");
  const ingestionSources = sources.filter((source) => source.source_type !== "upload");
  const selectedIngestionSource = ingestionSources.find(
    (source) => source.id === sourceIngestionSourceId,
  );
  const selectedTemplate = templates.find((template) => template.code === selectedTemplateCode);
  const allUploadsReady =
    uploadItems.length > 0 &&
    uploadItems.every(
      (item) => Boolean(item.inspection) && !["inspecting", "error"].includes(item.status),
    );
  const allUploadsSupportedByTemplate =
    Boolean(selectedTemplate) &&
    uploadItems.every(
      (item) =>
        item.inspection && selectedTemplate?.supported_types.includes(item.inspection.file_type),
    );
  const activeSheet =
    inspection?.sheets[activeSheetIndex] ??
    (inspection
      ? {
          name: "default",
          index: 0,
          state: "visible",
          is_active: true,
          columns: inspection.columns,
          rows: inspection.rows,
          metadata: inspection.metadata,
          warnings: inspection.warnings,
        }
      : null);

  const selectedCatalogDataset = datasets.find(
    (dataset) => dataset.id === selectedCatalogDatasetId,
  );
  const activeSpace = spaces.find((space) => space.id === activeSpaceId);
  const hasActiveScanJobs = scanJobs.some((job) => ["queued", "running"].includes(job.status));
  const visibleDatasets = useMemo(() => {
    const keyword = datasetSearch.trim().toLowerCase();
    if (!keyword) {
      return datasets;
    }
    return datasets.filter((dataset) =>
      `${dataset.name} ${dataset.description}`.toLowerCase().includes(keyword),
    );
  }, [datasetSearch, datasets]);

  useEffect(() => {
    if (
      !activeUploadFile ||
      !(
        activeUploadFile.type.startsWith("image/") ||
        activeUploadFile.type.startsWith("video/") ||
        activeUploadFile.type === "application/pdf"
      )
    ) {
      setBrowserPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(activeUploadFile);
    setBrowserPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activeUploadFile]);

  const loadCore = useCallback(
    async (silent = false) => {
      if (!activeSpaceId) {
        return;
      }
      if (!silent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const [nextOverview, nextStorage, nextSources, nextDatasets, nextTemplates, nextManifest] =
          await Promise.all([
            dataIngestionService.overview(),
            dataIngestionService.getStorageInfo(),
            dataIngestionService.listSources(),
            dataIngestionService.listDatasets(),
            dataIngestionService.listTemplates(),
            dataIngestionService.getAgentManifest(),
          ]);
        setOverview(nextOverview);
        setStorageInfo(nextStorage);
        setSources(nextSources);
        setDatasets(nextDatasets);
        setTemplates(nextTemplates);
        setAgentManifest(nextManifest);
        setSelectedDatasetId((current) => current || nextDatasets[0]?.id || "");
        setSelectedCatalogDatasetId((current) => current || nextDatasets[0]?.id || "");
        setSelectedSourceId(
          (current) =>
            (nextSources.some((source) => source.id === current && source.source_type === "upload")
              ? current
              : "") ||
            nextSources.find((source) => source.source_type === "upload")?.id ||
            "",
        );
        setSourceIngestionSourceId(
          (current) =>
            (nextSources.some((source) => source.id === current && source.source_type !== "upload")
              ? current
              : "") ||
            nextSources.find((source) => source.source_type !== "upload")?.id ||
            "",
        );
      } catch (error) {
        message.error(
          t("dataIngestion.errors.load", {
            message: extractRequestErrorMessage(error),
          }),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeSpaceId, message, t],
  );

  const loadScanJobs = useCallback(
    async (silent = false) => {
      if (!activeSpaceId) {
        setScanJobs([]);
        return;
      }
      if (scanJobsPollInFlightRef.current) {
        return;
      }
      scanJobsPollInFlightRef.current = true;
      try {
        const next = await dataIngestionService.listScanJobs();
        setScanJobs(next);
      } catch (error) {
        if (!silent) {
          message.error(
            t("dataIngestion.errors.load", {
              message: extractRequestErrorMessage(error),
            }),
          );
        }
      } finally {
        scanJobsPollInFlightRef.current = false;
      }
    },
    [activeSpaceId, message, t],
  );

  const loadRecords = useCallback(
    async (datasetId = selectedCatalogDatasetId, page = recordsPage) => {
      if (!activeSpaceId || !datasetId) {
        setRecords([]);
        setRecordsTotal(0);
        return;
      }
      setRecordsLoading(true);
      try {
        const result = await dataIngestionService.listRecords(datasetId, {
          page,
          pageSize: DEFAULT_PAGE_SIZE,
          query: recordSearch,
        });
        setRecords(result.items);
        setRecordsTotal(result.total);
      } catch (error) {
        message.error(
          t("dataIngestion.errors.load", {
            message: extractRequestErrorMessage(error),
          }),
        );
      } finally {
        setRecordsLoading(false);
      }
    },
    [activeSpaceId, message, recordSearch, recordsPage, selectedCatalogDatasetId, t],
  );

  const loadDataSpaces = useCallback(async () => {
    try {
      const nextSpaces = await dataIngestionService.listDataSpaces();
      const storedSpaceId = window.localStorage.getItem("data-ingestion.active-space");
      const selected =
        nextSpaces.find((space) => space.id === requestedSpaceId) ??
        nextSpaces.find((space) => space.id === storedSpaceId) ??
        nextSpaces.find((space) => space.is_default) ??
        nextSpaces[0];
      if (selected) {
        setDataIngestionSpace(selected.id);
        setActiveSpaceId(selected.id);
      }
      setSpaces(nextSpaces);
      setSpacesReady(true);
      setControlDatabaseError("");
    } catch (error) {
      setSpacesReady(true);
      throw error;
    }
  }, [requestedSpaceId]);

  useEffect(() => {
    let cancelled = false;
    setControlDatabaseLoading(true);
    void dataIngestionService
      .getControlDatabaseStatus()
      .then(async (status) => {
        if (cancelled) {
          return;
        }
        setControlDatabaseStatus(status);
        if (!status.initialized) {
          setControlDatabaseError("");
          return;
        }
        await loadDataSpaces();
      })
      .catch((error) => {
        if (!cancelled) {
          setSpacesReady(true);
          setControlDatabaseError(
            t("dataIngestion.errors.load", {
              message: extractRequestErrorMessage(error),
            }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setControlDatabaseLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadDataSpaces, message, t]);

  useEffect(() => {
    if (spacesReady && activeSpaceId) {
      void loadCore();
    }
  }, [activeSpaceId, loadCore, spacesReady]);

  useEffect(() => {
    if (spacesReady && activeSpaceId && activeView === "auto-scan") {
      void loadScanJobs();
    }
  }, [activeSpaceId, activeView, loadScanJobs, spacesReady]);

  useEffect(() => {
    if (activeView !== "auto-scan" || !hasActiveScanJobs) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadScanJobs(true);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeView, hasActiveScanJobs, loadScanJobs]);

  useEffect(() => {
    if (spacesReady && activeSpaceId && activeView === "catalog") {
      void loadRecords(selectedCatalogDatasetId, 1);
    }
  }, [activeSpaceId, activeView, loadRecords, selectedCatalogDatasetId, spacesReady]);

  useEffect(() => {
    if (
      activeView !== "catalog" ||
      datasets.length === 0 ||
      !requestedDatasetId ||
      !requestedDrawer
    ) {
      return;
    }
    const dataset = datasets.find((item) => item.id === requestedDatasetId);
    if (!dataset) {
      return;
    }
    const requestKey = `${requestedDatasetId}:${requestedDrawer}`;
    if (autoOpenedDrawerRef.current === requestKey) {
      return;
    }
    autoOpenedDrawerRef.current = requestKey;
    setSelectedCatalogDatasetId(dataset.id);
    setRecordsPage(1);
    if (requestedDrawer === "contract") {
      setContractDataset(dataset);
      setDatasetContract(null);
      setContractError("");
      setContractLoading(true);
      void Promise.all([
        dataIngestionService.getDatasetContract(dataset.id),
        dataIngestionService.getLatestFullDatasetQualityCheck(dataset.id),
      ])
        .then(([contract, latestCheck]) => {
          setDatasetContract(contract);
          setFullQualityCheck(latestCheck);
        })
        .catch((error) => {
          setContractError(extractRequestErrorMessage(error));
        })
        .finally(() => {
          setContractLoading(false);
        });
    }
    if (requestedDrawer === "provenance") {
      setProvenanceRecord(null);
      setProvenanceOpen(true);
    }
  }, [activeView, datasets, requestedDatasetId, requestedDrawer]);

  useEffect(() => {
    if (activeView !== "overview" || !overview?.active_runs) {
      return;
    }
    const timer = window.setInterval(() => {
      if (overviewPollInFlightRef.current) {
        return;
      }
      overviewPollInFlightRef.current = true;
      void dataIngestionService
        .overview()
        .then(setOverview)
        .catch(() => {
          // Background refresh failures are retried on the next interval.
        })
        .finally(() => {
          overviewPollInFlightRef.current = false;
        });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activeView, overview?.active_runs]);

  useEffect(() => {
    if (!runDetailOpen || !drawerRun || !["queued", "running"].includes(drawerRun.status)) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (drawerPollInFlightRef.current) {
        return;
      }
      drawerPollInFlightRef.current = true;
      void dataIngestionService
        .getRun(drawerRun.id)
        .then((next) => {
          if (!cancelled) {
            setDrawerRun(next);
          }
        })
        .catch(() => {
          // Keep the last visible snapshot while the service is retried.
        })
        .finally(() => {
          drawerPollInFlightRef.current = false;
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [drawerRun, runDetailOpen]);

  useEffect(() => {
    if (
      !contractDataset ||
      !fullQualityCheck ||
      !["queued", "running"].includes(fullQualityCheck.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      if (qualityCheckPollInFlightRef.current) {
        return;
      }
      qualityCheckPollInFlightRef.current = true;
      void dataIngestionService
        .getLatestFullDatasetQualityCheck(contractDataset.id)
        .then(setFullQualityCheck)
        .catch(() => {
          // Keep the current status and retry on the next interval.
        })
        .finally(() => {
          qualityCheckPollInFlightRef.current = false;
        });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [contractDataset, fullQualityCheck]);

  async function saveSource() {
    if (!sourceForm.name.trim()) {
      message.error(t("dataIngestion.sources.nameRequired"));
      return;
    }
    const sourceIsDatabase = ["mysql", "postgres"].includes(sourceForm.source_type);
    if (sourceIsDatabase) {
      if (!sourceForm.table_names.length) {
        message.error(t("dataIngestion.sources.tableNameRequired"));
        return;
      }
    }
    try {
      let headers: Record<string, string> = {};
      let body: Record<string, unknown> = {};
      if (sourceForm.source_type === "api") {
        try {
          headers = JSON.parse(sourceForm.headers || "{}") as Record<string, string>;
          body = sourceForm.body.trim()
            ? (JSON.parse(sourceForm.body) as Record<string, unknown>)
            : {};
        } catch {
          message.error(t("dataIngestion.sources.invalidJson"));
          return;
        }
      }
      const payload = {
        name: sourceForm.name.trim(),
        source_type: sourceForm.source_type,
        config: {
          body: sourceForm.source_type === "api" ? body : undefined,
          headers: sourceForm.source_type === "api" ? headers : undefined,
          host: sourceForm.source_type === "api" ? undefined : sourceForm.host || undefined,
          method: sourceForm.source_type === "api" ? sourceForm.method : undefined,
          pagination_type:
            sourceForm.source_type === "api" ? sourceForm.pagination_type : undefined,
          page_param: sourceForm.source_type === "api" ? sourceForm.page_param : undefined,
          page_size: sourceForm.source_type === "api" ? Number(sourceForm.page_size) : undefined,
          max_pages: sourceForm.source_type === "api" ? Number(sourceForm.max_pages) : undefined,
          next_url_path:
            sourceForm.source_type === "api" ? sourceForm.next_url_path || undefined : undefined,
          url: sourceForm.source_type === "api" ? sourceForm.host || undefined : undefined,
          port: sourceForm.port || undefined,
          path: sourceForm.path || undefined,
          username: sourceForm.username || undefined,
          password: sourceForm.password || undefined,
          database: sourceForm.database || undefined,
          private_key: sourceForm.private_key || undefined,
          query_mode: sourceIsDatabase ? "table" : undefined,
          sync_mode: sourceIsDatabase ? "full" : undefined,
          table_name:
            sourceIsDatabase && sourceForm.table_names.length === 1
              ? sourceForm.table_name || undefined
              : undefined,
          table_names: sourceIsDatabase ? sourceForm.table_names : undefined,
          schema_name: sourceIsDatabase ? sourceForm.schema_name || undefined : undefined,
          record_path:
            sourceForm.source_type === "api" ? sourceForm.record_path || undefined : undefined,
          use_tls: sourceForm.source_type === "ftp" ? sourceForm.use_tls : undefined,
          watermark_column: undefined,
        },
      };
      if (editingSourceId) {
        await dataIngestionService.updateSource(editingSourceId, payload);
      } else {
        await dataIngestionService.createSource(payload);
      }
      setSourceModalOpen(false);
      setEditingSourceId(null);
      setSourceForm(emptySourceForm());
      setSourceCatalog(null);
      setSourceCatalogError("");
      message.success(t("dataIngestion.sources.saved"));
      await loadCore(true);
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  async function loadDatabaseCatalog(tableName = "") {
    setSourceCatalogLoading(true);
    setSourceCatalogError("");
    try {
      const catalog = await dataIngestionService.inspectSourceDatabase({
        source_id: editingSourceId ?? undefined,
        source_type: sourceForm.source_type,
        table_name: tableName || undefined,
        config: {
          host: sourceForm.host || undefined,
          port: sourceForm.port ? Number(sourceForm.port) : undefined,
          database: sourceForm.database || undefined,
          username: sourceForm.username || undefined,
          password: sourceForm.password || undefined,
          schema_name: sourceForm.schema_name || undefined,
        },
      });
      setSourceCatalog(catalog);
      if (tableName) {
        setSourceForm((current) => ({
          ...current,
          table_name: catalog.table_name || current.table_names[0] || "",
          schema_name: catalog.schema_name,
          sync_mode: "full",
          watermark_column: "",
          initial_cursor: "",
        }));
      }
    } catch (error) {
      const detail = extractRequestErrorMessage(error);
      const errorKind = classifySourceConnectionError(detail);
      const title = t(`dataIngestion.sources.connectionErrorTitles.${errorKind}`);
      const hint = t(`dataIngestion.sources.connectionErrorHints.${errorKind}`);
      setSourceCatalogError(detail);
      message.error(
        <div>
          <div>{title}</div>
          <div>{hint}</div>
          <div>{detail}</div>
        </div>,
        10,
      );
    } finally {
      setSourceCatalogLoading(false);
    }
  }

  async function openDatasetContract(dataset: DataIngestionDataset) {
    setContractDataset(dataset);
    setDatasetContract(null);
    setContractError("");
    setContractLoading(true);
    try {
      const [contract, latestCheck] = await Promise.all([
        dataIngestionService.getDatasetContract(dataset.id),
        dataIngestionService.getLatestFullDatasetQualityCheck(dataset.id),
      ]);
      setDatasetContract(contract);
      setFullQualityCheck(latestCheck);
    } catch (error) {
      setContractError(extractRequestErrorMessage(error));
    } finally {
      setContractLoading(false);
    }
  }

  function openDatasetProvenance(record: DataIngestionDatasetRecord | null = null) {
    if (!selectedCatalogDataset) {
      return;
    }
    setProvenanceRecord(record);
    setProvenanceOpen(true);
  }

  async function startFullQualityCheck() {
    if (!contractDataset) {
      return;
    }
    setStartingQualityCheck(true);
    try {
      setFullQualityCheck(
        await dataIngestionService.startFullDatasetQualityCheck(contractDataset.id),
      );
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setStartingQualityCheck(false);
    }
  }

  async function backfillProvenance() {
    if (!contractDataset) {
      return;
    }
    setBackfillingProvenance(true);
    try {
      const result = await dataIngestionService.backfillDatasetProvenance(contractDataset.id);
      message.success(
        t("dataIngestion.contract.provenanceBackfilled", {
          count: result.updated_records,
        }),
      );
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setBackfillingProvenance(false);
    }
  }

  async function publishDatasetContract() {
    if (!contractDataset) {
      return;
    }
    setPublishingDataset(true);
    try {
      const publication = await dataIngestionService.publishDataset(contractDataset.id);
      setDatasetContract((current) => (current ? { ...current, publication } : current));
      message.success(t("dataIngestion.contract.published"));
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
      setDatasetContract((current) =>
        current
          ? {
              ...current,
              publication: {
                ...current.publication,
                status: "failed",
                last_error: extractRequestErrorMessage(error),
              },
            }
          : current,
      );
    } finally {
      setPublishingDataset(false);
    }
  }

  function changeSpace(spaceId: string) {
    setDataIngestionSpace(spaceId);
    setActiveSpaceId(spaceId);
    window.localStorage.setItem("data-ingestion.active-space", spaceId);
    setOverview(null);
    setStorageInfo(null);
    setSources([]);
    setDatasets([]);
    setTemplates([]);
    setScanJobs([]);
    setRecords([]);
    setRecordsTotal(0);
    setSelectedDatasetId("");
    setSelectedCatalogDatasetId("");
    setSelectedSourceId("");
    setSourceIngestionSourceId("");
    setSourceIngestionRun(null);
    setSourceIngestionError("");
    setUploadItems([]);
    setActiveUploadId("");
    setActiveSheetIndex(0);
    uploadKeysRef.current.clear();
    inspectedUploadCountRef.current = 0;
    setDrawerRun(null);
  }

  async function saveDataSpace(values: DataSpaceFormValues) {
    setCreatingSpace(true);
    try {
      const databaseUrl = buildMysqlConnectionUrl({
        databaseName: values.database_name,
        host: values.host,
        password: values.password || "",
        port: values.port,
        username: values.username,
      });
      const created = await dataIngestionService.createDataSpace({
        name: values.name.trim(),
        slug: createDataSpaceSlug(values.name, values.database_name),
        database_url: databaseUrl,
      });
      try {
        await dataIngestionService.syncDataSpaceCatalog(created.id);
      } catch (error) {
        message.warning(
          t("dataIngestion.spaces.catalogSyncWarning", {
            message: extractRequestErrorMessage(error),
          }),
        );
      }
      setSpaces((current) => [...current, created]);
      spaceForm.resetFields();
      setSpaceModalOpen(false);
      changeSpace(created.id);
      message.success(t("dataIngestion.spaces.created"));
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    } finally {
      setCreatingSpace(false);
    }
  }

  async function handleControlDatabaseInitialized(status: DataIngestionControlDatabaseStatus) {
    setControlDatabaseStatus(status);
    setDataIngestionSpace("");
    setActiveSpaceId("");
    setSpaces([]);
    setSpacesReady(false);
    setOverview(null);
    setStorageInfo(null);
    setSources([]);
    setDatasets([]);
    setTemplates([]);
    setScanJobs([]);
    setRecords([]);
    setRecordsTotal(0);
    setSelectedDatasetId("");
    setSelectedCatalogDatasetId("");
    setSelectedSourceId("");
    setSourceIngestionSourceId("");
    setSourceIngestionRun(null);
    setSourceIngestionError("");
    setUploadItems([]);
    setActiveUploadId("");
    setActiveSheetIndex(0);
    uploadKeysRef.current.clear();
    inspectedUploadCountRef.current = 0;
    setDrawerRun(null);
    try {
      await loadDataSpaces();
    } catch (error) {
      const detail = t("dataIngestion.errors.load", {
        message: extractRequestErrorMessage(error),
      });
      setControlDatabaseError(detail);
      message.error(detail);
    }
  }

  async function testSource(sourceId: string) {
    try {
      await dataIngestionService.testSource(sourceId);
      message.success(t("dataIngestion.sources.passed"));
      await loadCore(true);
    } catch (error) {
      const detail = extractRequestErrorMessage(error);
      const errorKind = classifySourceConnectionError(detail);
      message.error(
        <div>
          <div>{t(`dataIngestion.sources.connectionErrorTitles.${errorKind}`)}</div>
          <div>{t(`dataIngestion.sources.connectionErrorHints.${errorKind}`)}</div>
          <div>{detail}</div>
        </div>,
        10,
      );
    }
  }

  function openSourceEditor(source: DataIngestionDataSource) {
    const config = source.config;
    setEditingSourceId(source.id);
    setSourceForm({
      body: JSON.stringify(config.body ?? {}, null, 2),
      headers: JSON.stringify(config.headers ?? {}, null, 2),
      name: source.name,
      source_type: source.source_type,
      method: typeof config.method === "string" ? config.method : "GET",
      pagination_type: typeof config.pagination_type === "string" ? config.pagination_type : "none",
      page_param: typeof config.page_param === "string" ? config.page_param : "page",
      page_size: displayValue(config.page_size ?? "100"),
      max_pages: displayValue(config.max_pages ?? "10"),
      next_url_path: typeof config.next_url_path === "string" ? config.next_url_path : "",
      host:
        source.source_type === "api"
          ? typeof config.url === "string"
            ? config.url
            : ""
          : typeof config.host === "string"
            ? config.host
            : "",
      port: config.port === undefined || config.port === null ? "" : displayValue(config.port),
      path: typeof config.path === "string" ? config.path : "",
      username: typeof config.username === "string" ? config.username : "",
      password: "",
      database: typeof config.database === "string" ? config.database : "",
      private_key: "",
      query_mode: "table",
      sync_mode: "full",
      table_name: typeof config.table_name === "string" ? config.table_name : "",
      table_names: Array.isArray(config.table_names)
        ? config.table_names
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        : typeof config.table_name === "string" && config.table_name
          ? [config.table_name]
          : [],
      schema_name: typeof config.schema_name === "string" ? config.schema_name : "",
      initial_cursor: "",
      record_path: typeof config.record_path === "string" ? config.record_path : "",
      use_tls: config.use_tls === true,
      watermark_column: "",
    });
    setSourceCatalog(null);
    setSourceCatalogError("");
    setSourceModalOpen(true);
  }

  async function saveDataset() {
    if (!datasetForm.name.trim()) {
      return;
    }
    try {
      const wasEditing = Boolean(editingDatasetId);
      const payload = {
        name: datasetForm.name.trim(),
        description: datasetForm.description.trim(),
        data_type: datasetForm.data_type,
        upsert_keys: datasetForm.upsert_keys
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      };
      const dataset = editingDatasetId
        ? await dataIngestionService.updateDataset(editingDatasetId, payload)
        : await dataIngestionService.createDataset({
            ...payload,
            storage_mode: datasetForm.storage_mode,
          });
      setDatasetModalOpen(false);
      setEditingDatasetId(null);
      setDatasetForm({
        name: "",
        description: "",
        data_type: "tabular",
        storage_mode: "auto",
        upsert_keys: "",
      });
      setSelectedDatasetId(dataset.id);
      setSelectedCatalogDatasetId(dataset.id);
      message.success(
        t(wasEditing ? "dataIngestion.catalog.updated" : "dataIngestion.catalog.created"),
      );
      await loadCore(true);
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  function updateUploadItem(id: string, update: Partial<UploadQueueItem>) {
    setUploadItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  function queueUploadFiles(files: File[]) {
    const nextItems = files
      .filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (uploadKeysRef.current.has(key)) {
          return false;
        }
        uploadKeysRef.current.add(key);
        return true;
      })
      .map((file) => ({
        id: `upload-${++uploadSequenceRef.current}`,
        file,
        status: "inspecting" as const,
      }));
    if (!nextItems.length) {
      return;
    }
    setUploadItems((current) => [...current, ...nextItems]);
    setActiveUploadId(nextItems[0].id);
    setActiveSheetIndex(0);
    nextItems.forEach((item) => void inspectUploadItem(item));
  }

  async function inspectUploadItem(item: UploadQueueItem) {
    try {
      const inspectionResult = await dataIngestionService.inspectUpload(item.file);
      updateUploadItem(item.id, {
        error: "",
        inspection: inspectionResult,
        status: "ready",
      });
      if (activeUploadId === item.id || !activeUploadId) {
        setActiveSheetIndex(
          Math.max(
            0,
            inspectionResult.sheets.findIndex((sheet) => sheet.is_active),
          ),
        );
      }
      if (inspectedUploadCountRef.current === 0) {
        setSelectedTemplateCode(inspectionResult.recommended_pipeline);
        const recommendedType = {
          tabular_standard: "tabular",
          document_standard: "document",
          media_standard: "media",
        }[inspectionResult.recommended_pipeline];
        const dataset = datasets.find((candidate) => candidate.data_type === recommendedType);
        if (dataset) {
          setSelectedDatasetId(dataset.id);
        }
      }
      inspectedUploadCountRef.current += 1;
    } catch (error) {
      const detail = extractRequestErrorMessage(error);
      updateUploadItem(item.id, {
        error: detail,
        status: "error",
      });
      message.error(`${item.file.name}: ${detail}`, 8);
    }
  }

  function removeUploadItem(id: string) {
    const item = uploadItems.find((candidate) => candidate.id === id);
    if (item && !ingesting) {
      uploadKeysRef.current.delete(`${item.file.name}:${item.file.size}:${item.file.lastModified}`);
      setUploadItems((current) => current.filter((candidate) => candidate.id !== id));
      if (activeUploadId === id) {
        const remaining = uploadItems.filter((candidate) => candidate.id !== id);
        setActiveUploadId(remaining[0]?.id ?? "");
        setActiveSheetIndex(0);
      }
    }
  }

  async function waitForRunCompletion(runId: string) {
    let current = await dataIngestionService.getRun(runId);
    while (["queued", "running"].includes(current.status)) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      current = await dataIngestionService.getRun(runId);
    }
    return current;
  }

  async function startFileIngestion() {
    if (!uploadItems.length) {
      message.warning(t("dataIngestion.errors.selectFile"));
      return;
    }
    if (!allUploadsReady) {
      message.warning(t("dataIngestion.import.waitForPreview"));
      return;
    }
    if (!selectedDatasetId) {
      message.warning(t("dataIngestion.errors.selectDataset"));
      return;
    }
    if (!selectedTemplateCode) {
      message.warning(t("dataIngestion.errors.selectTemplate"));
      return;
    }
    if (!allUploadsSupportedByTemplate) {
      message.warning(t("dataIngestion.import.pipelineUnsupportedFiles"));
      return;
    }
    setIngesting(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const item of uploadItems) {
        updateUploadItem(item.id, { error: "", run: undefined, status: "queued" });
        try {
          const queuedRun = await dataIngestionService.createRun({
            datasetId: selectedDatasetId,
            file: item.file,
            sourceId: selectedSourceId || undefined,
            templateCode: selectedTemplateCode,
          });
          updateUploadItem(item.id, {
            run: queuedRun,
            status: queuedRun.status as UploadQueueStatus,
          });
          const completedRun = await waitForRunCompletion(queuedRun.id);
          updateUploadItem(item.id, {
            run: completedRun,
            status: completedRun.status === "success" ? "success" : "failed",
          });
          if (completedRun.status === "success") {
            succeeded += 1;
          } else {
            failed += 1;
          }
        } catch (error) {
          failed += 1;
          updateUploadItem(item.id, {
            error: extractRequestErrorMessage(error),
            status: "failed",
          });
        }
      }
      if (succeeded > 0 && activeSpaceId) {
        void dataIngestionService.publishDataset(selectedDatasetId).catch(() => {
          // Ingestion already succeeded; publication can be retried from the dataset drawer.
        });
      }
      if (failed === 0) {
        message.success(t("dataIngestion.import.batchSucceeded", { count: succeeded }));
      } else {
        message.warning(
          t("dataIngestion.import.batchPartial", {
            failed,
            succeeded,
          }),
        );
      }
      await loadCore(true);
    } finally {
      setIngesting(false);
    }
  }

  async function startSourceIngestion() {
    if (!selectedIngestionSource) {
      message.warning(t("dataIngestion.import.selectSource"));
      return;
    }
    if (!selectedDatasetId) {
      message.warning(t("dataIngestion.errors.selectDataset"));
      return;
    }
    if (!selectedTemplateCode) {
      message.warning(t("dataIngestion.errors.selectTemplate"));
      return;
    }
    setSourceIngesting(true);
    setSourceIngestionRun(null);
    setSourceIngestionError("");
    try {
      const result = await dataIngestionService.runSourceIngestion({
        datasetId: selectedDatasetId,
        name: t("dataIngestion.import.sourceRunName", {
          source: selectedIngestionSource.name,
        }),
        path:
          typeof selectedIngestionSource.config.path === "string"
            ? selectedIngestionSource.config.path
            : "",
        scanType: scanTypeForSource(selectedIngestionSource),
        sourceId: selectedIngestionSource.id,
        templateCode: selectedTemplateCode,
      });
      setSourceIngestionRun(result.run);
      if (result.job.last_error) {
        setSourceIngestionError(result.job.last_error);
        message.error(
          t("dataIngestion.import.failedDetail", {
            message: result.job.last_error,
          }),
          8,
        );
      } else if (!result.run) {
        message.warning(t("dataIngestion.import.noSourceData"));
      } else if (result.run.status === "success") {
        message.success(
          t("dataIngestion.import.saved", {
            duplicates: result.run.duplicate_count,
            inserted: result.run.inserted_count,
            updated: result.run.updated_count,
          }),
        );
        void dataIngestionService.publishDataset(selectedDatasetId).catch(() => {
          // Ingestion already succeeded; publication can be retried from the dataset drawer.
        });
      } else {
        setSourceIngestionError(result.run.error_message || t("dataIngestion.import.failed"));
        message.error(
          t("dataIngestion.import.failedDetail", {
            message: result.run.error_message || t("dataIngestion.import.failed"),
          }),
          8,
        );
      }
      await loadCore(true);
    } catch (error) {
      const detail = extractRequestErrorMessage(error);
      setSourceIngestionError(detail);
      message.error(detail, 8);
    } finally {
      setSourceIngesting(false);
    }
  }

  async function openRun(run: DataIngestionRunListItem) {
    try {
      const next = await dataIngestionService.getRun(run.id);
      setDrawerRun(next);
      setRunDetailOpen(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function retryRun(runToRetry: DataIngestionRun) {
    try {
      const next = await dataIngestionService.retryRun(runToRetry.id);
      if (onOpenRun) {
        onOpenRun(next.id);
      }
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function downloadRunAsset(runToDownload: DataIngestionRun) {
    try {
      await dataIngestionService.downloadRunAsset(runToDownload.id, runToDownload.original_name);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function saveScanJob() {
    if (!scanForm.name.trim()) {
      message.error(t("dataIngestion.autoScan.nameRequired"));
      return;
    }
    if (!scanForm.source_id) {
      message.error(t("dataIngestion.import.selectSource"));
      return;
    }
    if (!scanForm.dataset_id) {
      message.error(t("dataIngestion.errors.selectDataset"));
      return;
    }
    try {
      const wasEditing = Boolean(editingScanId);
      if (editingScanId) {
        await dataIngestionService.updateScanJob(editingScanId, scanForm);
      } else {
        await dataIngestionService.createScanJob(scanForm);
      }
      setScanModalOpen(false);
      setEditingScanId(null);
      setScanForm(emptyScanForm());
      message.success(
        t(wasEditing ? "dataIngestion.autoScan.updated" : "dataIngestion.autoScan.created"),
      );
      await loadScanJobs();
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  async function runScanJob(jobId: string) {
    try {
      await dataIngestionService.runScanJob(jobId);
      message.success(t("dataIngestion.autoScan.triggered"));
      await loadScanJobs();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteScanJob(jobId: string) {
    try {
      await dataIngestionService.deleteScanJob(jobId);
      message.success(t("dataIngestion.autoScan.deleted"));
      await loadScanJobs();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteSource(sourceId: string) {
    try {
      await dataIngestionService.deleteSource(sourceId);
      message.success(t("dataIngestion.sources.deleted"));
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteDataset(datasetId: string) {
    try {
      await dataIngestionService.deleteDataset(datasetId);
      if (selectedDatasetId === datasetId) {
        setSelectedDatasetId("");
      }
      if (selectedCatalogDatasetId === datasetId) {
        setSelectedCatalogDatasetId("");
        setRecords([]);
        setRecordsTotal(0);
      }
      message.success(t("dataIngestion.catalog.deleted"));
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  function openDatasetEditor(dataset: DataIngestionDataset) {
    setEditingDatasetId(dataset.id);
    setDatasetForm({
      name: dataset.name,
      description: dataset.description,
      data_type: dataset.data_type,
      storage_mode: dataset.storage_mode ?? "auto",
      upsert_keys: (dataset.upsert_keys ?? []).join(", "),
    });
    setDatasetModalOpen(true);
  }

  function openDatasetCreator() {
    setEditingDatasetId(null);
    setDatasetForm({
      name: "",
      description: "",
      data_type: "tabular",
      storage_mode: "auto",
      upsert_keys: "",
    });
    setDatasetModalOpen(true);
  }

  async function deletePipeline(pipelineId: string) {
    try {
      await dataIngestionService.deletePipeline(pipelineId);
      message.success(t("dataIngestion.pipelines.deleted"));
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteRun(runId: string) {
    try {
      await dataIngestionService.deleteRun(runId);
      message.success(t("dataIngestion.runs.deleted"));
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function createPipeline(
    payload: Parameters<typeof dataIngestionService.createPipeline>[0],
  ) {
    setCreatingPipeline(true);
    try {
      if (editingPipeline) {
        await dataIngestionService.updatePipeline(editingPipeline.id, {
          description: payload.description,
          name: payload.name,
          steps: payload.steps,
          supported_types: payload.supported_types,
          enabled: payload.enabled,
        });
      } else {
        await dataIngestionService.createPipeline(payload);
      }
      setPipelineModalOpen(false);
      message.success(
        t(editingPipeline ? "dataIngestion.pipelines.updated" : "dataIngestion.pipelines.created"),
      );
      setEditingPipeline(null);
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setCreatingPipeline(false);
    }
  }

  async function runPipeline(
    inputs: Record<string, unknown>,
    stepInputs: Record<string, Record<string, unknown>>,
  ) {
    if (!runPipelineTarget) return;
    setRunningPipeline(true);
    setPipelineRunResult(null);
    try {
      const result = await dataIngestionService.runUserPipeline(
        runPipelineTarget.id,
        inputs,
        stepInputs,
      );
      setPipelineRunResult(result);
      message.success(
        t("dataIngestion.pipelines.runCompleted", {
          count: result.results.length,
        }),
      );
      if (activeSpaceId) {
        void dataIngestionService.syncDataSpaceCatalog(activeSpaceId);
      }
      await loadCore(true);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setRunningPipeline(false);
    }
  }

  async function setScanEnabled(job: DataIngestionAutoScanJob, enabled: boolean) {
    try {
      await dataIngestionService.updateScanJob(job.id, { enabled });
      await loadScanJobs();
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  const sourceColumns: ColumnsType<DataIngestionDataSource> = [
    {
      title: t("dataIngestion.sources.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("dataIngestion.sources.type"),
      dataIndex: "source_type",
      key: "type",
      render: (value: string) => t(`dataIngestion.sourceTypes.${value}`, { defaultValue: value }),
    },
    {
      title: t("dataIngestion.sources.location"),
      key: "location",
      render: (_, item) => displayValue(item.config.path || item.config.host || item.config.url),
    },
    {
      title: t("dataIngestion.sources.status"),
      dataIndex: "status",
      key: "status",
      render: (value: string) => (
        <Tag color={statusColor(value)}>
          {t(`dataIngestion.status.${value}`, { defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t("dataIngestion.sources.lastChecked"),
      dataIndex: "last_checked_at",
      key: "lastChecked",
      render: formatTime,
    },
    {
      key: "actions",
      render: (_, item) => (
        <Space>
          <Button
            disabled={!can("data_ingestion:modify")}
            onClick={() => openSourceEditor(item)}
            type="link"
          >
            {t("dataIngestion.agent.edit")}
          </Button>
          <Button
            disabled={!can("data_ingestion:modify")}
            onClick={() => void testSource(item.id)}
            type="link"
          >
            {t("dataIngestion.actions.test")}
          </Button>
          <Popconfirm
            onConfirm={() => void deleteSource(item.id)}
            title={t("dataIngestion.actions.delete")}
          >
            <Button danger disabled={!can("data_ingestion:delete")} type="link">
              {t("dataIngestion.actions.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<DataIngestionRunListItem> = [
    {
      title: t("dataIngestion.runs.fileName"),
      key: "file",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text strong>{item.original_name}</Text>
          <Text code>{item.id}</Text>
        </Space>
      ),
    },
    {
      title: t("dataIngestion.runs.dataset"),
      key: "dataset",
      render: (_, item) =>
        datasets.find((dataset) => dataset.id === item.dataset_id)?.name || item.dataset_id,
    },
    {
      title: t("dataIngestion.runs.status"),
      dataIndex: "status",
      key: "status",
      render: (value: string) => (
        <Tag color={statusColor(value)}>
          {t(`dataIngestion.status.${value}`, { defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t("dataIngestion.runs.inserted"),
      dataIndex: "inserted_count",
      key: "inserted",
    },
    {
      title: t("dataIngestion.runs.updated"),
      dataIndex: "updated_count",
      key: "updated",
    },
    {
      title: t("dataIngestion.runs.duplicates"),
      dataIndex: "duplicate_count",
      key: "duplicates",
    },
    {
      title: t("dataIngestion.runs.size"),
      dataIndex: "file_size",
      key: "size",
      render: formatBytes,
    },
    {
      title: t("dataIngestion.runs.createdAt"),
      dataIndex: "created_at",
      key: "createdAt",
      render: formatTime,
    },
    {
      key: "actions",
      render: (_, item) => (
        <Space>
          <Button onClick={() => void openRun(item)} type="link">
            {t("dataIngestion.actions.open")}
          </Button>
          <Popconfirm
            disabled={["queued", "running"].includes(item.status)}
            onConfirm={() => void deleteRun(item.id)}
            title={t("dataIngestion.actions.delete")}
          >
            <Button
              danger
              disabled={
                !can("data_ingestion:delete") || ["queued", "running"].includes(item.status)
              }
              type="link"
            >
              {t("dataIngestion.actions.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const datasetColumns: ColumnsType<DataIngestionDataset> = [
    {
      title: t("dataIngestion.catalog.datasetName"),
      key: "name",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text strong>{item.name}</Text>
          <Text type="secondary">{item.description || "-"}</Text>
        </Space>
      ),
    },
    {
      title: t("dataIngestion.catalog.dataType"),
      dataIndex: "data_type",
      key: "dataType",
      render: (value: string) => t(`dataIngestion.dataTypes.${value}`, { defaultValue: value }),
    },
    {
      title: t("dataIngestion.catalog.storageMode"),
      key: "storageMode",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Tag color={item.storage_mode === "dedicated" ? "blue" : "default"}>
            {t(`dataIngestion.catalog.storageModes.${item.storage_mode}`, {
              defaultValue: item.storage_mode,
            })}
          </Tag>
          {item.physical_table ? <Text code>{item.physical_table}</Text> : null}
        </Space>
      ),
    },
    {
      title: t("dataIngestion.catalog.records"),
      dataIndex: "record_count",
      key: "records",
    },
    {
      title: t("dataIngestion.catalog.upsertKeys"),
      key: "upsertKeys",
      render: (_, item) => (
        <Space wrap size={4}>
          {(item.upsert_keys ?? []).length
            ? item.upsert_keys?.map((key) => <Tag key={key}>{key}</Tag>)
            : "-"}
        </Space>
      ),
    },
    {
      title: t("dataIngestion.catalog.lastIngested"),
      dataIndex: "last_ingested_at",
      key: "lastIngested",
      render: formatTime,
    },
    {
      key: "actions",
      render: (_, item) => (
        <Space size={4}>
          <Button
            onClick={() => {
              setSelectedCatalogDatasetId(item.id);
              setProvenanceRecord(null);
              setRecordsPage(1);
              void loadRecords(item.id, 1);
            }}
            type="link"
          >
            {t("dataIngestion.actions.open")}
          </Button>
          <Button
            icon={<ApartmentOutlined />}
            onClick={() => {
              setSelectedCatalogDatasetId(item.id);
              setProvenanceRecord(null);
              setProvenanceOpen(true);
            }}
            type="link"
          >
            {t("dataIngestion.provenance.title")}
          </Button>
          <Button
            disabled={!can("data_ingestion:modify")}
            onClick={() => openDatasetEditor(item)}
            type="link"
          >
            {t("dataIngestion.agent.edit")}
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => void openDatasetContract(item)}
            type="link"
          >
            {t("dataIngestion.contract.title")}
          </Button>
          {onOpenCatalogResource ? (
            <>
              <Button
                onClick={() =>
                  onOpenCatalogResource(
                    `data-ingestion:dataset:${encodeURIComponent(activeSpaceId)}:${encodeURIComponent(item.id)}`,
                    "detail",
                  )
                }
                type="link"
              >
                {t("dataIngestion.actions.openCatalog")}
              </Button>
              <Button
                onClick={() =>
                  onOpenCatalogResource(
                    `data-ingestion:dataset:${encodeURIComponent(activeSpaceId)}:${encodeURIComponent(item.id)}`,
                    "index",
                  )
                }
                type="link"
              >
                {t("dataIngestion.actions.openIndex")}
              </Button>
            </>
          ) : null}
          <Popconfirm
            onConfirm={() => void deleteDataset(item.id)}
            title={t("dataIngestion.actions.delete")}
          >
            <Button danger disabled={!can("data_ingestion:delete")} type="link">
              {t("dataIngestion.actions.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const recordColumns = useMemo<ColumnsType<DataIngestionDatasetRecord>>(() => {
    const keys = new Set<string>();
    records.slice(0, DEFAULT_PAGE_SIZE).forEach((record) => {
      Object.keys(record.payload)
        .filter((key) => key !== "metadata" && key !== "text_preview")
        .forEach((key) => keys.add(key));
    });
    return [
      {
        title: "type",
        dataIndex: "data_type",
        key: "dataType",
        width: 100,
      },
      {
        title: t("dataIngestion.contract.stableRecordId"),
        dataIndex: "stable_record_id",
        key: "stableRecordId",
        render: (value: string) => (
          <Text code title={value}>
            {value?.slice(0, 12) || "-"}
          </Text>
        ),
        width: 150,
      },
      {
        title: t("dataIngestion.contract.source"),
        key: "source",
        render: (_: unknown, item: DataIngestionDatasetRecord) => (
          <Text title={JSON.stringify(item.source_locator ?? {})}>{item.source_object || "-"}</Text>
        ),
        width: 180,
      },
      ...Array.from(keys).map((key) => ({
        title: key,
        key,
        render: (_: unknown, item: DataIngestionDatasetRecord) => {
          const value = item.payload[key];
          return displayValue(value);
        },
      })),
      {
        title: "run_id",
        dataIndex: "run_id",
        key: "runId",
        render: (value: string) => <Text code>{value}</Text>,
        width: 160,
      },
      {
        title: t("dataIngestion.runs.createdAt"),
        dataIndex: "created_at",
        key: "createdAt",
        render: formatTime,
        width: 170,
      },
      {
        title: t("dataIngestion.provenance.action"),
        key: "provenance",
        fixed: "right",
        width: 110,
        render: (_: unknown, item: DataIngestionDatasetRecord) => (
          <Button
            onClick={() => {
              setProvenanceRecord(item);
              setProvenanceOpen(true);
            }}
            type="link"
          >
            {t("dataIngestion.provenance.viewDetail")}
          </Button>
        ),
      },
    ];
  }, [records, t]);

  const contractFieldColumns = useMemo<ColumnsType<DataIngestionDatasetFieldSchema>>(
    () => [
      {
        title: t("dataIngestion.contract.field"),
        dataIndex: "name",
        key: "name",
        render: (value: string, item) => (
          <Space size={4}>
            <Text strong>{value}</Text>
            {item.primary_key ? (
              <Tag color="blue">{t("dataIngestion.contract.primaryKey")}</Tag>
            ) : null}
          </Space>
        ),
      },
      {
        title: t("dataIngestion.contract.type"),
        dataIndex: "data_type",
        key: "type",
      },
      {
        title: t("dataIngestion.contract.nullable"),
        dataIndex: "nullable",
        key: "nullable",
        render: (value: boolean) =>
          value ? t("dataIngestion.contract.yes") : t("dataIngestion.contract.no"),
      },
      {
        title: t("dataIngestion.contract.completeness"),
        dataIndex: "completeness",
        key: "completeness",
        render: (value: number) => `${Math.round(value * 1000) / 10}%`,
      },
      {
        title: t("dataIngestion.contract.samples"),
        dataIndex: "sample_values",
        key: "samples",
        render: (values: unknown[]) => values.map(displayValue).join(", ") || "-",
      },
    ],
    [t],
  );

  const scanColumns: ColumnsType<DataIngestionAutoScanJob> = [
    {
      title: t("dataIngestion.autoScan.name"),
      key: "name",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text strong>{item.name}</Text>
          <Text type="secondary">
            {item.source_name} → {item.dataset_name}
          </Text>
        </Space>
      ),
    },
    {
      title: t("dataIngestion.autoScan.schedule"),
      key: "schedule",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Text>
            {t(`dataIngestion.autoScan.types.${item.schedule_type}`, {
              defaultValue: item.schedule_type,
            })}
          </Text>
          <Text code>
            {item.schedule_type === "cron"
              ? item.cron_expression
              : item.schedule_type === "interval"
                ? `${item.interval_seconds}s`
                : item.schedule_time}
          </Text>
        </Space>
      ),
    },
    {
      title: t("dataIngestion.autoScan.nextRun"),
      dataIndex: "next_scan_at",
      key: "nextRun",
      render: formatTime,
    },
    {
      title: t("dataIngestion.autoScan.status"),
      dataIndex: "status",
      key: "status",
      render: (value: string) => (
        <Tag color={statusColor(value)}>
          {t(`dataIngestion.status.${value}`, { defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t("dataIngestion.autoScan.enabled"),
      dataIndex: "enabled",
      key: "enabled",
      width: 90,
      render: (enabled: boolean, item) => (
        <Switch
          checked={enabled}
          disabled={!can("data_ingestion:task_manage")}
          onChange={(checked) => void setScanEnabled(item, checked)}
          size="small"
        />
      ),
    },
    {
      key: "actions",
      render: (_, item) => (
        <Space>
          <Button
            disabled={!can("data_ingestion:task_manage")}
            onClick={() => {
              setEditingScanId(item.id);
              setScanForm(scanFormFromJob(item));
              setScanModalOpen(true);
            }}
            type="link"
          >
            {t("dataIngestion.autoScan.edit")}
          </Button>
          <Button
            disabled={!can("data_ingestion:task_manage")}
            onClick={() => void runScanJob(item.id)}
            type="link"
          >
            {t("dataIngestion.actions.runNow")}
          </Button>
          <Popconfirm
            onConfirm={() => void deleteScanJob(item.id)}
            title={t("dataIngestion.actions.delete")}
          >
            <Button danger disabled={!can("data_ingestion:delete")} type="link">
              {t("dataIngestion.actions.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pipelineStepColumns: ColumnsType<DataIngestionPipelineTemplate["steps"][number]> = [
    {
      title: t("dataIngestion.pipelines.stepSequence"),
      key: "sequence",
      width: 70,
      render: (_, __, index) => index + 1,
    },
    {
      title: t("dataIngestion.pipelines.stepName"),
      dataIndex: "name",
      key: "name",
      width: 150,
    },
    {
      title: t("dataIngestion.pipelines.stepDescription"),
      dataIndex: "description",
      key: "description",
      width: 320,
    },
    {
      title: t("dataIngestion.pipelines.stepKind"),
      dataIndex: "kind",
      key: "kind",
      width: 120,
    },
    {
      title: "MCP",
      dataIndex: "tool_name",
      key: "toolName",
      render: (value: string | undefined) => (value ? <Text code>{value}</Text> : "-"),
      width: 190,
    },
    {
      title: t("dataIngestion.pipelines.stepInput"),
      dataIndex: "input",
      key: "input",
    },
    {
      title: t("dataIngestion.pipelines.stepOutput"),
      dataIndex: "output",
      key: "output",
    },
    {
      title: t("dataIngestion.pipelines.stepImplementation"),
      dataIndex: "implementation",
      key: "implementation",
    },
    {
      title: t("dataIngestion.pipelines.stepParameters"),
      dataIndex: "parameters",
      key: "parameters",
      render: (value: unknown) => <Text code>{displayValue(value)}</Text>,
    },
    {
      title: t("dataIngestion.pipelines.stepArtifact"),
      dataIndex: "artifact",
      key: "artifact",
      render: (value: string) => value || "-",
    },
    {
      title: t("dataIngestion.pipelines.stepRetryable"),
      dataIndex: "retryable",
      key: "retryable",
      render: (value: boolean) => (value ? "Yes" : "No"),
    },
  ];

  const tabs: NonNullable<TabsProps["items"]> = [
    { key: "overview", label: t("dataIngestion.tabs.overview") },
    { key: "import", label: t("dataIngestion.tabs.import") },
    { key: "pipelines", label: t("dataIngestion.tabs.pipelines") },
    { key: "sources", label: t("dataIngestion.tabs.sources") },
    { key: "catalog", label: t("dataIngestion.tabs.catalog") },
    { key: "auto-scan", label: t("dataIngestion.tabs.autoScan") },
    ...(can("data_ingestion:agent_use")
      ? [{ key: "agent", label: t("dataIngestion.tabs.agent") }]
      : []),
  ];

  function renderOverview() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Row gutter={[16, 16]}>
          {[
            {
              key: "datasets",
              value: overview?.datasets ?? 0,
              icon: <DatabaseOutlined />,
              span: 4,
            },
            {
              key: "records",
              value: overview?.records ?? 0,
              icon: <FileTextOutlined />,
              span: 4,
            },
            {
              key: "runs",
              value: overview?.runs ?? 0,
              icon: <CloudUploadOutlined />,
              span: 4,
            },
            {
              key: "successRate",
              value: `${overview?.success_rate ?? 0}%`,
              icon: <ThunderboltOutlined />,
              span: 8,
            },
            {
              key: "activeRuns",
              value: overview?.active_runs ?? 0,
              icon: <PlayCircleOutlined />,
              span: 4,
            },
          ].map(({ key, value, icon, span }) => (
            <Col key={key} lg={span} xs={12}>
              <Card>
                <Statistic prefix={icon} title={t(`dataIngestion.overview.${key}`)} value={value} />
              </Card>
            </Col>
          ))}
        </Row>
        <Card title={t("dataIngestion.overview.recentRuns")}>
          <Table
            columns={runColumns}
            dataSource={overview?.recent_runs ?? []}
            locale={{ emptyText: t("dataIngestion.overview.empty") }}
            pagination={false}
            rowKey="id"
            scroll={{ x: 1100 }}
          />
        </Card>
      </Space>
    );
  }

  function renderImport() {
    const previewableUploads = uploadItems.filter((item) => item.inspection);
    const startedUploads = uploadItems.filter((item) => item.run || item.error);
    const uploadPreviewIsBrowserNative =
      activeUploadFile &&
      (activeUploadFile.type.startsWith("image/") ||
        activeUploadFile.type.startsWith("video/") ||
        activeUploadFile.type === "application/pdf");
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          extra={
            <Segmented
              onChange={(value) => setImportMode(value as ImportMode)}
              options={[
                {
                  label: t("dataIngestion.import.modeFiles"),
                  value: "files",
                },
                {
                  label: t("dataIngestion.import.modeSource"),
                  value: "source",
                },
              ]}
              value={importMode}
            />
          }
          title={t("dataIngestion.import.title")}
        >
          {importMode === "files" ? (
            <>
              <Upload.Dragger
                beforeUpload={(file) => {
                  queueUploadFiles([file]);
                  return Upload.LIST_IGNORE;
                }}
                disabled={ingesting}
                multiple
                showUploadList={false}
              >
                <p className="ant-upload-drag-icon">
                  <CloudUploadOutlined />
                </p>
                <p className="ant-upload-text">{t("dataIngestion.import.uploadHint")}</p>
                <p className="ant-upload-hint">{t("dataIngestion.import.uploadFormats")}</p>
              </Upload.Dragger>
              {uploadItems.length ? (
                <Table<UploadQueueItem>
                  columns={[
                    {
                      title: t("dataIngestion.import.fileName"),
                      dataIndex: "file",
                      key: "file",
                      render: (_value, item) => (
                        <Space direction="vertical" size={0}>
                          <Text>{item.file.name}</Text>
                          <Text type="secondary">
                            {formatBytes(item.file.size)}
                            {item.inspection ? ` · ${item.inspection.file_type}` : ""}
                          </Text>
                        </Space>
                      ),
                    },
                    {
                      title: t("dataIngestion.import.previewStatus"),
                      key: "status",
                      width: 150,
                      render: (_value, item) => (
                        <Tag color={statusColor(item.status)} title={item.error}>
                          {t(`dataIngestion.import.uploadStatus.${item.status}`)}
                        </Tag>
                      ),
                    },
                    {
                      title: t("dataIngestion.actions.preview"),
                      key: "actions",
                      width: 180,
                      render: (_value, item) => (
                        <Space>
                          <Button
                            disabled={!item.inspection || ingesting}
                            onClick={() => {
                              setActiveUploadId(item.id);
                              setActiveSheetIndex(0);
                            }}
                            size="small"
                            type="link"
                          >
                            {t("dataIngestion.actions.preview")}
                          </Button>
                          <Button
                            danger
                            disabled={ingesting}
                            onClick={() => removeUploadItem(item.id)}
                            size="small"
                            type="link"
                          >
                            {t("dataIngestion.actions.remove")}
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                  dataSource={uploadItems}
                  locale={{ emptyText: t("dataIngestion.import.noFiles") }}
                  pagination={false}
                  rowKey="id"
                  size="small"
                  style={{ marginTop: 16 }}
                />
              ) : (
                <Empty
                  description={t("dataIngestion.import.noFiles")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  style={{ marginTop: 16 }}
                />
              )}
              {uploadItems.some((item) => item.error) ? (
                <Alert
                  description={uploadItems
                    .filter((item) => item.error)
                    .map((item) => `${item.file.name}: ${item.error}`)
                    .join("\n")}
                  message={t("dataIngestion.import.previewErrors")}
                  showIcon
                  style={{ marginTop: 12, whiteSpace: "pre-line" }}
                  type="error"
                />
              ) : null}
            </>
          ) : (
            <>
              <Alert
                description={t("dataIngestion.import.sourceModeDescription")}
                message={t("dataIngestion.import.sourceModeTitle")}
                showIcon
                type="info"
              />
              {!ingestionSources.length ? (
                <Alert
                  action={
                    <Button onClick={() => onViewChange("sources")} type="primary">
                      {t("dataIngestion.import.goToSources")}
                    </Button>
                  }
                  message={t("dataIngestion.import.noSources")}
                  showIcon
                  style={{ marginTop: 12 }}
                  type="warning"
                />
              ) : null}
            </>
          )}
          <Form layout="vertical" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col md={importMode === "source" ? 8 : 12} xs={24}>
                <Form.Item label={t("dataIngestion.import.dataset")}>
                  <Space.Compact block>
                    <Select
                      onChange={setSelectedDatasetId}
                      options={datasets.map((item) => ({
                        label: item.name,
                        value: item.id,
                      }))}
                      placeholder={t("dataIngestion.import.noDatasets")}
                      style={{ flex: 1 }}
                      value={selectedDatasetId || undefined}
                    />
                    <Button
                      disabled={!can("data_ingestion:create")}
                      icon={<PlusOutlined />}
                      onClick={openDatasetCreator}
                    >
                      {t("dataIngestion.actions.createDataset")}
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Col>
              <Col md={importMode === "source" ? 8 : 12} xs={24}>
                <Form.Item label={t("dataIngestion.import.template")}>
                  <Select
                    onChange={setSelectedTemplateCode}
                    options={templates.map((item) => ({
                      label: item.name,
                      value: item.code,
                      disabled:
                        importMode === "files" &&
                        uploadItems.some(
                          (uploadItem) =>
                            uploadItem.inspection &&
                            !item.supported_types.includes(uploadItem.inspection.file_type),
                        ),
                    }))}
                    value={selectedTemplateCode}
                  />
                </Form.Item>
              </Col>
            </Row>
            {importMode === "source" ? (
              <Form.Item
                extra={t("dataIngestion.import.sourceHint")}
                label={t("dataIngestion.import.source")}
              >
                <Select
                  onChange={(sourceId) => {
                    setSourceIngestionError("");
                    setSourceIngestionRun(null);
                    setSourceIngestionSourceId(sourceId);
                  }}
                  optionFilterProp="label"
                  options={ingestionSources.map((item) => ({
                    label: item.name,
                    value: item.id,
                  }))}
                  placeholder={t("dataIngestion.import.selectSource")}
                  showSearch
                  value={sourceIngestionSourceId || undefined}
                />
              </Form.Item>
            ) : null}
            {importMode === "files" && uploadItems.length && !allUploadsSupportedByTemplate ? (
              <Alert
                message={t("dataIngestion.import.pipelineUnsupportedFiles")}
                showIcon
                style={{ marginBottom: 16 }}
                type="warning"
              />
            ) : null}
            <Space>
              <Button
                disabled={
                  !can("data_ingestion:create") ||
                  (importMode === "files"
                    ? ingesting || !allUploadsReady || !allUploadsSupportedByTemplate
                    : sourceIngesting ||
                      !selectedIngestionSource ||
                      !selectedDatasetId ||
                      !selectedTemplateCode)
                }
                loading={importMode === "files" ? ingesting : sourceIngesting}
                onClick={() =>
                  void (importMode === "files" ? startFileIngestion() : startSourceIngestion())
                }
                type="primary"
              >
                {importMode === "files"
                  ? t("dataIngestion.actions.startBatchIngestion")
                  : t("dataIngestion.actions.startSourceIngestion")}
              </Button>
            </Space>
          </Form>
        </Card>

        {importMode === "files" ? (
          <Card
            loading={inspecting}
            title={
              activeUploadItem
                ? t("dataIngestion.import.activeFilePreview", {
                    file: activeUploadItem.file.name,
                  })
                : t("dataIngestion.import.preview")
            }
          >
            {!inspection ? (
              <Empty description={t("dataIngestion.import.noPreview")} />
            ) : (
              <>
                {previewableUploads.length > 1 ? (
                  <Tabs
                    activeKey={activeUploadId}
                    items={previewableUploads.map((item) => ({
                      key: item.id,
                      label: item.file.name,
                    }))}
                    onChange={(key) => {
                      setActiveUploadId(key);
                      setActiveSheetIndex(0);
                    }}
                    size="small"
                    type="card"
                  />
                ) : null}
                {inspection.sheets.length > 1 ? (
                  <Tabs
                    activeKey={String(activeSheetIndex)}
                    items={inspection.sheets.map((sheet, index) => ({
                      key: String(index),
                      label: `${sheet.name} (${displayValue(
                        sheet.metadata.row_count ?? sheet.rows.length,
                      )})`,
                    }))}
                    onChange={(key) => setActiveSheetIndex(Number(key))}
                    size="small"
                  />
                ) : null}
                {activeSheet?.warnings.length ? (
                  <Alert
                    description={activeSheet.warnings.join("; ")}
                    message={t("dataIngestion.import.warnings")}
                    showIcon
                    style={{ marginBottom: 12 }}
                    type="warning"
                  />
                ) : null}
                <Descriptions column={{ md: 4, xs: 1 }} size="small">
                  {inspection.preview_type === "table" ? (
                    <>
                      <Descriptions.Item label={t("dataIngestion.import.rows")}>
                        {activeSheet?.rows.length ?? 0}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("dataIngestion.import.columns")}>
                        {activeSheet?.columns.length ?? 0}
                      </Descriptions.Item>
                    </>
                  ) : null}
                  <Descriptions.Item label="Type">{inspection.file_type}</Descriptions.Item>
                  <Descriptions.Item label="Size">{formatBytes(inspection.size)}</Descriptions.Item>
                  {typeof inspection.metadata.table_count === "number" ? (
                    <Descriptions.Item label={t("dataIngestion.import.tables")}>
                      {inspection.metadata.table_count}
                    </Descriptions.Item>
                  ) : null}
                </Descriptions>
                {browserPreviewUrl && uploadPreviewIsBrowserNative ? (
                  activeUploadFile?.type.startsWith("image/") ? (
                    <img
                      alt={activeUploadFile.name}
                      src={browserPreviewUrl}
                      style={{
                        display: "block",
                        margin: "16px auto",
                        maxHeight: 560,
                        maxWidth: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : activeUploadFile?.type.startsWith("video/") ? (
                    <video
                      controls
                      src={browserPreviewUrl}
                      style={{ display: "block", margin: "16px auto", maxWidth: "100%" }}
                    />
                  ) : (
                    <iframe
                      src={browserPreviewUrl}
                      style={{ border: 0, height: 560, marginTop: 16, width: "100%" }}
                      title={activeUploadFile?.name}
                    />
                  )
                ) : null}
                {inspection.preview_type === "table" ? (
                  <Table
                    columns={activeSheet?.columns.map((column) => ({
                      title: column,
                      dataIndex: column,
                      key: column,
                      render: (value: unknown) => displayValue(value),
                    }))}
                    dataSource={activeSheet?.rows ?? []}
                    pagination={false}
                    rowKey={(row) => JSON.stringify(row).slice(0, 64)}
                    scroll={{ x: "max-content", y: 360 }}
                    size="small"
                  />
                ) : !browserPreviewUrl ? (
                  <pre className={styles.codeBlock}>
                    {displayValue(inspection.metadata.excerpt || inspection.metadata)}
                  </pre>
                ) : inspection.metadata.excerpt ? (
                  <pre className={styles.codeBlock}>
                    {displayValue(inspection.metadata.excerpt)}
                  </pre>
                ) : null}
                {documentTables.length ? (
                  <>
                    <Divider />
                    <Space align="center" wrap>
                      <Title level={5} style={{ margin: 0 }}>
                        {t("dataIngestion.import.extractedTables")}
                      </Title>
                      <Tag color="blue">
                        {t("dataIngestion.import.tableCount", {
                          count: inspection.metadata.table_count ?? documentTables.length,
                        })}
                      </Tag>
                      {inspection.metadata.table_preview_truncated ? (
                        <Text type="secondary">{t("dataIngestion.import.tablePreviewHint")}</Text>
                      ) : null}
                    </Space>
                    {documentTables.map((table) => {
                      const header = table.rows[0] ?? [];
                      const columnCount = Math.max(header.length, table.column_count);
                      return (
                        <Card
                          key={table.index}
                          size="small"
                          style={{ marginTop: 12 }}
                          title={t("dataIngestion.import.tableTitle", {
                            index: table.index,
                            page:
                              table.page === undefined
                                ? ""
                                : t("dataIngestion.import.tablePage", {
                                    page: table.page,
                                  }),
                          })}
                        >
                          <Table
                            columns={Array.from({ length: columnCount }, (_, index) => ({
                              dataIndex: String(index),
                              key: String(index),
                              render: (value: unknown) => displayValue(value),
                              title:
                                header[index] ||
                                t("dataIngestion.import.columnNumber", {
                                  index: index + 1,
                                }),
                            }))}
                            dataSource={documentTableRows(table)}
                            pagination={false}
                            rowKey="key"
                            scroll={{ x: "max-content" }}
                            size="small"
                          />
                        </Card>
                      );
                    })}
                  </>
                ) : null}
              </>
            )}
          </Card>
        ) : selectedIngestionSource ? (
          <Card title={t("dataIngestion.import.selectedSource")}>
            <Descriptions column={{ md: 3, xs: 1 }} size="small">
              <Descriptions.Item label={t("dataIngestion.sources.name")}>
                {selectedIngestionSource.name}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.sources.type")}>
                {t(`dataIngestion.sourceTypes.${selectedIngestionSource.source_type}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.sources.status")}>
                {t(`dataIngestion.status.${selectedIngestionSource.status}`)}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        ) : null}

        {importMode === "files" && startedUploads.length ? (
          <Card title={t("dataIngestion.import.batchRuntime")}>
            <Table<UploadQueueItem>
              columns={[
                {
                  title: t("dataIngestion.import.fileName"),
                  dataIndex: "file",
                  key: "file",
                  render: (_value, item) => item.file.name,
                },
                {
                  title: t("dataIngestion.sources.status"),
                  key: "status",
                  render: (_value, item) => (
                    <Tag color={statusColor(item.status)}>
                      {t(`dataIngestion.import.uploadStatus.${item.status}`)}
                    </Tag>
                  ),
                },
                {
                  title: t("dataIngestion.runs.inserted"),
                  key: "inserted",
                  render: (_value, item) => item.run?.inserted_count ?? "-",
                },
                {
                  title: t("dataIngestion.runs.updated"),
                  key: "updated",
                  render: (_value, item) => item.run?.updated_count ?? "-",
                },
                {
                  title: t("dataIngestion.runs.duplicates"),
                  key: "duplicates",
                  render: (_value, item) => item.run?.duplicate_count ?? "-",
                },
                {
                  title: t("dataIngestion.import.error"),
                  key: "error",
                  render: (_value, item) => item.error || item.run?.error_message || "-",
                },
                {
                  title: t("dataIngestion.actions.view"),
                  key: "actions",
                  render: (_value, item) =>
                    item.run ? (
                      <Button onClick={() => void openRun(item.run!)} size="small" type="link">
                        {t("dataIngestion.runs.detail")}
                      </Button>
                    ) : (
                      "-"
                    ),
                },
              ]}
              dataSource={uploadItems}
              pagination={false}
              rowKey="id"
              scroll={{ x: 900 }}
              size="small"
            />
          </Card>
        ) : null}

        {importMode === "source" ? (
          <Card title={t("dataIngestion.import.sourceRuntime")}>
            {sourceIngestionError ? (
              <Alert
                description={sourceIngestionError}
                message={t("dataIngestion.import.failed")}
                showIcon
                type="error"
              />
            ) : !sourceIngestionRun ? (
              <Empty description={t("dataIngestion.import.notStarted")} />
            ) : (
              <>
                <Alert
                  message={
                    sourceIngestionRun.status === "success"
                      ? t("dataIngestion.import.success")
                      : t("dataIngestion.import.failed")
                  }
                  showIcon
                  type={sourceIngestionRun.status === "success" ? "success" : "error"}
                />
                <Space style={{ margin: "12px 0" }} wrap>
                  <Tag color={statusColor(sourceIngestionRun.status)}>
                    {t(`dataIngestion.status.${sourceIngestionRun.status}`)}
                  </Tag>
                  <Text>
                    {t("dataIngestion.import.inserted", {
                      count: sourceIngestionRun.inserted_count,
                    })}
                  </Text>
                  <Text>
                    {t("dataIngestion.import.duplicates", {
                      count: sourceIngestionRun.duplicate_count,
                    })}
                  </Text>
                  <Button onClick={() => void openRun(sourceIngestionRun)} type="link">
                    {t("dataIngestion.runs.detail")}
                  </Button>
                </Space>
                <StageDetail
                  run={sourceIngestionRun}
                  template={templates.find(
                    (template) => template.code === sourceIngestionRun.template_code,
                  )}
                />
              </>
            )}
          </Card>
        ) : null}
      </Space>
    );
  }

  function renderPipelines() {
    return (
      <Card
        extra={
          <Button
            disabled={!can("data_ingestion:task_manage")}
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingPipeline(null);
              setPipelineModalOpen(true);
            }}
            type="primary"
          >
            {t("dataIngestion.pipelines.create")}
          </Button>
        }
        title={t("dataIngestion.pipelines.title")}
      >
        <Paragraph type="secondary">{t("dataIngestion.pipelines.description")}</Paragraph>
        {templates.length ? (
          <Row gutter={[16, 16]}>
            {templates.map((template) => (
              <Col key={template.code} lg={8} xs={24}>
                <Card
                  className={styles.pipelineCard}
                  actions={[
                    <Button key="detail" onClick={() => setPipelineDrawer(template)} type="link">
                      {t("dataIngestion.pipelines.steps")}
                    </Button>,
                    ...(template.code.startsWith("user-")
                      ? [
                          <Button
                            key="run"
                            onClick={() => {
                              setPipelineRunResult(null);
                              setRunPipelineTarget(template);
                            }}
                            type="link"
                          >
                            {t("dataIngestion.pipelines.run")}
                          </Button>,
                          <Button
                            key="edit"
                            disabled={!can("data_ingestion:task_manage")}
                            onClick={() => {
                              setEditingPipeline(template);
                              setPipelineModalOpen(true);
                            }}
                            type="link"
                          >
                            {t("dataIngestion.agent.edit")}
                          </Button>,
                          <Popconfirm
                            key="delete"
                            onConfirm={() => void deletePipeline(template.id)}
                            title={t("dataIngestion.actions.delete")}
                          >
                            <Button danger disabled={!can("data_ingestion:delete")} type="link">
                              {t("dataIngestion.actions.delete")}
                            </Button>
                          </Popconfirm>,
                        ]
                      : [
                          <Button
                            key="use"
                            onClick={() => {
                              setSelectedTemplateCode(template.code);
                              onViewChange("import");
                            }}
                            type="link"
                          >
                            {t("dataIngestion.pipelines.useTemplate")}
                          </Button>,
                          <Tag key="builtin" color="gold">
                            {t("dataIngestion.pipelines.builtInLocked")}
                          </Tag>,
                        ]),
                  ]}
                  size="small"
                >
                  <Title level={4}>{template.name}</Title>
                  <Paragraph type="secondary">{template.description}</Paragraph>
                  <Space wrap>
                    {template.supported_types.map((type) => (
                      <Tag key={type}>{type.toUpperCase()}</Tag>
                    ))}
                  </Space>
                  <Divider />
                  <span className={styles.pipelineStepCount}>
                    {template.steps.length} {t("dataIngestion.pipelines.steps")}
                  </span>
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <Empty description={t("dataIngestion.pipelines.empty")} />
        )}
      </Card>
    );
  }

  function renderSources() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          extra={
            <Button
              disabled={!can("data_ingestion:create")}
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingSourceId(null);
                setSourceForm(emptySourceForm());
                setSourceCatalog(null);
                setSourceCatalogError("");
                setSourceModalOpen(true);
              }}
              type="primary"
            >
              {t("dataIngestion.actions.createSource")}
            </Button>
          }
          title={t("dataIngestion.sources.title")}
        >
          <Paragraph type="secondary">{t("dataIngestion.sources.description")}</Paragraph>
          <Table
            columns={sourceColumns}
            dataSource={sources}
            locale={{ emptyText: t("dataIngestion.sources.empty") }}
            rowKey="id"
            scroll={{ x: 900 }}
          />
        </Card>
        <Card className={styles.storageCard} title={t("dataIngestion.sources.storageLanding")}>
          <Row gutter={[16, 16]}>
            <Col md={8} xs={24}>
              <Descriptions
                column={1}
                size="small"
                title={t("dataIngestion.sources.storageDatabase")}
              >
                <Descriptions.Item label="Backend">
                  {storageInfo?.database_backend || "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.spaces.database")}>
                  {storageInfo?.database_label || "-"}
                </Descriptions.Item>
              </Descriptions>
            </Col>
            <Col md={8} xs={24}>
              <Descriptions column={1} size="small" title={t("dataIngestion.sources.storageRaw")}>
                <Descriptions.Item label="Backend">{storageInfo?.backend || "-"}</Descriptions.Item>
                <Descriptions.Item label="Path">
                  {storageInfo?.raw_storage || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Bucket">{storageInfo?.bucket || "-"}</Descriptions.Item>
              </Descriptions>
            </Col>
            <Col md={8} xs={24}>
              <Descriptions
                column={1}
                size="small"
                title={t("dataIngestion.sources.storageArtifact")}
              >
                <Descriptions.Item label="Path">
                  {storageInfo?.artifact_storage || "-"}
                </Descriptions.Item>
                <Descriptions.Item label="Endpoint">
                  {storageInfo?.endpoint || storageInfo?.root || "-"}
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        </Card>
      </Space>
    );
  }

  function renderCatalog() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          extra={
            <Space wrap>
              <Button
                disabled={!selectedCatalogDataset}
                icon={<FileTextOutlined />}
                onClick={() => {
                  if (selectedCatalogDataset) {
                    void openDatasetContract(selectedCatalogDataset);
                  }
                }}
              >
                {t("dataIngestion.contract.title")}
              </Button>
              <Button
                disabled={!selectedCatalogDataset}
                icon={<ApartmentOutlined />}
                onClick={() => openDatasetProvenance()}
              >
                {t("dataIngestion.provenance.title")}
              </Button>
              <Button
                disabled={!can("data_ingestion:create")}
                icon={<PlusOutlined />}
                onClick={openDatasetCreator}
                type="primary"
              >
                {t("dataIngestion.actions.createDataset")}
              </Button>
            </Space>
          }
          title={t("dataIngestion.catalog.title")}
        >
          <Paragraph type="secondary">{t("dataIngestion.catalog.description")}</Paragraph>
          <Input
            allowClear
            onChange={(event) => setDatasetSearch(event.target.value)}
            placeholder={t("dataIngestion.catalog.search")}
            prefix={<SearchOutlined />}
            style={{ marginBottom: 16, maxWidth: 420 }}
            value={datasetSearch}
          />
          <Table
            columns={datasetColumns}
            dataSource={visibleDatasets}
            locale={{ emptyText: t("dataIngestion.catalog.emptyDatasets") }}
            rowKey="id"
            scroll={{ x: 1450 }}
          />
        </Card>
        <Card
          extra={
            <Space wrap>
              <Button
                disabled={!selectedCatalogDataset}
                icon={<ApartmentOutlined />}
                onClick={() => openDatasetProvenance()}
              >
                {t("dataIngestion.provenance.title")}
              </Button>
              <Space.Compact>
                <Input
                  onChange={(event) => setRecordSearch(event.target.value)}
                  placeholder={t("dataIngestion.catalog.recordSearch")}
                  prefix={<SearchOutlined />}
                  value={recordSearch}
                />
                <Button onClick={() => void loadRecords(selectedCatalogDatasetId, 1)}>
                  {t("dataIngestion.actions.refresh")}
                </Button>
              </Space.Compact>
            </Space>
          }
          title={t("dataIngestion.catalog.recordsTitle", {
            name: selectedCatalogDataset?.name || "-",
          })}
        >
          <Table
            columns={recordColumns}
            dataSource={records}
            loading={recordsLoading}
            locale={{ emptyText: t("dataIngestion.catalog.emptyRecords") }}
            pagination={{
              current: recordsPage,
              pageSize: DEFAULT_PAGE_SIZE,
              total: recordsTotal,
              onChange: (page) => {
                setRecordsPage(page);
                void loadRecords(selectedCatalogDatasetId, page);
              },
            }}
            rowKey="id"
            scroll={{ x: "max-content" }}
          />
        </Card>
      </Space>
    );
  }

  function renderAutoScan() {
    return (
      <Card
        extra={
          <Button
            disabled={!can("data_ingestion:task_manage")}
            icon={<PlusOutlined />}
            onClick={() => {
              const defaultSource = sources[0];
              setEditingScanId(null);
              setScanForm({
                ...emptyScanForm(),
                source_id: defaultSource?.id || "",
                dataset_id: datasets[0]?.id || "",
                scan_type: scanTypeForSource(defaultSource),
                path:
                  defaultSource?.source_type === "local_dir"
                    ? typeof defaultSource.config.path === "string"
                      ? defaultSource.config.path
                      : ""
                    : "",
              });
              setScanModalOpen(true);
            }}
            type="primary"
          >
            {t("dataIngestion.actions.createScanJob")}
          </Button>
        }
        title={t("dataIngestion.autoScan.title")}
      >
        <Paragraph type="secondary">{t("dataIngestion.autoScan.description")}</Paragraph>
        <Table
          columns={scanColumns}
          dataSource={scanJobs}
          locale={{ emptyText: t("dataIngestion.autoScan.empty") }}
          rowKey="id"
          scroll={{ x: 1000 }}
        />
      </Card>
    );
  }

  const sourceNeedsEndpoint = ["ftp", "sftp", "mysql", "postgres"].includes(sourceForm.source_type);
  const sourceNeedsCredentials = ["ftp", "sftp", "mysql", "postgres"].includes(
    sourceForm.source_type,
  );
  const sourceNeedsDirectory = ["local_dir", "ftp", "sftp"].includes(sourceForm.source_type);
  const sourceIsDatabase = ["mysql", "postgres"].includes(sourceForm.source_type);
  const sourceIsApi = sourceForm.source_type === "api";
  const scanUsesFiles = ["local", "ftp", "sftp"].includes(scanForm.scan_type);
  const selectedScanSource = sources.find((source) => source.id === scanForm.source_id);
  const databaseTableOptions = (sourceCatalog?.tables ?? []).map((table) => ({
    value: table.name,
    label:
      table.kind === "view"
        ? `${table.name} · ${t("dataIngestion.sources.databaseView")}`
        : table.name,
  }));
  const viewContent = {
    overview: renderOverview,
    import: renderImport,
    pipelines: renderPipelines,
    sources: renderSources,
    catalog: renderCatalog,
    "auto-scan": renderAutoScan,
    agent: () =>
      can("data_ingestion:agent_use") ? (
        <IngestionAgentPanel onDataChanged={() => loadCore(true)} />
      ) : (
        <Alert message={t("dataIngestion.errors.noPermission")} showIcon type="error" />
      ),
  } as const;

  if (controlDatabaseLoading) {
    return (
      <Card loading>
        <Title level={2}>{t("dataIngestion.controlDatabase.checking")}</Title>
      </Card>
    );
  }

  if (!controlDatabaseStatus) {
    return (
      <Card>
        <Alert
          action={
            <Button onClick={() => window.location.reload()}>
              {t("dataIngestion.actions.refresh")}
            </Button>
          }
          description={controlDatabaseError}
          message={t("dataIngestion.controlDatabase.statusUnavailable")}
          showIcon
          type="error"
        />
      </Card>
    );
  }

  if (!controlDatabaseStatus.initialized) {
    return (
      <ControlDatabaseSetup
        canManage={can("data_ingestion:task_manage")}
        onInitialized={handleControlDatabaseInitialized}
        status={controlDatabaseStatus}
      />
    );
  }

  return (
    <div className={styles.workbench} data-loading={loading || undefined}>
      <div className={styles.header}>
        <div>
          <Title level={2}>{t("dataIngestion.title")}</Title>
          <Paragraph type="secondary">{t("dataIngestion.description")}</Paragraph>
        </div>
        <Space align="center" wrap>
          <div className={styles.spacePicker}>
            <DatabaseOutlined />
            <Select
              aria-label={t("dataIngestion.spaces.current")}
              loading={!spacesReady}
              onChange={changeSpace}
              options={spaces.map((space) => ({
                label: space.name,
                value: space.id,
              }))}
              placeholder={t("dataIngestion.spaces.selectPlaceholder")}
              value={activeSpaceId}
            />
            <Button
              aria-label={t("dataIngestion.spaces.create")}
              disabled={!can("data_ingestion:task_manage")}
              icon={<PlusOutlined />}
              onClick={() => setSpaceModalOpen(true)}
            >
              {t("dataIngestion.spaces.create")}
            </Button>
          </div>
          {activeSpace ? (
            <Tag color={activeSpace.status === "ready" ? "green" : "orange"}>
              {activeSpace.database_label}
            </Tag>
          ) : null}
          <Button
            disabled={
              !can("data_ingestion:task_manage") ||
              controlDatabaseStatus.source === "environment" ||
              !controlDatabaseStatus.bootstrap_enabled
            }
            icon={<DatabaseOutlined />}
            onClick={() => setControlDatabaseModalOpen(true)}
          >
            {t("dataIngestion.controlDatabase.change")}
          </Button>
          <Tag icon={<RobotOutlined />} color="blue">
            MCP
          </Tag>
          <Button
            disabled={!activeSpaceId}
            icon={<ReloadOutlined spin={refreshing} />}
            loading={refreshing}
            onClick={() => void loadCore(true)}
          >
            {t("dataIngestion.actions.refresh")}
          </Button>
        </Space>
      </div>

      {spacesReady && !activeSpaceId ? (
        <Alert
          action={
            <Button
              disabled={!can("data_ingestion:task_manage")}
              onClick={() => setSpaceModalOpen(true)}
              type="primary"
            >
              {t("dataIngestion.spaces.create")}
            </Button>
          }
          description={t("dataIngestion.spaces.emptyHint")}
          message={t("dataIngestion.spaces.required")}
          showIcon
          type="warning"
        />
      ) : null}
      {controlDatabaseError ? (
        <Alert
          closable
          message={controlDatabaseError}
          onClose={() => setControlDatabaseError("")}
          showIcon
          style={{ marginBottom: 16 }}
          type="warning"
        />
      ) : null}

      <Tabs
        activeKey={activeView}
        items={tabs.map((tab) => ({ ...tab, disabled: !activeSpaceId }))}
        onChange={(key) => onViewChange(key as typeof activeView)}
        type="card"
      />

      <div className={styles.content}>
        {spacesReady && !activeSpaceId ? (
          <Card>
            <Empty description={t("dataIngestion.spaces.emptyHint")} />
          </Card>
        ) : (
          viewContent[activeView]()
        )}
      </div>

      <Drawer
        destroyOnClose
        onClose={() => setRunDetailOpen(false)}
        open={runDetailOpen}
        title={t("dataIngestion.runs.detail")}
        width="min(1000px, 94vw)"
      >
        {drawerRun ? (
          <RunDetailCard
            canRetry={can("data_ingestion:task_manage")}
            onDownload={() => void downloadRunAsset(drawerRun)}
            onRetry={() => void retryRun(drawerRun)}
            run={drawerRun}
            template={templates.find((template) => template.code === drawerRun.template_code)}
          />
        ) : null}
      </Drawer>

      <Drawer
        destroyOnClose
        onClose={() => setPipelineDrawer(null)}
        open={Boolean(pipelineDrawer)}
        title={pipelineDrawer?.name}
        width="min(1100px, 96vw)"
      >
        {pipelineDrawer ? (
          <>
            <Paragraph type="secondary">{pipelineDrawer.description}</Paragraph>
            <Space wrap>
              {pipelineDrawer.supported_types.map((type) => (
                <Tag key={type}>{type.toUpperCase()}</Tag>
              ))}
            </Space>
            <Divider />
            <Table
              columns={pipelineStepColumns}
              dataSource={pipelineDrawer.steps}
              pagination={false}
              rowKey="key"
              scroll={{ x: 1820 }}
              size="small"
            />
          </>
        ) : null}
      </Drawer>

      <Drawer
        destroyOnClose
        onClose={() => {
          setContractDataset(null);
          setDatasetContract(null);
          setContractError("");
        }}
        open={Boolean(contractDataset)}
        title={`${t("dataIngestion.contract.title")} · ${contractDataset?.name ?? ""}`}
        width="min(1180px, 96vw)"
      >
        {contractLoading ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: 240 }}>
            <Spin />
          </div>
        ) : contractError ? (
          <Alert message={contractError} showIcon type="error" />
        ) : datasetContract ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered column={3} size="small">
              <Descriptions.Item label={t("dataIngestion.contract.schemaVersion")}>
                <Text code>{datasetContract.schema.schema_version}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.contract.sampleCount")}>
                {datasetContract.schema.sampled_records} / {datasetContract.schema.total_records}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.contract.stableKey")}>
                {datasetContract.schema.stable_key_strategy === "business_key"
                  ? t("dataIngestion.contract.businessKey")
                  : t("dataIngestion.contract.contentFingerprint")}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.contract.primaryKeys")}>
                {datasetContract.schema.primary_key_fields.length
                  ? datasetContract.schema.primary_key_fields.join(", ")
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.contract.qualityScore")}>
                <Tag color={datasetContract.quality.status === "passed" ? "green" : "red"}>
                  {datasetContract.quality.score}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.contract.completeness")}>
                {Math.round(datasetContract.quality.completeness * 1000) / 10}%
              </Descriptions.Item>
            </Descriptions>

            <Card
              extra={
                <Button loading={backfillingProvenance} onClick={() => void backfillProvenance()}>
                  {t("dataIngestion.contract.backfillProvenance")}
                </Button>
              }
              title={t("dataIngestion.contract.fieldsTitle")}
            >
              <Table
                columns={contractFieldColumns}
                dataSource={datasetContract.schema.fields}
                pagination={false}
                rowKey="name"
                scroll={{ x: 900 }}
                size="small"
              />
            </Card>

            <Card
              extra={
                <Button
                  loading={startingQualityCheck}
                  onClick={() => void startFullQualityCheck()}
                  type="primary"
                >
                  {t("dataIngestion.contract.startFullCheck")}
                </Button>
              }
              title={t("dataIngestion.contract.fullQualityTitle")}
            >
              <Descriptions bordered column={3} size="small">
                <Descriptions.Item label={t("dataIngestion.contract.status")}>
                  <Tag
                    color={
                      fullQualityCheck?.status === "completed"
                        ? "green"
                        : fullQualityCheck?.status === "failed"
                          ? "red"
                          : fullQualityCheck &&
                              ["queued", "running"].includes(fullQualityCheck.status)
                            ? "blue"
                            : "default"
                    }
                  >
                    {t(
                      `dataIngestion.contract.qualityCheckStatus.${fullQualityCheck?.status ?? "not_started"}`,
                    )}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.totalRecords")}>
                  {fullQualityCheck?.total_records ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.qualityScore")}>
                  {"score" in (fullQualityCheck?.report ?? {})
                    ? String(fullQualityCheck?.report.score)
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.completeness")}>
                  {"completeness" in (fullQualityCheck?.report ?? {})
                    ? `${
                        Math.round(Number(fullQualityCheck?.report.completeness ?? 0) * 1000) / 10
                      }%`
                    : "-"}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.startedAt")}>
                  {formatTime(fullQualityCheck?.started_at)}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.finishedAt")}>
                  {formatTime(fullQualityCheck?.finished_at)}
                </Descriptions.Item>
              </Descriptions>
              {fullQualityCheck?.error_message ? (
                <Alert
                  message={fullQualityCheck.error_message}
                  showIcon
                  style={{ marginTop: 12 }}
                  type="error"
                />
              ) : null}
            </Card>

            <Card
              title={t("dataIngestion.contract.qualityTitle")}
              extra={
                <Tag color={datasetContract.quality.status === "passed" ? "green" : "red"}>
                  {t(`dataIngestion.contract.qualityStatus.${datasetContract.quality.status}`)}
                </Tag>
              }
            >
              {datasetContract.quality.issues.length ? (
                <Table
                  columns={[
                    {
                      title: t("dataIngestion.contract.severity"),
                      dataIndex: "severity",
                      key: "severity",
                      render: (value: "warning" | "error") => (
                        <Tag color={value === "error" ? "red" : "gold"}>
                          {t(`dataIngestion.contract.severityLevels.${value}`)}
                        </Tag>
                      ),
                      width: 100,
                    },
                    {
                      title: t("dataIngestion.contract.field"),
                      dataIndex: "field",
                      key: "field",
                      render: (value?: string) => value || "-",
                      width: 180,
                    },
                    {
                      title: t("dataIngestion.contract.message"),
                      dataIndex: "message",
                      key: "message",
                    },
                  ]}
                  dataSource={datasetContract.quality.issues}
                  pagination={false}
                  rowKey={(item) => `${item.code}:${item.field ?? ""}:${item.message}`}
                  size="small"
                />
              ) : (
                <Alert message={t("dataIngestion.contract.noIssues")} showIcon type="success" />
              )}
            </Card>

            <Card
              extra={
                <Button
                  loading={publishingDataset}
                  onClick={() => void publishDatasetContract()}
                  type="primary"
                >
                  {t("dataIngestion.contract.publish")}
                </Button>
              }
              title={t("dataIngestion.contract.publicationTitle")}
            >
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label={t("dataIngestion.contract.status")}>
                  <Tag
                    color={
                      datasetContract.publication.status === "failed"
                        ? "red"
                        : datasetContract.publication.status === "not_published"
                          ? "default"
                          : "blue"
                    }
                  >
                    {t(
                      `dataIngestion.contract.publicationStatus.${datasetContract.publication.status}`,
                      { defaultValue: datasetContract.publication.status },
                    )}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.catalogId")}>
                  <Text code>{datasetContract.publication.catalog_id || "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.resourceId")}>
                  <Text code>{datasetContract.publication.resource_id || "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.contract.lastPublished")}>
                  {formatTime(datasetContract.publication.last_published_at)}
                </Descriptions.Item>
              </Descriptions>
              {datasetContract.publication.last_error ? (
                <Alert
                  message={datasetContract.publication.last_error}
                  showIcon
                  style={{ marginTop: 12 }}
                  type="error"
                />
              ) : null}
            </Card>
          </Space>
        ) : null}
      </Drawer>

      <DatasetProvenanceDrawer
        dataset={selectedCatalogDataset ?? null}
        initialRecord={provenanceRecord}
        onClose={() => {
          setProvenanceOpen(false);
          setProvenanceRecord(null);
        }}
        open={provenanceOpen}
        sources={sources}
        spaceName={activeSpace?.name ?? ""}
      />

      <ControlDatabaseSwitchModal
        onCancel={() => setControlDatabaseModalOpen(false)}
        onConfigured={handleControlDatabaseInitialized}
        open={controlDatabaseModalOpen}
        status={controlDatabaseStatus}
      />

      <Modal
        destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setSpaceModalOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button
            key="save"
            loading={creatingSpace}
            onClick={() => spaceForm.submit()}
            type="primary"
          >
            {t("dataIngestion.spaces.createAction")}
          </Button>,
        ]}
        onCancel={() => {
          spaceForm.resetFields();
          setSpaceModalOpen(false);
        }}
        open={spaceModalOpen}
        title={t("dataIngestion.spaces.create")}
        width={760}
      >
        <Alert
          description={t("dataIngestion.spaces.databaseHint")}
          message={t("dataIngestion.spaces.isolationHint")}
          showIcon
          style={{ marginBottom: 16 }}
          type="info"
        />
        <Form
          form={spaceForm}
          initialValues={{ port: DEFAULT_MYSQL_PORT }}
          layout="vertical"
          onFinish={(values) => void saveDataSpace(values)}
          requiredMark="optional"
        >
          <Form.Item
            extra={t("dataIngestion.spaces.autoIdentifierHint")}
            label={t("dataIngestion.spaces.name")}
            name="name"
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("dataIngestion.spaces.nameRequired"),
              },
              {
                max: 120,
                message: t("dataIngestion.spaces.nameTooLong"),
              },
            ]}
          >
            <Input autoComplete="off" placeholder={t("dataIngestion.spaces.namePlaceholder")} />
          </Form.Item>

          <DatabaseConnectionPicker form={spaceForm} />

          <Row gutter={16}>
            <Col sm={17} xs={24}>
              <Form.Item
                extra={t("dataIngestion.spaces.hostHint")}
                label={t("dataIngestion.spaces.host")}
                name="host"
                rules={[
                  {
                    validator: (_rule: unknown, value?: string) => {
                      const host = normalizeMysqlHost(value || "");
                      if (!host) {
                        return Promise.reject(new Error(t("dataIngestion.spaces.hostRequired")));
                      }
                      if (/[\s/?#@]/.test(host)) {
                        return Promise.reject(new Error(t("dataIngestion.spaces.hostInvalid")));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input autoComplete="off" placeholder={t("dataIngestion.spaces.hostPlaceholder")} />
              </Form.Item>
            </Col>
            <Col sm={7} xs={24}>
              <Form.Item
                extra={t("dataIngestion.spaces.portHint")}
                label={t("dataIngestion.spaces.port")}
                name="port"
                rules={[
                  {
                    required: true,
                    message: t("dataIngestion.spaces.portInvalid"),
                  },
                ]}
              >
                <InputNumber
                  className={styles.fullWidth}
                  controls={false}
                  max={65535}
                  min={1}
                  precision={0}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col sm={12} xs={24}>
              <Form.Item
                extra={t("dataIngestion.spaces.databaseNameHint")}
                label={t("dataIngestion.spaces.databaseName")}
                name="database_name"
                rules={[
                  {
                    required: true,
                    message: t("dataIngestion.spaces.databaseNameRequired"),
                  },
                  {
                    pattern: MYSQL_DATABASE_NAME_PATTERN,
                    message: t("dataIngestion.spaces.databaseNameInvalid"),
                  },
                ]}
              >
                <Input
                  autoComplete="off"
                  placeholder={t("dataIngestion.spaces.databaseNamePlaceholder")}
                />
              </Form.Item>
            </Col>
            <Col sm={12} xs={24}>
              <Form.Item
                extra={t("dataIngestion.spaces.usernameHint")}
                label={t("dataIngestion.spaces.username")}
                name="username"
                rules={[
                  {
                    required: true,
                    whitespace: true,
                    message: t("dataIngestion.spaces.usernameRequired"),
                  },
                ]}
              >
                <Input
                  autoComplete="off"
                  placeholder={t("dataIngestion.spaces.usernamePlaceholder")}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            extra={t("dataIngestion.spaces.passwordHint")}
            label={t("dataIngestion.spaces.password")}
            name="password"
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={t("dataIngestion.spaces.passwordPlaceholder")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <PipelineComposerModal
        initialTemplate={editingPipeline}
        onCancel={() => {
          setEditingPipeline(null);
          setPipelineModalOpen(false);
        }}
        onSave={(payload) => void createPipeline(payload)}
        open={pipelineModalOpen}
        saving={creatingPipeline}
        tools={agentManifest?.tools ?? []}
      />

      <PipelineRunModal
        onCancel={() => {
          setRunPipelineTarget(null);
          setPipelineRunResult(null);
        }}
        onRun={(inputs, stepInputs) => void runPipeline(inputs, stepInputs)}
        open={Boolean(runPipelineTarget)}
        result={pipelineRunResult}
        running={runningPipeline}
        template={runPipelineTarget}
        tools={agentManifest?.tools ?? []}
      />

      <Modal
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setEditingSourceId(null);
              setSourceModalOpen(false);
            }}
          >
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" onClick={() => void saveSource()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => {
          setEditingSourceId(null);
          setSourceModalOpen(false);
        }}
        open={sourceModalOpen}
        title={
          editingSourceId
            ? t("dataIngestion.sources.editTitle")
            : t("dataIngestion.actions.createSource")
        }
      >
        <Form layout="vertical">
          {sourceCatalogError ? (
            <Alert
              closable
              description={
                <>
                  <div>
                    {t(
                      `dataIngestion.sources.connectionErrorHints.${classifySourceConnectionError(
                        sourceCatalogError,
                      )}`,
                    )}
                  </div>
                  <Text code>{sourceCatalogError}</Text>
                </>
              }
              message={t(
                `dataIngestion.sources.connectionErrorTitles.${classifySourceConnectionError(
                  sourceCatalogError,
                )}`,
              )}
              onClose={() => setSourceCatalogError("")}
              showIcon
              style={{ marginBottom: 16 }}
              type="error"
            />
          ) : null}
          <Form.Item label={t("dataIngestion.sources.name")} required>
            <Input
              onChange={(event) =>
                setSourceForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t("dataIngestion.sources.namePlaceholder")}
              value={sourceForm.name}
            />
          </Form.Item>
          <Form.Item label={t("dataIngestion.sources.type")}>
            <Select
              onChange={(source_type) => {
                setSourceForm((current) => ({
                  ...current,
                  source_type,
                  query_mode: "table",
                  table_name: "",
                  schema_name: "",
                  watermark_column: "",
                  initial_cursor: "",
                }));
                setSourceCatalog(null);
                setSourceCatalogError("");
              }}
              options={["upload", "local_dir", "ftp", "sftp", "mysql", "postgres", "api"].map(
                (value) => ({
                  value,
                  label: t(`dataIngestion.sourceTypes.${value}`),
                }),
              )}
              value={sourceForm.source_type}
            />
          </Form.Item>
          {sourceIsApi ? (
            <>
              <Row gutter={12}>
                <Col span={7}>
                  <Form.Item label={t("dataIngestion.sources.method")}>
                    <Select
                      onChange={(method) => setSourceForm((current) => ({ ...current, method }))}
                      options={["GET", "POST", "PUT", "PATCH"].map((method) => ({
                        label: method,
                        value: method,
                      }))}
                      value={sourceForm.method}
                    />
                  </Form.Item>
                </Col>
                <Col span={17}>
                  <Form.Item label={t("dataIngestion.sources.url")}>
                    <Input
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          host: event.target.value,
                        }))
                      }
                      placeholder="https://api.example.com/data"
                      value={sourceForm.host}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item
                extra={t("dataIngestion.sources.headersHint")}
                label={t("dataIngestion.sources.headers")}
              >
                <Input.TextArea
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      headers: event.target.value,
                    }))
                  }
                  value={sourceForm.headers}
                />
              </Form.Item>
              <Form.Item
                extra={t("dataIngestion.sources.bodyHint")}
                label={t("dataIngestion.sources.body")}
              >
                <Input.TextArea
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                  value={sourceForm.body}
                />
              </Form.Item>
              <Form.Item
                extra={t("dataIngestion.sources.recordPathHint")}
                label={t("dataIngestion.sources.recordPath")}
              >
                <Input
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      record_path: event.target.value,
                    }))
                  }
                  placeholder="data.items"
                  value={sourceForm.record_path}
                />
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item label={t("dataIngestion.sources.paginationType")}>
                    <Select
                      onChange={(pagination_type) =>
                        setSourceForm((current) => ({
                          ...current,
                          pagination_type,
                        }))
                      }
                      options={[
                        {
                          label: t("dataIngestion.sources.paginationNone"),
                          value: "none",
                        },
                        {
                          label: t("dataIngestion.sources.paginationPage"),
                          value: "page",
                        },
                        {
                          label: t("dataIngestion.sources.paginationNext"),
                          value: "next_url",
                        },
                      ]}
                      value={sourceForm.pagination_type}
                    />
                  </Form.Item>
                </Col>
                {sourceForm.pagination_type === "page" ? (
                  <>
                    <Col span={8}>
                      <Form.Item label={t("dataIngestion.sources.pageParam")}>
                        <Input
                          onChange={(event) =>
                            setSourceForm((current) => ({
                              ...current,
                              page_param: event.target.value,
                            }))
                          }
                          value={sourceForm.page_param}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label={t("dataIngestion.sources.pageSize")}>
                        <Input
                          onChange={(event) =>
                            setSourceForm((current) => ({
                              ...current,
                              page_size: event.target.value,
                            }))
                          }
                          value={sourceForm.page_size}
                        />
                      </Form.Item>
                    </Col>
                  </>
                ) : null}
                {sourceForm.pagination_type === "next_url" ? (
                  <Col span={16}>
                    <Form.Item label={t("dataIngestion.sources.nextUrlPath")}>
                      <Input
                        onChange={(event) =>
                          setSourceForm((current) => ({
                            ...current,
                            next_url_path: event.target.value,
                          }))
                        }
                        placeholder="links.next"
                        value={sourceForm.next_url_path}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
                {sourceForm.pagination_type !== "none" ? (
                  <Col span={8}>
                    <Form.Item label={t("dataIngestion.sources.maxPages")}>
                      <Input
                        onChange={(event) =>
                          setSourceForm((current) => ({
                            ...current,
                            max_pages: event.target.value,
                          }))
                        }
                        value={sourceForm.max_pages}
                      />
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>
            </>
          ) : null}
          {sourceNeedsEndpoint ? (
            <Row gutter={12}>
              <Col span={16}>
                <Form.Item label={t("dataIngestion.sources.host")}>
                  <Input
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        host: event.target.value,
                      }))
                    }
                    value={sourceForm.host}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item label={t("dataIngestion.sources.port")}>
                  <Input
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        port: event.target.value,
                      }))
                    }
                    value={sourceForm.port}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          {sourceNeedsCredentials ? (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={t("dataIngestion.sources.username")}>
                  <Input
                    autoComplete="off"
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    value={sourceForm.username}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  help={
                    sourceCatalogError &&
                    classifySourceConnectionError(sourceCatalogError) === "auth"
                      ? t("dataIngestion.sources.passwordRejected")
                      : undefined
                  }
                  label={t("dataIngestion.sources.password")}
                  validateStatus={
                    sourceCatalogError &&
                    classifySourceConnectionError(sourceCatalogError) === "auth"
                      ? "error"
                      : undefined
                  }
                >
                  <Input.Password
                    autoComplete="new-password"
                    onChange={(event) => {
                      setSourceCatalogError("");
                      setSourceForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }));
                    }}
                    placeholder={
                      editingSourceId ? t("dataIngestion.sources.passwordKeep") : undefined
                    }
                    value={sourceForm.password}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          {sourceForm.source_type === "sftp" ? (
            <Form.Item
              extra={t("dataIngestion.sources.privateKeyHint")}
              label={t("dataIngestion.sources.privateKey")}
            >
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 8 }}
                onChange={(event) =>
                  setSourceForm((current) => ({
                    ...current,
                    private_key: event.target.value,
                  }))
                }
                placeholder={
                  editingSourceId ? t("dataIngestion.sources.privateKeyKeep") : undefined
                }
                value={sourceForm.private_key}
              />
            </Form.Item>
          ) : null}
          {sourceForm.source_type === "ftp" ? (
            <Form.Item label={t("dataIngestion.sources.ftpTls")}>
              <Switch
                checked={sourceForm.use_tls}
                onChange={(use_tls) => setSourceForm((current) => ({ ...current, use_tls }))}
              />
            </Form.Item>
          ) : null}
          {sourceNeedsDirectory ? (
            <Form.Item label={t("dataIngestion.sources.path")}>
              <Input
                onChange={(event) =>
                  setSourceForm((current) => ({
                    ...current,
                    path: event.target.value,
                  }))
                }
                value={sourceForm.path}
              />
            </Form.Item>
          ) : null}
          {sourceIsDatabase ? (
            <>
              <Form.Item label={t("dataIngestion.sources.database")}>
                <Input
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      database: event.target.value,
                    }))
                  }
                  value={sourceForm.database}
                />
              </Form.Item>
              <Form.Item
                extra={t("dataIngestion.sources.tableNameHint")}
                label={t("dataIngestion.sources.tableName")}
              >
                <Space.Compact block>
                  <Select
                    loading={sourceCatalogLoading}
                    mode="multiple"
                    onChange={(tableNames: string[]) =>
                      setSourceForm((current) => ({
                        ...current,
                        table_name: tableNames[0] ?? "",
                        table_names: tableNames,
                      }))
                    }
                    options={
                      databaseTableOptions.length || !sourceForm.table_name
                        ? databaseTableOptions
                        : sourceForm.table_names.map((tableName) => ({
                            value: tableName,
                            label: tableName,
                          }))
                    }
                    placeholder={t("dataIngestion.sources.tableNamePlaceholder")}
                    showSearch
                    style={{ width: "100%" }}
                    value={sourceForm.table_names}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    loading={sourceCatalogLoading}
                    onClick={() => void loadDatabaseCatalog()}
                  >
                    {t("dataIngestion.sources.loadTables")}
                  </Button>
                </Space.Compact>
              </Form.Item>
              {sourceCatalog ? (
                <Alert
                  description={t("dataIngestion.sources.autoQueryFull", {
                    count: sourceForm.table_names.length,
                  })}
                  message={t("dataIngestion.sources.autoQueryReady")}
                  showIcon
                  style={{ marginBottom: 16 }}
                  type="success"
                />
              ) : (
                <Alert
                  message={t("dataIngestion.sources.loadTablesFirst")}
                  showIcon
                  style={{ marginBottom: 16 }}
                  type="info"
                />
              )}
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setEditingDatasetId(null);
              setDatasetModalOpen(false);
            }}
          >
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" onClick={() => void saveDataset()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => {
          setEditingDatasetId(null);
          setDatasetModalOpen(false);
        }}
        open={datasetModalOpen}
        title={
          editingDatasetId
            ? t("dataIngestion.catalog.editTitle")
            : t("dataIngestion.actions.createDataset")
        }
      >
        <Form layout="vertical">
          <Form.Item label={t("dataIngestion.catalog.datasetName")} required>
            <Input
              onChange={(event) =>
                setDatasetForm((current) => ({ ...current, name: event.target.value }))
              }
              value={datasetForm.name}
            />
          </Form.Item>
          <Form.Item label={t("dataIngestion.catalog.dataType")}>
            <Select
              onChange={(data_type) => setDatasetForm((current) => ({ ...current, data_type }))}
              options={["tabular", "document", "media", "mixed"].map((value) => ({
                value,
                label: t(`dataIngestion.dataTypes.${value}`),
              }))}
              value={datasetForm.data_type}
            />
          </Form.Item>
          <Form.Item
            extra={t("dataIngestion.catalog.storageModeHint")}
            label={t("dataIngestion.catalog.storageMode")}
          >
            <Select
              onChange={(storage_mode) =>
                setDatasetForm((current) => ({
                  ...current,
                  storage_mode,
                }))
              }
              options={["auto", "shared", "dedicated"].map((value) => ({
                value,
                label: t(`dataIngestion.catalog.storageModes.${value}`),
              }))}
              disabled={Boolean(editingDatasetId)}
              value={datasetForm.storage_mode}
            />
          </Form.Item>
          <Form.Item
            extra={t("dataIngestion.catalog.upsertKeysHint")}
            label={t("dataIngestion.catalog.upsertKeys")}
          >
            <Input
              onChange={(event) =>
                setDatasetForm((current) => ({
                  ...current,
                  upsert_keys: event.target.value,
                }))
              }
              placeholder="id, tenant_id"
              value={datasetForm.upsert_keys}
            />
          </Form.Item>
          <Form.Item label={t("dataIngestion.catalog.descriptionLabel")}>
            <Input.TextArea
              onChange={(event) =>
                setDatasetForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              value={datasetForm.description}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        footer={[
          <Button key="cancel" onClick={() => setScanModalOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" onClick={() => void saveScanJob()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => setScanModalOpen(false)}
        open={scanModalOpen}
        title={
          editingScanId
            ? t("dataIngestion.autoScan.edit")
            : t("dataIngestion.actions.createScanJob")
        }
      >
        <Form layout="vertical">
          <Form.Item label={t("dataIngestion.autoScan.name")} required>
            <Input
              onChange={(event) =>
                setScanForm((current) => ({ ...current, name: event.target.value }))
              }
              value={scanForm.name}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("dataIngestion.autoScan.source")}>
                <Select
                  onChange={(source_id) => {
                    const source = sources.find((item) => item.id === source_id);
                    setScanForm((current) => ({
                      ...current,
                      source_id,
                      scan_type: scanTypeForSource(source),
                      path:
                        source?.source_type === "local_dir"
                          ? typeof source.config.path === "string"
                            ? source.config.path
                            : ""
                          : current.path,
                      recursive: ["local_dir", "ftp", "sftp"].includes(source?.source_type ?? ""),
                    }));
                  }}
                  options={sources.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  value={scanForm.source_id || undefined}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("dataIngestion.autoScan.dataset")}>
                <Select
                  onChange={(dataset_id) => setScanForm((current) => ({ ...current, dataset_id }))}
                  options={datasets.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                  value={scanForm.dataset_id || undefined}
                />
              </Form.Item>
            </Col>
          </Row>
          {scanForm.scan_type === "database" && selectedScanSource ? (
            <Alert
              message={t("dataIngestion.autoScan.databaseSettingsFromSource")}
              description={
                selectedScanSource.config.query_mode === "table"
                  ? t("dataIngestion.autoScan.databaseFullCheck")
                  : t("dataIngestion.autoScan.databaseCustomSql")
              }
              showIcon
              style={{ marginBottom: 16 }}
              type="info"
            />
          ) : null}
          <Form.Item label={t("dataIngestion.autoScan.template")}>
            <Select
              onChange={(template_code) =>
                setScanForm((current) => ({ ...current, template_code }))
              }
              options={[
                {
                  value: "auto",
                  label: t("dataIngestion.autoScan.autoTemplate"),
                },
                ...templates.map((template) => ({
                  value: template.code,
                  label: template.name,
                })),
              ]}
              value={scanForm.template_code}
            />
          </Form.Item>
          {scanForm.schedule_type === "weekly" ? (
            <Form.Item label={t("dataIngestion.autoScan.weekdays")}>
              <Select
                mode="multiple"
                onChange={(weekdays: number[]) =>
                  setScanForm((current) => ({ ...current, weekdays }))
                }
                options={["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((label, value) => ({
                  value,
                  label: t(`dataIngestion.autoScan.weekdayOptions.${label}`),
                }))}
                value={scanForm.weekdays}
              />
            </Form.Item>
          ) : null}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("dataIngestion.autoScan.scheduleType")}>
                <Select
                  onChange={(schedule_type) =>
                    setScanForm((current) => ({ ...current, schedule_type }))
                  }
                  options={["interval", "daily", "weekly", "cron"].map((value) => ({
                    value,
                    label: t(`dataIngestion.autoScan.types.${value}`),
                  }))}
                  value={scanForm.schedule_type}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              {scanForm.schedule_type === "interval" ? (
                <Form.Item label={t("dataIngestion.autoScan.intervalSeconds")}>
                  <InputNumber
                    min={30}
                    onChange={(value) =>
                      setScanForm((current) => ({
                        ...current,
                        interval_seconds: Number(value ?? 300),
                      }))
                    }
                    style={{ width: "100%" }}
                    value={scanForm.interval_seconds}
                  />
                </Form.Item>
              ) : scanForm.schedule_type === "cron" ? (
                <Form.Item label={t("dataIngestion.autoScan.cron")}>
                  <Input
                    onChange={(event) =>
                      setScanForm((current) => ({
                        ...current,
                        cron_expression: event.target.value,
                      }))
                    }
                    placeholder="0 2 * * *"
                    value={scanForm.cron_expression}
                  />
                </Form.Item>
              ) : (
                <Form.Item label={t("dataIngestion.autoScan.scheduleTime")}>
                  <Input
                    onChange={(event) =>
                      setScanForm((current) => ({
                        ...current,
                        schedule_time: event.target.value,
                      }))
                    }
                    placeholder="02:00"
                    value={scanForm.schedule_time}
                  />
                </Form.Item>
              )}
            </Col>
          </Row>
          {scanUsesFiles ? (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label={t("dataIngestion.autoScan.filePattern")}>
                  <Input
                    onChange={(event) =>
                      setScanForm((current) => ({
                        ...current,
                        file_pattern: event.target.value,
                      }))
                    }
                    value={scanForm.file_pattern}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t("dataIngestion.autoScan.recursive")}>
                  <Switch
                    checked={scanForm.recursive}
                    onChange={(recursive) => setScanForm((current) => ({ ...current, recursive }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : null}
          <Row gutter={12}>
            {scanUsesFiles ? (
              <Col span={18}>
                <Form.Item label={t("dataIngestion.autoScan.scanPath")}>
                  <Input
                    onChange={(event) =>
                      setScanForm((current) => ({ ...current, path: event.target.value }))
                    }
                    value={scanForm.path}
                  />
                </Form.Item>
              </Col>
            ) : null}
            <Col span={scanUsesFiles ? 6 : 24}>
              <Form.Item label={t("dataIngestion.autoScan.timezone")}>
                <Input
                  onChange={(event) =>
                    setScanForm((current) => ({
                      ...current,
                      timezone: event.target.value,
                    }))
                  }
                  value={scanForm.timezone}
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
