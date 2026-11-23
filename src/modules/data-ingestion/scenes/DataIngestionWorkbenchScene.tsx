/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
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
  Space,
  Statistic,
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
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
import { IngestionAgentPanel } from "@/modules/data-ingestion/components/IngestionAgentPanel";
import type { DataIngestionWorkbenchSceneProps } from "@/modules/data-ingestion/contracts/scenes";
import {
  buildMysqlConnectionUrl,
  createDataSpaceSlug,
  DEFAULT_MYSQL_PORT,
  normalizeMysqlHost,
} from "@/modules/data-ingestion/lib/mysql-connection-url";
import {
  dataIngestionService,
  setDataIngestionSpace,
} from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionAutoScanJob,
  DataIngestionControlDatabaseStatus,
  DataIngestionDataSource,
  DataIngestionDataset,
  DataIngestionDatasetRecord,
  DataIngestionInspection,
  DataIngestionOverview,
  DataIngestionPipelineTemplate,
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
    recursive: false,
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
  runId,
  onViewChange,
  onOpenRun,
  onBack,
}: DataIngestionWorkbenchSceneProps) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const runtimeConfig = useRuntimeConfig();
  const [searchParams] = useSearchParams();
  const requestedDatasetId = searchParams.get("dataset")?.trim() || "";
  const can = useCallback(
    (permission: string) => runtimeConfig.currentUser.permissions.includes(permission),
    [runtimeConfig.currentUser.permissions],
  );

  const [overview, setOverview] = useState<DataIngestionOverview | null>(null);
  const [storageInfo, setStorageInfo] = useState<DataIngestionStorageInfo | null>(null);
  const [sources, setSources] = useState<DataIngestionDataSource[]>([]);
  const [datasets, setDatasets] = useState<DataIngestionDataset[]>([]);
  const [templates, setTemplates] = useState<DataIngestionPipelineTemplate[]>([]);
  const [runs, setRuns] = useState<DataIngestionRunListItem[]>([]);
  const [runSearch, setRunSearch] = useState("");
  const [runStatus, setRunStatus] = useState("");
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
  const [sourceForm, setSourceForm] = useState({
    name: "",
    source_type: "upload",
    host: "",
    port: "",
    path: "",
    username: "",
    password: "",
    database: "",
    query: "",
    watermark_column: "",
  });

  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [datasetForm, setDatasetForm] = useState({
    name: "",
    description: "",
    data_type: "tabular",
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<DataIngestionInspection | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [selectedDatasetId, setSelectedDatasetId] = useState(requestedDatasetId);
  useEffect(() => {
    if (requestedDatasetId) {
      setSelectedDatasetId(requestedDatasetId);
    }
  }, [requestedDatasetId]);
  const [selectedTemplateCode, setSelectedTemplateCode] = useState("tabular_standard");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [createdRun, setCreatedRun] = useState<DataIngestionRun | null>(null);
  const [routeRun, setRouteRun] = useState<DataIngestionRun | null>(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [drawerRun, setDrawerRun] = useState<DataIngestionRun | null>(null);
  const [pipelineDrawer, setPipelineDrawer] = useState<DataIngestionPipelineTemplate | null>(null);
  const pollerRef = useRef<number | null>(null);

  const [selectedCatalogDatasetId, setSelectedCatalogDatasetId] = useState("");
  const [datasetSearch, setDatasetSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [records, setRecords] = useState<DataIngestionDatasetRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsLoading, setRecordsLoading] = useState(false);

  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [editingScanId, setEditingScanId] = useState<string | null>(null);
  const [scanForm, setScanForm] = useState(emptyScanForm);

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
  const activeRun = routeRun ?? createdRun;
  const visibleRuns = useMemo(() => {
    const keyword = runSearch.trim().toLowerCase();
    return runs.filter((run) => {
      if (runStatus && run.status !== runStatus) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const datasetName = datasets.find((dataset) => dataset.id === run.dataset_id)?.name || "";
      return [run.id, run.original_name, datasetName].join(" ").toLowerCase().includes(keyword);
    });
  }, [datasets, runSearch, runStatus, runs]);
  const visibleDatasets = useMemo(() => {
    const keyword = datasetSearch.trim().toLowerCase();
    if (!keyword) {
      return datasets;
    }
    return datasets.filter((dataset) =>
      `${dataset.name} ${dataset.description}`.toLowerCase().includes(keyword),
    );
  }, [datasetSearch, datasets]);

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
        const [nextOverview, nextStorage, nextSources, nextDatasets, nextTemplates, nextRuns] =
          await Promise.all([
            dataIngestionService.overview(),
            dataIngestionService.getStorageInfo(),
            dataIngestionService.listSources(),
            dataIngestionService.listDatasets(),
            dataIngestionService.listTemplates(),
            dataIngestionService.listRuns(),
          ]);
        setOverview(nextOverview);
        setStorageInfo(nextStorage);
        setSources(nextSources);
        setDatasets(nextDatasets);
        setTemplates(nextTemplates);
        setRuns(nextRuns);
        setSelectedDatasetId((current) => current || nextDatasets[0]?.id || "");
        setSelectedCatalogDatasetId((current) => current || nextDatasets[0]?.id || "");
        setSelectedSourceId(
          (current) =>
            current || nextSources.find((source) => source.source_type === "upload")?.id || "",
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

  const loadScanJobs = useCallback(async () => {
    if (!activeSpaceId) {
      setScanJobs([]);
      return;
    }
    try {
      const next = await dataIngestionService.listScanJobs();
      setScanJobs(next);
    } catch (error) {
      message.error(
        t("dataIngestion.errors.load", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }, [activeSpaceId, message, t]);

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
  }, []);

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
    if (spacesReady && activeSpaceId && activeView === "catalog") {
      void loadRecords(selectedCatalogDatasetId, 1);
    }
  }, [activeSpaceId, activeView, loadRecords, selectedCatalogDatasetId, spacesReady]);

  useEffect(() => {
    if (!spacesReady || !activeSpaceId) {
      return;
    }
    if (!runId) {
      setRouteRun(null);
      return;
    }
    let cancelled = false;
    void dataIngestionService
      .getRun(runId)
      .then((run) => {
        if (!cancelled) {
          setRouteRun(run);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          message.error(extractRequestErrorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSpaceId, message, runId, spacesReady]);

  useEffect(
    () => () => {
      if (pollerRef.current) {
        window.clearInterval(pollerRef.current);
      }
    },
    [],
  );

  async function saveSource() {
    if (!sourceForm.name.trim()) {
      return;
    }
    try {
      await dataIngestionService.createSource({
        name: sourceForm.name.trim(),
        source_type: sourceForm.source_type,
        config: {
          host: sourceForm.source_type === "api" ? undefined : sourceForm.host || undefined,
          url: sourceForm.source_type === "api" ? sourceForm.host || undefined : undefined,
          port: sourceForm.port || undefined,
          path: sourceForm.path || undefined,
          username: sourceForm.username || undefined,
          password: sourceForm.password || undefined,
          database: sourceForm.database || undefined,
          query: sourceForm.query || undefined,
          watermark_column: sourceForm.watermark_column || undefined,
        },
      });
      setSourceModalOpen(false);
      setSourceForm({
        name: "",
        source_type: "upload",
        host: "",
        port: "",
        path: "",
        username: "",
        password: "",
        database: "",
        query: "",
        watermark_column: "",
      });
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

  function changeSpace(spaceId: string) {
    setDataIngestionSpace(spaceId);
    setActiveSpaceId(spaceId);
    window.localStorage.setItem("data-ingestion.active-space", spaceId);
    setOverview(null);
    setStorageInfo(null);
    setSources([]);
    setDatasets([]);
    setTemplates([]);
    setRuns([]);
    setScanJobs([]);
    setRecords([]);
    setRecordsTotal(0);
    setSelectedDatasetId("");
    setSelectedCatalogDatasetId("");
    setSelectedSourceId("");
    setCreatedRun(null);
    setRouteRun(null);
    setDrawerRun(null);
  }

  async function saveDataSpace(values: DataSpaceFormValues) {
    setCreatingSpace(true);
    try {
      const created = await dataIngestionService.createDataSpace({
        name: values.name.trim(),
        slug: createDataSpaceSlug(values.name, values.database_name),
        database_url: buildMysqlConnectionUrl({
          databaseName: values.database_name,
          host: values.host,
          password: values.password || "",
          port: values.port,
          username: values.username,
        }),
      });
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
    setRuns([]);
    setScanJobs([]);
    setRecords([]);
    setRecordsTotal(0);
    setSelectedDatasetId("");
    setSelectedCatalogDatasetId("");
    setSelectedSourceId("");
    setCreatedRun(null);
    setRouteRun(null);
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
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function saveDataset() {
    if (!datasetForm.name.trim()) {
      return;
    }
    try {
      const dataset = await dataIngestionService.createDataset({
        name: datasetForm.name.trim(),
        description: datasetForm.description.trim(),
        data_type: datasetForm.data_type,
      });
      setDatasetModalOpen(false);
      setDatasetForm({ name: "", description: "", data_type: "tabular" });
      setSelectedDatasetId(dataset.id);
      setSelectedCatalogDatasetId(dataset.id);
      message.success(t("dataIngestion.catalog.created"));
      await loadCore(true);
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  async function inspectFile(file: File) {
    setSelectedFile(file);
    setCreatedRun(null);
    setInspection(null);
    setInspecting(true);
    try {
      const next = await dataIngestionService.inspectUpload(file);
      setInspection(next);
      setSelectedTemplateCode(next.recommended_pipeline);
      setActiveSheetIndex(
        Math.max(
          0,
          next.sheets.findIndex((sheet) => sheet.is_active),
        ),
      );
      const recommendedType = {
        tabular_standard: "tabular",
        document_standard: "document",
        media_standard: "media",
      }[next.recommended_pipeline];
      const dataset = datasets.find((item) => item.data_type === recommendedType);
      if (dataset) {
        setSelectedDatasetId(dataset.id);
      }
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setInspecting(false);
    }
  }

  async function startIngestion() {
    if (!selectedFile) {
      message.warning(t("dataIngestion.errors.selectFile"));
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
    setIngesting(true);
    try {
      const run = await dataIngestionService.createRun({
        file: selectedFile,
        datasetId: selectedDatasetId,
        templateCode: selectedTemplateCode,
        sourceId: selectedSourceId || undefined,
      });
      setCreatedRun(run);
      if (pollerRef.current) {
        window.clearInterval(pollerRef.current);
      }
      pollerRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const next = await dataIngestionService.getRun(run.id);
            setCreatedRun(next);
            if (!["queued", "running"].includes(next.status)) {
              if (pollerRef.current) {
                window.clearInterval(pollerRef.current);
                pollerRef.current = null;
              }
              message.success(t("dataIngestion.import.inserted", { count: next.inserted_count }));
              await loadCore(true);
            }
          } catch {
            if (pollerRef.current) {
              window.clearInterval(pollerRef.current);
              pollerRef.current = null;
            }
          }
        })();
      }, 1000);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setIngesting(false);
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
      setRouteRun(next);
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
        <Button
          disabled={!can("data_ingestion:modify")}
          onClick={() => void testSource(item.id)}
          type="link"
        >
          {t("dataIngestion.actions.test")}
        </Button>
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
        <Button onClick={() => void openRun(item)} type="link">
          {t("dataIngestion.actions.open")}
        </Button>
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
      title: t("dataIngestion.catalog.records"),
      dataIndex: "record_count",
      key: "records",
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
        <Button
          onClick={() => {
            setSelectedCatalogDatasetId(item.id);
            setRecordsPage(1);
            void loadRecords(item.id, 1);
          }}
          type="link"
        >
          {t("dataIngestion.actions.open")}
        </Button>
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
    ];
  }, [records, t]);

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
      title: t("dataIngestion.pipelines.stepKind"),
      dataIndex: "kind",
      key: "kind",
      width: 120,
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
    { key: "runs", label: t("dataIngestion.tabs.runs") },
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
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card title={t("dataIngestion.import.title")}>
          <Upload.Dragger
            beforeUpload={(file) => {
              void inspectFile(file);
              return Upload.LIST_IGNORE;
            }}
            disabled={ingesting}
            maxCount={1}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined />
            </p>
            <p className="ant-upload-text">
              {inspection?.filename || t("dataIngestion.import.uploadHint")}
            </p>
            <p className="ant-upload-hint">{t("dataIngestion.import.uploadFormats")}</p>
          </Upload.Dragger>
          <Form layout="vertical" style={{ marginTop: 16 }}>
            <Row gutter={16}>
              <Col md={8} xs={24}>
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
                      onClick={() => setDatasetModalOpen(true)}
                    >
                      {t("dataIngestion.actions.createDataset")}
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Col>
              <Col md={8} xs={24}>
                <Form.Item label={t("dataIngestion.import.template")}>
                  <Select
                    onChange={setSelectedTemplateCode}
                    options={templates.map((item) => ({
                      label: item.name,
                      value: item.code,
                      disabled:
                        !!inspection && !item.supported_types.includes(inspection.file_type),
                    }))}
                    value={selectedTemplateCode}
                  />
                </Form.Item>
              </Col>
              <Col md={8} xs={24}>
                <Form.Item label={t("dataIngestion.import.source")}>
                  <Select
                    allowClear
                    onChange={setSelectedSourceId}
                    options={sources.map((item) => ({
                      label: item.name,
                      value: item.id,
                    }))}
                    value={selectedSourceId || undefined}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Space>
              <Button
                disabled={!can("data_ingestion:create")}
                loading={ingesting}
                onClick={() => void startIngestion()}
                type="primary"
              >
                {t("dataIngestion.actions.startIngestion")}
              </Button>
            </Space>
          </Form>
        </Card>

        <Card loading={inspecting} title={t("dataIngestion.import.preview")}>
          {!inspection ? (
            <Empty description={t("dataIngestion.import.noPreview")} />
          ) : (
            <>
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
                <Descriptions.Item label={t("dataIngestion.import.rows")}>
                  {activeSheet?.rows.length ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label={t("dataIngestion.import.columns")}>
                  {activeSheet?.columns.length ?? 0}
                </Descriptions.Item>
                <Descriptions.Item label="Type">{inspection.file_type}</Descriptions.Item>
                <Descriptions.Item label="Size">{formatBytes(inspection.size)}</Descriptions.Item>
              </Descriptions>
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
              ) : (
                <pre className={styles.codeBlock}>
                  {displayValue(inspection.metadata.excerpt || inspection.metadata)}
                </pre>
              )}
            </>
          )}
        </Card>

        <Card title={t("dataIngestion.import.runtime")}>
          {!activeRun ? (
            <Empty description={t("dataIngestion.import.notStarted")} />
          ) : (
            <>
              <Alert
                message={
                  activeRun.status === "success"
                    ? t("dataIngestion.import.success")
                    : activeRun.status === "failed"
                      ? t("dataIngestion.import.failed")
                      : t(`dataIngestion.status.${activeRun.status}`)
                }
                showIcon
                type={
                  activeRun.status === "success"
                    ? "success"
                    : activeRun.status === "failed"
                      ? "error"
                      : "info"
                }
              />
              <Space style={{ margin: "12px 0" }} wrap>
                <Tag color={statusColor(activeRun.status)}>
                  {t(`dataIngestion.status.${activeRun.status}`)}
                </Tag>
                <Text>
                  {t("dataIngestion.import.inserted", { count: activeRun.inserted_count })}
                </Text>
                <Text>
                  {t("dataIngestion.import.duplicates", {
                    count: activeRun.duplicate_count,
                  })}
                </Text>
                {onOpenRun ? (
                  <Button onClick={() => onOpenRun(activeRun.id)} type="link">
                    {t("dataIngestion.runs.detail")}
                  </Button>
                ) : null}
              </Space>
              <StageDetail
                run={activeRun}
                template={templates.find((template) => template.code === activeRun.template_code)}
              />
            </>
          )}
        </Card>
      </Space>
    );
  }

  function renderPipelines() {
    return (
      <Card title={t("dataIngestion.pipelines.title")}>
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
              onClick={() => setSourceModalOpen(true)}
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

  function renderRuns() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {runId && routeRun ? (
          <RunDetailCard
            canRetry={can("data_ingestion:task_manage")}
            onBack={onBack}
            onDownload={() => void downloadRunAsset(routeRun)}
            onRetry={() => void retryRun(routeRun)}
            run={routeRun}
            template={templates.find((template) => template.code === routeRun.template_code)}
          />
        ) : null}
        <Card title={t("dataIngestion.runs.title")}>
          <Paragraph type="secondary">{t("dataIngestion.runs.description")}</Paragraph>
          <Space className={styles.filterBar} wrap>
            <Input
              allowClear
              onChange={(event) => setRunSearch(event.target.value)}
              placeholder={t("dataIngestion.runs.search")}
              prefix={<SearchOutlined />}
              value={runSearch}
            />
            <Select
              allowClear
              onChange={setRunStatus}
              options={["queued", "running", "success", "failed"].map((value) => ({
                value,
                label: t(`dataIngestion.status.${value}`),
              }))}
              placeholder={t("dataIngestion.runs.statusFilter")}
              style={{ minWidth: 160 }}
              value={runStatus || undefined}
            />
            <Text type="secondary">{visibleRuns.length}</Text>
          </Space>
          <Table
            columns={runColumns}
            dataSource={visibleRuns}
            locale={{ emptyText: t("dataIngestion.runs.empty") }}
            rowKey="id"
            scroll={{ x: 1100 }}
          />
        </Card>
      </Space>
    );
  }

  function renderCatalog() {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Card
          extra={
            <Button
              disabled={!can("data_ingestion:create")}
              icon={<PlusOutlined />}
              onClick={() => setDatasetModalOpen(true)}
            >
              {t("dataIngestion.actions.createDataset")}
            </Button>
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
          />
        </Card>
        <Card
          extra={
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

  const sourceNeedsEndpoint = ["ftp", "sftp", "mysql", "postgres", "api"].includes(
    sourceForm.source_type,
  );
  const sourceNeedsCredentials = ["ftp", "sftp", "mysql", "postgres"].includes(
    sourceForm.source_type,
  );
  const sourceNeedsDirectory = ["local_dir", "ftp", "sftp"].includes(sourceForm.source_type);
  const sourceIsDatabase = ["mysql", "postgres"].includes(sourceForm.source_type);

  const viewContent = {
    overview: renderOverview,
    import: renderImport,
    pipelines: renderPipelines,
    sources: renderSources,
    runs: renderRuns,
    catalog: renderCatalog,
    "auto-scan": renderAutoScan,
    agent: () =>
      can("data_ingestion:agent_use") ? (
        <IngestionAgentPanel />
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
              scroll={{ x: 1500 }}
              size="small"
            />
          </>
        ) : null}
      </Drawer>

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

      <Modal
        footer={[
          <Button key="cancel" onClick={() => setSourceModalOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" onClick={() => void saveSource()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => setSourceModalOpen(false)}
        open={sourceModalOpen}
        title={t("dataIngestion.actions.createSource")}
      >
        <Form layout="vertical">
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
              onChange={(source_type) => setSourceForm((current) => ({ ...current, source_type }))}
              options={["upload", "local_dir", "ftp", "sftp", "mysql", "postgres", "api"].map(
                (value) => ({
                  value,
                  label: t(`dataIngestion.sourceTypes.${value}`),
                }),
              )}
              value={sourceForm.source_type}
            />
          </Form.Item>
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
                <Form.Item label={t("dataIngestion.sources.password")}>
                  <Input.Password
                    autoComplete="new-password"
                    onChange={(event) =>
                      setSourceForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    value={sourceForm.password}
                  />
                </Form.Item>
              </Col>
            </Row>
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
              <Row gutter={12}>
                <Col span={12}>
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
                </Col>
                <Col span={12}>
                  <Form.Item label={t("dataIngestion.sources.watermark")}>
                    <Input
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          watermark_column: event.target.value,
                        }))
                      }
                      value={sourceForm.watermark_column}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t("dataIngestion.sources.query")}>
                <Input.TextArea
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  rows={4}
                  value={sourceForm.query}
                />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        footer={[
          <Button key="cancel" onClick={() => setDatasetModalOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" onClick={() => void saveDataset()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => setDatasetModalOpen(false)}
        open={datasetModalOpen}
        title={t("dataIngestion.actions.createDataset")}
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
          <Row gutter={12}>
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
            <Col span={6}>
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
