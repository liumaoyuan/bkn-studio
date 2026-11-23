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
import { Alert, Button, Card, Form, Input, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionControlDatabaseRequest,
  DataIngestionControlDatabaseStatus,
  DataIngestionControlDatabaseTestResult,
} from "@/modules/data-ingestion/types/data-ingestion";

import styles from "./ControlDatabaseSetup.module.css";

const { Paragraph, Text, Title } = Typography;
const MYSQL_URL_PATTERN = /^(mysql|mariadb)\+pymysql:\/\//;

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
  const [form] = Form.useForm<DataIngestionControlDatabaseRequest>();
  const [testing, setTesting] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [testResult, setTestResult] = useState<DataIngestionControlDatabaseTestResult | null>(null);

  const validationRules = (required: boolean) => [
    {
      required,
      message: t("dataIngestion.controlDatabase.required"),
    },
    {
      validator: (_rule: unknown, value?: string) => {
        if (!value || MYSQL_URL_PATTERN.test(value)) {
          return Promise.resolve();
        }
        return Promise.reject(new Error(t("dataIngestion.controlDatabase.invalidUrl")));
      },
    },
  ];

  async function readForm(): Promise<DataIngestionControlDatabaseRequest> {
    const values = await form.validateFields();
    return {
      database_url: values.database_url.trim(),
      create_database: values.create_database,
      bootstrap_database_url: values.bootstrap_database_url?.trim() || undefined,
    };
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await dataIngestionService.testControlDatabase(await readForm());
      setTestResult(result);
      message.success(t("dataIngestion.controlDatabase.testPassed"));
    } catch (error) {
      message.error(
        t("dataIngestion.controlDatabase.testFailed", {
          message: extractRequestErrorMessage(error),
        }),
      );
    } finally {
      setTesting(false);
    }
  }

  async function initializeDatabase() {
    setInitializing(true);
    try {
      const nextStatus = await dataIngestionService.configureControlDatabase(await readForm());
      message.success(t("dataIngestion.controlDatabase.initialized"));
      await onInitialized(nextStatus);
    } catch (error) {
      message.error(
        t("dataIngestion.controlDatabase.initializeFailed", {
          message: extractRequestErrorMessage(error),
        }),
      );
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

        <Alert
          description={t("dataIngestion.controlDatabase.securityHint")}
          icon={<SafetyCertificateOutlined />}
          message={t("dataIngestion.controlDatabase.onceHint")}
          showIcon
          style={{ marginBottom: 20 }}
          type="info"
        />

        {!canManage ? (
          <Alert message={t("dataIngestion.controlDatabase.noPermission")} showIcon type="error" />
        ) : (
          <Form
            form={form}
            initialValues={{
              create_database: true,
              bootstrap_database_url: "",
            }}
            layout="vertical"
            requiredMark="optional"
          >
            <Form.Item
              extra={t("dataIngestion.controlDatabase.applicationUrlHint")}
              label={t("dataIngestion.controlDatabase.applicationUrl")}
              name="database_url"
              rules={validationRules(true)}
            >
              <Input.Password
                autoComplete="new-password"
                placeholder={t("dataIngestion.controlDatabase.applicationUrlPlaceholder")}
              />
            </Form.Item>

            <Form.Item
              extra={t("dataIngestion.controlDatabase.bootstrapUrlHint")}
              label={t("dataIngestion.controlDatabase.bootstrapUrl")}
              name="bootstrap_database_url"
              rules={validationRules(false)}
            >
              <Input.Password
                autoComplete="new-password"
                placeholder={t("dataIngestion.controlDatabase.bootstrapUrlPlaceholder")}
              />
            </Form.Item>

            <Form.Item
              extra={t("dataIngestion.controlDatabase.createDatabaseHint")}
              label={t("dataIngestion.controlDatabase.createDatabase")}
              name="create_database"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

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
