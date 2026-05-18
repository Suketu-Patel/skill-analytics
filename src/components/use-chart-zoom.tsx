"use client";

import { useEffect, useMemo, useState } from "react";
import { ReferenceArea } from "recharts";

/**
 * Drag-on-chart zoom for categorical Recharts charts.
 *
 * Same interaction as Cost/Timeline's date brush, but adapted for
 * non-date X axes (token-band strings, hour-of-day strings, anything
 * sortable by position in the source array). Hold mouse down on the
 * chart, drag across the region you want to zoom into, release. The
 * chart re-renders with only the sliced subset. A small "reset" pill
 * appears in the panel header while zoomed.
 *
 * Usage:
 *   const { zoomedData, chartProps, selectionOverlay, isZoomed, reset } =
 *     useChartZoom(rawData, "band");
 *   <LineChart data={zoomedData} {...chartProps}> ... {selectionOverlay()} </LineChart>
 *
 * The X axis values must be strings (use String() or padStart). The hook
 * slices by index of the first/last match in the source array, so the
 * slice respects the natural order the caller passed in (no sort).
 */
export function useChartZoom<T extends Record<string, unknown>>(
  data: T[],
  xKey: keyof T & string
) {
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<{ from: string; to: string } | null>(null);
  const isDragging = left != null;

  const reset = () => {
    setLeft(null);
    setRight(null);
  };
  const clearZoom = () => setZoomRange(null);

  // Suppress text selection while dragging so the browser doesn't
  // grey-highlight surrounding labels/panels.
  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isDragging]);

  const zoomedData = useMemo(() => {
    if (!zoomRange) return data;
    const i1 = data.findIndex((d) => String(d[xKey]) === zoomRange.from);
    const i2 = data.findIndex((d) => String(d[xKey]) === zoomRange.to);
    if (i1 === -1 || i2 === -1) return data;
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    return data.slice(lo, hi + 1);
  }, [data, xKey, zoomRange]);

  const chartProps = {
    onMouseDown: (e: { activeLabel?: string } | null) => {
      const lab = e?.activeLabel;
      if (typeof lab === "string" && lab) {
        setLeft(lab);
        setRight(lab);
      }
    },
    onMouseMove: (e: { activeLabel?: string } | null) => {
      if (left == null) return;
      const lab = e?.activeLabel;
      if (typeof lab === "string" && lab) setRight(lab);
    },
    onMouseUp: () => {
      if (left != null && right != null && left !== right) {
        // Order by index in the (already-zoomed) chart, not lexically —
        // "08" < "21" works fine for hours, but token bands like
        // "0-2K" sort weirdly. Index-based ordering is always correct.
        const indexIn = (label: string) =>
          zoomedData.findIndex((d) => String(d[xKey]) === label);
        const li = indexIn(left);
        const ri = indexIn(right);
        const [from, to] = li <= ri ? [left, right] : [right, left];
        setZoomRange({ from, to });
      }
      reset();
    },
    onMouseLeave: reset,
    style: {
      cursor: zoomRange ? "zoom-out" : "crosshair",
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
  };

  const selectionOverlay = () =>
    left && right && left !== right ? (
      <ReferenceArea
        x1={left}
        x2={right}
        strokeOpacity={0.3}
        fill="#0f8f8a"
        fillOpacity={0.15}
      />
    ) : null;

  return {
    zoomedData,
    chartProps,
    selectionOverlay,
    isZoomed: zoomRange != null,
    zoomRange,
    reset: clearZoom,
  };
}

/**
 * Tiny pill button that shows the current zoom range and clears it on
 * click. Drop this into the PanelHeader `right` slot when zoomed.
 */
export function ZoomBadge({
  from,
  to,
  onClear,
}: {
  from: string;
  to: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      title="Reset zoom"
      className="inline-flex items-center gap-1.5 rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal hover:bg-teal/20"
    >
      <span className="tabular-nums">
        zoomed {from} → {to}
      </span>
      <span className="text-teal/70">✕</span>
    </button>
  );
}
