/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  DataIngestionAgentManifest,
  DataIngestionPipelineRunResult,
  DataIngestionPipelineTemplate,
} from "@/modules/data-ingestion/types/data-ingestion";

const { Text } = Typography;
const INPUT_REFERENCE_PATTERN = /\$\{inputs\.([A-Za-z0-9_-]+)/g;
const REFERENCE_PATTERN = /^\$\{[^{}]+\}$/;
const META_PIPELINE_TOOLS = new Set(["create_ingestion_pipeline", "run_user_pipeline"]);
type McpTool = DataIngestionAgentManifest["tools"][number];
type ToolArgument = NonNullable<McpTool["arguments"]>[number];

interface BuilderStep {
  key: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  customParameters: string;
}

interface PipelineDraft {
  code: string;
  name: string;
  description: string;
  supportedTypes: string[];
  steps: BuilderStep[];
}

const EMPTY_DRAFT: PipelineDraft = {
  code: "user-",
  name: "",
  description: "",
  supportedTypes: ["csv", "excel"],
  steps: [],
};

function textValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function parseParameterValue(argument: ToolArgument, raw: string) {
  const value = raw.trim();
  if (!value) {
    return { present: false, value: undefined };
  }
  if (REFERENCE_PATTERN.test(value)) {
    return { present: true, value: raw };
  }
  if (argument.type === "boolean") {
    if (value !== "true" && value !== "false") {
      throw new Error(`${argument.name} must be true or false`);
    }
    return { present: true, value: value === "true" };
  }
  if (argument.type === "integer") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${argument.name} must be an integer`);
    }
    return { present: true, value: parsed };
  }
  if (argument.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${argument.name} must be a number`);
    }
    return { present: true, value: parsed };
  }
  if (argument.type === "object" || argument.type === "array") {
    const parsed: unknown = JSON.parse(value);
    return { present: true, value: parsed };
  }
  return { present: true, value: raw };
}

