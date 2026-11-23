/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { Modal, Input } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";
import type { CopilotModelSettings } from "@/modules/knowledge-network/services/ontology-copilot.service";
import {
  clearCopilotModelSettings,
  getCopilotModelSettings,
  saveCopilotModelSettings,
  testCopilotModelSettings,
} from "@/modules/knowledge-network/services/ontology-copilot.service";

import styles from "./CopilotModelSettingsModal.module.css";

export type CopilotModelSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: (settings: CopilotModelSettings) => void;
};

type Feedback = { tone: "success" | "error"; text: string } | null;

export function CopilotModelSettingsModal({
  open,
  onClose,
  onSaved,
}: CopilotModelSettingsModalProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<CopilotModelSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCopilotModelSettings();
      setSettings(next);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey("");
    } catch {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFeedback(null);
    void load();
  }, [open, load]);

  const sourceLabel = (() => {
    switch (settings?.source) {
      case "file":
        return t("knowledgeNetwork.copilotSettingsSourceFile");
      case "env":
        return t("knowledgeNetwork.copilotSettingsSourceEnv");
      default:
        return t("knowledgeNetwork.copilotSettingsSourceNone");
    }
  })();

  const handleTest = useCallback(async () => {
    setTesting(true);
    setFeedback(null);
    try {
      const result = await testCopilotModelSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      setFeedback(
        result.ok
          ? {
              tone: "success",
              text: t("knowledgeNetwork.copilotSettingsTestOk", { ms: result.latencyMs }),
            }
          : {
              tone: "error",
              text: t("knowledgeNetwork.copilotSettingsTestFailed", { error: result.error }),
            },
      );
    } catch {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, model, t]);

  const handleSave = useCallback(async () => {
    if (!baseUrl.trim() || !model.trim()) {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsRequired") });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const result = await saveCopilotModelSettings({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      if (!result.ok) {
        setFeedback({
          tone: "error",
          text: result.errors.join("；") || t("knowledgeNetwork.copilotSettingsFailed"),
        });
        return;
      }
      setSettings(result.settings);
      setApiKey("");
      setFeedback({ tone: "success", text: t("knowledgeNetwork.copilotSettingsSaved") });
      onSaved?.(result.settings);
    } catch {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl, model, onSaved, t]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const next = await clearCopilotModelSettings();
      setSettings(next);
      setFeedback({ tone: "success", text: t("knowledgeNetwork.copilotSettingsCleared") });
    } catch {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
    } finally {
      setSaving(false);
    }
  }, [t]);

  return (
    <Modal
      destroyOnHidden
      footer={null}
      onCancel={onClose}
      open={open}
      title={t("knowledgeNetwork.copilotSettingsTitle")}
      width={460}
    >
      <p className={styles.intro}>{t("knowledgeNetwork.copilotSettingsIntro")}</p>

      <label className={styles.field}>
        <span className={styles.label}>{t("knowledgeNetwork.copilotSettingsBaseUrl")}</span>
        <Input
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={t("knowledgeNetwork.copilotSettingsBaseUrlHint")}
          value={baseUrl}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t("knowledgeNetwork.copilotSettingsModel")}</span>
        <Input
          onChange={(event) => setModel(event.target.value)}
          placeholder={t("knowledgeNetwork.copilotSettingsModelHint")}
          value={model}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t("knowledgeNetwork.copilotSettingsApiKey")}</span>
        <Input.Password
          disabled={loading}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            settings?.apiKeyMasked
              ? t("knowledgeNetwork.copilotSettingsApiKeyHint", { masked: settings.apiKeyMasked })
              : t("knowledgeNetwork.copilotSettingsApiKeyPlaceholder")
          }
          value={apiKey}
        />
      </label>

      <div className={styles.meta}>
        {t("knowledgeNetwork.copilotSettingsSource", { source: sourceLabel })}
      </div>

      {feedback ? (
        <div
          className={`${styles.feedback} ${
            feedback.tone === "success" ? styles.success : styles.failure
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      <div className={styles.actions}>
        <AppButton loading={testing} onClick={() => void handleTest()} size="small">
          {testing
            ? t("knowledgeNetwork.copilotSettingsTesting")
            : t("knowledgeNetwork.copilotSettingsTest")}
        </AppButton>
        <AppButton loading={saving} onClick={() => void handleClear()} size="small" type="text">
          {t("knowledgeNetwork.copilotSettingsClear")}
        </AppButton>
        <span className={styles.spacer} />
        <AppButton loading={saving} onClick={() => void handleSave()} size="small" type="primary">
          {saving
            ? t("knowledgeNetwork.copilotSettingsSaving")
            : t("knowledgeNetwork.copilotSettingsSave")}
        </AppButton>
      </div>
    </Modal>
  );
}
