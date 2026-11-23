/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { DownloadOutlined, ExpandOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/framework/ui/common/AppButton";
import type {
  CopilotIr,
  CopilotIrRelation,
} from "@/modules/knowledge-network/services/ontology-copilot.service";

import styles from "./OntologyGraph.module.css";

/** 画布上的节点（对象类型）。 */
type GraphNode = {
  id: string;
  name: string;
  properties: number;
  evidence: number;
  x: number;
  y: number;
};

/** 画布上的边（关系类型）。 */
type GraphEdge = {
  id: string;
  name: string;
  source: string;
  target: string;
  mapping?: CopilotIrRelation["mapping"];
};

const ITERATIONS = 360;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.4;

/** 按画布尺寸取节点尺寸与字号，抽屉里紧凑、全屏时放大。 */
function nodeMetrics(width: number) {
  if (width < 700) {
    return { nodeWidth: 132, nodeHeight: 40, nameFont: 12, metaFont: 10, edgeFont: 10 };
  }
  if (width < 1000) {
    return { nodeWidth: 152, nodeHeight: 44, nameFont: 13, metaFont: 11, edgeFont: 11 };
  }
  return { nodeWidth: 176, nodeHeight: 50, nameFont: 15, metaFont: 12, edgeFont: 12 };
}

/**
 * 省略号截断，避免长中文名把节点撑爆。
 */
function ellipsis(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 简易力导向布局（斥力 + 弹簧 + 向心），确定性初始化保证同一份草案每次布局一致。
 */
function layout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): void {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.34;
  const count = Math.max(1, nodes.length);
  nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    node.x = centerX + Math.cos(angle) * radius;
    node.y = centerY + Math.sin(angle) * radius;
  });
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const positions = nodes.map((node) => ({ x: node.x, y: node.y }));

  for (let step = 0; step < ITERATIONS; step += 1) {
    const displacement = positions.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        let dx = positions[i].x - positions[j].x;
        let dy = positions[i].y - positions[j].y;
        if (dx === 0 && dy === 0) {
          dx = i % 2 === 0 ? 0.5 : -0.5;
          dy = j % 2 === 0 ? 0.5 : -0.5;
        }
        const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = 14000 / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        displacement[i].x += fx;
        displacement[i].y += fy;
        displacement[j].x -= fx;
        displacement[j].y -= fy;
      }
    }

    for (const edge of edges) {
      const sourceIndex = indexById.get(edge.source);
      const targetIndex = indexById.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) {
        continue;
      }
      const from = positions[sourceIndex];
      const to = positions[targetIndex];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (distance - 165) * 0.05;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      displacement[sourceIndex].x += fx;
      displacement[sourceIndex].y += fy;
      displacement[targetIndex].x -= fx;
      displacement[targetIndex].y -= fy;
    }

    positions.forEach((position, index) => {
      displacement[index].x += (centerX - position.x) * 0.01;
      displacement[index].y += (centerY - position.y) * 0.01;
      const length = Math.sqrt(
        displacement[index].x * displacement[index].x +
          displacement[index].y * displacement[index].y,
      );
      if (length === 0) {
        return;
      }
      const stepSize = Math.min(26, length);
      position.x += (displacement[index].x / length) * stepSize;
      position.y += (displacement[index].y / length) * stepSize;
      position.x = Math.max(24, Math.min(width - 24, position.x));
      position.y = Math.max(24, Math.min(height - 24, position.y));
    });
  }

  nodes.forEach((node, index) => {
    node.x = positions[index].x;
    node.y = positions[index].y;
  });
}

/**
 * 把布局结果按画布尺寸等比放大填充，避免全屏时图形挤在中间。
 */