function collectInputReferences(template: DataIngestionPipelineTemplate) {
  const names = new Set<string>();
  for (const step of template.steps) {
    const serialized = JSON.stringify(step.parameters ?? {});
    for (const match of serialized.matchAll(INPUT_REFERENCE_PATTERN)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function nextStepKey(steps: BuilderStep[]) {
  const used = new Set(steps.map((step) => step.key));
  let index = 1;
  while (used.has(`step-${index}`)) {
    index += 1;
  }
  return `step-${index}`;
}

function defaultParameters(tool: McpTool) {
  return Object.fromEntries(
    (tool.arguments ?? [])
      .filter((argument) => argument.required)
      .map((argument) => [argument.name, `\${inputs.${argument.name}}`]),
  );
}

function toolArguments(tool: McpTool | undefined) {
  return tool?.arguments ?? [];
}

function buildParameters(tool: McpTool, values: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const argument of toolArguments(tool)) {
    const raw = textValue(values[argument.name]);
    const parsed = parseParameterValue(argument, raw);
    if (parsed.present) {
      parameters[argument.name] = parsed.value;
    } else if (argument.required) {
      throw new Error(`${argument.name} is required`);
    }
  }
  return parameters;
}

export function PipelineComposerModal({
  initialTemplate,
  onCancel,
  onSave,
  open,
  saving,
  tools,
}: {
  initialTemplate?: DataIngestionPipelineTemplate | null;
  onCancel: () => void;
  onSave: (payload: {
    code: string;
    name: string;
    description: string;
    supported_types: string[];
    steps: Record<string, unknown>[];
    enabled: boolean;
  }) => void;
  open: boolean;
  saving: boolean;
  tools: McpTool[];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PipelineDraft>(EMPTY_DRAFT);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      if (initialTemplate) {
        setDraft({
          code: initialTemplate.code,
          name: initialTemplate.name,
          description: initialTemplate.description,
          supportedTypes: initialTemplate.supported_types,
          steps: initialTemplate.steps.map((step) => {
            const tool = tools.find((item) => item.name === step.tool_name);
            const knownNames = new Set(toolArguments(tool).map((argument) => argument.name));
            const knownParameters = Object.fromEntries(
              Object.entries(step.parameters ?? {}).filter(([name]) => knownNames.has(name)),
            );
            const customParameters = Object.fromEntries(
              Object.entries(step.parameters ?? {}).filter(([name]) => !knownNames.has(name)),
            );
            return {
              key: step.key,
              tool_name: step.tool_name || "",
              parameters: knownParameters,
              customParameters: JSON.stringify(customParameters, null, 2),
            };
          }),
        });
      } else {
        setDraft(EMPTY_DRAFT);
      }
      setError("");
    }
  }, [initialTemplate, open, tools]);

  const selectableTools = useMemo(
    () => tools.filter((tool) => !META_PIPELINE_TOOLS.has(tool.name)),
    [tools],
  );
  const toolByName = useMemo(() => new Map(tools.map((tool) => [tool.name, tool])), [tools]);

  function addStep(toolName: string) {
    const tool = toolByName.get(toolName);
    if (!tool) {
      return;
    }
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps,
        {
          key: nextStepKey(current.steps),
          tool_name: toolName,
          parameters: defaultParameters(tool),
          customParameters: "{}",
        },
      ],
    }));
  }

  function updateParameter(stepKey: string, name: string, value: string) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.key === stepKey
          ? {
              ...step,
              parameters: {
                ...step.parameters,
                [name]: value,
              },
            }
          : step,
      ),
    }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.steps];
      const target = index + direction;
      if (target < 0 || target >= next.length) {
        return current;
      }
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, steps: next };
    });
  }

  function removeStep(stepKey: string) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.key !== stepKey),
    }));
  }

  function addFileIngestionExample() {
    const inspect = toolByName.get("inspect_local_file");
    const ingest = toolByName.get("ingest_local_file");
    if (!inspect || !ingest) {
      setError(t("dataIngestion.pipelines.fileExampleUnavailable"));
      return;
    }
    setDraft((current) => ({
      ...current,
      code: current.code === "user-" ? "user-file-ingestion" : current.code,
      name: current.name || t("dataIngestion.pipelines.fileExampleName"),
      description: current.description || t("dataIngestion.pipelines.fileExampleDescription"),
      steps: [
        {
          key: "step-1",
          tool_name: "inspect_local_file",
          parameters: { file_path: "${inputs.file_path}" },
          customParameters: "{}",
        },
        {
          key: "step-2",
          tool_name: "ingest_local_file",
          parameters: {
            file_path: "${inputs.file_path}",
            dataset_id: "${inputs.dataset_id}",
            template_code: "${steps.step-1.result.recommended_pipeline}",
          },
          customParameters: "{}",
        },
      ],
    }));
    setError("");
  }

  function submit() {
    setError("");
    if (!/^user-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(draft.code.trim())) {
      setError(t("dataIngestion.pipelines.codeInvalid"));
      return;
    }
    if (!draft.name.trim() || draft.steps.length === 0) {
      setError(t("dataIngestion.pipelines.formInvalidV2"));
      return;
    }
    try {
      const steps = draft.steps.map((step) => {
        const tool = toolByName.get(step.tool_name);
        if (!tool) {
          throw new Error(t("dataIngestion.pipelines.toolUnavailable", { name: step.tool_name }));
        }
        let customParameters: Record<string, unknown> = {};
        if (step.customParameters.trim()) {
          const parsed: unknown = JSON.parse(step.customParameters);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(t("dataIngestion.pipelines.customParametersInvalid"));
          }
          customParameters = parsed as Record<string, unknown>;
        }
        return {
          key: step.key,
          name: tool.display_name || tool.name,
          description: tool.description,
          kind: "mcp_tool",
          tool_name: tool.name,
          parameters: {
            ...buildParameters(tool, step.parameters),
            ...customParameters,
          },
          input:
            step === draft.steps[0]
              ? t("dataIngestion.pipelines.inputFromRun")
              : t("dataIngestion.pipelines.inputFromPrevious"),
          output: tool.returns || t("dataIngestion.pipelines.toolResult"),
          retryable: true,
        };
      });
      onSave({
        code: draft.code.trim(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        supported_types: draft.supportedTypes,
        steps,
        enabled: true,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Modal
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t("dataIngestion.actions.cancel")}
        </Button>,
        <Button key="save" loading={saving} onClick={submit} type="primary">
          {t("dataIngestion.actions.save")}
        </Button>,
      ]}
      onCancel={onCancel}
      open={open}
      title={
        initialTemplate
          ? t("dataIngestion.pipelines.editTitle")
          : t("dataIngestion.pipelines.createTitle")
      }
      width="min(1040px, 96vw)"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          description={
            <Space direction="vertical" size={2}>
              <Text>
                {t("dataIngestion.pipelines.bindingInputHint")}{" "}
                <Text code>{"${inputs.file_path}"}</Text>
              </Text>
              <Text>
                {t("dataIngestion.pipelines.bindingStepHint")}{" "}
                <Text code>{"${steps.step-1.result.dataset_id}"}</Text>
              </Text>
            </Space>
          }
          message={t("dataIngestion.pipelines.dataFlowTitle")}
          showIcon
          type="info"
        />
        {error ? <Alert message={error} showIcon type="error" /> : null}
        <Row gutter={[12, 12]}>
          <Col md={12} xs={24}>
            <Text strong>{t("dataIngestion.pipelines.code")}</Text>
            <Input
              disabled={Boolean(initialTemplate)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, code: event.target.value }))
              }
              placeholder="user-my-pipeline"
              value={draft.code}
            />
          </Col>
          <Col md={12} xs={24}>
            <Text strong>{t("dataIngestion.pipelines.name")}</Text>
            <Input
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              value={draft.name}
            />
          </Col>
          <Col xs={24}>
            <Text strong>{t("dataIngestion.pipelines.descriptionLabel")}</Text>
            <Input
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              value={draft.description}
            />
          </Col>
          <Col xs={24}>
            <Text strong>{t("dataIngestion.pipelines.supportedTypes")}</Text>
            <Select
              mode="tags"
              onChange={(supportedTypes) => setDraft((current) => ({ ...current, supportedTypes }))}
              options={["csv", "excel", "pdf", "document", "image", "video"].map((value) => ({
                label: value.toUpperCase(),
                value,
              }))}
              style={{ width: "100%" }}
              value={draft.supportedTypes}
            />
          </Col>
        </Row>

        <Divider style={{ margin: 0 }} />
        <Space wrap>
          <Select
            onChange={addStep}
            optionFilterProp="label"
            options={selectableTools.map((tool) => ({
              label: `${tool.display_name || tool.name} · ${tool.name}`,
              value: tool.name,
            }))}
            placeholder={t("dataIngestion.pipelines.chooseTool")}
            showSearch
            style={{ minWidth: 360 }}
            value={null}
          />
          <Button onClick={addFileIngestionExample} type="dashed">
            {t("dataIngestion.pipelines.fileExample")}
          </Button>
          <Text type="secondary">{t("dataIngestion.pipelines.fileExampleHint")}</Text>
        </Space>

        {draft.steps.length ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {draft.steps.map((step, index) => {
              const tool = toolByName.get(step.tool_name);
              if (!tool) {
                return null;
              }
              return (
                <Card
                  extra={
                    <Space>
                      <Button
                        disabled={index === 0}
                        icon={<ArrowUpOutlined />}
                        onClick={() => moveStep(index, -1)}
                        size="small"
                      />
                      <Button
                        disabled={index === draft.steps.length - 1}
                        icon={<ArrowDownOutlined />}
                        onClick={() => moveStep(index, 1)}
                        size="small"
                      />
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeStep(step.key)}
                        size="small"
                      />
                    </Space>
                  }
                  key={step.key}
                  size="small"
                  title={`${index + 1}. ${tool.display_name || tool.name}`}
                >
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Space wrap>
                      <Text code>{tool.name}</Text>
                      <Tag color={tool.built_in ? "gold" : "blue"}>
                        {tool.built_in
                          ? t("dataIngestion.agent.builtIn")
                          : t("dataIngestion.agent.userEditable")}
                      </Tag>
                      <Text type="secondary">{tool.description}</Text>
                    </Space>
                    {toolArguments(tool).length ? (
                      <Row gutter={[12, 12]}>
                        {toolArguments(tool).map((argument) => {
                          const previousStep = index > 0 ? draft.steps[index - 1] : null;
                          return (
                            <Col key={argument.name} md={12} xs={24}>
                              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                                <Space wrap>
                                  <Text strong>{argument.name}</Text>
                                  <Tag>{argument.type}</Tag>
                                  {argument.required ? (
                                    <Text type="danger">{t("dataIngestion.agent.required")}</Text>
                                  ) : null}
                                  <Button
                                    onClick={() =>
                                      updateParameter(
                                        step.key,
                                        argument.name,
                                        `\${inputs.${argument.name}}`,
                                      )
                                    }
                                    size="small"
                                    type="link"
                                  >
                                    {t("dataIngestion.pipelines.useRunInput")}
                                  </Button>
                                  {previousStep ? (
                                    <Button
                                      onClick={() =>
                                        updateParameter(
                                          step.key,
                                          argument.name,
                                          `\${steps.${previousStep.key}.result.${argument.name}}`,
                                        )
                                      }
                                      size="small"
                                      type="link"
                                    >
                                      {t("dataIngestion.pipelines.usePreviousResult")}
                                    </Button>
                                  ) : null}
                                </Space>
                                {argument.type === "object" || argument.type === "array" ? (
                                  <Input.TextArea
                                    autoSize={{ minRows: 2, maxRows: 8 }}
                                    onChange={(event) =>
                                      updateParameter(step.key, argument.name, event.target.value)
                                    }
                                    placeholder={argument.type === "object" ? "{}" : "[]"}
                                    value={textValue(step.parameters[argument.name])}
                                  />
                                ) : (
                                  <Input
                                    onChange={(event) =>
                                      updateParameter(step.key, argument.name, event.target.value)
                                    }
                                    placeholder={
                                      argument.type === "boolean"
                                        ? "true / false"
                                        : `\${inputs.${argument.name}}`
                                    }
                                    value={textValue(step.parameters[argument.name])}
                                  />
                                )}
                              </Space>
                            </Col>
                          );
                        })}
                      </Row>
                    ) : (
                      <Text type="secondary">
                        {t("dataIngestion.pipelines.customParametersHint")}
                      </Text>
                    )}
                    {!toolArguments(tool).length ? (
                      <Input.TextArea
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            steps: current.steps.map((item) =>
                              item.key === step.key
                                ? { ...item, customParameters: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        placeholder='{"argument":"${inputs.argument}"}'
                        value={step.customParameters}
                      />
                    ) : null}
                  </Space>
                </Card>
              );
            })}
          </Space>
        ) : (
          <Empty description={t("dataIngestion.pipelines.noSteps")} />
        )}
      </Space>
    </Modal>
  );
}

