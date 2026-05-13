"use client";

import { useEffect, useState } from "react";
import { ReferenceArea } from "recharts";

/**
 * Hook that turns any Recharts time-series chart into a click-and-drag
 * date-range selector.
 *
 * Spread `chartProps` onto your `<LineChart>` / `<AreaChart>` /
 * `<BarChart>`, render `selectionOverlay()` inside it, and pass
 * `onSelect(from, to)` to receive the sorted-ascending day pair.
 *
 * Behavior:
 *  - mousedown on a data point records the left bound
 *  - mousemove with the button held records the right bound and shows
 *    a translucent <ReferenceArea> across the selection
 *  - mouseup with a non-empty range fires onSelect and clears the overlay
 *  - leaving the chart while dragging cancels (no half-selections)
 *  - document-wide user-select is disabled during drag so the browser
 *    doesn't grey-highlight surrounding text
 *
 * Chart data must have a `day` field whose values are sortable strings —
 * YYYY-MM-DD works as-is.
 */
export function useChartDateBrush(onSelect: (from: string, to: string) => void) {
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const isDragging = left != null;

  const reset = () => {
    setLeft(null);
    setRight(null);
  };

  // Suppress text selection at the document level for the duration of
  // the drag — without this the browser greys-out anything within the
  // mouse sweep (chart axis labels, surrounding panel headings, etc.).
  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isDragging]);

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
        const [from, to] = [left, right].sort();
        onSelect(from, to);
      }
      reset();
    },
    onMouseLeave: reset,
    style: {
      cursor: "crosshair",
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

  return { chartProps, selectionOverlay };
}