function fitToCanvas(
  nodes: GraphNode[],
  width: number,
  height: number,
  nodeWidth: number,
  nodeHeight: number,
): void {
  if (nodes.length === 0) {
    return;
  }
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const padX = 28 + nodeWidth / 2;
  const padY = 26 + nodeHeight / 2;
  const availableX = Math.max(80, width - padX * 2);
  const availableY = Math.max(60, height - padY * 2);
  const scale = Math.min(1.7, Math.min(availableX / spanX, availableY / spanY));
  if (!Number.isFinite(scale) || scale <= 0) {
    return;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  nodes.forEach((node) => {
    node.x = width / 2 + (node.x - centerX) * scale;
    node.y = height / 2 + (node.y - centerY) * scale;
  });
}

type OntologyGraphProps = {
  ir: CopilotIr;
  /** 画布高度（viewBox 高度）。 */
  height?: number;
  /** 画布宽度（viewBox 宽度）。 */
  width?: number;
  /** 传入后显示「全屏」按钮。 */
  onFullscreen?: () => void;
};

/**
 * 草案关系图：对象类型为节点、关系类型为带方向的边，支持缩放/平移/选中与导出图片。
 */
export function OntologyGraph({ ir, height = 360, width = 480, onFullscreen }: OntologyGraphProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const metrics = useMemo(() => nodeMetrics(width), [width]);
  const groups = useMemo(() => ir.conceptGroups ?? [], [ir.conceptGroups]);

  const visibleIds = useMemo(() => {
    if (group === "all") {
      return null;
    }
    const target = groups.find((item) => item.id === group);
    return target ? new Set(target.objectTypes) : null;
  }, [group, groups]);

  const nodes = useMemo<GraphNode[]>(
    () =>
      ir.objectTypes
        .filter((object) => !visibleIds || visibleIds.has(object.id))
        .map((object) => ({
          id: object.id,
          name: object.name,
          properties: object.properties.length,
          evidence: object.evidence?.length ?? 0,
          x: 0,
          y: 0,
        })),
    [ir.objectTypes, visibleIds],
  );

  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);

  const edges = useMemo<GraphEdge[]>(
    () =>
      ir.relations
        .filter((relation) => nodeIds.has(relation.source) && nodeIds.has(relation.target))
        .map((relation) => ({
          id: relation.id,
          name: relation.name,
          source: relation.source,
          target: relation.target,
          mapping: relation.mapping,
        })),
    [ir.relations, nodeIds],
  );

  const positioned = useMemo(() => {
    const copies = nodes.map((node) => ({ ...node }));
    layout(copies, edges, width, height);
    fitToCanvas(copies, width, height, metrics.nodeWidth, metrics.nodeHeight);
    return copies;
  }, [nodes, edges, width, height, metrics.nodeHeight, metrics.nodeWidth]);

  const nodeById = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);

  const highlightedEdges = useMemo(() => {
    if (!selectedNode) {
      return new Set<string>();
    }
    return new Set(
      edges
        .filter((edge) => edge.source === selectedNode || edge.target === selectedNode)
        .map((edge) => edge.id),
    );
  }, [edges, selectedNode]);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    setZoom((current) => {
      const next = current + (event.deltaY > 0 ? -0.08 : 0.08);
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });
  }, []);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) {
      return;
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as Element;
    if (target.closest("[data-graph-node]") || target.closest("[data-graph-edge]")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width === 0 ? 1 : width / rect.width;
    setPan({
      x: drag.panX + (event.clientX - drag.x) * ratio,
      y: drag.panY + (event.clientY - drag.y) * ratio,
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const exportPng = () => {
    const element = svgRef.current;
    if (!element) {
      return;
    }
    const clone = element.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const data = new XMLSerializer().serializeToString(clone);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a");
      link.download = `${ir.networkName || "ontology-graph"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  };

  const selectedNodeData = selectedNode ? nodeById.get(selectedNode) : undefined;
  const selectedEdgeData = selectedEdge
    ? edges.find((edge) => edge.id === selectedEdge)
    : undefined;
  const infoText = selectedNodeData
    ? t("knowledgeNetwork.copilotGraphNodeInfo", {
        name: selectedNodeData.name,
        properties: selectedNodeData.properties,
        evidence: selectedNodeData.evidence,
      })
    : selectedEdgeData
      ? t("knowledgeNetwork.copilotGraphEdgeInfo", {
          name: selectedEdgeData.name,
          source: nodeById.get(selectedEdgeData.source)?.name ?? selectedEdgeData.source,
          target: nodeById.get(selectedEdgeData.target)?.name ?? selectedEdgeData.target,
        })
      : t("knowledgeNetwork.copilotGraphHint");

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        {groups.length > 0 ? (
          <select
            className={styles.groupSelect}
            onChange={(event) => {
              setGroup(event.target.value);
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
            value={group}
          >
            <option value="all">{t("knowledgeNetwork.copilotGraphGroupAll")}</option>
            {groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        <div className={styles.toolbarActions}>
          <AppButton icon={<DownloadOutlined />} onClick={exportPng} size="small" type="text">
            {t("knowledgeNetwork.copilotGraphExport")}
          </AppButton>
          {onFullscreen ? (
            <AppButton icon={<ExpandOutlined />} onClick={onFullscreen} size="small" type="text">
              {t("knowledgeNetwork.copilotGraphFullscreen")}
            </AppButton>
          ) : null}
        </div>
      </div>

      {positioned.length === 0 ? (
        <div className={styles.empty}>{t("knowledgeNetwork.copilotGraphEmpty")}</div>
      ) : (
        <svg
          className={styles.canvas}
          data-testid="ontology-graph"
          height={height}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          <defs>
            <marker
              id="og-arrow"
              markerHeight="7"
              markerWidth="7"
              orient="auto-start-reverse"
              refX="9"
              refY="5"
              viewBox="0 0 10 10"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9aa4b5" />
            </marker>
            <marker
              id="og-arrow-active"
              markerHeight="7"
              markerWidth="7"
              orient="auto-start-reverse"
              refX="9"
              refY="5"
              viewBox="0 0 10 10"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2f6fed" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {edges.map((edge) => {
              const from = nodeById.get(edge.source);
              const to = nodeById.get(edge.target);
              if (!from || !to) {
                return null;
              }
              const active = highlightedEdges.has(edge.id) || selectedEdge === edge.id;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / length;
              const uy = dy / length;
              const offsetX = (ux * metrics.nodeWidth) / 2;
              const offsetY = (uy * metrics.nodeHeight) / 2;
              const x1 = from.x + offsetX;
              const y1 = from.y + offsetY;
              const x2 = to.x - offsetX;
              const y2 = to.y - offsetY;
              return (
                <g
                  className={active ? styles.edgeActive : styles.edge}
                  data-graph-edge
                  key={edge.id}
                  onClick={() => {
                    setSelectedEdge(edge.id);
                    setSelectedNode(null);
                  }}
                >
                  <line
                    markerEnd={active ? "url(#og-arrow-active)" : "url(#og-arrow)"}
                    x1={x1}
                    x2={x2}
                    y1={y1}
                    y2={y2}
                  />
                  <text
                    className={styles.edgeLabel}
                    style={{ fontSize: metrics.edgeFont }}
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 5}
                  >
                    {ellipsis(edge.name, 8)}
                  </text>
                </g>
              );
            })}
            {positioned.map((node) => {
              const active = selectedNode === node.id;
              return (
                <g
                  className={active ? styles.nodeActive : styles.node}
                  data-graph-node
                  key={node.id}
                  onClick={() => {
                    setSelectedNode(node.id);
                    setSelectedEdge(null);
                  }}
                >
                  <rect
                    height={metrics.nodeHeight}
                    rx={10}
                    width={metrics.nodeWidth}
                    x={node.x - metrics.nodeWidth / 2}
                    y={node.y - metrics.nodeHeight / 2}
                  />
                  <text
                    className={styles.nodeName}
                    style={{ fontSize: metrics.nameFont }}
                    x={node.x}
                    y={node.y - 3}
                  >
                    {ellipsis(node.name, 10)}
                  </text>
                  <text
                    className={styles.nodeMeta}
                    style={{ fontSize: metrics.metaFont }}
                    x={node.x}
                    y={node.y + metrics.metaFont + 7}
                  >
                    {t("knowledgeNetwork.copilotGraphNodeMeta", { count: node.properties })}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}

      <div className={styles.info}>{infoText}</div>
    </div>
  );
}
