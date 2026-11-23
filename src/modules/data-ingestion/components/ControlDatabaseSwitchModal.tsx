/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { Alert, Button, Checkbox, Form, Input, Modal, Space, Switch, Typography } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppServices } from "@/framework/context/use-app-services";
import { extractRequestErrorMessage } from "@/framework/request/error-message";
import { dataIngestionService } from "@/modules/data-ingestion/services/data-ingestion.service";
import type {
  DataIngestionControlDatabaseRequest,
  DataIngestionControlDatabaseStatus,
} from "@/modules/data-ingestion/types/data-ingestion";

import styles from "./ControlDatabaseSetup.module.css";

const { Paragraph, Text } = Typography;
const MYSQL_URL_PATTERN = /^(mysql|mariadb)\+pymysql:\/\//;

type ControlDatabaseSwitchValues = DataIngestionControlDatabaseRequest & {
  confirm_switch: boolean;
};

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
  const [switching, setSwitching] = useState(false);

  async function submit() {
    const values = await form.validateFields();
    setSwitching(true);
    try {
      const nextStatus = await dataIngestionService.configureControlDatabase({
        database_url: values.database_url.trim(),
        create_database: values.create_database,
        bootstrap_database_url: values.bootstrap_database_url?.trim() || undefined,
      });
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
              bootstrap_database_url: "",
              confirm_switch: false,
            }}
            layout="vertical"
            requiredMark="optional"
          >
            <Form.Item
              extra={t("dataIngestion.controlDatabase.applicationUrlHint")}
              label={t("dataIngestion.controlDatabase.applicationUrl")}
              name="database_url"
              rules={[
                {
                  required: true,
                  message: t("dataIngestion.controlDatabase.required"),
                },
                {
                  validator: (_rule, value?: string) => {
                    if (!value || MYSQL_URL_PATTERN.test(value)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t("dataIngestion.controlDatabase.invalidUrl")));
                  },
                },
              ]}
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
              rules={[
                {
                  validator: (_rule, value?: string) => {
                    if (!value || MYSQL_URL_PATTERN.test(value)) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error(t("dataIngestion.controlDatabase.invalidUrl")));
                  },
                },
              ]}
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
