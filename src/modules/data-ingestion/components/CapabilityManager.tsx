/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionAgentManifest,
  DataIngestionCustomSkill,
} from "@/modules/data-ingestion/types/data-ingestion";

interface ToolFormValues {
  description: string;
  display_name: string;
  enabled: boolean;
  headers: string;
  method: string;
  name: string;
  read_only: boolean;
  requires_approval: boolean;
  url: string;
}

interface SkillFormValues {
  content: string;
  description: string;
  display_name: string;
  enabled: boolean;
  name: string;
}

function stringConfig(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function CustomMcpToolManager({
  tools,
  onChanged,
}: {
  tools: DataIngestionAgentManifest["tools"];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [form] = Form.useForm<ToolFormValues>();
  const [editing, setEditing] = useState<DataIngestionAgentManifest["tools"][number] | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const customTools = tools.filter((tool) => !tool.built_in);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue({
      description: "",
      display_name: "",
      enabled: true,
      headers: "{}",
      method: "POST",
      name: "",
      read_only: true,
      requires_approval: true,
      url: "",
    });
    setOpen(true);
  }

  function openEdit(tool: DataIngestionAgentManifest["tools"][number]) {
    setEditing(tool);
    form.setFieldsValue({
      description: tool.description,
      display_name: tool.display_name,
      enabled: true,
      headers: JSON.stringify(tool.config?.headers ?? {}, null, 2),
      method: stringConfig(tool.config?.method, "POST"),
      name: tool.name,
      read_only: tool.read_only,
      requires_approval: tool.requires_approval,
      url: stringConfig(tool.config?.url),
    });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(values.headers || "{}") as Record<string, string>;
    } catch {
      message.error(t("dataIngestion.agent.invalidHeaders"));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        config: {
          headers,
          method: values.method,
          timeout_seconds: 30,
          url: values.url,
        },
        description: values.description ?? "",
        display_name: values.display_name,
        enabled: values.enabled,
        name: values.name,
        read_only: values.read_only,
        requires_approval: values.requires_approval,
        tool_type: "http" as const,
      };
      if (editing) {
        await dataIngestionService.updateCustomMcpTool(editing.id || editing.name, {
          config: payload.config,
          description: payload.description,
          display_name: payload.display_name,
          enabled: payload.enabled,
          read_only: payload.read_only,
          requires_approval: payload.requires_approval,
        });
      } else {
        await dataIngestionService.createCustomMcpTool(payload);
      }
      setOpen(false);
      message.success(t("dataIngestion.agent.capabilitySaved"));
      await onChanged();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(toolName: string) {
    try {
      await dataIngestionService.deleteCustomMcpTool(toolName);
      message.success(t("dataIngestion.agent.capabilityDeleted"));
      await onChanged();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  return (
    <Card
      extra={
        <Button icon={<PlusOutlined />} onClick={openCreate}>
          {t("dataIngestion.agent.addMcpTool")}
        </Button>
      }
      title={t("dataIngestion.agent.customMcpTools")}
    >
      <Table
        columns={[
          {
            dataIndex: "display_name",
            key: "name",
            render: (_: unknown, item) => (
              <Space direction="vertical" size={0}>
                <strong>{item.display_name}</strong>
                <span>{item.name}</span>
              </Space>
            ),
            title: t("dataIngestion.agent.name"),
          },
          {
            dataIndex: "description",
            key: "description",
            title: t("dataIngestion.agent.description"),
          },
          {
            key: "type",
            render: () => <Tag color="blue">HTTP MCP</Tag>,
            title: t("dataIngestion.agent.type"),
          },
          {
            key: "actions",
            render: (_: unknown, item) => (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEdit(item)} type="link">
                  {t("dataIngestion.agent.edit")}
                </Button>
                <Popconfirm
                  onConfirm={() => void remove(item.id || item.name)}
                  title={t("dataIngestion.agent.deleteConfirm")}
                >
                  <Button danger icon={<DeleteOutlined />} type="link">
                    {t("dataIngestion.actions.delete")}
                  </Button>
                </Popconfirm>
              </Space>
            ),
            title: t("dataIngestion.agent.actions"),
          },
        ]}
        dataSource={customTools}
        locale={{ emptyText: t("dataIngestion.agent.noCustomTools") }}
        pagination={false}
        rowKey="name"
        size="small"
      />
      <Modal
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" loading={saving} onClick={() => void save()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => setOpen(false)}
        open={open}
        title={editing ? t("dataIngestion.agent.editMcpTool") : t("dataIngestion.agent.addMcpTool")}
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            label={t("dataIngestion.agent.technicalName")}
            name="name"
            rules={[{ required: true, pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/ }]}
          >
            <Input disabled={Boolean(editing)} placeholder="lookup_customer" />
          </Form.Item>
          <Form.Item
            label={t("dataIngestion.agent.displayName")}
            name="display_name"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label={t("dataIngestion.agent.description")} name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="method" noStyle>
              <Select
                options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({
                  label: method,
                  value: method,
                }))}
                style={{ width: 110 }}
              />
            </Form.Item>
            <Form.Item name="url" noStyle rules={[{ required: true, pattern: /^https?:\/\// }]}>
              <Input placeholder="https://api.example.com/tool" />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="Headers (JSON)" name="headers">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="read_only" valuePropName="checked">
              <Switch checkedChildren={t("dataIngestion.agent.readOnly")} />
            </Form.Item>
            <Form.Item name="requires_approval" valuePropName="checked">
              <Switch checkedChildren={t("dataIngestion.agent.requiresApproval")} />
            </Form.Item>
            <Form.Item name="enabled" valuePropName="checked">
              <Switch checkedChildren={t("dataIngestion.autoScan.enabled")} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

export function CustomSkillManager({
  skills,
  onChanged,
}: {
  skills: DataIngestionCustomSkill[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [form] = Form.useForm<SkillFormValues>();
  const [editing, setEditing] = useState<DataIngestionCustomSkill | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    form.setFieldsValue({
      content: "",
      description: "",
      display_name: "",
      enabled: true,
      name: "",
    });
    setOpen(true);
  }

  function openEdit(skill: DataIngestionCustomSkill) {
    setEditing(skill);
    form.setFieldsValue(skill);
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await dataIngestionService.updateCustomSkill(editing.id, {
          content: values.content,
          description: values.description,
          display_name: values.display_name,
          enabled: values.enabled,
        });
      } else {
        await dataIngestionService.createCustomSkill(values);
      }
      setOpen(false);
      message.success(t("dataIngestion.agent.capabilitySaved"));
      await onChanged();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(skillId: string) {
    try {
      await dataIngestionService.deleteCustomSkill(skillId);
      message.success(t("dataIngestion.agent.capabilityDeleted"));
      await onChanged();
    } catch (error) {
      message.error(extractRequestErrorMessage(error));
    }
  }

  return (
    <Card
      extra={
        <Button icon={<PlusOutlined />} onClick={openCreate}>
          {t("dataIngestion.agent.addSkill")}
        </Button>
      }
      title={t("dataIngestion.agent.customSkills")}
    >
      <Table
        columns={[
          {
            dataIndex: "display_name",
            key: "name",
            title: t("dataIngestion.agent.name"),
          },
          {
            dataIndex: "description",
            key: "description",
            title: t("dataIngestion.agent.description"),
          },
          {
            dataIndex: "enabled",
            key: "enabled",
            render: (enabled: boolean) => (
              <Tag color={enabled ? "green" : "default"}>
                {enabled
                  ? t("dataIngestion.autoScan.enabled")
                  : t("dataIngestion.autoScan.disabled")}
              </Tag>
            ),
            title: t("dataIngestion.agent.status"),
          },
          {
            key: "actions",
            render: (_: unknown, item) => (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEdit(item)} type="link">
                  {t("dataIngestion.agent.edit")}
                </Button>
                <Popconfirm
                  onConfirm={() => void remove(item.id)}
                  title={t("dataIngestion.agent.deleteConfirm")}
                >
                  <Button danger icon={<DeleteOutlined />} type="link">
                    {t("dataIngestion.actions.delete")}
                  </Button>
                </Popconfirm>
              </Space>
            ),
            title: t("dataIngestion.agent.actions"),
          },
        ]}
        dataSource={skills}
        locale={{ emptyText: t("dataIngestion.agent.noCustomSkills") }}
        pagination={false}
        rowKey="id"
        size="small"
      />
      <Modal
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>
            {t("dataIngestion.actions.cancel")}
          </Button>,
          <Button key="save" loading={saving} onClick={() => void save()} type="primary">
            {t("dataIngestion.actions.save")}
          </Button>,
        ]}
        onCancel={() => setOpen(false)}
        open={open}
        title={editing ? t("dataIngestion.agent.editSkill") : t("dataIngestion.agent.addSkill")}
        width={860}
      >
        <Form form={form} layout="vertical" requiredMark="optional">
          <Form.Item
            label={t("dataIngestion.agent.technicalName")}
            name="name"
            rules={[{ required: true, pattern: /^[a-zA-Z][a-zA-Z0-9_-]*$/ }]}
          >
            <Input disabled={Boolean(editing)} placeholder="customer-data-skill" />
          </Form.Item>
          <Form.Item
            label={t("dataIngestion.agent.displayName")}
            name="display_name"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label={t("dataIngestion.agent.description")} name="description">
            <Input />
          </Form.Item>
          <Form.Item
            label={t("dataIngestion.agent.skillContent")}
            name="content"
            rules={[{ required: true }]}
          >
            <Input.TextArea autoSize={{ minRows: 12, maxRows: 24 }} />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked">
            <Switch checkedChildren={t("dataIngestion.autoScan.enabled")} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
