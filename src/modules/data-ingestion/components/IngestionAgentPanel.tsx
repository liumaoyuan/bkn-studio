/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  ApiOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { MarkdownText } from "@/framework/ui/common/MarkdownText";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionAgentManifest,
  DataIngestionAgentMessage,
  DataIngestionAgentSession,
  DataIngestionAgentSessionDetail,
  DataIngestionAgentSkill,
  DataIngestionAgentStatus,
  DataIngestionAgentStreamEvent,
} from "@/modules/data-ingestion/types/data-ingestion";

import { CustomMcpToolManager, CustomSkillManager } from "./CapabilityManager";
import styles from "./IngestionAgentPanel.module.css";

const { Paragraph, Text, Title } = Typography;

function safeText(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function McpToolList({
  onDelete,
  tools,
}: {
  onDelete?: (tool: DataIngestionAgentManifest["tools"][number]) => void;
  tools: DataIngestionAgentManifest["tools"];
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DataIngestionAgentManifest["tools"][number] | null>(
    null,
  );

  return (
    <>
      <div className={styles.toolGrid}>
        {tools.map((tool) => (
          <Card
            className={styles.toolCard}
            hoverable
            key={tool.qualifiedName || tool.name}
            onClick={() => setSelected(tool)}
            size="small"
          >
            <div className={styles.toolHeader}>
              <div>
                <div className={styles.toolName}>{tool.display_name || tool.name}</div>
              </div>
              <Space size={4}>
                {tool.built_in ? <Tag color="gold">{t("dataIngestion.agent.builtIn")}</Tag> : null}
                <Tag color={tool.read_only ? "blue" : "orange"}>
                  {t(
                    tool.read_only
                      ? "dataIngestion.agent.readOnly"
                      : "dataIngestion.agent.requiresApproval",
                  )}
                </Tag>
              </Space>
            </div>
            <Paragraph className={styles.toolDescription}>{tool.description}</Paragraph>
            <div className={styles.toolMeta}>
              <Text className={styles.technicalLabel} type="secondary">
                {t("dataIngestion.agent.technicalName")}
              </Text>
              <Text className={styles.toolCode} code>
                {tool.qualifiedName || tool.name}
              </Text>
            </div>
          </Card>
        ))}
      </div>
      <Modal
        footer={
          selected && !selected.built_in && onDelete ? (
            <Popconfirm
              onConfirm={() => {
                onDelete(selected);
                setSelected(null);
              }}
              title={t("dataIngestion.agent.deleteConfirm")}
            >
              <Button danger>{t("dataIngestion.actions.delete")}</Button>
            </Popconfirm>
          ) : null
        }
        onCancel={() => setSelected(null)}
        open={Boolean(selected)}
        title={selected?.display_name || selected?.name}
      >
        {selected ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label={t("dataIngestion.agent.description")}>
              {selected.description || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("dataIngestion.agent.technicalName")}>
              <Text code>{selected.qualifiedName || selected.name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label={t("dataIngestion.agent.arguments")}>
              {selected.arguments?.length ? (
                <Space direction="vertical" size={2}>
                  {selected.arguments.map((argument) => (
                    <Text key={argument.name}>
                      <Text code>{argument.name}</Text> · {argument.type}
                      {argument.required ? ` · ${t("dataIngestion.agent.required")}` : ""}
                    </Text>
                  ))}
                </Space>
              ) : (
                "-"
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("dataIngestion.agent.returns")}>
              {selected.returns || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("dataIngestion.agent.lockState")}>
              {selected.locked
                ? t("dataIngestion.agent.builtInLocked")
                : t("dataIngestion.agent.userEditable")}
            </Descriptions.Item>
            {selected.config ? (
              <Descriptions.Item label={t("dataIngestion.agent.configuration")}>
                <pre className={styles.codePanel}>{JSON.stringify(selected.config, null, 2)}</pre>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
        ) : null}
      </Modal>
    </>
  );
}

export function IngestionAgentPanel() {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCapabilityTab = searchParams.get("tab") || "overview";
  const [manifest, setManifest] = useState<DataIngestionAgentManifest | null>(null);
  const [skill, setSkill] = useState<DataIngestionAgentSkill | null>(null);
  const [agentStatus, setAgentStatus] = useState<DataIngestionAgentStatus | null>(null);
  const [sessions, setSessions] = useState<DataIngestionAgentSession[]>([]);
  const [detail, setDetail] = useState<DataIngestionAgentSessionDetail | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [input, setInput] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string>();
  const [loadingSessionId, setLoadingSessionId] = useState<string>();
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string>();
  const [streamActivity, setStreamActivity] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const selectedSessionIdRef = useRef<string | undefined>(undefined);
  const chatPanelRef = useRef<HTMLDivElement>(null);

  const loadSession = useCallback(async (sessionId: string) => {
    const next = await dataIngestionService.getAgentSession(sessionId);
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setDetail(next);
    setSessions((current) =>
      current.map((item) =>
        item.id === next.id
          ? {
              ...item,
              status: next.status,
              title: next.title,
              updated_at: next.updated_at,
            }
          : item,
      ),
    );
    return next;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextManifest, nextSkill, nextStatus, nextSessions] = await Promise.all([
        dataIngestionService.getAgentManifest(),
        dataIngestionService.getAgentSkill(),
        dataIngestionService.getAgentStatus(),
        dataIngestionService.listAgentSessions(),
      ]);
      setManifest(nextManifest);
      setSkill(nextSkill);
      setAgentStatus(nextStatus);
      setSessions(nextSessions);
      const selected = selectedSessionIdRef.current;
      const target =
        nextSessions.find((session) => session.id === selected)?.id ?? nextSessions[0]?.id;
      if (target) {
        await loadSession(target);
      } else {
        selectedSessionIdRef.current = undefined;
        setSelectedSessionId(undefined);
        setDetail(null);
      }
    } catch (error) {
      message.error(
        t("dataIngestion.errors.load", {
          message: extractRequestErrorMessage(error),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [loadSession, message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    const panel = chatPanelRef.current;
    if (!panel || !detail?.messages.length) {
      return;
    }
    window.requestAnimationFrame(() => {
      panel.scrollTop = panel.scrollHeight;
    });
  }, [detail?.id, detail?.messages.length, streamActivity, streamReasoning.length]);

  async function selectSession(sessionId: string) {
    if (loadingSessionId === sessionId) {
      return;
    }
    if (selectedSessionIdRef.current === sessionId && detail) {
      return;
    }
    setLoadingSessionId(sessionId);
    setInput("");
    setPendingAttachment(null);
    try {
      await loadSession(sessionId);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setLoadingSessionId(undefined);
    }
  }

  async function refreshCurrentSession() {
    if (!detail || loadingSessionId) {
      return;
    }
    setLoadingSessionId(detail.id);
    try {
      await loadSession(detail.id);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setLoadingSessionId(undefined);
    }
  }

  async function createSession() {
    if (creatingSession) {
      return;
    }
    setCreatingSession(true);
    try {
      const session = await dataIngestionService.createAgentSession();
      selectedSessionIdRef.current = session.id;
      setSelectedSessionId(session.id);
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      setDetail({
        ...session,
        messages: [],
        approvals: [],
        memories: [],
      });
      setInput("");
      setPendingAttachment(null);
      message.success(t("dataIngestion.agent.sessionCreated"));
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    } finally {
      setCreatingSession(false);
    }
  }

  async function send() {
    const content = input.trim();
    const attachment = pendingAttachment;
    if (
      !detail ||
      detail.status === "running" ||
      pendingApprovals.length > 0 ||
      (!content && !attachment) ||
      !agentStatus?.configured ||
      sending
    ) {
      return;
    }
    const now = new Date().toISOString();
    const optimisticMessage: DataIngestionAgentMessage = {
      attachments: attachment
        ? [
            {
              file_path: "",
              file_type: "",
              filename: attachment.name,
              id: `pending-${Date.now()}`,
              media_type: attachment.type,
              recommended_pipeline: "",
              sha256: "",
              size: attachment.size,
            },
          ]
        : [],
      content: content || t("dataIngestion.agent.attachmentSent"),
      created_at: now,
      id: `pending-${Date.now()}`,
      name: "",
      role: "user",
      tool_call_id: "",
      tool_calls: [],
    };
    setSending(true);
    setStreamActivity(t("dataIngestion.agent.streamPreparing"));
    setStreamReasoning("");
    setInput("");
    setPendingAttachment(null);
    setDetail((current) =>
      current
        ? {
            ...current,
            messages: [...current.messages, optimisticMessage],
            status: "running",
          }
        : current,
    );
    setSessions((current) =>
      current.map((item) =>
        item.id === detail.id ? { ...item, status: "running", updated_at: now } : item,
      ),
    );
    try {
      const turnId = `stream-${Date.now()}`;
      const handleEvent = (event: DataIngestionAgentStreamEvent) => {
        handleAgentStreamEvent(event, turnId);
      };
      const result = attachment
        ? await dataIngestionService.streamAgentMessageWithAttachment(
            detail.id,
            content,
            attachment,
            handleEvent,
          )
        : await dataIngestionService.streamAgentMessage(detail.id, content, handleEvent);
      if (result.session) {
        applySessionSnapshot(result.session);
      }
      if (result.error) {
        setStreamActivity("");
        message.error(result.error);
      }
    } catch (error) {
      await loadSession(detail.id).catch(() => undefined);
      setInput((current) => current || content);
      setPendingAttachment((current) => current ?? attachment);
      setStreamActivity("");
      message.error(extractRequestErrorMessage(error));
    } finally {
      await reconcileSession(detail.id);
      setStreamActivity("");
      setStreamReasoning("");
      setSending(false);
    }
  }

  async function resolveApproval(approvalId: string, approve: boolean) {
    if (!detail || resolvingApprovalId) {
      return;
    }
    const nextStatus = approve ? "approved" : "rejected";
    setResolvingApprovalId(approvalId);
    setStreamActivity(t("dataIngestion.agent.streamPreparing"));
    setStreamReasoning("");
    setDetail((current) =>
      current
        ? {
            ...current,
            approvals: current.approvals.map((approval) =>
              approval.id === approvalId
                ? {
                    ...approval,
                    resolved_at: new Date().toISOString(),
                    status: nextStatus,
                  }
                : approval,
            ),
            status: "running",
          }
        : current,
    );
    try {
      const turnId = `approval-${approvalId}-${Date.now()}`;
      const handleEvent = (event: DataIngestionAgentStreamEvent) => {
        handleAgentStreamEvent(event, turnId);
      };
      const result = approve
        ? await dataIngestionService.streamApproveAgentTool(detail.id, approvalId, "", handleEvent)
        : await dataIngestionService.streamRejectAgentTool(detail.id, approvalId, "", handleEvent);
      if (result.session) {
        applySessionSnapshot(result.session);
      }
      if (result.error) {
        setStreamActivity("");
        message.error(result.error);
      }
      message.success(t(approve ? "dataIngestion.agent.approved" : "dataIngestion.agent.rejected"));
    } catch (error) {
      await loadSession(detail.id).catch(() => undefined);
      setStreamActivity("");
      message.error(extractRequestErrorMessage(error));
    } finally {
      await reconcileSession(detail.id);
      setStreamActivity("");
      setStreamReasoning("");
      setResolvingApprovalId(undefined);
    }
  }

  async function addMemory() {
    if (!detail || !memoryKey.trim() || !memoryValue.trim()) {
      return;
    }
    try {
      await dataIngestionService.addAgentMemory(detail.id, memoryKey.trim(), memoryValue.trim());
      setMemoryKey("");
      setMemoryValue("");
      await loadSession(detail.id);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteMemory(memoryId: string) {
    if (!detail) {
      return;
    }
    try {
      await dataIngestionService.deleteAgentMemory(detail.id, memoryId);
      await loadSession(detail.id);
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function deleteSession(sessionId: string) {
    if (deletingSessionId) {
      return;
    }
    const previousSessions = sessions;
    const nextSessions = sessions.filter((session) => session.id !== sessionId);
    setDeletingSessionId(sessionId);
    setSessions(nextSessions);
    if (selectedSessionIdRef.current === sessionId) {
      selectedSessionIdRef.current = nextSessions[0]?.id;
      setSelectedSessionId(nextSessions[0]?.id);
      setDetail(null);
    }
    try {
      await dataIngestionService.deleteAgentSession(sessionId);
      message.success(t("dataIngestion.agent.sessionDeleted"));
      if (selectedSessionIdRef.current && nextSessions[0]) {
        await loadSession(nextSessions[0].id);
      }
    } catch (error) {
      setSessions(previousSessions);
      if (selectedSessionId && selectedSessionIdRef.current !== selectedSessionId) {
        await loadSession(selectedSessionId).catch(() => undefined);
      }
      message.error(extractRequestErrorMessage(error));
    } finally {
      setDeletingSessionId(undefined);
    }
  }

  async function deleteCustomTool(tool: DataIngestionAgentManifest["tools"][number]) {
    try {
      await dataIngestionService.deleteCustomMcpTool(tool.id || tool.name);
      message.success(t("dataIngestion.agent.capabilityDeleted"));
      await load();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      message.success(t("dataIngestion.agent.copied"));
    } catch {
      message.error(t("dataIngestion.agent.copy"));
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    event.preventDefault();
    void send();
  }

  function applySessionSnapshot(snapshot: DataIngestionAgentSessionDetail) {
    setDetail(snapshot);
    setSessions((current) =>
      current.map((item) =>
        item.id === snapshot.id
          ? {
              ...item,
              status: snapshot.status,
              title: snapshot.title,
              updated_at: snapshot.updated_at,
            }
          : item,
      ),
    );
  }

  async function reconcileSession(sessionId: string) {
    try {
      applySessionSnapshot(await dataIngestionService.getAgentSession(sessionId));
    } catch {
      // The streamed snapshot remains usable when final reconciliation fails.
    }
  }

  function handleAgentStreamEvent(event: DataIngestionAgentStreamEvent, turnId: string) {
    if (event.type === "assistant_start") {
      const messageId = `${turnId}-${event.round}`;
      setDetail((current) => {
        if (!current || current.messages.some((message) => message.id === messageId)) {
          return current;
        }
        return {
          ...current,
          messages: [
            ...current.messages,
            {
              attachments: [],
              content: "",
              created_at: new Date().toISOString(),
              id: messageId,
              name: "",
              role: "assistant",
              tool_call_id: "",
              tool_calls: [],
            },
          ],
          status: "running",
        };
      });
      return;
    }
    if (event.type === "content_delta") {
      const messageId = `${turnId}-${event.round}`;
      setDetail((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((message) =>
                message.id === messageId
                  ? { ...message, content: `${message.content}${event.content}` }
                  : message,
              ),
            }
          : current,
      );
      return;
    }
    if (event.type === "reasoning_delta") {
      setStreamReasoning((current) => `${current}${event.content}`);
      return;
    }
    if (event.type === "assistant_message") {
      const messageId = `${turnId}-${event.round}`;
      setDetail((current) => {
        if (!current) {
          return current;
        }
        const replacement: DataIngestionAgentMessage = {
          attachments: [],
          content: event.message.content,
          created_at: new Date().toISOString(),
          id: event.message.id,
          name: "",
          role: "assistant",
          tool_call_id: "",
          tool_calls: event.message.tool_calls,
        };
        const exists = current.messages.some((message) => message.id === messageId);
        return {
          ...current,
          messages: exists
            ? current.messages.map((message) => (message.id === messageId ? replacement : message))
            : [...current.messages, replacement],
        };
      });
      return;
    }
    if (event.type === "tool_start") {
      setStreamActivity(
        t("dataIngestion.agent.streamToolRunning", {
          name: String(event.name || ""),
        }),
      );
      return;
    }
    if (event.type === "tool_result") {
      setStreamActivity(
        t("dataIngestion.agent.streamToolFinished", {
          name: String(event.name || ""),
        }),
      );
      return;
    }
    if (event.type === "approval_resolved") {
      const approvalId = String(event.approval_id || "");
      const status = String(event.status || "");
      setDetail((current) =>
        current
          ? {
              ...current,
              approvals: current.approvals.map((approval) =>
                approval.id === approvalId ? { ...approval, status } : approval,
              ),
            }
          : current,
      );
      return;
    }
    if (event.type === "approvals_created") {
      setStreamActivity(t("dataIngestion.agent.streamWaitingApproval"));
      return;
    }
    if (event.type === "status") {
      const status = String(event.status || "");
      setDetail((current) => (current ? { ...current, status } : current));
      return;
    }
    const snapshot = "session" in event ? event.session : null;
    if (
      snapshot &&
      typeof snapshot === "object" &&
      "messages" in snapshot &&
      "approvals" in snapshot
    ) {
      applySessionSnapshot(snapshot as DataIngestionAgentSessionDetail);
      if (event.type === "done" || event.type === "error") {
        setStreamActivity("");
        setStreamReasoning("");
      }
    }
  }

  const pendingApprovals =
    detail?.approvals.filter((approval) => approval.status === "pending") ?? [];
  const dshSnippet = manifest
    ? [
        "- id: mcp-marine-ingestion",
        "  name: '@deepseek-ai/dsh-mcp-client'",
        "  config:",
        "    serverName: marine_ingestion",
        "    transport: streamable-http",
        `    url: '${safeText(manifest.mcp.endpoint)}'`,
        "    headers:",
        "      Authorization: 'Bearer <openbkn-access-token>'",
      ].join("\n")
    : "";

  return (
    <div className={styles.workspace} data-loading={loading || undefined}>
      <section className={styles.agentIntro}>
        <span className={styles.agentIntroIcon}>
          <RobotOutlined />
        </span>
        <div className={styles.agentIntroCopy}>
          <Space align="center" size={10} wrap>
            <Title level={4}>{manifest?.name || t("dataIngestion.agent.title")}</Title>
            <Tag color="blue">MCP</Tag>
          </Space>
          <Paragraph>{manifest?.description || t("dataIngestion.agent.description")}</Paragraph>
        </div>
      </section>

      <Row className={styles.layout} gutter={[16, 16]}>
        <Col lg={8} xs={24}>
          <Card
            className={styles.sideCard}
            extra={
              <Space size={8}>
                <Button
                  aria-label={t("dataIngestion.actions.refresh")}
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void load()}
                  size="small"
                  type="text"
                />
                <Tag color={agentStatus?.configured ? "green" : "orange"}>
                  {t(
                    agentStatus?.configured
                      ? "dataIngestion.agent.configured"
                      : "dataIngestion.agent.notConfigured",
                  )}
                </Tag>
              </Space>
            }
            title={t("dataIngestion.agent.sessions")}
          >
            <div
              className={styles.modelStatus}
              data-configured={agentStatus?.configured || undefined}
            >
              <div className={styles.modelStatusMain}>
                <span className={styles.modelStatusIcon}>
                  <ApiOutlined />
                </span>
                <div className={styles.modelStatusCopy}>
                  <Text strong>
                    {agentStatus?.default_model_name ||
                      t("dataIngestion.agent.platformDefaultModel")}
                  </Text>
                  <Text type="secondary">
                    {agentStatus?.configured
                      ? t("dataIngestion.agent.modelManagedByPlatform")
                      : t("dataIngestion.agent.noDefaultModel")}
                  </Text>
                </div>
              </div>
              <Button
                icon={<SettingOutlined />}
                onClick={() => {
                  void navigate("/model-resources/models?tab=llm");
                }}
                type="link"
              >
                {t("dataIngestion.agent.modelManagement")}
                <RightOutlined />
              </Button>
              {agentStatus?.error ? (
                <Text className={styles.modelStatusError} type="danger">
                  {t("dataIngestion.agent.modelStatusError")}
                </Text>
              ) : null}
            </div>
            <Button
              block
              icon={<PlusOutlined />}
              loading={creatingSession}
              onClick={() => void createSession()}
              type="primary"
            >
              {t("dataIngestion.actions.newSession")}
            </Button>
            <List
              className={styles.sessionList}
              dataSource={sessions}
              locale={{ emptyText: t("dataIngestion.agent.noSessions") }}
              renderItem={(session) => {
                const selected = selectedSessionId === session.id;
                return (
                  <List.Item
                    actions={[
                      <Popconfirm
                        key="delete"
                        onConfirm={() => void deleteSession(session.id)}
                        title={t("dataIngestion.agent.deleteConfirm")}
                      >
                        <Button
                          danger
                          disabled={["running", "awaiting_approval"].includes(session.status)}
                          icon={<DeleteOutlined />}
                          loading={deletingSessionId === session.id}
                          onClick={(event) => event.stopPropagation()}
                          type="link"
                        >
                          {t("dataIngestion.actions.delete")}
                        </Button>
                      </Popconfirm>,
                    ]}
                    className={`${styles.sessionRow} ${selected ? styles.sessionSelected : ""}`}
                    data-loading={loadingSessionId === session.id || undefined}
                    onClick={() => void selectSession(session.id)}
                  >
                    <List.Item.Meta
                      description={
                        <Space>
                          <Tag>{t(`dataIngestion.status.${session.status}`)}</Tag>
                          {loadingSessionId === session.id ? (
                            <Text type="secondary">{t("dataIngestion.agent.loadingSession")}</Text>
                          ) : null}
                          <Text type="secondary">{session.updated_at.slice(0, 19)}</Text>
                        </Space>
                      }
                      title={session.title}
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>

        <Col lg={16} xs={24}>
          <Card
            className={styles.chatCard}
            extra={
              <Space>
                {detail ? <Tag>{t(`dataIngestion.status.${detail.status}`)}</Tag> : null}
                <Button
                  aria-label={t("dataIngestion.actions.refresh")}
                  icon={<ReloadOutlined />}
                  disabled={!detail || Boolean(loadingSessionId)}
                  onClick={() => void refreshCurrentSession()}
                  size="small"
                  type="text"
                />
              </Space>
            }
            title={detail?.title || t("dataIngestion.agent.title")}
          >
            {!detail ? (
              <Empty description={t("dataIngestion.agent.noSessionSelected")} />
            ) : (
              <>
                {pendingApprovals.length > 0 ? (
                  <>
                    <Alert
                      description={
                        <Space direction="vertical" style={{ width: "100%" }}>
                          {pendingApprovals.map((approval) => (
                            <Card className={styles.approvalCard} key={approval.id} size="small">
                              <div className={styles.approvalHeading}>
                                <Text strong>{approval.tool_name}</Text>
                                <Tag color="orange">
                                  {t("dataIngestion.agent.requiresApproval")}
                                </Tag>
                              </div>
                              <Text className={styles.approvalReason} type="secondary">
                                {approval.reason || t("dataIngestion.agent.writeApproval")}
                              </Text>
                              <details className={styles.approvalDetails}>
                                <summary>{t("dataIngestion.agent.showApprovalArguments")}</summary>
                                <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
                              </details>
                              <Space className={styles.approvalActions}>
                                <Button
                                  icon={<CheckOutlined />}
                                  loading={resolvingApprovalId === approval.id}
                                  onClick={() => void resolveApproval(approval.id, true)}
                                  type="primary"
                                >
                                  {t("dataIngestion.actions.approve")}
                                </Button>
                                <Button
                                  danger
                                  icon={<CloseOutlined />}
                                  disabled={Boolean(resolvingApprovalId)}
                                  onClick={() => void resolveApproval(approval.id, false)}
                                >
                                  {t("dataIngestion.actions.reject")}
                                </Button>
                              </Space>
                            </Card>
                          ))}
                        </Space>
                      }
                      message={t("dataIngestion.agent.writeApproval")}
                      showIcon
                      type="warning"
                    />
                    <Divider />
                  </>
                ) : null}

                <div aria-live="polite" className={styles.chatPanel} ref={chatPanelRef}>
                  {detail.messages.length === 0 ? (
                    <Empty
                      description={t("dataIngestion.agent.inputPlaceholder")}
                      image={<RobotOutlined style={{ fontSize: 42 }} />}
                    />
                  ) : (
                    detail.messages.map((entry) => {
                      const isUser = entry.role === "user";
                      const isTool = entry.role === "tool";
                      return (
                        <article
                          className={styles.messageRow}
                          data-role={entry.role}
                          key={entry.id}
                        >
                          <span className={styles.messageAvatar}>
                            {isUser ? <UserOutlined /> : <RobotOutlined />}
                          </span>
                          <div className={styles.messageBubble}>
                            <div className={styles.messageMeta}>
                              <Tag color={isUser ? "blue" : undefined}>
                                {t(`dataIngestion.agent.roles.${entry.role}`, {
                                  defaultValue: entry.role,
                                })}
                              </Tag>
                              {entry.name ? <Text type="secondary">{entry.name}</Text> : null}
                            </div>
                            {entry.content || entry.tool_calls?.length ? (
                              isTool ? (
                                <pre className={styles.toolResult}>
                                  {entry.content || JSON.stringify(entry.tool_calls, null, 2)}
                                </pre>
                              ) : (
                                <MarkdownText
                                  className={styles.messageText}
                                  text={entry.content || JSON.stringify(entry.tool_calls, null, 2)}
                                />
                              )
                            ) : null}
                            {entry.attachments?.length ? (
                              <Space className={styles.messageAttachments} size={[6, 6]} wrap>
                                {entry.attachments.map((attachment) => (
                                  <Tag
                                    icon={<PaperClipOutlined />}
                                    key={attachment.id}
                                    title={attachment.file_path}
                                  >
                                    {attachment.filename}
                                  </Tag>
                                ))}
                              </Space>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  )}
                  {streamActivity || streamReasoning ? (
                    <div className={styles.streamProgress}>
                      <div className={styles.streamStatus}>
                        <span className={styles.streamPulse} />
                        <Text>{streamActivity || t("dataIngestion.agent.streamPreparing")}</Text>
                      </div>
                      {streamReasoning ? (
                        <div className={styles.reasoningPanel}>
                          <Text className={styles.reasoningLabel} type="secondary">
                            {t("dataIngestion.agent.streamReasoning")}
                          </Text>
                          <MarkdownText className={styles.reasoningText} text={streamReasoning} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className={styles.composer}>
                  <div className={styles.composerHeading}>
                    <Space>
                      <span className={styles.composerIcon}>
                        <RobotOutlined />
                      </span>
                      <div>
                        <Text strong>{t("dataIngestion.agent.composerTitle")}</Text>
                        <Text className={styles.composerSubtitle} type="secondary">
                          {t("dataIngestion.agent.composerSubtitle")}
                        </Text>
                      </div>
                    </Space>
                    <Tag color={agentStatus?.configured ? "blue" : "orange"}>
                      {agentStatus?.default_model_name ||
                        t("dataIngestion.agent.platformDefaultModel")}
                    </Tag>
                  </div>
                  <Input.TextArea
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    className={styles.composerInput}
                    disabled={
                      !agentStatus?.configured ||
                      sending ||
                      detail.status === "running" ||
                      pendingApprovals.length > 0
                    }
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={t("dataIngestion.agent.inputPlaceholder")}
                    value={input}
                  />
                  <div className={styles.composerAttachments}>
                    <Upload
                      accept=".csv,.xlsx,.xlsm,.pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm"
                      beforeUpload={(file) => {
                        setPendingAttachment(file);
                        return Upload.LIST_IGNORE;
                      }}
                      disabled={
                        !agentStatus?.configured ||
                        sending ||
                        detail.status === "running" ||
                        pendingApprovals.length > 0
                      }
                      maxCount={1}
                      showUploadList={false}
                    >
                      <Button icon={<PaperClipOutlined />} size="small">
                        {t("dataIngestion.agent.attachFile")}
                      </Button>
                    </Upload>
                    {pendingAttachment ? (
                      <Tag
                        closable
                        icon={<PaperClipOutlined />}
                        onClose={() => setPendingAttachment(null)}
                      >
                        {pendingAttachment.name}
                      </Tag>
                    ) : (
                      <Text type="secondary">{t("dataIngestion.agent.attachmentHint")}</Text>
                    )}
                  </div>
                  <div className={styles.composerFooter}>
                    <Text type="secondary">
                      {pendingApprovals.length
                        ? t("dataIngestion.agent.resolveApprovalFirst")
                        : agentStatus?.configured
                          ? t("dataIngestion.agent.platformModelHint")
                          : t("dataIngestion.agent.noDefaultModel")}
                    </Text>
                    <Space align="center">
                      <Text className={styles.keyboardHint} type="secondary">
                        {t("dataIngestion.agent.sendShortcut")}
                      </Text>
                      <Button
                        disabled={
                          !agentStatus?.configured ||
                          detail.status === "running" ||
                          !!pendingApprovals.length ||
                          (!input.trim() && !pendingAttachment)
                        }
                        icon={<SendOutlined />}
                        loading={sending}
                        onClick={() => void send()}
                        size="large"
                        type="primary"
                      >
                        {t("dataIngestion.actions.send")}
                      </Button>
                    </Space>
                  </div>
                </div>

                <Divider />
                <Row gutter={[16, 16]}>
                  <Col className={styles.sectionBlock} span={24}>
                    <Title level={5}>{t("dataIngestion.agent.memories")}</Title>
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        onChange={(event) => setMemoryKey(event.target.value)}
                        placeholder={t("dataIngestion.agent.memoryKey")}
                        value={memoryKey}
                      />
                      <Input
                        onChange={(event) => setMemoryValue(event.target.value)}
                        placeholder={t("dataIngestion.agent.memoryValue")}
                        value={memoryValue}
                      />
                      <Button onClick={() => void addMemory()}>
                        {t("dataIngestion.actions.addMemory")}
                      </Button>
                    </Space.Compact>
                    <List
                      dataSource={detail.memories}
                      renderItem={(memory) => (
                        <List.Item
                          actions={[
                            <Popconfirm
                              key="delete"
                              onConfirm={() => void deleteMemory(memory.id)}
                              title={t("dataIngestion.agent.deleteConfirm")}
                            >
                              <Button danger icon={<DeleteOutlined />} type="link" />
                            </Popconfirm>,
                          ]}
                        >
                          <Text strong>{memory.memory_key}</Text>
                          <Text>{memory.value}</Text>
                        </List.Item>
                      )}
                    />
                  </Col>
                </Row>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Card className={styles.capabilityCard} title={t("dataIngestion.agent.title")}>
        <Tabs
          activeKey={activeCapabilityTab}
          onChange={(key) => {
            const next = new URLSearchParams(searchParams);
            next.set("tab", key);
            setSearchParams(next, { replace: true });
          }}
          items={[
            {
              key: "overview",
              label: t("dataIngestion.agent.overview"),
              children: manifest ? (
                <Row gutter={[24, 16]}>
                  <Col md={12} xs={24}>
                    <Descriptions column={1} size="small" title={t("dataIngestion.agent.preset")}>
                      <Descriptions.Item label={t("dataIngestion.agent.presetMode")}>
                        {safeText(manifest.preset.mode)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("dataIngestion.agent.maxToolSteps")}>
                        {safeText(manifest.preset.maxToolSteps)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("dataIngestion.agent.toolResultMode")}>
                        {safeText(manifest.preset.toolResultMode)}
                      </Descriptions.Item>
                      <Descriptions.Item label={t("dataIngestion.agent.mcpEndpoint")}>
                        <Text code>{safeText(manifest.mcp.endpoint)}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label={t("dataIngestion.agent.skillPath")}>
                        {safeText(manifest.skill.path)}
                      </Descriptions.Item>
                    </Descriptions>
                  </Col>
                  <Col md={12} xs={24}>
                    <Title level={5}>{t("dataIngestion.agent.workflow")}</Title>
                    <List
                      dataSource={manifest.workflow}
                      renderItem={(item, index) => (
                        <List.Item>
                          <Space>
                            <Tag>{index + 1}</Tag>
                            <Text>{item}</Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Col>
                </Row>
              ) : (
                <Empty />
              ),
            },
            {
              key: "tools",
              label: t("dataIngestion.agent.tools"),
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <CustomMcpToolManager onChanged={load} tools={manifest?.tools ?? []} />
                  <McpToolList
                    onDelete={(tool) => void deleteCustomTool(tool)}
                    tools={manifest?.tools ?? []}
                  />
                </Space>
              ),
            },
            {
              key: "skill",
              label: t("dataIngestion.agent.skillView"),
              children: (
                <Space direction="vertical" size={16} style={{ width: "100%" }}>
                  <Card
                    extra={
                      <Space>
                        <Tag color="gold">{t("dataIngestion.agent.builtInLocked")}</Tag>
                        <Button
                          icon={<CopyOutlined />}
                          onClick={() => void copyText(skill?.content || "")}
                        >
                          {t("dataIngestion.agent.copy")}
                        </Button>
                      </Space>
                    }
                    title={t("dataIngestion.agent.builtInSkill")}
                  >
                    <pre className={styles.codePanel}>{skill?.content || "-"}</pre>
                  </Card>
                  <CustomSkillManager onChanged={load} skills={skill?.custom ?? []} />
                </Space>
              ),
            },
            {
              key: "dsh",
              label: t("dataIngestion.agent.dshView"),
              children: (
                <>
                  <Button icon={<CopyOutlined />} onClick={() => void copyText(dshSnippet)}>
                    {t("dataIngestion.agent.copy")}
                  </Button>
                  <pre className={styles.codePanel}>{dshSnippet || "-"}</pre>
                </>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
