import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownOutlined,
  LoadingOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { Progress } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppButton } from "@/framework/ui/common/AppButton";
import { useTranslation } from "react-i18next";

import styles from "./CopilotProgressPanel.module.css";

import type { CopilotAnalyzeStep } from "../../services/ontology-copilot.service";

export type CopilotProgressSummary = {
  objects: number;
  attributes: number;
  relations: number;
  actions: number;
  risks: number;
};

type CopilotProgressPanelProps = {
  steps: CopilotAnalyzeStep[];
  running: boolean;
  summary?: CopilotProgressSummary | null;
  error?: string;
  persisted?: boolean;
  onCancel?: () => void;
};

function summaryText(summary: CopilotProgressSummary): string[] {
  return [
    `${summary.objects} 个对象类`,
    `${summary.attributes} 个属性`,
    `${summary.relations} 条关系`,
    ...(summary.actions > 0 ? [`${summary.actions} 个行动`] : []),
    ...(summary.risks > 0 ? [`${summary.risks} 项风险`] : []),
  ];
}

export function CopilotProgressPanel({
  steps,
  running,
  summary,
  error,
  persisted,
  onCancel,
}: CopilotProgressPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(!running);
  const [elapsedMs, setElapsedMs] = useState(0);
  const runStartRef = useRef(0);

  useEffect(() => {
    if (running) {
      setCollapsed(false);
      return;
    }
    if (steps.length === 0) return;
    const timer = window.setTimeout(() => setCollapsed(true), 1200);
    return () => window.clearTimeout(timer);
  }, [running, steps.length]);

  const doneCount = steps.filter((step) => step.status === "done" && !step.error).length;
  const failed = !running && (Boolean(error) || steps.some((step) => Boolean(step.error)));
  const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100);
  const runningStep = steps.find((step) => step.status === "running");
  const totalMs = useMemo(() => steps.reduce((sum, step) => sum + (step.ms ?? 0), 0), [steps]);

  useEffect(() => {
    if (!running) {
      return;
    }
    runStartRef.current = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - runStartRef.current);
    }, 200);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (!running) {
      setElapsedMs(totalMs);
    }
  }, [running, totalMs]);

  if (steps.length === 0 && !error) return null;

  const headline = running
    ? t("knowledgeNetwork.copilotProgressRunning")
    : failed
      ? t("knowledgeNetwork.copilotProgressFailed")
      : persisted
        ? t("knowledgeNetwork.copilotStepsLast")
        : t("knowledgeNetwork.copilotProgressDone");
  const meta = running
    ? `${runningStep?.label ?? t("knowledgeNetwork.copilotProgressWaiting")} · ${(elapsedMs / 1000).toFixed(1)}s`
    : `${t("knowledgeNetwork.copilotProgressSteps", { count: steps.length })} · ${(totalMs / 1000).toFixed(1)}s`;

  return (
    <section className={styles.card} data-state={failed ? "failed" : running ? "running" : "done"}>
      <header className={styles.header}>
        <span className={styles.statusIcon}>
          {running ? (
            <LoadingOutlined spin />
          ) : failed ? (
            <CloseCircleFilled />
          ) : (
            <CheckCircleFilled />
          )}
        </span>
        <div className={styles.headings}>
          <div className={styles.headline}>{headline}</div>
          <div className={styles.meta}>{meta}</div>
        </div>
        {running ? (
          <Progress
            className={styles.bar}
            percent={percent}
            showInfo={false}
            size="small"
            status="active"
            strokeColor="#2563eb"
          />
        ) : null}
        {running && onCancel ? (
          <AppButton onClick={onCancel} size="small">
            {t("knowledgeNetwork.copilotProgressCancel")}
          </AppButton>
        ) : null}
        {!running ? (
          <AppButton
            aria-label={
              collapsed
                ? t("knowledgeNetwork.copilotProgressExpand")
                : t("knowledgeNetwork.copilotProgressCollapse")
            }
            icon={collapsed ? <DownOutlined /> : <UpOutlined />}
            onClick={() => setCollapsed((prev) => !prev)}
            size="small"
            type="text"
          />
        ) : null}
      </header>

      {!running && summary ? (
        <div className={styles.summaryRow}>
          {summaryText(summary).map((item) => (
            <span className={styles.summaryChip} key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : null}

      {!collapsed ? (
        <ol className={styles.steps}>
          {steps.map((step) => (
            <li
              className={styles.step}
              data-status={step.error ? "failed" : step.status}
              key={step.id}
            >
              <span className={styles.dot}>
                {step.error ? "!" : step.status === "done" ? "✓" : "•"}
              </span>
              <div className={styles.stepBody}>
                <div className={styles.stepLine}>
                  <span className={styles.stepLabel}>{step.label}</span>
                  {step.ms ? (
                    <span className={styles.stepMs}>{(step.ms / 1000).toFixed(1)}s</span>
                  ) : null}
                </div>
                {step.detail ? <div className={styles.stepDetail}>{step.detail}</div> : null}
                {step.error ? <div className={styles.stepError}>{step.error}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {error && !running ? <div className={styles.error}>{error}</div> : null}
    </section>
  );
}
