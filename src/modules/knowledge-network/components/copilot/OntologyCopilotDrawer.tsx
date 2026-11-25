/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import {
  ApartmentOutlined,
  CloudUploadOutlined,
  CloseOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  InboxOutlined,
  TableOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  RedoOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  CheckCircleOutlined,
  UnorderedListOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Checkbox, Drawer, Input, Modal, Select, Tag, Upload } from "antd";
import type { UploadProps } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";
import type {
  AnalyzeCopilotResult,
  CopilotAnalyzeStep,
  CopilotBindingDetails,
  CopilotIntrospectTarget,
  CopilotIndexPlan,
  CopilotSchemaStats,
  CopilotBindingStats,
  CopilotEvidenceStats,
  CopilotChatMessage,
  CopilotIr,
  CopilotIrRelation,
} from "@/modules/knowledge-network/services/ontology-copilot.service";
import {
  analyzeCopilot,
  analyzeCopilotStream,
  applyCopilotIndexPlan,
  compileCopilotIndexPlan,
  compileCopilotKnPayload,
  createCopilotAlignmentViews,
  createCopilotSessionId,
  downloadCopilotBindingKit,
  downloadCopilotPackage,
  introspectCopilotDatabase,
  attachCopilotDataSource,
  compileCopilotAttachPlan,
  listCopilotEmbeddingModels,
  streamCopilotChat,
  testCopilotDatabaseConnection,
  checkCopilotIr,
} from "@/modules/knowledge-network/services/ontology-copilot.service";
import type { CopilotIngestionDataset } from "@/modules/knowledge-network/services/copilot-ingestion.service";
import {
  buildCopilotIngestionSample,
  listCopilotIngestionDatasets,
} from "@/modules/knowledge-network/services/copilot-ingestion.service";
import { importKnowledgeNetwork } from "@/modules/knowledge-network/services/network.service";
import {
  listCopilotBaseNetworks,
  loadCopilotBaseDraft,
  type CopilotBaseNetwork,
} from "@/modules/knowledge-network/services/copilot-base.service";
import { extractRequestErrorMessage } from "@/framework/request/error-message";

import styles from "./OntologyCopilotDrawer.module.css";
import { CopilotModelSettingsModal } from "./CopilotModelSettingsModal";
import { OntologyGraph } from "./OntologyGraph";
import { VirtualList } from "./VirtualList";

/** 与后端 bkn id 规则保持一致：小写字母开头，只含小写字母/数字/下划线。 */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/** 把名称转成 ASCII slug；中文等非 ASCII 名称返回 undefined（沿用原 id）。 */
function slugifyAscii(raw: string): string | undefined {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return IDENTIFIER.test(slug) ? slug : undefined;
}

function uniqueId(candidate: string, used: Set<string>): string {
  if (!used.has(candidate)) {
    return candidate;
  }
  let index = 2;
  while (used.has(`${candidate}_${index}`)) {
    index += 1;
  }
  return `${candidate}_${index}`;
}

type ObjectScope = "all" | "with_props" | "without_props";

type ChatEntry = CopilotChatMessage & { applied?: string[] };

export type OntologyCopilotDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** 导入成功后回调，用于刷新知识网络列表。 */
  onImported?: () => void;
};

/** 上传文件的两类用途：设计报告用于理解业务语义，数据表用于推导结构。 */
type CopilotUploadKind = "report" | "data";

type CopilotUploadItem = {
  file: File;
  kind: CopilotUploadKind;
};

/** 撤销栈深度上限，避免大草案占太多内存。 */
const MAX_DRAFT_HISTORY = 20;

/** 草案自动保存的 localStorage 键（同浏览器下次打开可恢复）。 */
const COPILOT_DRAFT_STORAGE_KEY = "bkn-studio:copilot-draft:v1";

type StoredCopilotDraft = {
  draft: CopilotIr;
  draftMode: "llm" | "heuristic";
  messages: ChatEntry[];
  binding: CopilotBindingStats | null;
  bindingDetails: CopilotBindingDetails | null;
  evidence: CopilotEvidenceStats | null;
  /** 数据库结构输入（DDL / dump）的解析统计。 */
  schema?: CopilotSchemaStats | null;
  /** 数据库结构输入时由模型生成的待确认问题。 */
  openQuestions?: string[];
  /** 增量演化：草案来自哪个已有知识网络（新建草案时为 null）。 */
  baseNetwork?: CopilotBaseNetwork | null;
  savedAt: number;
};

