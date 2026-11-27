/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  CheckCircleOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tag,
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
import type {
  DataIngestionControlDatabaseRequest,
  DataIngestionControlDatabaseStatus,
  DataIngestionControlDatabaseTestResult,
} from "@/modules/data-ingestion/types/data-ingestion";

import { DatabaseConnectionPicker } from "./DatabaseConnectionPicker";
import styles from "./ControlDatabaseSetup.module.css";

const { Paragraph, Text, Title } = Typography;
const CONTROL_DATABASE_URL_PATTERN = /^(?:(?:mysql|mariadb)\+pymysql|postgresql\+psycopg):\/\//;
const MYSQL_DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

interface ControlDatabaseSetupValues {
  bootstrap_database_url?: string;
  create_database: boolean;
  database_type: ControlDatabaseEngine;
  database_name: string;
  host: string;
  password: string;
  port: number;
  username: string;
}

export function ControlDatabaseSetup({
  status,
  canManage,
  onInitialized,
}: {
  status: DataIngestionControlDatabaseStatus;
  canManage: boolean;
  onInitialized: (status: DataIngestionControlDatabaseStatus) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { message } = useAppServices();
  const [form] = Form.useForm<ControlDatabaseSetupValues>();
  const databaseType = Form.useWatch("database_type", form) ?? "mysql";
  const [testing, setTesting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [testResult, setTestResult] = useState<DataIngestionControlDatabaseTestResult | null>(null);

  const optionalBootstrapUrlRules = [
    {
      validator: (_rule: unknown, value?: string) => {
        if (!value || CONTROL_DATABASE_URL_PATTERN.test(value)) {
          return Promise.resolve();
        }
        return Promise.reject(new Error(t("dataIngestion.controlDatabase.invalidBootstrapUrl")));
      },
    },
  ];

  async function readForm(): Promise<DataIngestionControlDatabaseRequest> {
    const values = await form.validateFields();
    return {
      database_url: buildControlDatabaseConnectionUrl(
        {
          databaseName: values.database_name,
          host: values.host,
          password: values.password || "",
          port: values.port,
          username: values.username,
        },
        values.database_type,
      ),
      create_database: values.create_database,
      bootstrap_database_url: values.bootstrap_database_url?.trim() || undefined,
    };
  }

  async function testConnection() {
    setTesting(true);
    setOperationError("");
    setTestResult(null);
    try {
      const result = await dataIngestionService.testControlDatabase(await readForm());
      setTestResult(result);
      message.success(t("dataIngestion.controlDatabase.testPassed"));
    } catch (error) {
      const detail = t("dataIngestion.controlDatabase.testFailed", {
        message: extractRequestErrorMessage(error),
      });
      setOperationError(detail);
      message.error(detail);
    } finally {
      setTesting(false);
    }
  }

  async function initializeDatabase() {
    setInitializing(true);
    setOperationError("");
    try {
      const values = await form.validateFields();
      const request = {
        database_url: buildControlDatabaseConnectionUrl(
          {
            databaseName: values.database_name,
            host: values.host,
            password: values.password || "",
            port: values.port,
            username: values.username,
          },
          values.database_type,
        ),
        create_database: values.create_database,
        bootstrap_database_url: values.bootstrap_database_url?.trim() || undefined,
      };
      const nextStatus = await dataIngestionService.configureControlDatabase(request);
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
      message.success(t("dataIngestion.controlDatabase.initialized"));
      await onInitialized(nextStatus);
    } catch (error) {
      const detail = t("dataIngestion.controlDatabase.initializeFailed", {
        message: extractRequestErrorMessage(error),
      });
      setOperationError(detail);
      message.error(detail);
    } finally {
      setInitializing(false);
    }
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.heading}>
          <div className={styles.icon}>
            <DatabaseOutlined />
          </div>
          <div>
            <Space align="center" wrap>
              <Title level={2}>{t("dataIngestion.controlDatabase.title")}</Title>
              <Tag color="gold">{t("dataIngestion.controlDatabase.requiredTag")}</Tag>
            </Space>
            <Paragraph type="secondary">{t("dataIngestion.controlDatabase.description")}</Paragraph>
          </div>
        </div>

        {status.error ? (
          <Alert
            message={t("dataIngestion.controlDatabase.configReadError")}
            description={status.error}
            showIcon
            style={{ marginBottom: 20 }}
            type="warning"
          />
        ) : null}

        <div className={styles.connectionGuide}>
          <Alert
            description={t("dataIngestion.controlDatabase.connectionHelp")}
            icon={<DatabaseOutlined />}
            message={t("dataIngestion.controlDatabase.connectionGuide")}
            showIcon
            type="info"
          />
          <Alert
            description={t("dataIngestion.controlDatabase.securityHint")}
            icon={<SafetyCertificateOutlined />}
            message={t("dataIngestion.controlDatabase.onceHint")}
            showIcon
            type="success"
          />
        </div>

        {!canManage ? (
          <Alert message={t("dataIngestion.controlDatabase.noPermission")} showIcon type="error" />
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
            }}
            layout="vertical"
            onValuesChange={() => {
              setOperationError("");
              setTestResult(null);
            }}
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
                  setOperationError("");
                  setTestResult(null);
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
                    autoComplete="username"
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
                      rules={optionalBootstrapUrlRules}
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

            {operationError ? (
              <Alert
                className={styles.operationError}
                description={t("dataIngestion.controlDatabase.connectionTroubleshooting")}
                message={operationError}
                showIcon
                type="error"
              />
            ) : null}

            {testResult ? (
              <Alert
                className={styles.testResult}
                description={
                  <Space direction="vertical" size={2}>
                    <Text>
                      {t("dataIngestion.controlDatabase.databaseName", {
                        name: testResult.database_name,
                      })}
                    </Text>
                    <Text type="secondary">{testResult.database_label}</Text>
                    <Text>
                      {testResult.database_exists
                        ? t("dataIngestion.controlDatabase.databaseExists")
                        : t("dataIngestion.controlDatabase.databaseMissing")}
                    </Text>
                  </Space>
                }
                icon={<CheckCircleOutlined />}
                message={t("dataIngestion.controlDatabase.testPassed")}
                showIcon
                type="success"
              />
            ) : null}

            <Space className={styles.actions} wrap>
              <Button loading={testing} onClick={() => void testConnection()}>
                {t("dataIngestion.controlDatabase.test")}
              </Button>
              <Button
                disabled={!status.bootstrap_enabled}
                loading={initializing}
                onClick={() => void initializeDatabase()}
                type="primary"
              >
                {t("dataIngestion.controlDatabase.initialize")}
              </Button>
            </Space>

            {!status.bootstrap_enabled ? (
              <Alert
                message={t("dataIngestion.controlDatabase.disabled")}
                showIcon
                style={{ marginTop: 16 }}
                type="warning"
              />
            ) : null}
          </Form>
        )}
      </Card>
    </div>
  );
}
