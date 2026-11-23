/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

import { useEffect, useRef, useState } from "react";

import styles from "./VirtualList.module.css";

export type VirtualListProps<T> = {
  items: T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  getKey: (item: T) => string;
  /** 行高（px），用于计算可视窗口。 */
  rowHeight?: number;
  /** 列表最大高度，例如 "26vh"。 */
  maxHeight?: string;
  /** 少于该条数时不虚拟化，直接渲染，便于测试与小数据。 */
  threshold?: number;
};

const OVERSCAN = 4;

/**
 * 轻量虚拟滚动列表：只渲染可视窗口内的行，上方/下方用占位撑开高度。
 * 浏览器里用 ResizeObserver 读取可视高度；jsdom 等无布局环境自动退化为全量渲染。
 */
export function VirtualList<T>({
  items,
  renderRow,
  getKey,
  rowHeight = 34,
  maxHeight = "26vh",
  threshold = 30,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      setViewHeight(element.clientHeight);
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [items.length]);

  const virtualized = viewHeight > 0 && items.length > threshold;
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN) : 0;
  const endIndex = virtualized
    ? Math.min(items.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN)
    : items.length;
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={scrollRef}
      className={styles.scroll}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ maxHeight }}
    >
      <div
        className={styles.inner}
        style={virtualized ? { height: items.length * rowHeight } : undefined}
      >
        {virtualized ? (
          <div style={{ transform: `translateY(${startIndex * rowHeight}px)` }}>
            {visibleItems.map((item, offset) => (
              <div className={styles.row} key={getKey(item)} style={{ height: rowHeight }}>
                {renderRow(item, startIndex + offset)}
              </div>
            ))}
          </div>
        ) : (
          visibleItems.map((item, index) => (
            <div className={styles.row} key={getKey(item)} style={{ height: rowHeight }}>
              {renderRow(item, index)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
