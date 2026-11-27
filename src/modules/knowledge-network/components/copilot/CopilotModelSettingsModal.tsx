/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { Input, Modal, Radio, Select } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";
import type {
  CopilotModelMode,
  CopilotModelSettings,
  CopilotPlatformModel,
} from "@/modules/knowledge-network/services/ontology-copilot.service";
import {
  clearCopilotModelSettings,
  getCopilotModelSettings,
  listCopilotPlatformModels,
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
  const [mode, setMode] = useState<Exclude<CopilotModelMode, "none">>("platform");
  const [platformModel, setPlatformModel] = useState("");
  const [platformModels, setPlatformModels] = useState<CopilotPlatformModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadPlatformModels = useCallback(
    async (fallbackId: string) => {
      setModelsLoading(true);
      setModelsError("");
      try {
        const result = await listCopilotPlatformModels();
        if (!result.ok) {
          setModelsError(result.error);
          setPlatformModels([]);
          return;
        }
        setPlatformModels(result.models);
        const preferred =
          result.models.find((item) => item.id === fallbackId) ??
          result.models.find((item) => item.isDefault) ??
          result.models[0];
        if (preferred) {
          setPlatformModel(preferred.id);
        }
      } catch {
        setModelsError(t("knowledgeNetwork.copilotSettingsPlatformLoadFailed", { error: "-" }));
      } finally {
        setModelsLoading(false);
      }
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCopilotModelSettings();
      setSettings(next);
      setMode(next.mode === "manual" ? "manual" : "platform");
      setPlatformModel(next.platformModel);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey("");
      await loadPlatformModels(next.platformModel);
    } catch {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
    } finally {
      setLoading(false);
    }
  }, [loadPlatformModels, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFeedback(null);
    void load();
  }, [open, load]);

  const sourceLabel = (() => {
    if (settings?.mode === "platform" && settings.platformModel) {
      return t("knowledgeNetwork.copilotSettingsSourcePlatform", {
        name: settings.platformModelName || settings.platformModel,
      });
    }
    switch (settings?.source) {
      case "file":
        return t("knowledgeNetwork.copilotSettingsSourceFile");
      case "env":
        return t("knowledgeNetwork.copilotSettingsSourceEnv");
      default:
        return t("knowledgeNetwork.copilotSettingsSourceNone");
    }
  })();

  const selectedPlatformModel = useMemo(
    () => platformModels.find((item) => item.id === platformModel),
    [platformModel, platformModels],
  );

  const handleTest = useCallback(async () => {
    if (mode === "platform") {
      if (!platformModel) {
        setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsPlatformRequired") });
        return;
      }
      setTesting(true);
      setFeedback(null);
      try {
        const result = await testCopilotModelSettings({ mode: "platform", platformModel });
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
      return;
    }

    setTesting(true);
    setFeedback(null);
    try {
      const result = await testCopilotModelSettings({
        mode: "manual",
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
  }, [apiKey, baseUrl, mode, model, platformModel, t]);

  const handleSave = useCallback(async () => {
    if (mode === "platform") {
      if (!platformModel) {
        setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsPlatformRequired") });
        return;
      }
      setSaving(true);
      setFeedback(null);
      try {
        const result = await saveCopilotModelSettings({
          mode: "platform",
          platformModel,
          platformModelName: selectedPlatformModel?.name ?? platformModel,
        });
        if (!result.ok) {
          setFeedback({
            tone: "error",
            text: result.errors.join("；") || t("knowledgeNetwork.copilotSettingsFailed"),
          });
          return;
        }
        setSettings(result.settings);
        setFeedback({ tone: "success", text: t("knowledgeNetwork.copilotSettingsSaved") });
        onSaved?.(result.settings);
      } catch {
        setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsFailed") });
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!baseUrl.trim() || !model.trim()) {
      setFeedback({ tone: "error", text: t("knowledgeNetwork.copilotSettingsRequired") });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const result = await saveCopilotModelSettings({
        mode: "manual",
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
  }, [apiKey, baseUrl, mode, model, onSaved, platformModel, selectedPlatformModel, t]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const next = await clearCopilotModelSettings();
      setSettings(next);
      setMode(next.mode === "manual" ? "manual" : "platform");
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
      width={480}
    >
      <p className={styles.intro}>{t("knowledgeNetwork.copilotSettingsIntro")}</p>

      <div className={styles.field}>
        <span className={styles.label}>{t("knowledgeNetwork.copilotSettingsMode")}</span>
        <Radio.Group
          onChange={(event) => setMode(event.target.value as "platform" | "manual")}
          value={mode}
        >
          <Radio value="platform">{t("knowledgeNetwork.copilotSettingsModePlatform")}</Radio>
          <Radio value="manual">{t("knowledgeNetwork.copilotSettingsModeManual")}</Radio>
        </Radio.Group>
      </div>

      {mode === "platform" ? (
        <>
          <label className={styles.field}>
            <span className={styles.label}>
              {t("knowledgeNetwork.copilotSettingsPlatformModel")}
            </span>
            <Select
              loading={modelsLoading}
              notFoundContent={
                modelsLoading ? null : (
                  <span className={styles.empty}>
                    {t("knowledgeNetwork.copilotSettingsPlatformEmpty")}
                  </span>
                )
              }
              onChange={(value: string) => setPlatformModel(value)}
              options={platformModels.map((item) => ({
                label: item.name ? `${item.name}（${item.id}）` : item.id,
                value: item.id,
              }))}
              placeholder={t("knowledgeNetwork.copilotSettingsPlatformModelHint")}
              value={platformModel || undefined}
            />
          </label>
          <div className={styles.meta}>{t("knowledgeNetwork.copilotSettingsPlatformHint")}</div>
          {modelsError ? (
            <div className={`${styles.feedback} ${styles.failure}`}>
              {t("knowledgeNetwork.copilotSettingsPlatformLoadFailed", { error: modelsError })}
            </div>
          ) : null}
        </>
      ) : (
        <>
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
                  ? t("knowledgeNetwork.copilotSettingsApiKeyHint", {
                      masked: settings.apiKeyMasked,
                    })
                  : t("knowledgeNetwork.copilotSettingsApiKeyPlaceholder")
              }
              value={apiKey}
            />
          </label>
        </>
      )}

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
