import {
  applyNetworkChangeStream,
  describeOp,
  planNetworkChangeStream,
  rollbackNetworkChange,
  type NetworkEditAppliedItem,
  type NetworkEditPlan,
  type NetworkEditStep,
} from "@/modules/knowledge-network/services/network-edit.service";
import { LoadingOutlined } from "@ant-design/icons";
import { Alert, Input, Modal, Progress, Space, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import styles from "./NetworkEditModal.module.css";

type NetworkEditModalProps = {
  networkId: string;
  onApplied?: () => void;
  onClose: () => void;
  open: boolean;
};

export function NetworkEditModal({ networkId, onApplied, onClose, open }: NetworkEditModalProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<NetworkEditPlan | null>(null);
  const [planModel, setPlanModel] = useState("");
  const [applied, setApplied] = useState<NetworkEditAppliedItem[]>([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [steps, setSteps] = useState<NetworkEditStep[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!loading && !applying) {
      return;
    }
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsedMs(Date.now() - startedAtRef.current);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [loading, applying]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reset = () => {
    setMessage("");
    setPlan(null);
    setPlanModel("");
    setApplied([]);
    setSnapshotId("");
    setError("");
    setNotice("");
    setLoading(false);
    setApplying(false);
    setSteps([]);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePlan = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setError("");
    setNotice("");
    setApplied([]);
    setSnapshotId("");
    setSteps([]);
    const mergeStep = (step: NetworkEditStep) => {
      setSteps((prev) => [...prev.filter((item) => item.id !== step.id), step]);
    };
    try {
      const result = await planNetworkChangeStream(networkId, message.trim(), mergeStep);
      setPlan(result.plan);
      setPlanModel(result.model ?? "");
      if (result.plan.ops.length === 0) {
        setNotice(t("knowledgeNetwork.networkEditNoOps"));
      }
    } catch (cause) {
      setPlan(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!plan || plan.ops.length === 0) return;
    setApplying(true);
    setError("");
    setSteps([]);
    const mergeStep = (step: NetworkEditStep) => {
      setSteps((prev) => [...prev.filter((item) => item.id !== step.id), step]);
    };
    try {
      const result = await applyNetworkChangeStream(networkId, plan.ops, mergeStep);
      setApplied(result.applied);
      setSnapshotId(result.snapshotId ?? "");
      setSteps((prev) => prev.map((step) => ({ ...step, status: "done" as const })));
      setNotice(
        t("knowledgeNetwork.networkEditApplied", {
          ok: result.applied.filter((item) => item.ok).length,
          total: result.applied.length,
        }),
      );
      onApplied?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  const handleRollback = async () => {
    if (!snapshotId) return;
    setApplying(true);
    setError("");
    try {
      const result = await rollbackNetworkChange(networkId, snapshotId);
      setNotice(t("knowledgeNetwork.networkEditRolledBack", { count: result.restored.length }));
      setSnapshotId("");
      setApplied([]);
      onApplied?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      destroyOnClose
      footer={null}
      onCancel={handleClose}
      open={open}
      title={t("knowledgeNetwork.networkEditTitle")}
      width={720}
    >
      <Space className={styles.body} direction="vertical" size="middle">
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 5 }}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("knowledgeNetwork.networkEditPlaceholder")}
          value={message}
        />
        <Space>
          <button
            className={styles.primary}
            disabled={loading || applying || !message.trim()}
            onClick={handlePlan}
            type="button"
          >
            {loading
              ? t("knowledgeNetwork.networkEditPlanning")
              : t("knowledgeNetwork.networkEditPlan")}
          </button>
          {plan && plan.ops.length > 0 ? (
            <button
              className={styles.primary}
              disabled={applying}
              onClick={handleApply}
              type="button"
            >
              {applying
                ? t("knowledgeNetwork.networkEditApplying")
                : t("knowledgeNetwork.networkEditApply")}
            </button>
          ) : null}
          {snapshotId ? (
            <button
              className={styles.secondary}
              disabled={applying}
              onClick={handleRollback}
              type="button"
            >
              {t("knowledgeNetwork.networkEditRollback")}
            </button>
          ) : null}
        </Space>

        {loading || applying ? (
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <LoadingOutlined spin />
              <span>
                {loading
                  ? t("knowledgeNetwork.networkEditPlanning")
                  : t("knowledgeNetwork.networkEditApplying")}
              </span>
              <span className={styles.progressElapsed}>{(elapsedMs / 1000).toFixed(1)}s</span>
            </div>
            <Progress
              percent={
                applying && steps.length > 0
                  ? Math.round(
                      (steps.filter((item) => item.status === "done").length /
                        Math.max(steps[0]?.total ?? steps.length, 1)) *
                        100,
                    )
                  : undefined
              }
              showInfo={false}
              size="small"
              status="active"
              strokeColor="#1677ff"
            />
          </div>
        ) : null}
        {error ? <Alert message={error} showIcon type="error" /> : null}
        {notice ? <Alert message={notice} showIcon type="success" /> : null}

        {planModel && !steps.some((step) => step.status === "running") ? (
          <p className={styles.modelHint}>
            {t("knowledgeNetwork.networkEditModelHint", { model: planModel })}
          </p>
        ) : null}
        {steps.length > 0 ? (
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li className={styles.step} data-status={step.status} key={step.id}>
                <span className={styles.stepIcon}>
                  {step.status === "done" ? "✓" : step.error ? "!" : "⟳"}
                </span>
                <span className={styles.stepLabel}>
                  {step.label ??
                    (typeof step.index === "number"
                      ? "执行第 " + (step.index + 1) + " 条变更"
                      : step.id)}
                </span>
                {typeof step.index === "number" && typeof step.total === "number" ? (
                  <span className={styles.stepDetail}>
                    {step.index + 1}/{step.total}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}

        {plan ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t("knowledgeNetwork.networkEditReply")}</div>
            <div className={styles.reply}>{plan.reply}</div>
            {plan.ops.length > 0 ? (
              <>
                <div className={styles.sectionTitle}>{t("knowledgeNetwork.networkEditOps")}</div>
                <ol className={styles.ops}>
                  {plan.ops.map((op, index) => (
                    <li key={`${op.op}-${index}`}>
                      <Tag color="blue">{op.op}</Tag>
                      <span>{describeOp(op)}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
            {plan.warnings.length > 0 ? (
              <Alert
                className={styles.warning}
                description={
                  <ul className={styles.warnings}>
                    {plan.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                }
                message={t("knowledgeNetwork.networkEditWarnings")}
                showIcon
                type="warning"
              />
            ) : null}
          </div>
        ) : null}

        {applied.length > 0 ? (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>{t("knowledgeNetwork.networkEditResult")}</div>
            <ul className={styles.ops}>
              {applied.map((item, index) => (
                <li key={`${item.op.op}-${index}`}>
                  <Tag color={item.ok ? "green" : "red"}>{item.ok ? "OK" : "FAIL"}</Tag>
                  <span>{describeOp(item.op)}</span>
                  {item.detail ? <span className={styles.detail}>（{item.detail}）</span> : null}
                  {item.error ? <span className={styles.error}>（{item.error}）</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Space>
    </Modal>
  );
}
