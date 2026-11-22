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
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
  SettingOutlined,
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
  Popconfirm,
  Row,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionAgentManifest,
  DataIngestionAgentSession,
  DataIngestionAgentSessionDetail,
  DataIngestionAgentSkill,
  DataIngestionAgentStatus,
} from "@/modules/data-ingestion/types/data-ingestion";

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

function McpToolList({ tools }: { tools: DataIngestionAgentManifest["tools"] }) {
  const { t } = useTranslation();

  return (
    <div className={styles.toolGrid}>
      {tools.map((tool) => (
        <Card className={styles.toolCard} key={tool.qualifiedName} size="small">
          <div className={styles.toolHeader}>
            <div>
              <div className={styles.toolName}>{tool.display_name || tool.name}</div>
            </div>
            <Tag color={tool.read_only ? "blue" : "orange"}>
              {t(
                tool.read_only
                  ? "dataIngestion.agent.readOnly"
                  : "dataIngestion.agent.requiresApproval",
              )}
            </Tag>
          </div>
          <Paragraph className={styles.toolDescription}>{tool.description}</Paragraph>
          <div className={styles.toolMeta}>
            <Text className={styles.technicalLabel} type="secondary">
              {t("dataIngestion.agent.technicalName")}
            </Text>
            <Text className={styles.toolCode} code>
              {tool.qualifiedName}
            </Text>
          </div>
        </Card>
      ))}
    </div>
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
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const loadSession = useCallback(async (sessionId: string) => {
    const next = await dataIngestionService.getAgentSession(sessionId);
    setSelectedSessionId(sessionId);
    setDetail(next);
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
      const target = selectedSessionId ?? nextSessions[0]?.id;
      if (target) {
        await loadSession(target);
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
  }, [loadSession, message, selectedSessionId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSession() {
    try {
      const session = await dataIngestionService.createAgentSession();
      setSessions((current) => [session, ...current]);
      await loadSession(session.id);
    } catch (error) {
      message.error(
        t("dataIngestion.errors.save", {
          message: extractRequestErrorMessage(error),
        }),
      );
    }
  }

  async function send() {
    if (!detail || !input.trim() || !agentStatus?.configured) {
      return;
    }
    setSending(true);
    try {
      const next = await dataIngestionService.sendAgentMessage(detail.id, input.trim());
      setDetail(next);
      setInput("");
      setSessions((current) =>
        current.map((item) =>
          item.id === next.id
            ? { ...item, status: next.status, updated_at: next.updated_at }
            : item,
        ),
      );
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function resolveApproval(approvalId: string, approve: boolean) {
    if (!detail) {
      return;
    }
    try {
      const next = approve
        ? await dataIngestionService.approveAgentTool(detail.id, approvalId, "")
        : await dataIngestionService.rejectAgentTool(detail.id, approvalId, "");
      setDetail(next);
      message.success(t(approve ? "dataIngestion.agent.approved" : "dataIngestion.agent.rejected"));
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
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
    try {
      await dataIngestionService.deleteAgentSession(sessionId);
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      setSessions(nextSessions);
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(undefined);
        setDetail(null);
        if (nextSessions[0]) {
          await loadSession(nextSessions[0].id);
        }
      }
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
              <Tag color={agentStatus?.configured ? "green" : "orange"}>
                {t(
                  agentStatus?.configured
                    ? "dataIngestion.agent.configured"
                    : "dataIngestion.agent.notConfigured",
                )}
              </Tag>
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
            <Button block icon={<PlusOutlined />} onClick={() => void createSession()}>
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
                      <Button key="open" onClick={() => void loadSession(session.id)} type="link">
                        {t("dataIngestion.actions.open")}
                      </Button>,
                      <Popconfirm
                        key="delete"
                        onConfirm={() => void deleteSession(session.id)}
                        title={t("dataIngestion.agent.deleteConfirm")}
                      >
                        <Button danger icon={<DeleteOutlined />} type="link" />
                      </Popconfirm>,
                    ]}
                    className={selected ? styles.sessionSelected : undefined}
                  >
                    <List.Item.Meta
                      description={
                        <Space>
                          <Tag>{t(`dataIngestion.status.${session.status}`)}</Tag>
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
            extra={detail ? <Tag>{t(`dataIngestion.status.${detail.status}`)}</Tag> : null}
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
                              <Descriptions column={1} size="small">
                                <Descriptions.Item label={t("dataIngestion.agent.tools")}>
                                  {approval.tool_name}
                                </Descriptions.Item>
                                <Descriptions.Item label={t("dataIngestion.agent.arguments")}>
                                  <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                                    {JSON.stringify(approval.arguments, null, 2)}
                                  </pre>
                                </Descriptions.Item>
                              </Descriptions>
                              <Space>
                                <Button
                                  icon={<CheckOutlined />}
                                  onClick={() => void resolveApproval(approval.id, true)}
                                  type="primary"
                                >
                                  {t("dataIngestion.actions.approve")}
                                </Button>
                                <Button
                                  danger
                                  icon={<CloseOutlined />}
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

                <div className={styles.chatPanel}>
                  {detail.messages.length === 0 ? (
                    <Empty
                      description={t("dataIngestion.agent.inputPlaceholder")}
                      image={<RobotOutlined style={{ fontSize: 42 }} />}
                    />
                  ) : (
                    detail.messages.map((entry) => (
                      <Card
                        className={`${styles.messageCard} ${
                          entry.role === "user" ? styles.messageUser : styles.messageAgent
                        }`}
                        key={entry.id}
                        size="small"
                        title={
                          <Space>
                            <Tag color={entry.role === "user" ? "blue" : undefined}>
                              {t(`dataIngestion.agent.roles.${entry.role}`, {
                                defaultValue: entry.role,
                              })}
                            </Tag>
                            {entry.name ? <Text>{entry.name}</Text> : null}
                          </Space>
                        }
                      >
                        <Paragraph className={styles.messageText}>
                          {entry.content || JSON.stringify(entry.tool_calls)}
                        </Paragraph>
                      </Card>
                    ))
                  )}
                </div>

                <div className={styles.composer}>
                  <Input.TextArea
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    className={styles.composerInput}
                    disabled={!agentStatus?.configured}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={t("dataIngestion.agent.inputPlaceholder")}
                    value={input}
                  />
                  <div className={styles.composerFooter}>
                    <Text type="secondary">
                      {agentStatus?.configured
                        ? t("dataIngestion.agent.platformModelHint")
                        : t("dataIngestion.agent.noDefaultModel")}
                    </Text>
                    <Button
                      disabled={!agentStatus?.configured || !!pendingApprovals.length}
                      loading={sending}
                      onClick={() => void send()}
                      type="primary"
                    >
                      {t("dataIngestion.actions.send")}
                    </Button>
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
              children: <McpToolList tools={manifest?.tools ?? []} />,
            },
            {
              key: "skill",
              label: t("dataIngestion.agent.skillView"),
              children: (
                <>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => void copyText(skill?.content || "")}
                  >
                    {t("dataIngestion.agent.copy")}
                  </Button>
                  <pre className={styles.codePanel}>{skill?.content || "-"}</pre>
                </>
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