export function OntologyCopilotDrawer({ open, onClose, onImported }: OntologyCopilotDrawerProps) {
  const { t } = useTranslation();
  const sessionIdRef = useRef(createCopilotSessionId());
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<CopilotUploadItem[]>([]);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraftState] = useState<CopilotIr | null>(null);
  const draftRef = useRef<CopilotIr | null>(null);
  const draftPastRef = useRef<CopilotIr[]>([]);
  const draftFutureRef = useRef<CopilotIr[]>([]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [selfChecking, setSelfChecking] = useState(false);
  const runSelfCheck = useCallback(async () => {
    if (!draft || selfChecking) return;
    setSelfChecking(true);
    try {
      const result = await checkCopilotIr(draft);
      if (!result.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `自检失败：${result.errors.join("；")}` },
        ]);
        return;
      }
      const { summary } = result;
      if (result.changed) setDraftState(result.ir);
      const detail = result.issues
        .slice(0, 5)
        .map(
          (issue) =>
            `${issue.fixed ? "已修复" : issue.level === "error" ? "错误" : "提示"}：${issue.message}`,
        )
        .join("\n");
      const head = result.changed
        ? `已自检并修复 ${summary.fixed} 处问题，剩余 ${result.issues.length - summary.fixed} 条提示。`
        : `自检完成：没有需要修复的问题（${result.issues.length} 条提示）。`;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: detail ? `${head}\n${detail}` : head },
      ]);
    } finally {
      setSelfChecking(false);
    }
  }, [draft, selfChecking]);
  const [draftMode, setDraftMode] = useState<"llm" | "heuristic">("heuristic");
  const [binding, setBinding] = useState<CopilotBindingStats | null>(null);
  const [bindingDetails, setBindingDetails] = useState<CopilotBindingDetails | null>(null);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [evidence, setEvidence] = useState<CopilotEvidenceStats | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [schemaStats, setSchemaStats] = useState<CopilotSchemaStats | null>(null);
  const [openQuestions, setOpenQuestions] = useState<string[]>([]);
  const [baseNetwork, setBaseNetwork] = useState<CopilotBaseNetwork | null>(null);
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [baseNetworks, setBaseNetworks] = useState<CopilotBaseNetwork[]>([]);
  const [baseNetworksLoading, setBaseNetworksLoading] = useState(false);
  const [baseNetworkId, setBaseNetworkId] = useState<string | null>(null);
  const [baseLoading, setBaseLoading] = useState(false);
  const [analyzeWarnings, setAnalyzeWarnings] = useState<string[]>([]);
  const [fallbackNotice, setFallbackNotice] = useState<{ reason: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeSteps, setAnalyzeSteps] = useState<CopilotAnalyzeStep[]>([]);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftQuery, setDraftQuery] = useState("");
  const [objectScope, setObjectScope] = useState<ObjectScope>("all");
  const [endpointFilter, setEndpointFilter] = useState("all");
  const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  const [selectedRelations, setSelectedRelations] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [draftCollapsed, setDraftCollapsed] = useState(false);
  const [draftView, setDraftView] = useState<"list" | "graph">("list");
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedName, setImportedName] = useState<string | null>(null);
  const [importedKind, setImportedKind] = useState<"created" | "updated">("created");
  const [importError, setImportError] = useState<string | null>(null);
  const [introspectOpen, setIntrospectOpen] = useState(false);
  const [introspectBusy, setIntrospectBusy] = useState(false);
  const [introspectTesting, setIntrospectTesting] = useState(false);
  const [introspectError, setIntrospectError] = useState<string | null>(null);
  const [introspectMessage, setIntrospectMessage] = useState<string | null>(null);
  const [autoAttach, setAutoAttach] = useState(true);
  // 平台不接受 data_properties[].mapped_field，字段级绑定只能靠「列名与属性名一致」的视图。
  const [autoAlignViews, setAutoAlignViews] = useState(true);
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [indexPlan, setIndexPlan] = useState<CopilotIndexPlan | null>(null);
  const [indexBusy, setIndexBusy] = useState(false);
  const [indexNotice, setIndexNotice] = useState<string | null>(null);
  const [embeddingModelId, setEmbeddingModelId] = useState("");
  const [introspectForm, setIntrospectForm] = useState<CopilotIntrospectTarget>({
    dialect: "mysql",
    host: "127.0.0.1",
    port: 3306,
    database: "",
    user: "",
    password: "",
  });
  const [ingestionOpen, setIngestionOpen] = useState(false);
  const [ingestionLoading, setIngestionLoading] = useState(false);
  const [ingestionBusy, setIngestionBusy] = useState(false);
  const [ingestionError, setIngestionError] = useState<string | null>(null);
  const [ingestionSpace, setIngestionSpace] = useState("");
  const [ingestionDatasets, setIngestionDatasets] = useState<CopilotIngestionDataset[]>([]);
  const [ingestionDatasetId, setIngestionDatasetId] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);

  /** 同步撤销/重做可用状态，让按钮在历史变化后刷新。 */
  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: draftPastRef.current.length > 0,
      canRedo: draftFutureRef.current.length > 0,
    });
  }, []);

  /**
   * 草案唯一写入口：支持值和函数两种写法。
   * 与 useState 的区别是会自动把上一版草案压入撤销栈（生成新草案时也一样，可撤回）。
   */
  const setDraft = useCallback(
    (value: CopilotIr | null | ((current: CopilotIr | null) => CopilotIr | null)) => {
      const current = draftRef.current;
      const next = typeof value === "function" ? value(current) : value;
      if (next === current) {
        return;
      }
      if (current) {
        draftPastRef.current = [...draftPastRef.current.slice(-(MAX_DRAFT_HISTORY - 1)), current];
        draftFutureRef.current = [];
      }
      draftRef.current = next;
      setDraftState(next);
      syncHistoryState();
    },
    [syncHistoryState],
  );

  /** 不记历史、直接清空草案（「清空」按钮用）。 */
  const resetDraft = useCallback(() => {
    draftPastRef.current = [];
    draftFutureRef.current = [];
    draftRef.current = null;
    setDraftState(null);
    syncHistoryState();
    try {
      window.localStorage.removeItem(COPILOT_DRAFT_STORAGE_KEY);
    } catch {
      // localStorage 不可用时忽略（隐私模式等）。
    }
  }, [syncHistoryState]);

  const undoDraft = useCallback(() => {
    const current = draftRef.current;
    const previous = draftPastRef.current.at(-1);
    if (!current || !previous) {
      return;
    }
    draftPastRef.current = draftPastRef.current.slice(0, -1);
    draftFutureRef.current = [current, ...draftFutureRef.current].slice(0, MAX_DRAFT_HISTORY);
    draftRef.current = previous;
    setDraftState(previous);
    syncHistoryState();
  }, [syncHistoryState]);

  const redoDraft = useCallback(() => {
    const current = draftRef.current;
    const next = draftFutureRef.current[0];
    if (!current || !next) {
      return;
    }
    draftFutureRef.current = draftFutureRef.current.slice(1);
    draftPastRef.current = [...draftPastRef.current.slice(-(MAX_DRAFT_HISTORY - 1)), current];
    draftRef.current = next;
    setDraftState(next);
    syncHistoryState();
  }, [syncHistoryState]);

  /** 打开抽屉时恢复上次未清空的草案（同浏览器）。 */
  useEffect(() => {
    if (!open || draftRef.current) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(COPILOT_DRAFT_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as StoredCopilotDraft;
      if (!saved?.draft || !Array.isArray(saved.draft.objectTypes)) {
        return;
      }
      draftRef.current = saved.draft;
      setDraftState(saved.draft);
      setDraftMode(saved.draftMode === "llm" ? "llm" : "heuristic");
      setMessages(Array.isArray(saved.messages) ? saved.messages.slice(-40) : []);
      setBinding(saved.binding ?? null);
      setBindingDetails(saved.bindingDetails ?? null);
      setEvidence(saved.evidence ?? null);
      setSchemaStats(saved.schema ?? null);
      setOpenQuestions(Array.isArray(saved.openQuestions) ? saved.openQuestions : []);
      setBaseNetwork(saved.baseNetwork ?? null);
    } catch {
      // 损坏的本地缓存直接忽略，不阻塞使用。
    }
  }, [open]);

  /** 草案变化时自动保存（非空才存，清空会删除）。 */
  useEffect(() => {
    if (!open) {
      return;
    }
    try {
      if (!draft) {
        window.localStorage.removeItem(COPILOT_DRAFT_STORAGE_KEY);
        return;
      }
      const payload: StoredCopilotDraft = {
        draft,
        draftMode,
        messages: messages.slice(-40),
        binding,
        bindingDetails,
        evidence,
        schema: schemaStats,
        openQuestions,
        baseNetwork,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(COPILOT_DRAFT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 存储超限时忽略，不影响主流程。
    }
  }, [
    open,
    draft,
    draftMode,
    messages,
    binding,
    bindingDetails,
    evidence,
    schemaStats,
    openQuestions,
    baseNetwork,
  ]);

  /** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销重做（输入框内不拦截）。 */
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName ?? "";
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoDraft();
        } else {
          undoDraft();
        }
      } else if (key === "y") {
        event.preventDefault();
        redoDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, redoDraft, undoDraft]);

  const pickFile = useCallback((file: File, kind: CopilotUploadKind) => {
    const raw = (file as File & { originFileObj?: File }).originFileObj ?? file;
    setFiles((prev) =>
      prev.some((item) => item.file.name === raw.name) ? prev : [...prev, { file: raw, kind }],
    );
    return false;
  }, []);

  const beforeUploadReport = useCallback<NonNullable<UploadProps["beforeUpload"]>>(
    (file) => pickFile(file, "report"),
    [pickFile],
  );

  const beforeUploadData = useCallback<NonNullable<UploadProps["beforeUpload"]>>(
    (file) => pickFile(file, "data"),
    [pickFile],
  );

  useEffect(() => {
    const node = messagesRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, progress]);
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) {
      return;
    }

    const outgoing: CopilotChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    setProgress(null);
    setError(null);
    if (draft && draft.objectTypes.length + draft.relations.length > 16) {
      setDraftCollapsed(true);
    }

    try {
      await streamCopilotChat({
        sessionId: sessionIdRef.current,
        messages: outgoing,
        draft,
        onEvent: (event) => {
          if (event.type === "status") {
            const stageKey = `knowledgeNetwork.copilotStage${event.stage === "replying" ? "Replying" : event.stage === "applying" ? "Applying" : "Thinking"}`;
            setProgress(t(stageKey));
            return;
          }
          if (event.type === "delta") {
            setProgress(null);
            setMessages((prev) => {
              const next = [...prev];
              const last = next.at(-1);
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + event.text };
              }
              return next;
            });
            return;
          }
          if (event.type === "error") {
            setError(event.message ?? t("knowledgeNetwork.copilotError"));
            return;
          }
          if (event.type === "done") {
            if (event.ir) {
              setDraft(event.ir);
              setDraftMode("llm");
              setDraftQuery("");
              setObjectScope("all");
              setEndpointFilter("all");
              setSelectedObjects([]);
              setSelectedRelations([]);
            }
            if (event.applied && event.applied.length > 0) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next.at(-1);
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, applied: event.applied };
                }
                return next;
              });
            }
            if (event.note) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next.at(-1);
                if (last?.role === "assistant") {
                  next[next.length - 1] = {
                    ...last,
                    content: `${last.content}\n（${event.note}）`,
                  };
                }
                return next;
              });
            }
          }
        },
      });
    } catch {
      setError(t("knowledgeNetwork.copilotError"));
    } finally {
      setStreaming(false);
      setProgress(null);
    }
  }, [draft, input, messages, streaming, t, setDraft]);

  /** 把一次分析结果整体落到界面状态：上传生成与数据库内省共用。 */
  const applyAnalyzeResult = useCallback(
    (result: Extract<AnalyzeCopilotResult, { ok: true }>) => {
      setDraft(result.ir);
      setDraftMode(result.mode);
      setBinding(result.binding ?? null);
      setBindingDetails(result.bindingDetails ?? null);
      setBindingOpen(false);
      setEvidence(result.evidence ?? null);
      setEvidenceOpen(false);
      setSchemaStats(result.schema ?? null);
      setOpenQuestions(result.openQuestions ?? []);
      setAnalyzeWarnings(result.warnings);
      setFallbackNotice(result.mode === "heuristic" ? { reason: result.llmError ?? "" } : null);
      setDraftQuery("");
      setObjectScope("all");
      setEndpointFilter("all");
      setSelectedObjects([]);
      setSelectedRelations([]);
      setIndexPlan(null);
      setIndexNotice(null);
    },
    [setDraft],
  );

  /** 导入成功后生成检索索引建议，并读取平台已有的 embedding 模型。 */
  const prepareIndexPlan = useCallback(async (ir: CopilotIr) => {
    setIndexNotice(null);
    try {
      const result = await compileCopilotIndexPlan(ir);
      if (!result.ok || result.plan.suggestions.length === 0) {
        setIndexPlan(null);
        return;
      }
      setIndexPlan(result.plan);
      const models = await listCopilotEmbeddingModels();
      setEmbeddingModelId(models[0]?.id ?? "");
    } catch {
      setIndexPlan(null);
    }
  }, []);

  /** 一键建索引：更新资源索引配置并触发平台索引构建任务。 */
  const handleBuildIndex = useCallback(async () => {
    if (!indexPlan || indexBusy) {
      return;
    }
    setIndexBusy(true);
    setIndexNotice(t("knowledgeNetwork.copilotIndexRunning"));
    try {
      const result = await applyCopilotIndexPlan(indexPlan, {
        embeddingModel: embeddingModelId || undefined,
      });
      const completed = result.tasks.filter((task) => task.status === "completed").length;
      const failed = result.tasks.filter((task) => task.status === "failed").length;
      const fulltext = result.tasks.reduce((sum, task) => sum + task.fulltextFields.length, 0);
      const vector = result.tasks.reduce((sum, task) => sum + task.vectorFields.length, 0);
      setIndexNotice(
        t("knowledgeNetwork.copilotIndexDone", {
          completed,
          failed,
          fulltext,
          vector,
          warning: result.warnings.length > 0 ? `；${result.warnings.slice(0, 2).join("；")}` : "",
        }),
      );
    } catch (cause) {
      setIndexNotice(
        t("knowledgeNetwork.copilotIndexFailed", {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      setIndexBusy(false);
    }
  }, [embeddingModelId, indexBusy, indexPlan, t]);

  /** 打开数据库连接弹窗：默认值保留上次输入。 */
  const openIntrospect = useCallback(() => {
    setIntrospectError(null);
    setIntrospectMessage(null);
    setIntrospectOpen(true);
  }, []);

  /** 测试数据库连接（只读，最多读元数据）。 */
  const handleIntrospectTest = useCallback(async () => {
    if (introspectTesting) {
      return;
    }
    setIntrospectTesting(true);
    setIntrospectError(null);
    setIntrospectMessage(null);
    try {
      const result = await testCopilotDatabaseConnection(introspectForm);
      if (!result.ok) {
        setIntrospectError(result.errors.join("；"));
        return;
      }
      setIntrospectMessage(
        t("knowledgeNetwork.copilotIntrospectTestOk", {
          version: result.serverVersion || "-",
          tables: result.tables,
        }),
      );
    } catch {
      setIntrospectError(t("knowledgeNetwork.copilotIntrospectFailed"));
    } finally {
      setIntrospectTesting(false);
    }
  }, [introspectForm, introspectTesting, t]);

  /** 自动接入：在平台建数据源与资源 → 编译带资源绑定的载荷 → 直接导入。 */
  const attachAndImport = useCallback(
    async (ir: CopilotIr, target: CopilotIntrospectTarget) => {
      setAttachNotice(t("knowledgeNetwork.copilotAttachRunning"));
      setImportError(null);
      setImportedName(null);
      try {
        const planResult = await compileCopilotAttachPlan(ir, target);
        if (!planResult.ok) {
          setAttachNotice(null);
          setImportError(planResult.errors.join("；"));
          return;
        }
        // 平台不接受 data_properties[].mapped_field（0.1.5/0.2.1 都 400），
        // 因此在业务库上建「列名 = 本体属性名」的视图，让平台走同名列隐式绑定。
        const nameOverrides: Record<string, string> = {};
        let viewCount = 0;
        if (autoAlignViews) {
          const viewPlans = planResult.plan.bindings
            .filter((binding) => binding.properties.length > 0)
            .map((binding) => ({
              objectId: binding.objectId,
              viewName: `v_${binding.objectId}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60),
              tableName: binding.resourceName,
              columns: binding.properties,
            }))
            .filter((view) => view.columns.length > 0);
          if (viewPlans.length > 0) {
            const aligned = await createCopilotAlignmentViews(
              target,
              viewPlans.map(({ viewName, tableName, columns }) => ({
                viewName,
                tableName,
                columns,
              })),
            );
            for (const view of viewPlans) {
              if (aligned.created.includes(view.viewName)) {
                nameOverrides[view.objectId] = view.viewName;
                viewCount += 1;
              }
            }
          }
        }
        const attached = await attachCopilotDataSource(planResult.plan, { nameOverrides });
        const resourceBindings: Record<string, { id: string; name?: string }> = {};
        for (const binding of planResult.plan.bindings) {
          const id = attached.resourceIds[binding.objectId];
          if (id) {
            resourceBindings[binding.objectId] = {
              id,
              name: nameOverrides[binding.objectId] ?? binding.resourceName,
            };
          }
        }
        const compiled = await compileCopilotKnPayload(ir, { resourceBindings });
        if (!compiled.ok) {
          setAttachNotice(null);
          setImportError(compiled.errors.join("；"));
          return;
        }
        let bound = true;
        try {
          // 必须用默认的 preserve 绑定策略：binding_policy=detach 会让平台丢弃对象上的 data_source。
          await importKnowledgeNetwork(compiled.payload, baseNetwork ? "overwrite" : undefined);
        } catch (cause) {
          // 平台若拒绝对象级 data_source，退化为「只导入本体」，资源仍已创建、可手工绑定。
          bound = false;
          const fallback = await compileCopilotKnPayload(ir);
          if (!fallback.ok) {
            throw cause;
          }
          await importKnowledgeNetwork(fallback.payload, baseNetwork ? "overwrite" : undefined);
        }
        setImportedKind(baseNetwork ? "updated" : "created");
        setImportedName(ir.networkName);
        setAttachNotice(
          bound
            ? t("knowledgeNetwork.copilotAttachOk", {
                catalog: attached.catalogName,
                created: attached.createdResources,
                reused: attached.reusedResources,
              })
            : t("knowledgeNetwork.copilotAttachFallback", { catalog: attached.catalogName }),
        );
        if (viewCount > 0) {
          setAttachNotice(`${t("knowledgeNetwork.copilotAlignViewsOk", { count: viewCount })}`);
        }
        onImported?.();
        void prepareIndexPlan(ir);
      } catch (cause) {
        setAttachNotice(null);
        setImportError(
          extractRequestErrorMessage(cause) ||
            t("knowledgeNetwork.copilotAttachFailed", { error: "" }),
        );
      }
    },
    [autoAlignViews, baseNetwork, onImported, prepareIndexPlan, t],
  );
  /** 读取数据库结构并生成本体草案，完成后回到抽屉展示。 */
  const handleIntrospectRun = useCallback(async () => {
    if (introspectBusy) {
      return;
    }
    setIntrospectBusy(true);
    setIntrospectError(null);
    setIntrospectMessage(null);
    try {
      const result = await introspectCopilotDatabase(introspectForm);
      if (!result.ok) {
        setIntrospectError(
          result.errors.join("；") || t("knowledgeNetwork.copilotIntrospectFailed"),
        );
        return;
      }
      applyAnalyzeResult(result);
      setIntrospectOpen(false);
      if (autoAttach) {
        void attachAndImport(result.ir, introspectForm);
      }
    } catch {
      setIntrospectError(t("knowledgeNetwork.copilotIntrospectFailed"));
    } finally {
      setIntrospectBusy(false);
    }
  }, [applyAnalyzeResult, attachAndImport, autoAttach, introspectBusy, introspectForm, t]);

  /** 打开「从数据入库选数据集」弹窗并加载数据集清单。 */
  const openIngestionPicker = useCallback(async () => {
    setIngestionOpen(true);
    setIngestionError(null);
    setIngestionLoading(true);
    try {
      const result = await listCopilotIngestionDatasets();
      setIngestionSpace(result.spaceName);
      setIngestionDatasets(result.datasets);
      setIngestionDatasetId((current) => current || result.datasets[0]?.id || "");
    } catch {
      setIngestionError(t("knowledgeNetwork.copilotIngestionFailed"));
    } finally {
      setIngestionLoading(false);
    }
  }, [t]);

  /** 把数据入库数据集的前 N 条记录转成 CSV，交给既有分析链路生成草案。 */
  const handleIngestionGenerate = useCallback(async () => {
    const dataset = ingestionDatasets.find((item) => item.id === ingestionDatasetId);
    if (!dataset || ingestionBusy) {
      return;
    }
    setIngestionBusy(true);
    setIngestionError(null);
    try {
      const sample = await buildCopilotIngestionSample(dataset);
      const result = await analyzeCopilot({
        text: t("knowledgeNetwork.copilotIngestionPrompt", { name: dataset.name }),
        dataFiles: [sample.file],
        networkName: "",
      });
      if (!result.ok) {
        setIngestionError(result.errors.join("；"));
        return;
      }
      applyAnalyzeResult(result);
      setIngestionOpen(false);
    } catch (error) {
      setIngestionError(
        error instanceof Error && error.message
          ? error.message
          : t("knowledgeNetwork.copilotIngestionFailed"),
      );
    } finally {
      setIngestionBusy(false);
    }
  }, [applyAnalyzeResult, ingestionBusy, ingestionDatasetId, ingestionDatasets, t]);

  const handleGenerate = useCallback(async () => {
    if (analyzing) {
      return;
    }
    const text =
      input.trim() ||
      messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .join("\n");

    if (!text && files.length === 0) {
      setDraftError(t("knowledgeNetwork.copilotNoInput"));
      return;
    }

    setAnalyzing(true);
    setDraftError(null);
    setAnalyzeSteps([]);
    const mergeStep = (step: CopilotAnalyzeStep) => {
      setAnalyzeSteps((prev) => {
        const next = prev.filter((item) => item.id !== step.id);
        return [...next, step];
      });
    };
    try {
      const result = await analyzeCopilotStream({
        text,
        reportFiles: files.filter((item) => item.kind === "report").map((item) => item.file),
        dataFiles: files.filter((item) => item.kind === "data").map((item) => item.file),
        networkName: "",
        onStep: mergeStep,
      });
      if (!result.ok) {
        setDraftError(result.errors.join("；") || t("knowledgeNetwork.copilotAnalyzeFailed"));
        return;
      }
      applyAnalyzeResult(result);
    } catch {
      setDraftError(t("knowledgeNetwork.copilotAnalyzeFailed"));
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, applyAnalyzeResult, files, input, messages, t]);

  /** 清空本轮：对话、草案、选择、上传文件全部回到初始状态。 */
  const handleClearDraft = useCallback(() => {
    resetDraft();
    setMessages([]);
    setFiles([]);
    setInput("");
    setDraftError(null);
    setError(null);
    setDraftQuery("");
    setObjectScope("all");
    setEndpointFilter("all");
    setSelectedObjects([]);
    setSelectedRelations([]);
    setDraftMode("heuristic");
    setBinding(null);
    setBindingDetails(null);
    setBindingOpen(false);
    setEvidence(null);
    setEvidenceOpen(false);
    setSchemaStats(null);
    setOpenQuestions([]);
    setBaseNetwork(null);
    setBaseNetworkId(null);
    setAnalyzeWarnings([]);
    setFallbackNotice(null);
  }, [resetDraft]);

  const handleDownload = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      await downloadCopilotPackage(draft);
    } catch {
      setDraftError(t("knowledgeNetwork.copilotAnalyzeFailed"));
    }
  }, [draft, t]);

  const handleDownloadBindingKit = useCallback(async () => {
    if (!draft) {
      return;
    }
    try {
      await downloadCopilotBindingKit(draft);
    } catch {
      setDraftError(t("knowledgeNetwork.copilotAnalyzeFailed"));
    }
  }, [draft, t]);

  /** 打开「从已有网络开始」选择框，首次打开时拉取网络列表。 */
  const handleOpenBasePicker = useCallback(async () => {
    setBasePickerOpen(true);
    if (baseNetworks.length > 0 || baseNetworksLoading) {
      return;
    }
    setBaseNetworksLoading(true);
    setDraftError(null);
    try {
      setBaseNetworks(await listCopilotBaseNetworks());
    } catch (cause) {
      setDraftError(
        extractRequestErrorMessage(cause) || t("knowledgeNetwork.copilotBaseLoadFailed"),
      );
    } finally {
      setBaseNetworksLoading(false);
    }
  }, [baseNetworks.length, baseNetworksLoading, t]);

  /** 把选中的平台知识网络读成草案，作为增量演化的底稿。 */
  const handleLoadBase = useCallback(async () => {
    if (!baseNetworkId || baseLoading) {
      return;
    }
    setBaseLoading(true);
    setDraftError(null);
    try {
      const loaded = await loadCopilotBaseDraft(baseNetworkId);
      setDraft(loaded.ir);
      setBaseNetwork(loaded.network);
      setBasePickerOpen(false);
      setBinding(null);
      setBindingDetails(null);
      setEvidence(null);
      setSchemaStats(null);
      setOpenQuestions([]);
      setAnalyzeWarnings([]);
      setFallbackNotice(null);
      setDraftCollapsed(false);
    } catch (cause) {
      setDraftError(
        extractRequestErrorMessage(cause) || t("knowledgeNetwork.copilotBaseLoadFailed"),
      );
    } finally {
      setBaseLoading(false);
    }
  }, [baseLoading, baseNetworkId, setDraft, t]);

  /**
   * 执行导入：`overwrite` 覆盖原网络（增量演化），`create` 另存为新网络（id/名称加副本后缀）。
   */
  const runImport = useCallback(
    async (mode: "create" | "overwrite") => {
      if (!draft || importing) {
        return;
      }
      setImporting(true);
      setImportError(null);
      setImportedName(null);
      setImportedKind(mode === "overwrite" && baseNetwork ? "updated" : "created");
      try {
        const compiled = await compileCopilotKnPayload(draft);
        if (!compiled.ok) {
          setImportError(compiled.errors.join("；"));
          return;
        }
        if (mode === "create" && baseNetwork) {
          // 另存为新网络：换 id 和名称，避免和原网络冲突。
          const suffix = Date.now().toString(36).slice(-5);
          const copyName = t("knowledgeNetwork.copilotCopyName", { name: draft.networkName });
          const payload = {
            ...compiled.payload,
            id: `${draft.networkId}_copy_${suffix}`,
            name: copyName,
          };
          await importKnowledgeNetwork(payload, undefined, "detach");
          setImportedName(copyName);
        } else {
          await importKnowledgeNetwork(
            compiled.payload,
            baseNetwork ? "overwrite" : undefined,
            "detach",
          );
          setImportedName(draft.networkName);
        }
        onImported?.();
        void prepareIndexPlan(draft);
      } catch (cause) {
        setImportError(
          extractRequestErrorMessage(cause) || t("knowledgeNetwork.copilotImportFailed"),
        );
      } finally {
        setImporting(false);
      }
    },
    [baseNetwork, draft, importing, onImported, prepareIndexPlan, t],
  );

  const handleImport = useCallback(() => runImport("overwrite"), [runImport]);

  const handleSaveAsNew = useCallback(() => runImport("create"), [runImport]);

  /** 改名时按新名称重算 slug；ASCII 名称才能得到稳定 id，中文则保留原 id。 */
  const renameObject = useCallback(
    (id: string, name: string) => {
      setDraft((current) => {
        if (!current) {
          return current;
        }
        const taken = new Set(
          current.objectTypes.filter((item) => item.id !== id).map((item) => item.id),
        );
        const slug = slugifyAscii(name);
        const nextId = slug && !taken.has(slug) ? slug : id;

        return {
          ...current,
          objectTypes: current.objectTypes.map((item) =>
            item.id === id ? { ...item, id: nextId, name } : item,
          ),
          relations:
            nextId === id
              ? current.relations
              : current.relations.map((relation) => {
                  const source = relation.source === id ? nextId : relation.source;
                  const target = relation.target === id ? nextId : relation.target;
                  if (source === relation.source && target === relation.target) {
                    return relation;
                  }
                  const used = new Set(
                    current.relations
                      .filter((item) => item.id !== relation.id)
                      .map((item) => item.id),
                  );
                  const nextRelationId = uniqueId(
                    slugifyAscii(`${source}_${target}`) ?? relation.id,
                    used,
                  );
                  return { ...relation, id: nextRelationId, source, target };
                }),
        };
      });
    },
    [setDraft],
  );

  const removeObject = useCallback(
    (id: string) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              objectTypes: current.objectTypes.filter((item) => item.id !== id),
              relations: current.relations.filter(
                (relation) => relation.source !== id && relation.target !== id,
              ),
            }
          : current,
      );
    },
    [setDraft],
  );

  const addObject = useCallback(() => {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const used = new Set(current.objectTypes.map((item) => item.id));
      const index = current.objectTypes.length + 1;
      const name = `${t("knowledgeNetwork.copilotNewObject")} ${index}`;
      const id = uniqueId(slugifyAscii(name) ?? `obj_${index}`, used);
      return {
        ...current,
        objectTypes: [...current.objectTypes, { id, name, properties: [] }],
      };
    });
  }, [t, setDraft]);

  const addRelation = useCallback(() => {
    setDraft((current) => {
      if (!current || current.objectTypes.length < 2) {
        return current;
      }
      const source = current.objectTypes[0]?.id ?? "";
      const target = current.objectTypes[1]?.id ?? source;
      const used = new Set(current.relations.map((item) => item.id));
      const index = current.relations.length + 1;
      const id = uniqueId(slugifyAscii(`${source}_${target}`) ?? `rel_${index}`, used);
      return {
        ...current,
        relations: [
          ...current.relations,
          {
            id,
            name: `${t("knowledgeNetwork.copilotNewRelation")} ${index}`,
            source,
            target,
          },
        ],
      };
    });
  }, [t, setDraft]);

  const renameRelation = useCallback(
    (id: string, name: string) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              relations: current.relations.map((item) =>
                item.id === id ? { ...item, name } : item,
              ),
            }
          : current,
      );
    },
    [setDraft],
  );

  const changeRelationEndpoint = useCallback(
    (id: string, side: "source" | "target", value: string) => {
      setDraft((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          relations: current.relations.map((relation) => {
            if (relation.id !== id || relation[side] === value) {
              return relation;
            }
            const source = side === "source" ? value : relation.source;
            const target = side === "target" ? value : relation.target;
            if (source === target) {
              return relation;
            }
            const used = new Set(
              current.relations.filter((item) => item.id !== id).map((item) => item.id),
            );
            const nextId = uniqueId(slugifyAscii(`${source}_${target}`) ?? relation.id, used);
            return { ...relation, id: nextId, source, target };
          }),
        };
      });
    },
    [setDraft],
  );

  const removeRelation = useCallback(
    (id: string) => {
      setDraft((current) =>
        current
          ? { ...current, relations: current.relations.filter((item) => item.id !== id) }
          : current,
      );
    },
    [setDraft],
  );

  const objectOptions =
    draft?.objectTypes.map((item) => ({ label: item.name, value: item.id })) ?? [];

  const actionTypeOptions = [
    { label: t("knowledgeNetwork.copilotActionTypeAdd"), value: "add" },
    { label: t("knowledgeNetwork.copilotActionTypeModify"), value: "modify" },
    { label: t("knowledgeNetwork.copilotActionTypeDelete"), value: "delete" },
  ];

  const boundObjectCount =
    draft?.objectTypes.filter((item) => Boolean(item.sourceTable)).length ?? 0;
  const draftQueryText = draftQuery.trim().toLowerCase();
  const matchesQuery = (name: string, id: string): boolean =>
    !draftQueryText || name.toLowerCase().includes(draftQueryText) || id.includes(draftQueryText);

  const scopedObjects =
    draft?.objectTypes.filter((item) => {
      if (objectScope === "with_props") {
        return item.properties.length > 0;
      }
      if (objectScope === "without_props") {
        return item.properties.length === 0;
      }
      return true;
    }) ?? [];
  const filteredObjects = scopedObjects.filter((item) => matchesQuery(item.name, item.id));

  const scopedRelations =
    draft?.relations.filter(
      (item) =>
        endpointFilter === "all" ||
        item.source === endpointFilter ||
        item.target === endpointFilter,
    ) ?? [];
  const filteredRelations = scopedRelations.filter((item) => matchesQuery(item.name, item.id));

  const allObjectsSelected =
    filteredObjects.length > 0 &&
    filteredObjects.every((item) => selectedObjects.includes(item.id));
  const someObjectsSelected = filteredObjects.some((item) => selectedObjects.includes(item.id));
  const allRelationsSelected =
    filteredRelations.length > 0 &&
    filteredRelations.every((item) => selectedRelations.includes(item.id));
  const someRelationsSelected = filteredRelations.some((item) =>
    selectedRelations.includes(item.id),
  );

  const toggleObject = useCallback((id: string, checked: boolean) => {
    setSelectedObjects((current) =>
      checked
        ? [...current.filter((item) => item !== id), id]
        : current.filter((item) => item !== id),
    );
  }, []);

  const toggleRelation = useCallback((id: string, checked: boolean) => {
    setSelectedRelations((current) =>
      checked
        ? [...current.filter((item) => item !== id), id]
        : current.filter((item) => item !== id),
    );
  }, []);

  const removeSelectedObjects = useCallback(() => {
    if (selectedObjects.length === 0) {
      return;
    }
    const removed = new Set(selectedObjects);
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        objectTypes: current.objectTypes.filter((item) => !removed.has(item.id)),
        relations: current.relations.filter(
          (item) => !removed.has(item.source) && !removed.has(item.target),
        ),
      };
    });
    setSelectedObjects([]);
  }, [selectedObjects, setDraft]);

  const removeSelectedRelations = useCallback(() => {
    if (selectedRelations.length === 0) {
      return;
    }
    const removed = new Set(selectedRelations);
    setDraft((current) =>
      current
        ? { ...current, relations: current.relations.filter((item) => !removed.has(item.id)) }
        : current,
    );
    setSelectedRelations([]);
  }, [selectedRelations, setDraft]);

  return (
    <Drawer
      className={styles.drawer}
      onClose={onClose}
      open={open}
      title={
        <span className={styles.titleRow}>
          {t("knowledgeNetwork.copilotTitle")}
          <AppButton
            aria-label={t("knowledgeNetwork.copilotSettings")}
            icon={<SettingOutlined />}
            onClick={() => setSettingsOpen(true)}
            size="small"
            type="text"
          />
        </span>
      }
      width={520}
    >
      <div className={styles.body}>
        <div className={styles.scrollArea}>
          <p className={styles.intro}>{t("knowledgeNetwork.copilotIntro")}</p>

          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <span className={styles.panelLabel}>{t("knowledgeNetwork.copilotChatLabel")}</span>
              {streaming ? (
                <span className={styles.panelHint}>{t("knowledgeNetwork.copilotStreaming")}</span>
              ) : null}
            </header>
            <div className={styles.messages} ref={messagesRef}>
              {messages.length === 0 ? (
                <div className={styles.emptyState}>
                  <RobotOutlined className={styles.emptyIcon} />
                  <span className={styles.placeholder}>{t("knowledgeNetwork.copilotEmpty")}</span>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={styles.messageGroup}>
                      <div
                        className={`${styles.bubble} ${
                          message.role === "user" ? styles.userBubble : styles.assistantBubble
                        }`}
                      >
                        {message.content ||
                          (streaming && index === messages.length - 1 ? (
                            <span className={styles.typing}>{progress ?? ""}</span>
                          ) : null)}
                      </div>
                      {message.applied && message.applied.length > 0 ? (
                        <ul className={styles.appliedList}>
                          <li className={styles.appliedTitle}>
                            {t("knowledgeNetwork.copilotApplied")}
                          </li>
                          {message.applied.map((item) => (
                            <li className={styles.appliedItem} key={item}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>

          {draft ? (
            <section className={styles.draft}>
              <header className={styles.draftHeader}>
                <span className={styles.draftTitle}>{t("knowledgeNetwork.copilotDraftTitle")}</span>
                <span className={styles.draftHeaderActions}>
                  <AppButton
                    aria-label={t("knowledgeNetwork.copilotUndo")}
                    disabled={!historyState.canUndo}
                    onClick={undoDraft}
                    size="small"
                    title={t("knowledgeNetwork.copilotUndo")}
                    type="text"
                  >
                    <UndoOutlined />
                  </AppButton>
                  <AppButton
                    aria-label={t("knowledgeNetwork.copilotRedo")}
                    disabled={!historyState.canRedo}
                    onClick={redoDraft}
                    size="small"
                    title={t("knowledgeNetwork.copilotRedo")}
                    type="text"
                  >
                    <RedoOutlined />
                  </AppButton>
                  <AppButton
                    aria-label={t("knowledgeNetwork.copilotSelfCheck")}
                    icon={<CheckCircleOutlined />}
                    loading={selfChecking}
                    onClick={runSelfCheck}
                    size="small"
                    title={t("knowledgeNetwork.copilotSelfCheck")}
                    type="text"
                  />{" "}
                  <Tag color={draftMode === "llm" ? "blue" : "default"}>
                    {draftMode === "llm"
                      ? t("knowledgeNetwork.copilotModeLlm")
                      : t("knowledgeNetwork.copilotModeHeuristic")}
                  </Tag>
                  <span className={styles.viewToggleGroup}>
                    <AppButton
                      className={draftView === "list" ? styles.viewToggleActive : styles.viewToggle}
                      icon={<UnorderedListOutlined />}
                      onClick={() => setDraftView("list")}
                      size="small"
                      title={t("knowledgeNetwork.copilotViewList")}
                      type="text"
                    />
                    <AppButton
                      className={
                        draftView === "graph" ? styles.viewToggleActive : styles.viewToggle
                      }
                      icon={<ApartmentOutlined />}
                      onClick={() => setDraftView("graph")}
                      size="small"
                      title={t("knowledgeNetwork.copilotViewGraph")}
                      type="text"
                    />
                  </span>
                  <AppButton
                    onClick={() => setDraftCollapsed((current) => !current)}
                    size="small"
                    type="text"
                  >
                    {draftCollapsed
                      ? t("knowledgeNetwork.copilotExpandDraft")
                      : t("knowledgeNetwork.copilotCollapseDraft")}
                  </AppButton>
                  <AppButton danger size="small" type="text" onClick={handleClearDraft}>
                    {t("knowledgeNetwork.copilotClearDraft")}
                  </AppButton>
                </span>
              </header>
              <div className={styles.draftName}>{draft.networkName}</div>
              {baseNetwork ? (
                <div className={styles.draftMeta}>
                  <Tag color="geekblue">
                    {t("knowledgeNetwork.copilotBaseTag", { name: baseNetwork.name })}
                  </Tag>
                </div>
              ) : null}
              <div className={styles.draftMeta}>
                {t("knowledgeNetwork.copilotDraftSummary", {
                  objects: draft.objectTypes.length,
                  relations: draft.relations.length,
                })}
              </div>
              {boundObjectCount > 0 ? (
                <div className={styles.bindHint}>
                  {t("knowledgeNetwork.copilotBindingHint", {
                    bound: boundObjectCount,
                    total: draft.objectTypes.length,
                  })}
                </div>
              ) : null}
              {fallbackNotice ? (
                <div className={styles.fallbackBox}>
                  <div className={styles.fallbackTitle}>
                    <WarningOutlined />
                    <span>{t("knowledgeNetwork.copilotFallbackTitle")}</span>
                  </div>
                  <div className={styles.fallbackReason}>
                    {fallbackNotice.reason
                      ? t("knowledgeNetwork.copilotFallbackReason", {
                          reason: fallbackNotice.reason,
                        })
                      : t("knowledgeNetwork.copilotFallbackNoModel")}
                  </div>
                  <div className={styles.fallbackActions}>
                    <AppButton
                      disabled={analyzing}
                      loading={analyzing}
                      onClick={() => void handleGenerate()}
                      size="small"
                      type="primary"
                    >
                      {t("knowledgeNetwork.copilotFallbackRetry")}
                    </AppButton>
                    <AppButton onClick={() => setSettingsOpen(true)} size="small">
                      {t("knowledgeNetwork.copilotFallbackConfig")}
                    </AppButton>
                  </div>
                </div>
              ) : null}
              {analyzeWarnings.length > 0 ? (
                <div className={styles.warnBox}>
                  {analyzeWarnings.map((message) => (
                    <div className={styles.warnItem} key={message}>
                      <WarningOutlined />
                      <span>{message}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {schemaStats ? (
                <div className={styles.schemaBox}>
                  <div className={styles.schemaTitle}>
                    {t("knowledgeNetwork.copilotSchemaTitle", {
                      dialect: schemaStats.dialect,
                      tables: schemaStats.tables,
                      columns: schemaStats.columns,
                    })}
                  </div>
                  <div className={styles.schemaMeta}>
                    {schemaStats.hasComments
                      ? t("knowledgeNetwork.copilotSchemaCommented", {
                          commentedTables: schemaStats.commentedTables,
                          tables: schemaStats.tables,
                          foreignKeys: schemaStats.foreignKeys,
                        })
                      : t("knowledgeNetwork.copilotSchemaNoComment")}
                  </div>
                  {openQuestions.length > 0 ? (
                    <div className={styles.questionBlock}>
                      <div className={styles.questionTitle}>
                        {t("knowledgeNetwork.copilotSchemaQuestions")}
                      </div>
                      <ul className={styles.questionList}>
                        {openQuestions.map((question) => (
                          <li className={styles.questionItem} key={question}>
                            {question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {binding && binding.boundObjects > 0 ? (
                <div className={styles.bindingBox}>
                  <div className={styles.bindingHeader}>
                    <span className={styles.bindingTitle}>
                      {t("knowledgeNetwork.copilotBindingTitle", {
                        primaryKeys: binding.inferredPrimaryKeys,
                        relations: binding.inferredRelations,
                      })}
                    </span>
                    <AppButton
                      size="small"
                      type="text"
                      icon={<DownloadOutlined />}
                      onClick={() => void handleDownloadBindingKit()}
                    >
                      {t("knowledgeNetwork.copilotBindingKit")}
                    </AppButton>
                    <AppButton
                      size="small"
                      type="text"
                      onClick={() => setBindingOpen((open) => !open)}
                    >
                      {bindingOpen
                        ? t("knowledgeNetwork.copilotBindingHide")
                        : t("knowledgeNetwork.copilotBindingShow")}
                    </AppButton>
                  </div>
                  {bindingOpen && bindingDetails ? (
                    <div className={styles.bindingList}>
                      {bindingDetails.objects.map((item) => (
                        <div className={styles.bindingRow} key={item.objectId}>
                          <span className={styles.bindingRowName}>{item.objectName}</span>
                          <span className={styles.bindingRowMeta}>
                            {item.primaryKey
                              ? t("knowledgeNetwork.copilotBindingObjectMeta", {
                                  table: item.table,
                                  column: item.primaryKey.column,
                                  count: item.properties.length,
                                })
                              : t("knowledgeNetwork.copilotBindingObjectMetaNoPk", {
                                  table: item.table,
                                  count: item.properties.length,
                                })}
                          </span>
                        </div>
                      ))}
                      {bindingDetails.relations
                        .filter((item) => item.mapping.length > 0)
                        .map((item) => (
                          <div className={styles.bindingRow} key={item.relationId}>
                            <span className={styles.bindingRowName}>{item.relationName}</span>
                            <span className={styles.bindingRowMeta}>
                              {item.mapping
                                .map((pair) => `${pair.sourceProperty} → ${pair.targetProperty}`)
                                .join("；")}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {evidence && evidence.objectsWithEvidence > 0 ? (
                <div className={styles.bindingBox}>
                  <div className={styles.bindingHeader}>
                    <span className={styles.bindingTitle}>
                      {t("knowledgeNetwork.copilotEvidenceTitle", {
                        objects: evidence.objectsWithEvidence,
                        objectTotal: evidence.objects,
                        properties: evidence.propertiesWithEvidence,
                        propertyTotal: evidence.properties,
                      })}
                    </span>
                    <AppButton
                      size="small"
                      type="text"
                      onClick={() => setEvidenceOpen((open) => !open)}
                    >
                      {evidenceOpen
                        ? t("knowledgeNetwork.copilotEvidenceHide")
                        : t("knowledgeNetwork.copilotEvidenceShow")}
                    </AppButton>
                  </div>
                  {evidenceOpen ? (
                    <div className={styles.bindingList}>
                      {draft.objectTypes
                        .filter((object) => (object.evidence?.length ?? 0) > 0)
                        .map((object) => {
                          const first = object.evidence?.[0];
                          const propertyCount = object.properties.filter(
                            (property) => (property.evidence?.length ?? 0) > 0,
                          ).length;
                          return (
                            <div className={styles.bindingRow} key={object.id}>
                              <span className={styles.bindingRowName}>{object.name}</span>
                              <span className={styles.bindingRowMeta}>
                                {first
                                  ? `${first.source}${first.location ? ` · ${first.location}` : ""}`
                                  : ""}
                                {" · "}
                                {t("knowledgeNetwork.copilotEvidencePropertyCount", {
                                  count: propertyCount,
                                })}
                                {first ? ` · “${first.quote}”` : ""}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
              ) : null}{" "}
              {draftCollapsed ? (
                <div className={styles.draftCollapsed}>
                  {draft.objectTypes.slice(0, 10).map((object) => (
                    <Tag key={object.id}>{object.name}</Tag>
                  ))}
                  {draft.objectTypes.length > 10 ? (
                    <Tag>+{draft.objectTypes.length - 10}</Tag>
                  ) : null}
                </div>
              ) : draftView === "graph" ? (
                <OntologyGraph
                  height={380}
                  ir={draft}
                  onFullscreen={() => setGraphFullscreen(true)}
                  width={480}
                />
              ) : (
                <>
                  <Input
                    allowClear
                    className={styles.draftSearch}
                    onChange={(event) => setDraftQuery(event.target.value)}
                    placeholder={t("knowledgeNetwork.copilotDraftSearch")}
                    size="small"
                    value={draftQuery}
                  />

                  <div className={styles.draftListHeader}>
                    <span>
                      {t("knowledgeNetwork.copilotObjectSection")} · {filteredObjects.length}
                      {draftQueryText ? ` / ${draft.objectTypes.length}` : ""}
                    </span>
                    <AppButton icon={<PlusOutlined />} onClick={addObject} size="small" type="text">
                      {t("knowledgeNetwork.copilotAddObject")}
                    </AppButton>
                  </div>
                  <div className={styles.draftToolbar}>
                    <Checkbox
                      checked={allObjectsSelected}
                      indeterminate={!allObjectsSelected && someObjectsSelected}
                      onChange={(event) =>
                        setSelectedObjects(
                          event.target.checked ? filteredObjects.map((item) => item.id) : [],
                        )
                      }
                    >
                      {t("knowledgeNetwork.copilotSelectAll")}
                    </Checkbox>
                    <Select
                      className={styles.draftScope}
                      onChange={(value: ObjectScope) => setObjectScope(value)}
                      options={[
                        { label: t("knowledgeNetwork.copilotScopeAll"), value: "all" },
                        { label: t("knowledgeNetwork.copilotScopeWithProps"), value: "with_props" },
                        {
                          label: t("knowledgeNetwork.copilotScopeWithoutProps"),
                          value: "without_props",
                        },
                      ]}
                      size="small"
                      value={objectScope}
                    />
                    <span className={styles.draftSelected}>
                      {t("knowledgeNetwork.copilotSelected", { count: selectedObjects.length })}
                    </span>
                    <AppButton
                      danger
                      disabled={selectedObjects.length === 0}
                      icon={<DeleteOutlined />}
                      onClick={removeSelectedObjects}
                      size="small"
                      type="text"
                    >
                      {t("knowledgeNetwork.copilotDeleteSelected")}
                    </AppButton>
                  </div>
                  {filteredObjects.length === 0 ? (
                    <span className={styles.draftHint}>{t("knowledgeNetwork.copilotNoMatch")}</span>
                  ) : (
                    <VirtualList
                      getKey={(item) => item.id}
                      items={filteredObjects}
                      renderRow={(object) => (
                        <>
                          <Checkbox
                            checked={selectedObjects.includes(object.id)}
                            onChange={(event) => toggleObject(object.id, event.target.checked)}
                          />
                          <Input
                            className={styles.draftRowName}
                            onChange={(event) => renameObject(object.id, event.target.value)}
                            size="small"
                            value={object.name}
                          />
                          <span className={styles.draftRowMeta}>{object.id}</span>
                          <AppButton
                            aria-label={`${t("knowledgeNetwork.copilotDelete")} ${object.name}`}
                            className={styles.draftDelete}
                            icon={<DeleteOutlined />}
                            onClick={() => removeObject(object.id)}
                            size="small"
                            type="text"
                          />
                        </>
                      )}
                    />
                  )}

                  <div className={styles.draftListHeader}>
                    <span>
                      {t("knowledgeNetwork.copilotRelationSection")} · {filteredRelations.length}
                      {draftQueryText ? ` / ${draft.relations.length}` : ""}
                    </span>
                    <AppButton
                      disabled={draft.objectTypes.length < 2}
                      icon={<PlusOutlined />}
                      onClick={addRelation}
                      size="small"
                      type="text"
                    >
                      {t("knowledgeNetwork.copilotAddRelation")}
                    </AppButton>
                  </div>
                  <div className={styles.draftToolbar}>
                    <Checkbox
                      checked={allRelationsSelected}
                      indeterminate={!allRelationsSelected && someRelationsSelected}
                      onChange={(event) =>
                        setSelectedRelations(
                          event.target.checked ? filteredRelations.map((item) => item.id) : [],
                        )
                      }
                    >
                      {t("knowledgeNetwork.copilotSelectAll")}
                    </Checkbox>
                    <Select
                      className={styles.draftScope}
                      onChange={(value: string) => setEndpointFilter(value)}
                      options={[
                        { label: t("knowledgeNetwork.copilotAllEndpoints"), value: "all" },
                        ...objectOptions,
                      ]}
                      size="small"
                      value={endpointFilter}
                    />
                    <span className={styles.draftSelected}>
                      {t("knowledgeNetwork.copilotSelected", { count: selectedRelations.length })}
                    </span>
                    <AppButton
                      danger
                      disabled={selectedRelations.length === 0}
                      icon={<DeleteOutlined />}
                      onClick={removeSelectedRelations}
                      size="small"
                      type="text"
                    >
                      {t("knowledgeNetwork.copilotDeleteSelected")}
                    </AppButton>
                  </div>
                  {filteredRelations.length === 0 ? (
                    <span className={styles.draftHint}>
                      {draftQueryText || endpointFilter !== "all"
                        ? t("knowledgeNetwork.copilotNoMatch")
                        : t("knowledgeNetwork.copilotNoRelations")}
                    </span>
                  ) : (
                    <VirtualList
                      getKey={(item) => item.id}
                      items={filteredRelations}
                      renderRow={(relation: CopilotIrRelation) => (
                        <>
                          <Checkbox
                            checked={selectedRelations.includes(relation.id)}
                            onChange={(event) => toggleRelation(relation.id, event.target.checked)}
                          />
                          <Input
                            className={styles.draftRowName}
                            onChange={(event) => renameRelation(relation.id, event.target.value)}
                            size="small"
                            value={relation.name}
                          />
                          <Select
                            className={styles.draftEndpoint}
                            onChange={(value: string) =>
                              changeRelationEndpoint(relation.id, "source", value)
                            }
                            options={objectOptions}
                            size="small"
                            value={relation.source}
                          />
                          <span className={styles.draftRowMeta}>→</span>
                          <Select
                            className={styles.draftEndpoint}
                            onChange={(value: string) =>
                              changeRelationEndpoint(relation.id, "target", value)
                            }
                            options={objectOptions}
                            size="small"
                            value={relation.target}
                          />
                          <AppButton
                            aria-label={`${t("knowledgeNetwork.copilotDelete")} ${relation.name}`}
                            className={styles.draftDelete}
                            icon={<DeleteOutlined />}
                            onClick={() => removeRelation(relation.id)}
                            size="small"
                            type="text"
                          />
                        </>
                      )}
                    />
                  )}
                </>
              )}
              {draft.actionTypes && draft.actionTypes.length > 0 ? (
                <div className={styles.draftList}>
                  <div className={styles.draftListHeader}>
                    <span>
                      {t("knowledgeNetwork.copilotActionTypes", {
                        count: draft.actionTypes.length,
                      })}
                    </span>
                  </div>
                  {draft.actionTypes.map((action) => (
                    <div className={styles.draftRow} key={action.id}>
                      <Input
                        aria-label={action.name}
                        className={styles.draftRowInput}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  actionTypes: (current.actionTypes ?? []).map((item) =>
                                    item.id === action.id
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                        size="small"
                        value={action.name}
                      />
                      <Select
                        className={styles.draftEndpoint}
                        onChange={(value: string) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  actionTypes: (current.actionTypes ?? []).map((item) =>
                                    item.id === action.id ? { ...item, boundObject: value } : item,
                                  ),
                                }
                              : current,
                          )
                        }
                        options={objectOptions}
                        size="small"
                        value={action.boundObject}
                      />
                      <Select
                        className={styles.draftEndpoint}
                        onChange={(value: string) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  actionTypes: (current.actionTypes ?? []).map((item) =>
                                    item.id === action.id
                                      ? {
                                          ...item,
                                          actionType: value as "add" | "modify" | "delete",
                                        }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                        options={actionTypeOptions}
                        size="small"
                        value={action.actionType}
                      />
                      <AppButton
                        aria-label={`${t("knowledgeNetwork.copilotDelete")} ${action.name}`}
                        className={styles.draftDelete}
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  actionTypes: (current.actionTypes ?? []).filter(
                                    (item) => item.id !== action.id,
                                  ),
                                }
                              : current,
                          )
                        }
                        size="small"
                        type="text"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {draft.riskTypes && draft.riskTypes.length > 0 ? (
                <div className={styles.draftList}>
                  <div className={styles.draftListHeader}>
                    <span>
                      {t("knowledgeNetwork.copilotRiskTypes", { count: draft.riskTypes.length })}
                    </span>
                  </div>
                  {draft.riskTypes.map((risk) => (
                    <div className={styles.draftRow} key={risk.id}>
                      <Input
                        aria-label={risk.name}
                        className={styles.draftRowInput}
                        onChange={(event) =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  riskTypes: (current.riskTypes ?? []).map((item) =>
                                    item.id === risk.id
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                }
                              : current,
                          )
                        }
                        size="small"
                        value={risk.name}
                      />
                      <span className={styles.draftRowMeta}>
                        {t("knowledgeNetwork.copilotRiskPolicyCount", {
                          count: risk.policies.length,
                        })}
                      </span>
                      <AppButton
                        aria-label={`${t("knowledgeNetwork.copilotDelete")} ${risk.name}`}
                        className={styles.draftDelete}
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  riskTypes: (current.riskTypes ?? []).filter(
                                    (item) => item.id !== risk.id,
                                  ),
                                }
                              : current,
                          )
                        }
                        size="small"
                        type="text"
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              <div className={styles.draftHint}>{t("knowledgeNetwork.copilotDraftHint")}</div>
              {importedName ? (
                <div className={styles.importOk}>
                  {t(
                    importedKind === "updated"
                      ? "knowledgeNetwork.copilotImportOverwriteOk"
                      : "knowledgeNetwork.copilotImportOk",
                    { name: importedName },
                  )}
                </div>
              ) : null}
              {attachNotice ? <div className={styles.attachNotice}>{attachNotice}</div> : null}
              {importError ? <div className={styles.importError}>{importError}</div> : null}
              {indexPlan ? (
                <div className={styles.indexBox}>
                  <div className={styles.indexTitle}>
                    {t("knowledgeNetwork.copilotIndexTitle", {
                      objects: indexPlan.summary.objects,
                      fulltext: indexPlan.summary.fulltextFields,
                      vector: indexPlan.summary.vectorFields,
                    })}
                  </div>
                  {embeddingModelId ? null : (
                    <div className={styles.indexHint}>
                      {t("knowledgeNetwork.copilotIndexNoEmbedding")}
                    </div>
                  )}
                  {indexNotice ? <div className={styles.indexNotice}>{indexNotice}</div> : null}
                  <AppButton
                    icon={<ThunderboltOutlined />}
                    loading={indexBusy}
                    onClick={() => void handleBuildIndex()}
                    size="small"
                  >
                    {t("knowledgeNetwork.copilotIndexBuild")}
                  </AppButton>
                </div>
              ) : null}
              <div className={styles.draftActions}>
                <AppButton icon={<DownloadOutlined />} onClick={() => void handleDownload()}>
                  {t("knowledgeNetwork.copilotDownload")}
                </AppButton>
                {baseNetwork ? (
                  <AppButton
                    disabled={importing}
                    onClick={() => void handleSaveAsNew()}
                    type="default"
                  >
                    {t("knowledgeNetwork.copilotSaveAsNew")}
                  </AppButton>
                ) : null}
                <AppButton
                  disabled={importing}
                  icon={<CloudUploadOutlined />}
                  loading={importing}
                  onClick={() => void handleImport()}
                  type="primary"
                >
                  {importing
                    ? t("knowledgeNetwork.copilotImporting")
                    : baseNetwork
                      ? t("knowledgeNetwork.copilotUpdateExisting")
                      : t("knowledgeNetwork.copilotImport")}
                </AppButton>
              </div>
            </section>
          ) : null}
        </div>

        <section className={styles.composer}>
          <div className={styles.fileRow}>
            <Upload
              accept=".docx,.pdf,.pptx,.md,.markdown,.txt,.html,.htm,.doc"
              beforeUpload={beforeUploadReport}
              multiple
              showUploadList={false}
            >
              <AppButton icon={<FileTextOutlined />}>
                {t("knowledgeNetwork.copilotUploadReport")}
              </AppButton>
            </Upload>
            <Upload
              accept=".xlsx,.xls,.csv,.tsv,.json,.sql,.ddl,.yaml,.yml"
              beforeUpload={beforeUploadData}
              multiple
              showUploadList={false}
            >
              <AppButton icon={<TableOutlined />}>
                {t("knowledgeNetwork.copilotUploadData")}
              </AppButton>
            </Upload>
            <AppButton icon={<ApartmentOutlined />} onClick={() => void handleOpenBasePicker()}>
              {t("knowledgeNetwork.copilotBaseButton")}
            </AppButton>
            <AppButton icon={<DatabaseOutlined />} onClick={openIntrospect}>
              {t("knowledgeNetwork.copilotIntrospectOpen")}
            </AppButton>
            <AppButton icon={<InboxOutlined />} onClick={() => void openIngestionPicker()}>
              {t("knowledgeNetwork.copilotIngestionOpen")}
            </AppButton>
            {files.length > 0 ? (
              <span className={styles.fileList}>
                {files.map((item) => (
                  <span className={styles.fileChip} key={item.file.name}>
                    <Tag className={styles.fileKind}>
                      {item.kind === "report"
                        ? t("knowledgeNetwork.copilotKindReport")
                        : t("knowledgeNetwork.copilotKindData")}
                    </Tag>
                    {item.file.name}
                    <AppButton
                      aria-label={t("knowledgeNetwork.copilotRemoveFile")}
                      icon={<CloseOutlined />}
                      onClick={() =>
                        setFiles((prev) =>
                          prev.filter((entry) => entry.file.name !== item.file.name),
                        )
                      }
                      size="small"
                      type="text"
                    />
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.hint}>{t("knowledgeNetwork.copilotFileHint")}</span>
            )}
          </div>
          {files.some((item) => item.kind === "report") &&
          files.some((item) => item.kind === "data") ? (
            <span className={styles.bothReady}>{t("knowledgeNetwork.copilotBothReady")}</span>
          ) : null}
          <Input.TextArea
            autoSize={{ maxRows: 6, minRows: 3 }}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("knowledgeNetwork.copilotInputPlaceholder")}
            variant="borderless"
            value={input}
          />
          {error ? <span className={styles.error}>{error}</span> : null}
          {draftError ? <span className={styles.error}>{draftError}</span> : null}
          {analyzeSteps.length > 0 ? (
            <ol className={styles.analyzeSteps}>
              {analyzeSteps.map((step) => (
                <li className={styles.analyzeStep} data-status={step.status} key={step.id}>
                  <span className={styles.analyzeStepIcon}>
                    {step.status === "done" ? "✓" : step.error ? "!" : "⟳"}
                  </span>
                  <span className={styles.analyzeStepLabel}>{step.label}</span>
                  {step.detail ? (
                    <span className={styles.analyzeStepDetail}>{step.detail}</span>
                  ) : null}
                  {step.ms ? (
                    <span className={styles.analyzeStepMs}>{(step.ms / 1000).toFixed(1)}s</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          <div className={styles.actions}>
            <AppButton
              disabled={!input.trim()}
              loading={streaming}
              onClick={() => void handleSend()}
            >
              {streaming ? t("knowledgeNetwork.copilotSending") : t("knowledgeNetwork.copilotSend")}
            </AppButton>
            <AppButton
              icon={<ThunderboltOutlined />}
              loading={analyzing}
              onClick={() => void handleGenerate()}
              type="primary"
            >
              {analyzing
                ? t("knowledgeNetwork.copilotGenerating")
                : t("knowledgeNetwork.copilotGenerate")}
            </AppButton>
          </div>
        </section>

        <CopilotModelSettingsModal onClose={() => setSettingsOpen(false)} open={settingsOpen} />

        <Modal
          destroyOnHidden
          footer={null}
          onCancel={() => setBasePickerOpen(false)}
          open={basePickerOpen}
          style={{ top: 120 }}
          title={t("knowledgeNetwork.copilotBaseTitle")}
          width={520}
        >
          <div className={styles.basePickerBody}>
            <Select
              loading={baseNetworksLoading}
              notFoundContent={baseNetworksLoading ? null : t("knowledgeNetwork.copilotBaseEmpty")}
              onChange={(value: string) => setBaseNetworkId(value)}
              options={baseNetworks.map((item) => ({ label: item.name, value: item.id }))}
              placeholder={t("knowledgeNetwork.copilotBasePlaceholder")}
              style={{ width: "100%" }}
              value={baseNetworkId ?? undefined}
            />
            <div className={styles.hint}>{t("knowledgeNetwork.copilotBaseHint")}</div>
            <div className={styles.basePickerActions}>
              <AppButton onClick={() => setBasePickerOpen(false)}>
                {t("knowledgeNetwork.copilotBaseCancel")}
              </AppButton>
              <AppButton
                disabled={!baseNetworkId}
                loading={baseLoading}
                onClick={() => void handleLoadBase()}
                type="primary"
              >
                {baseLoading
                  ? t("knowledgeNetwork.copilotBaseLoading")
                  : t("knowledgeNetwork.copilotBaseLoad")}
              </AppButton>
            </div>
          </div>
        </Modal>

        <Modal
          destroyOnHidden
          footer={null}
          onCancel={() => setGraphFullscreen(false)}
          open={graphFullscreen}
          style={{ top: 16 }}
          title={draft?.networkName ?? t("knowledgeNetwork.copilotViewGraph")}
          width="94vw"
        >
          {draft ? <OntologyGraph height={700} ir={draft} width={1400} /> : null}
        </Modal>

        <Modal
          destroyOnHidden
          footer={null}
          onCancel={() => setIntrospectOpen(false)}
          open={introspectOpen}
          style={{ top: 100 }}
          title={t("knowledgeNetwork.copilotIntrospectTitle")}
          width={520}
        >
          <div className={styles.introspectBody}>
            <div className={styles.introspectHint}>
              {t("knowledgeNetwork.copilotIntrospectHint")}
            </div>
            <div className={styles.introspectRow}>
              <Select
                onChange={(value: "mysql" | "postgres") =>
                  setIntrospectForm((prev) => ({
                    ...prev,
                    dialect: value,
                    port: value === "mysql" ? 3306 : 5432,
                  }))
                }
                options={[
                  { label: "MySQL / MariaDB", value: "mysql" },
                  { label: "PostgreSQL", value: "postgres" },
                ]}
                value={introspectForm.dialect}
              />
              <Input
                onChange={(event) =>
                  setIntrospectForm((prev) => ({ ...prev, host: event.target.value }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectHost")}
                value={introspectForm.host}
              />
              <Input
                onChange={(event) =>
                  setIntrospectForm((prev) => ({
                    ...prev,
                    port: Number(event.target.value) || undefined,
                  }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectPort")}
                style={{ width: 96 }}
                value={introspectForm.port ?? ""}
              />
            </div>
            <div className={styles.introspectRow}>
              <Input
                onChange={(event) =>
                  setIntrospectForm((prev) => ({ ...prev, database: event.target.value }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectDatabase")}
                value={introspectForm.database}
              />
              <Input
                onChange={(event) =>
                  setIntrospectForm((prev) => ({ ...prev, schema: event.target.value }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectSchema")}
                value={introspectForm.schema ?? ""}
              />
            </div>
            <div className={styles.introspectRow}>
              <Input
                onChange={(event) =>
                  setIntrospectForm((prev) => ({ ...prev, user: event.target.value }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectUser")}
                value={introspectForm.user}
              />
              <Input.Password
                onChange={(event) =>
                  setIntrospectForm((prev) => ({ ...prev, password: event.target.value }))
                }
                placeholder={t("knowledgeNetwork.copilotIntrospectPassword")}
                value={introspectForm.password}
              />
            </div>
            {introspectMessage ? (
              <div className={styles.introspectOk}>{introspectMessage}</div>
            ) : null}
            {introspectError ? (
              <div className={styles.introspectError}>{introspectError}</div>
            ) : null}
            <div className={styles.introspectAttachRow}>
              <Checkbox
                checked={autoAttach}
                onChange={(event) => setAutoAttach(event.target.checked)}
              >
                {t("knowledgeNetwork.copilotAutoAttach")}
              </Checkbox>
            </div>
            {autoAttach ? (
              <div className={styles.introspectAttachRow}>
                <Checkbox
                  checked={autoAlignViews}
                  onChange={(event) => setAutoAlignViews(event.target.checked)}
                >
                  {t("knowledgeNetwork.copilotAlignViews")}
                </Checkbox>
              </div>
            ) : null}
            <div className={styles.introspectActions}>
              <AppButton onClick={() => setIntrospectOpen(false)}>
                {t("knowledgeNetwork.copilotIntrospectCancel")}
              </AppButton>
              <AppButton loading={introspectTesting} onClick={() => void handleIntrospectTest()}>
                {t("knowledgeNetwork.copilotIntrospectTest")}
              </AppButton>
              <AppButton
                loading={introspectBusy}
                onClick={() => void handleIntrospectRun()}
                type="primary"
              >
                {t("knowledgeNetwork.copilotIntrospectRun")}
              </AppButton>
            </div>
          </div>
        </Modal>

        <Modal
          destroyOnHidden
          footer={null}
          onCancel={() => setIngestionOpen(false)}
          open={ingestionOpen}
          style={{ top: 120 }}
          title={t("knowledgeNetwork.copilotIngestionTitle")}
          width={520}
        >
          <div className={styles.introspectBody}>
            <div className={styles.introspectHint}>
              {t("knowledgeNetwork.copilotIngestionHint")}
            </div>
            {ingestionSpace ? (
              <div className={styles.introspectHint}>
                {t("knowledgeNetwork.copilotIngestionSpace", { name: ingestionSpace })}
              </div>
            ) : null}
            <div className={styles.introspectRow}>
              <Select
                loading={ingestionLoading}
                onChange={(value: string) => setIngestionDatasetId(value)}
                options={ingestionDatasets.map((item) => ({
                  label: `${item.name}（${item.recordCount} 条记录）`,
                  value: item.id,
                }))}
                placeholder={t("knowledgeNetwork.copilotIngestionSelect")}
                style={{ width: "100%" }}
                value={ingestionDatasetId || undefined}
              />
            </div>
            {!ingestionLoading && ingestionDatasets.length === 0 ? (
              <div className={styles.introspectHint}>
                {t("knowledgeNetwork.copilotIngestionEmpty")}
              </div>
            ) : null}
            {ingestionError ? <div className={styles.introspectError}>{ingestionError}</div> : null}
            <div className={styles.introspectActions}>
              <AppButton onClick={() => setIngestionOpen(false)}>
                {t("knowledgeNetwork.copilotIntrospectCancel")}
              </AppButton>
              <AppButton
                disabled={!ingestionDatasetId}
                loading={ingestionBusy}
                onClick={() => void handleIngestionGenerate()}
                type="primary"
              >
                {t("knowledgeNetwork.copilotIngestionRun")}
              </AppButton>
            </div>
          </div>
        </Modal>
      </div>
    </Drawer>
  );
}
