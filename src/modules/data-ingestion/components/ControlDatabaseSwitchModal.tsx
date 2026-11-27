/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  Alert,
  Button,
  Checkbox,
  Col,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import {
  buildControlDatabaseConnectionUrl,
  DEFAULT_CONTROL_DATABASE_NAME,
  DEFAULT_MYSQL_PORT,
  DEFAULT_POSTGRESQL_PORT,
  normalizeMysqlHost,
  type ControlDatabaseEngine,
} from "@/modules/data-ingestion/lib/mysql-connection-url";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type { DataIngestionControlDatabaseStatus } from "@/modules/data-ingestion/types/data-ingestion";

import { DatabaseConnectionPicker } from "./DatabaseConnectionPicker";
import styles from "./ControlDatabaseSetup.module.css";

const { Paragraph, Text } = Typography;
const CONTROL_DATABASE_URL_PATTERN = /^(?:(?:mysql|mariadb)\+pymysql|postgresql\+psycopg):\/\//;
const MYSQL_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

interface ControlDatabaseSwitchValues {
  bootstrap_database_url?: string;
  confirm_switch: boolean;
  create_database: boolean;
  database_type: ControlDatabaseEngine;
  database_name: string;
  host: string;
  password: string;
  port: number;
  username: string;
}

export function ControlDatabaseSwitchModal({
  open,
  status,
  onCancel,
  onConfigured,
}: {
  open: boolean;
  status: DataIngestionControlDatabaseStatus;
  onCancel: () => void;
  onConfigured: (status: DataIngestionControlDatabaseStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [form] = Form.useForm<ControlDatabaseSwitchValues>();
  const databaseType = Form.useWatch("database_type", form) ?? "mysql";
  const [switching, setSwitching] = useState(false);

  async function submit() {
    const values = await form.validateFields();
    setSwitching(true);
    try {
      const databaseUrl = buildControlDatabaseConnectionUrl(
        {
          databaseName: values.database_name,
          host: values.host,
          password: values.password || "",
          port: values.port,
          username: values.username,
        },
        values.database_type,
      );
      const nextStatus = await dataIngestionService.configureControlDatabase({
        database_url: databaseUrl,
        create_database: values.create_database,
        bootstrap_database_url: values.bootstrap_database_url?.trim() || undefined,
      });
      try {
        const spaces = await dataIngestionService.listDataSpaces();
        const defaultSpace = spaces.find((space) => space.is_default) ?? spaces[0];
        if (defaultSpace) {
          await dataIngestionService.syncDataSpaceCatalog(defaultSpace.id);
        }
      } catch (error) {
        message.warning(
          t("dataIngestion.controlDatabase.catalogSyncWarning", {
            message: extractRequestErrorMessage(error),
          }),
        );
      }
      message.success(t("dataIngestion.controlDatabase.switched"));
      await onConfigured(nextStatus);
      onCancel();
    } catch (error) {
      message.error(
        t("dataIngestion.controlDatabase.switchFailed", {
          message: extractRequestErrorMessage(error),
        }),
      );
    } finally {
      setSwitching(false);
    }
  }

  return (
    <Modal
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t("dataIngestion.actions.cancel")}
        </Button>,
        <Button
          danger
          disabled={status.source === "environment"}
          key="switch"
          loading={switching}
          onClick={() => void submit()}
          type="primary"
        >
          {t("dataIngestion.controlDatabase.switch")}
        </Button>,
      ]}
      onCancel={onCancel}
      open={open}
      title={t("dataIngestion.controlDatabase.changeTitle")}
      width={760}
    >
      <Space className={styles.modalContent} direction="vertical" size="middle">
        <div>
          <Paragraph>{t("dataIngestion.controlDatabase.changeDescription")}</Paragraph>
          <Text type="secondary">{status.database_label}</Text>
        </div>
        <Alert
          description={t("dataIngestion.controlDatabase.changeWarning")}
          message={t("dataIngestion.controlDatabase.changeAlert")}
          showIcon
          type="warning"
        />
        {status.source === "environment" ? (
          <Alert
            message={t("dataIngestion.controlDatabase.environmentManaged")}
            showIcon
            type="error"
          />
        ) : (
          <Form
            form={form}
            initialValues={{
              create_database: true,
              database_name: DEFAULT_CONTROL_DATABASE_NAME,
              database_type: "mysql",
              host: "",
              password: "",
              port: DEFAULT_MYSQL_PORT,
              username: "",
              bootstrap_database_url: "",
              confirm_switch: false,
            }}
            layout="vertical"
            requiredMark="optional"
          >
            <DatabaseConnectionPicker
              form={form}
              onConnectorTypeChange={(connectorType) => {
                const nextType: ControlDatabaseEngine =
                  connectorType === "postgres" || connectorType === "postgresql"
                    ? "postgresql"
                    : "mysql";
                form.setFieldsValue({
                  database_type: nextType,
                  port: nextType === "postgresql" ? DEFAULT_POSTGRESQL_PORT : DEFAULT_MYSQL_PORT,
                });
              }}
            />

            <Form.Item
              extra={t("dataIngestion.controlDatabase.databaseTypeHint")}
              label={t("dataIngestion.controlDatabase.databaseType")}
              name="database_type"
            >
              <Select
                onChange={(value: ControlDatabaseEngine) => {
                  form.setFieldValue(
                    "port",
                    value === "postgresql" ? DEFAULT_POSTGRESQL_PORT : DEFAULT_MYSQL_PORT,
                  );
                  form.setFieldValue("bootstrap_database_url", "");
                }}
                options={[
                  {
                    label: t("dataIngestion.controlDatabase.databaseTypes.mysql"),
                    value: "mysql",
                  },
                  {
                    label: t("dataIngestion.controlDatabase.databaseTypes.postgresql"),
                    value: "postgresql",
                  },
                ]}
              />
            </Form.Item>

            <Row gutter={16}>
              <Col sm={17} xs={24}>
                <Form.Item
                  extra={t("dataIngestion.controlDatabase.hostHint")}
                  label={t("dataIngestion.controlDatabase.host")}
                  name="host"
                  rules={[
                    {
                      validator: (_rule: unknown, value?: string) => {
                        const host = normalizeMysqlHost(value || "");
                        if (!host) {
                          return Promise.reject(
                            new Error(t("dataIngestion.controlDatabase.hostRequired")),
                          );
                        }
                        if (/[\s/?#@]/.test(host)) {
                          return Promise.reject(
                            new Error(t("dataIngestion.controlDatabase.hostInvalid")),
                          );
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <Input
                    autoComplete="off"
                    placeholder={t("dataIngestion.controlDatabase.hostPlaceholder")}
                  />
                </Form.Item>
              </Col>
              <Col sm={7} xs={24}>
                <Form.Item
                  extra={t(
                    databaseType === "postgresql"
                      ? "dataIngestion.controlDatabase.postgresqlPortHint"
                      : "dataIngestion.controlDatabase.mysqlPortHint",
                  )}
                  label={t("dataIngestion.controlDatabase.port")}
                  name="port"
                  rules={[
                    {
                      required: true,
                      message: t("dataIngestion.controlDatabase.portInvalid"),
                    },
                  ]}
                >
                  <InputNumber
                    className={styles.portInput}
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
                  extra={t("dataIngestion.controlDatabase.databaseNameHint")}
                  label={t("dataIngestion.controlDatabase.databaseNameLabel")}
                  name="database_name"
                  rules={[
                    {
                      required: true,
                      message: t("dataIngestion.controlDatabase.databaseNameRequired"),
                    },
                    {
                      pattern: MYSQL_DATABASE_NAME_PATTERN,
                      message: t("dataIngestion.controlDatabase.databaseNameInvalid"),
                    },
                  ]}
                >
                  <Input
                    autoComplete="off"
                    placeholder={t("dataIngestion.controlDatabase.databaseNamePlaceholder")}
                  />
                </Form.Item>
              </Col>
              <Col sm={12} xs={24}>
                <Form.Item
                  extra={t("dataIngestion.controlDatabase.usernameHint")}
                  label={t("dataIngestion.controlDatabase.username")}
                  name="username"
                  rules={[
                    {
                      required: true,
                      whitespace: true,
                      message: t("dataIngestion.controlDatabase.usernameRequired"),
                    },
                  ]}
                >
                  <Input
                    autoComplete="off"
                    placeholder={t("dataIngestion.controlDatabase.usernamePlaceholder")}
                  />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              extra={t("dataIngestion.controlDatabase.passwordHint")}
              label={t("dataIngestion.controlDatabase.password")}
              name="password"
            >
              <Input.Password
                autoComplete="new-password"
                placeholder={t("dataIngestion.controlDatabase.passwordPlaceholder")}
              />
            </Form.Item>

            <Form.Item
              extra={t("dataIngestion.controlDatabase.createDatabaseHint")}
              label={t("dataIngestion.controlDatabase.autoCreateDatabase")}
              name="create_database"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Collapse
              className={styles.advanced}
              ghost
              items={[
                {
                  key: "bootstrap",
                  label: t("dataIngestion.controlDatabase.advancedTitle"),
                  children: (
                    <Form.Item
                      extra={t("dataIngestion.controlDatabase.bootstrapUrlHint")}
                      label={t("dataIngestion.controlDatabase.bootstrapUrl")}
                      name="bootstrap_database_url"
                      rules={[
                        {
                          validator: (_rule, value?: string) => {
                            if (!value || CONTROL_DATABASE_URL_PATTERN.test(value)) {
                              return Promise.resolve();
                            }
                            return Promise.reject(
                              new Error(t("dataIngestion.controlDatabase.invalidBootstrapUrl")),
                            );
                          },
                        },
                      ]}
                    >
                      <Input.Password
                        autoComplete="new-password"
                        placeholder={t(
                          databaseType === "postgresql"
                            ? "dataIngestion.controlDatabase.postgresqlBootstrapUrlPlaceholder"
                            : "dataIngestion.controlDatabase.bootstrapUrlPlaceholder",
                        )}
                      />
                    </Form.Item>
                  ),
                },
              ]}
            />

            <Form.Item
              name="confirm_switch"
              rules={[
                {
                  validator: (_rule, checked: boolean) => {
                    if (!checked) {
                      return Promise.reject(
                        new Error(t("dataIngestion.controlDatabase.confirmSwitch")),
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
              valuePropName="checked"
            >
              <Checkbox>{t("dataIngestion.controlDatabase.confirmSwitch")}</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Space>
    </Modal>
  );
}
