"use client";

import {
  AreaSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

type Point = { time: Time | number; value: number };
type BarPoint = Point & { color?: string };

type Props = {
  type: "area" | "line" | "bar";
  data: Point[] | BarPoint[];
  color: string;
  areaTopColor?: string;
  areaBottomColor?: string;
  height?: number;
  valueFormat?: (value: number) => string;
  className?: string;
};

export function LightweightTimeSeriesChart({
  type,
  data,
  color,
  areaTopColor,
  areaBottomColor,
  height = 208,
  valueFormat,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const options = {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5a6a7a",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1a2332" },
        horzLines: { color: "#1a2332" },
      },
      rightPriceScale: { borderColor: "#1a2332" },
      timeScale: { borderColor: "#1a2332", timeVisible: false, rightOffset: 2 },
      crosshair: {
        vertLine: { color: "#5a6a7a", width: 1 },
        horzLine: { color: "#5a6a7a", width: 1 },
      },
    };
    const chart = createChart(container, options as any);
    const series =
      type === "area"
        ? chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: areaTopColor ?? `${color}55`,
            bottomColor: areaBottomColor ?? `${color}00`,
            lineWidth: 2,
          })
        : type === "bar"
          ? chart.addSeries(HistogramSeries, {
              color,
              priceFormat: {
                type: "custom",
                formatter: valueFormat ?? ((value: number) => value.toFixed(0)),
              },
            })
          : chart.addSeries(LineSeries, {
              color,
              lineWidth: 2,
              priceFormat: valueFormat
                ? { type: "custom", formatter: valueFormat }
                : undefined,
            });

    series.setData(data as never);
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [areaBottomColor, areaTopColor, color, data, height, type, valueFormat]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height }}
      aria-label="Interactive time series chart"
    />
  );
}