export function PipelineRunModal({
  onCancel,
  onRun,
  open,
  result,
  running,
  template,
  tools,
}: {
  onCancel: () => void;
  onRun: (
    inputs: Record<string, unknown>,
    stepInputs: Record<string, Record<string, unknown>>,
  ) => void;
  open: boolean;
  result: DataIngestionPipelineRunResult | null;
  running: boolean;
  template: DataIngestionPipelineTemplate | null;
  tools: McpTool[];
}) {
  const { t } = useTranslation();
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [stepValues, setStepValues] = useState<Record<string, Record<string, string>>>({});
  const [rawStepValues, setRawStepValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const toolByName = useMemo(() => new Map(tools.map((tool) => [tool.name, tool])), [tools]);
  const inputNames = useMemo(() => (template ? collectInputReferences(template) : []), [template]);

  useEffect(() => {
    if (open && template) {
      setInputValues({});
      setStepValues({});
      setRawStepValues({});
      setError("");
    }
  }, [open, template]);

  function inputArgument(name: string): ToolArgument {
    for (const step of template?.steps ?? []) {
      const argument = toolArguments(toolByName.get(step.tool_name || "")).find(
        (item) => item.name === name,
      );
      if (argument) {
        return argument;
      }
    }
    return { name, type: "string", required: true };
  }

  function missingRequiredArguments(step: DataIngestionPipelineTemplate["steps"][number]) {
    const tool = toolByName.get(step.tool_name || "");
    return toolArguments(tool).filter(
      (argument) =>
        argument.required &&
        !(step.parameters && Object.prototype.hasOwnProperty.call(step.parameters, argument.name)),
    );
  }

  function submit() {
    if (!template) {
      return;
    }
    setError("");
    try {
      const inputs: Record<string, unknown> = {};
      for (const name of inputNames) {
        const argument = inputArgument(name);
        const parsed = parseParameterValue(argument, inputValues[name] ?? "");
        if (parsed.present) {
          inputs[name] = parsed.value;
        } else if (argument.required) {
          throw new Error(t("dataIngestion.pipelines.runInputRequired", { name }));
        }
      }
      const stepInputs: Record<string, Record<string, unknown>> = {};
      for (const step of template.steps) {
        const tool = toolByName.get(step.tool_name || "");
        const values = stepValues[step.key] ?? {};
        const provided: Record<string, unknown> = {};
        for (const argument of toolArguments(tool)) {
          const parsed = parseParameterValue(argument, values[argument.name] ?? "");
          if (parsed.present) {
            provided[argument.name] = parsed.value;
          } else if (
            argument.required &&
            !Object.prototype.hasOwnProperty.call(step.parameters ?? {}, argument.name)
          ) {
            throw new Error(
              t("dataIngestion.pipelines.stepInputRequired", {
                name: argument.name,
                step: step.name || step.tool_name,
              }),
            );
          }
        }
        const rawArguments = rawStepValues[step.key]?.trim();
        if (rawArguments) {
          const parsed: unknown = JSON.parse(rawArguments);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(t("dataIngestion.pipelines.customParametersInvalid"));
          }
          Object.assign(provided, parsed);
        }
        if (Object.keys(provided).length) {
          stepInputs[step.key] = provided;
        }
      }
      onRun(inputs, stepInputs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Modal
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t("dataIngestion.actions.close")}
        </Button>,
        <Button key="run" loading={running} onClick={submit} type="primary">
          {t("dataIngestion.pipelines.run")}
        </Button>,
      ]}
      onCancel={onCancel}
      open={open}
      title={t("dataIngestion.pipelines.runTitle", { name: template?.name || "" })}
      width="min(960px, 96vw)"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          description={t("dataIngestion.pipelines.runDescription")}
          message={t("dataIngestion.pipelines.runChecklist")}
          showIcon
          type="info"
        />
        {error ? <Alert message={error} showIcon type="error" /> : null}
        {inputNames.length ? (
          <Card size="small" title={t("dataIngestion.pipelines.runInputsForm")}>
            <Row gutter={[12, 12]}>
              {inputNames.map((name) => {
                const argument = inputArgument(name);
                return (
                  <Col key={name} md={12} xs={24}>
                    <Text strong>{name}</Text> <Tag>{argument.type}</Tag>
                    <Input
                      onChange={(event) =>
                        setInputValues((current) => ({
                          ...current,
                          [name]: event.target.value,
                        }))
                      }
                      placeholder={argument.type === "boolean" ? "true / false" : undefined}
                      value={inputValues[name] ?? ""}
                    />
                  </Col>
                );
              })}
            </Row>
          </Card>
        ) : null}
        <Card size="small" title={t("dataIngestion.pipelines.stepPlan")}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {template?.steps.map((step, index) => {
              const tool = toolByName.get(step.tool_name || "");
              const missing = missingRequiredArguments(step);
              const configured = Object.entries(step.parameters ?? {});
              return (
                <Card key={step.key} size="small" title={`${index + 1}. ${step.name}`}>
                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                    <Space wrap>
                      <Text code>{step.tool_name || "-"}</Text>
                      {configured.length ? (
                        configured.map(([name, value]) => (
                          <Tag key={name} color={String(value).includes("${") ? "blue" : "default"}>
                            {name}={textValue(value)}
                          </Tag>
                        ))
                      ) : (
                        <Text type="secondary">
                          {t("dataIngestion.pipelines.noConfiguredParameters")}
                        </Text>
                      )}
                    </Space>
                    {missing.length ? (
                      <Row gutter={[12, 12]}>
                        {missing.map((argument) => (
                          <Col key={argument.name} md={12} xs={24}>
                            <Text strong>{argument.name}</Text> <Tag>{argument.type}</Tag>
                            <Input
                              onChange={(event) =>
                                setStepValues((current) => ({
                                  ...current,
                                  [step.key]: {
                                    ...(current[step.key] ?? {}),
                                    [argument.name]: event.target.value,
                                  },
                                }))
                              }
                              placeholder={t("dataIngestion.pipelines.requiredParameter")}
                              value={stepValues[step.key]?.[argument.name] ?? ""}
                            />
                          </Col>
                        ))}
                      </Row>
                    ) : (
                      <Text type="secondary">
                        {tool
                          ? t("dataIngestion.pipelines.stepReady")
                          : t("dataIngestion.pipelines.toolUnavailable", {
                              name: step.tool_name || "-",
                            })}
                      </Text>
                    )}
                    {!toolArguments(tool).length ? (
                      <Input.TextArea
                        autoSize={{ minRows: 2, maxRows: 8 }}
                        onChange={(event) =>
                          setRawStepValues((current) => ({
                            ...current,
                            [step.key]: event.target.value,
                          }))
                        }
                        placeholder='{"argument":"value"}'
                        value={rawStepValues[step.key] ?? ""}
                      />
                    ) : null}
                  </Space>
                </Card>
              );
            })}
          </Space>
        </Card>
        {result ? (
          <Card
            size="small"
            title={t("dataIngestion.pipelines.executionResult", {
              count: result.results.length,
            })}
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Alert
                message={t("dataIngestion.pipelines.executionSuccess")}
                showIcon
                type="success"
              />
              {result.results.map((item) => (
                <Card
                  key={`${item.step}-${item.key}`}
                  size="small"
                  title={`${item.step}. ${item.tool_name}`}
                >
                  <Text type="secondary">{t("dataIngestion.pipelines.arguments")}</Text>
                  <pre style={{ margin: "4px 0 10px", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(item.arguments ?? {}, null, 2)}
                  </pre>
                  <Text type="secondary">{t("dataIngestion.pipelines.result")}</Text>
                  <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(item.result, null, 2)}
                  </pre>
                </Card>
              ))}
            </Space>
          </Card>
        ) : null}
      </Space>
    </Modal>
  );
}
