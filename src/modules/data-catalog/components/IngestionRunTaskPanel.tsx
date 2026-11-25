/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 */

import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionPipelineExecution,
  DataIngestionRun,
  DataIngestionRunListItem,
  DataIngestionSpace,
} from "@/modules/data-ingestion/types/data-ingestion";

type IngestionTaskRow = DataIngestionRunListItem & {
  dataset_name: string;
  space_id: string;
  space_name: string;
};

const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

function statusColor(status: string) {
  if (status === "success") return "green";
  if (status === "failed") return "red";
  if (status === "running") return "blue";
  if (status === "queued" || status === "pending") return "gold";
  return "default";
}

export function IngestionRunTaskPanel() {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [rows, setRows] = useState<IngestionTaskRow[]>([]);
  const [pipelineExecutions, setPipelineExecutions] = useState<DataIngestionPipelineExecution[]>(
    [],
  );
  const [spaces, setSpaces] = useState<DataIngestionSpace[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DataIngestionRun | null>(null);
  const [pipelineDetail, setPipelineDetail] = useState<DataIngestionPipelineExecution | null>(null);
  const loadInFlightRef = useRef(false);
  const detailInFlightRef = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (loadInFlightRef.current) {
        return;
      }
      loadInFlightRef.current = true;
      if (!silent) {
        setLoading(true);
      }
      try {
        const nextSpaces = await dataIngestionService.listDataSpaces();
        setSpaces(nextSpaces);
        const perSpace = await Promise.all(
          nextSpaces.map(async (space) => {
            const [runs, datasets, executions] = await Promise.all([
              silent
                ? dataIngestionService
                    .listRunsForSpacePage(space.id, {
                      page: 1,
                      pageSize: 200,
                      status: status || undefined,
                    })
                    .then((result) => result.items)
                : dataIngestionService.listAllRunsForSpace(space.id, {
                    status: status || undefined,
                  }),
              dataIngestionService.listDatasetsForSpace(space.id),
              silent
                ? dataIngestionService
                    .listPipelineExecutionsForSpacePage(space.id, 1, 200)
                    .then((result) => result.items)
                : dataIngestionService.listAllPipelineExecutionsForSpace(space.id),
            ]);
            const datasetNames = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
            return {
              executions,
              runs: runs.map((run) => ({
                ...run,
                dataset_name: datasetNames.get(run.dataset_id) || run.dataset_id,
                space_id: space.id,
                space_name: space.name,
              })),
            };
          }),
        );
        const freshRows = perSpace
          .flatMap((item) => item.runs)
          .sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRows((current) => {
          if (!silent) {
            return freshRows;
          }
          const freshIds = new Set(freshRows.map((row) => row.id));
          return [
            ...current.filter(
              (row) => !freshIds.has(row.id) && !ACTIVE_RUN_STATUSES.has(row.status),
            ),
            ...freshRows,
          ].sort((a, b) => b.created_at.localeCompare(a.created_at));
        });
        const nextExecutions = perSpace.flatMap((item) => item.executions);
        setPipelineExecutions((current) => {
          if (!silent) {
            return nextExecutions;
          }
          const freshIds = new Set(nextExecutions.map((execution) => execution.id));
          return [
            ...current.filter(
              (execution) =>
                !freshIds.has(execution.id) && !ACTIVE_RUN_STATUSES.has(execution.status),
            ),
            ...nextExecutions,
          ].sort((a, b) => b.created_at.localeCompare(a.created_at));
        });
        setPipelineDetail((current) =>
          current
            ? (nextExecutions.find((execution) => execution.id === current.id) ?? current)
            : null,
        );
      } catch (error) {
        if (!silent) {
          message.error(extractRequestErrorMessage(error));
        }
      } finally {
        loadInFlightRef.current = false;
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [message, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveTasks = useMemo(
    () =>
      rows.some((row) => ACTIVE_RUN_STATUSES.has(row.status)) ||
      pipelineExecutions.some((execution) => ACTIVE_RUN_STATUSES.has(execution.status)),
    [pipelineExecutions, rows],
  );

  useEffect(() => {
    if (!hasActiveTasks) {
      return;
    }
    const timer = window.setInterval(() => {
      void load(true);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveTasks, load]);

  const detailSpaceId = useMemo(
    () => rows.find((row) => row.id === detail?.id)?.space_id ?? "",
    [detail?.id, rows],
  );

  useEffect(() => {
    if (!detail || !detailSpaceId || !ACTIVE_RUN_STATUSES.has(detail.status)) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (detailInFlightRef.current) {
        return;
      }
      detailInFlightRef.current = true;
      void dataIngestionService
        .getRunForSpace(detailSpaceId, detail.id)
        .then((next) => {
          if (!cancelled) {
            setDetail(next);
          }
        })
        .catch(() => {
          // The task list refresh will surface a persistent failure once.
        })
        .finally(() => {
          detailInFlightRef.current = false;
        });
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detail, detailSpaceId]);

  const openDetail = useCallback(
    async (row: IngestionTaskRow) => {
      try {
        setDetail(await dataIngestionService.getRunForSpace(row.space_id, row.id));
      } catch (error) {
        message.error(extractRequestErrorMessage(error));
      }
    },
    [message],
  );

  const removeRun = useCallback(
    async (row: IngestionTaskRow) => {
      try {
        await dataIngestionService.deleteRunForSpace(row.space_id, row.id);
        message.success(t("dataIngestion.runs.deleted"));
        await load();
      } catch (error) {
        message.error(extractRequestErrorMessage(error));
      }
    },
    [load, message, t],
  );

  const removePipelineExecution = useCallback(
    async (execution: DataIngestionPipelineExecution) => {
      try {
        await dataIngestionService.deletePipelineExecutionForSpace(
          execution.space_id,
          execution.id,
        );
        message.success(t("dataIngestion.pipelines.executionDeleted"));
        await load();
      } catch (error) {
        message.error(extractRequestErrorMessage(error));
      }
    },
    [load, message, t],
  );

  const columns = useMemo(
    () => [
      {
        key: "file",
        title: t("dataIngestion.runs.fileName"),
        render: (_: unknown, row: IngestionTaskRow) => (
          <Space direction="vertical" size={0}>
            <strong>{row.original_name}</strong>
            <code>{row.id}</code>
          </Space>
        ),
      },
      {
        dataIndex: "space_name",
        key: "space",
        title: t("dataIngestion.spaces.current"),
      },
      {
        dataIndex: "dataset_name",
        key: "dataset",
        title: t("dataIngestion.runs.dataset"),
      },
      {
        dataIndex: "status",
        key: "status",
        render: (value: string) => (
          <Tag color={statusColor(value)}>
            {t(`dataIngestion.status.${value}`, { defaultValue: value })}
          </Tag>
        ),
        title: t("dataIngestion.runs.status"),
      },
      {
        dataIndex: "inserted_count",
        key: "inserted",
        title: t("dataIngestion.runs.inserted"),
      },
      {
        dataIndex: "updated_count",
        key: "updated",
        title: t("dataIngestion.runs.updated"),
      },
      {
        dataIndex: "created_at",
        key: "created",
        render: (value: string) => value.replace("T", " ").replace(/\.\d+Z?$/, ""),
        title: t("dataIngestion.runs.createdAt"),
      },
      {
        key: "actions",
        render: (_: unknown, row: IngestionTaskRow) => (
          <Space>
            <Button onClick={() => void openDetail(row)} type="link">
              {t("dataIngestion.runs.detail")}
            </Button>
            {ACTIVE_RUN_STATUSES.has(row.status) ? (
              <Tooltip title={t("dataIngestion.runs.activeDeleteBlocked")}>
                <Button danger disabled icon={<DeleteOutlined />} type="link">
                  {t("dataIngestion.actions.delete")}
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                onConfirm={() => void removeRun(row)}
                title={t("dataIngestion.actions.delete")}
              >
                <Button danger icon={<DeleteOutlined />} type="link">
                  {t("dataIngestion.actions.delete")}
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
        title: t("dataIngestion.agent.actions"),
      },
    ],
    [openDetail, removeRun, t],
  );

  const pipelineColumns = useMemo(
    () => [
      {
        key: "pipeline",
        title: t("dataIngestion.pipelines.executionPipeline"),
        render: (_: unknown, row: DataIngestionPipelineExecution) => (
          <Space direction="vertical" size={0}>
            <strong>{row.pipeline_name}</strong>
            <code>{row.pipeline_code}</code>
          </Space>
        ),
      },
      {
        key: "space",
        title: t("dataIngestion.spaces.current"),
        render: (_: unknown, row: DataIngestionPipelineExecution) =>
          spaces.find((space) => space.id === row.space_id)?.name || row.space_id,
      },
      {
        dataIndex: "status",
        key: "status",
        title: t("dataIngestion.runs.status"),
        render: (value: string) => (
          <Tag color={statusColor(value)}>
            {t(`dataIngestion.status.${value}`, { defaultValue: value })}
          </Tag>
        ),
      },
      {
        key: "steps",
        title: t("dataIngestion.pipelines.executionSteps"),
        render: (_: unknown, row: DataIngestionPipelineExecution) => row.results.length,
      },
      {
        dataIndex: "created_at",
        key: "created",
        title: t("dataIngestion.runs.createdAt"),
        render: (value: string) => value.replace("T", " ").replace(/\.\d+Z?$/, ""),
      },
      {
        key: "actions",
        title: t("dataIngestion.agent.actions"),
        render: (_: unknown, row: DataIngestionPipelineExecution) => (
          <Space>
            <Button onClick={() => setPipelineDetail(row)} type="link">
              {t("dataIngestion.runs.detail")}
            </Button>
            {ACTIVE_RUN_STATUSES.has(row.status) ? (
              <Tooltip title={t("dataIngestion.runs.activeDeleteBlocked")}>
                <Button danger disabled icon={<DeleteOutlined />} type="link">
                  {t("dataIngestion.actions.delete")}
                </Button>
              </Tooltip>
            ) : (
              <Popconfirm
                onConfirm={() => void removePipelineExecution(row)}
                title={t("dataIngestion.actions.delete")}
              >
                <Button danger icon={<DeleteOutlined />} type="link">
                  {t("dataIngestion.actions.delete")}
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [removePipelineExecution, spaces, t],
  );

  return (
    <>
      <Card
        extra={
          <Space>
            <Select
              allowClear
              onChange={setStatus}
              options={["queued", "running", "success", "failed"].map((value) => ({
                label: t(`dataIngestion.status.${value}`),
                value,
              }))}
              placeholder={t("dataIngestion.runs.statusFilter")}
              style={{ width: 160 }}
              value={status || undefined}
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
              {t("dataIngestion.actions.refresh")}
            </Button>
            {hasActiveTasks ? (
              <Tag color="processing">{t("dataIngestion.runs.autoRefreshing")}</Tag>
            ) : null}
          </Space>
        }
        title={t("dataCatalog.taskManagement.ingestionRunsTitle", {
          spaces: spaces.length,
        })}
      >
        <Table
          columns={columns}
          dataSource={rows}
          loading={loading}
          locale={{ emptyText: t("dataIngestion.runs.empty") }}
          pagination={{ pageSize: 20 }}
          rowKey={(row) => `${row.space_id}:${row.id}`}
          scroll={{ x: 1000 }}
        />
      </Card>
      <Card
        style={{ marginTop: 16 }}
        title={t("dataCatalog.taskManagement.pipelineExecutionsTitle")}
      >
        <Table
          columns={pipelineColumns}
          dataSource={pipelineExecutions}
          loading={loading}
          locale={{ emptyText: t("dataIngestion.pipelines.executionEmpty") }}
          pagination={{ pageSize: 20 }}
          rowKey="id"
          scroll={{ x: 900 }}
        />
      </Card>
      <Drawer
        onClose={() => setDetail(null)}
        open={Boolean(detail)}
        title={detail?.original_name}
        width="min(900px, 94vw)"
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Run ID">{detail.id}</Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.status")}>
                <Tag color={statusColor(detail.status)}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.inserted")}>
                {detail.inserted_count}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.updated")}>
                {detail.updated_count}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.duplicates")}>
                {detail.duplicate_count}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.size")}>
                {detail.file_size}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.createdAt")}>
                {detail.created_at}
              </Descriptions.Item>
            </Descriptions>
            <Table
              columns={[
                { dataIndex: "sequence", key: "sequence", title: "#", width: 60 },
                { dataIndex: "name", key: "name", title: t("dataIngestion.pipelines.stepName") },
                {
                  dataIndex: "status",
                  key: "status",
                  render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>,
                  title: t("dataIngestion.runs.status"),
                },
                {
                  dataIndex: "input_count",
                  key: "input",
                  title: t("dataIngestion.pipelines.stepInput"),
                },
                {
                  dataIndex: "output_count",
                  key: "output",
                  title: t("dataIngestion.pipelines.stepOutput"),
                },
                {
                  dataIndex: "duration_ms",
                  key: "duration",
                  title: "ms",
                },
              ]}
              dataSource={detail.stages}
              pagination={false}
              rowKey="id"
              size="small"
            />
          </Space>
        ) : null}
      </Drawer>
      <Drawer
        onClose={() => setPipelineDetail(null)}
        open={Boolean(pipelineDetail)}
        title={pipelineDetail?.pipeline_name}
        width="min(900px, 94vw)"
      >
        {pipelineDetail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="Execution ID">{pipelineDetail.id}</Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.status")}>
                <Tag color={statusColor(pipelineDetail.status)}>{pipelineDetail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.pipelines.executionSteps")}>
                {pipelineDetail.results.length}
              </Descriptions.Item>
              <Descriptions.Item label={t("dataIngestion.runs.createdAt")}>
                {pipelineDetail.created_at}
              </Descriptions.Item>
            </Descriptions>
            {pipelineDetail.error_message ? (
              <Card title={t("dataIngestion.runs.error")}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {pipelineDetail.error_message}
                </pre>
              </Card>
            ) : null}
            <Card title={t("dataIngestion.pipelines.executionInputs")}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(pipelineDetail.inputs, null, 2)}
              </pre>
            </Card>
            {pipelineDetail.results.map((item) => (
              <Card key={`${item.step}-${item.key}`} title={`${item.step}. ${item.tool_name}`}>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(item, null, 2)}
                </pre>
              </Card>
            ))}
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
