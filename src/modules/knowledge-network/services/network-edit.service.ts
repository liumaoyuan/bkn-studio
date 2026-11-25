import { getStoredAccessToken } from "@/framework/auth/token-store";

export type NetworkEditOp =
  | { op: "rename_object_type"; objectTypeId: string; newName: string }
  | {
      op: "add_property";
      objectTypeId: string;
      name: string;
      displayName?: string;
      type?: string;
      description?: string;
    }
  | {
      op: "update_property";
      objectTypeId: string;
      propertyName: string;
      displayName?: string;
      description?: string;
    }
  | {
      op: "add_object_type";
      id: string;
      name: string;
      primaryKey?: string;
      properties?: { name: string; displayName?: string; type?: string }[];
    }
  | {
      op: "add_relation_type";
      id: string;
      name: string;
      sourceObjectTypeId: string;
      targetObjectTypeId: string;
      sourceProperty: string;
      targetProperty: string;
    }
  | {
      op: "add_action_type";
      id: string;
      name: string;
      actionType: "add" | "modify" | "delete";
      objectTypeId: string;
    };

export type NetworkEditPlan = {
  reply: string;
  ops: NetworkEditOp[];
  warnings: string[];
};

export type NetworkEditAppliedItem = {
  op: NetworkEditOp;
  ok: boolean;
  error?: string;
  detail?: string;
};

export type NetworkEditResult = {
  applied: NetworkEditAppliedItem[];
  snapshotId?: string;
  warnings: string[];
};

function authHeaders(): Record<string, string> {
  const token = getStoredAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "")
        : "";
    throw new Error(message || `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export async function getNetworkSchema(networkId: string): Promise<string> {
  const payload = await requestJson<{ schema?: string }>(
    `/api/copilot/network/${encodeURIComponent(networkId)}/schema`,
    { method: "GET" },
  );
  return payload.schema ?? "";
}

export async function planNetworkChange(
  networkId: string,
  message: string,
): Promise<NetworkEditPlan> {
  const payload = await requestJson<{ plan?: NetworkEditPlan }>(
    `/api/copilot/network/${encodeURIComponent(networkId)}/plan`,
    { method: "POST", body: JSON.stringify({ message }) },
  );
  if (!payload.plan) throw new Error("服务没有返回变更计划");
  return payload.plan;
}

export async function applyNetworkChange(
  networkId: string,
  ops: NetworkEditOp[],
): Promise<NetworkEditResult> {
  const payload = await requestJson<{ result?: NetworkEditResult }>(
    `/api/copilot/network/${encodeURIComponent(networkId)}/apply`,
    { method: "POST", body: JSON.stringify({ ops }) },
  );
  if (!payload.result) throw new Error("服务没有返回执行结果");
  return payload.result;
}

export async function rollbackNetworkChange(
  networkId: string,
  snapshotId: string,
): Promise<{ restored: string[]; warnings: string[] }> {
  const payload = await requestJson<{ result?: { restored: string[]; warnings: string[] } }>(
    `/api/copilot/network/${encodeURIComponent(networkId)}/rollback`,
    { method: "POST", body: JSON.stringify({ snapshotId }) },
  );
  return payload.result ?? { restored: [], warnings: [] };
}

export function describeOp(op: NetworkEditOp): string {
  switch (op.op) {
    case "rename_object_type":
      return `改名：对象类 ${op.objectTypeId} → ${op.newName}`;
    case "add_property":
      return `加属性：${op.objectTypeId}.${op.name}（${op.displayName ?? op.name}）`;
    case "update_property":
      return `改属性：${op.objectTypeId}.${op.propertyName} → ${op.displayName ?? ""}`;
    case "add_object_type":
      return `新增对象类：${op.name}（${op.id}）`;
    case "add_relation_type":
      return `新增关系：${op.name}（${op.sourceObjectTypeId}.${op.sourceProperty} → ${op.targetObjectTypeId}.${op.targetProperty}）`;
    case "add_action_type":
      return `新增行动：${op.name}（绑定 ${op.objectTypeId}）`;
    default:
      return "未知操作";
  }
}

export type NetworkEditStep = {
  id: string;
  status: "running" | "done";
  label?: string;
  detail?: string;
  error?: string;
  index?: number;
  total?: number;
};

async function readStepStream(
  response: Response,
  onStep?: (step: NetworkEditStep) => void,
): Promise<Record<string, unknown> | null> {
  if (!response.ok || !response.body) {
    throw new Error(`请求失败（HTTP ${response.status}）`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Record<string, unknown> | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === "step") {
        onStep?.(event as unknown as NetworkEditStep);
      } else if (event.type === "result") {
        if (event.ok) {
          result = event;
        } else {
          throw new Error(String(event.error ?? "变更失败"));
        }
      }
    }
  }
  return result;
}

export async function planNetworkChangeStream(
  networkId: string,
  message: string,
  onStep?: (step: NetworkEditStep) => void,
): Promise<NetworkEditPlan> {
  const response = await fetch(
    `/api/copilot/network/${encodeURIComponent(networkId)}/plan/stream`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message }),
    },
  );
  const payload = await readStepStream(response, onStep);
  const plan = payload?.plan as NetworkEditPlan | undefined;
  if (!plan) throw new Error("服务没有返回变更计划");
  return plan;
}

export async function applyNetworkChangeStream(
  networkId: string,
  ops: NetworkEditOp[],
  onStep?: (step: NetworkEditStep) => void,
): Promise<NetworkEditResult> {
  const response = await fetch(
    `/api/copilot/network/${encodeURIComponent(networkId)}/apply/stream`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ ops }),
    },
  );
  const payload = await readStepStream(response, onStep);
  const result = payload?.result as NetworkEditResult | undefined;
  if (!result) throw new Error("服务没有返回执行结果");
  return result;
}
