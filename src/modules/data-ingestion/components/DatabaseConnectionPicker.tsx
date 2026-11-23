/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { Alert, Form, Select, Space, Tag, Typography } from "antd";
import type { FormInstance } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getDatabaseConnectionDefaults,
  listDatabaseConnectionOptions,
  type DatabaseConnectionOption,
} from "@/modules/data-ingestion/services/data-connection-options.service";

const { Text } = Typography;

export function DatabaseConnectionPicker({
  form,
  onReset,
}: {
  form: FormInstance;
  onReset?: () => void;
}) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<DatabaseConnectionOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedConnection, setSelectedConnection] = useState<DatabaseConnectionOption | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const options = await listDatabaseConnectionOptions();
        if (active) {
          setConnections(options);
        }
      } catch {
        if (active) {
          setLoadError(t("dataIngestion.connections.loadFailed"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [t]);

  async function selectConnection(connectionId: string) {
    setSelectedId(connectionId);
    setLoadError("");
    if (!connectionId) {
      setSelectedConnection(null);
      onReset?.();
      return;
    }

    const connection = connections.find((item) => item.id === connectionId) ?? null;
    setSelectedConnection(connection);
    setLoadingDetails(true);
    try {
      const defaults = connection?.defaults ?? (await getDatabaseConnectionDefaults(connectionId));
      form.setFieldsValue({
        database_name: defaults.databaseName,
        host: defaults.host,
        password: "",
        port: defaults.port,
        username: defaults.username ?? String(form.getFieldValue("username") ?? ""),
      });
    } catch {
      setSelectedId("");
      setSelectedConnection(null);
      setLoadError(t("dataIngestion.connections.detailFailed"));
    } finally {
      setLoadingDetails(false);
    }
  }

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Form.Item
        extra={t("dataIngestion.connections.pickerHint")}
        label={t("dataIngestion.connections.pickerLabel")}
        style={{ marginBottom: 8 }}
      >
        <Select
          allowClear
          disabled={loading}
          filterOption={(input, option) =>
            String(option?.label ?? "")
              .toLowerCase()
              .includes(input.trim().toLowerCase())
          }
          loading={loading || loadingDetails}
          onChange={(value) => void selectConnection(value || "")}
          optionRender={(option) => {
            const connection = option.data.connection;
            return (
              <Space>
                <Text>{connection.name}</Text>
                <Tag>{connection.connectorType}</Tag>
                {connection.source === "data-ingestion" ? (
                  <Tag color="blue">{t("dataIngestion.connections.ingestionSource")}</Tag>
                ) : null}
              </Space>
            );
          }}
          options={connections.map((connection) => ({
            connection,
            label: `${t(
              connection.kind === "control"
                ? "dataIngestion.connections.controlKind"
                : connection.kind === "space"
                  ? "dataIngestion.connections.spaceKind"
                  : "dataIngestion.connections.connectionKind",
            )} · ${connection.name} · ${connection.connectorType}`,
            value: connection.id,
          }))}
          placeholder={
            connections.length
              ? t("dataIngestion.connections.pickerPlaceholder")
              : t("dataIngestion.connections.empty")
          }
          showSearch
          value={selectedId || undefined}
        />
      </Form.Item>

      {selectedConnection ? (
        <Alert
          description={t("dataIngestion.connections.passwordHint")}
          message={t("dataIngestion.connections.selected", {
            name: selectedConnection.name,
          })}
          showIcon
          type="info"
        />
      ) : null}

      {loadError ? <Alert message={loadError} showIcon type="warning" /> : null}
    </Space>
  );
}
