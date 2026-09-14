"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 100,
  height = 28,
  color,
  className,
}: SparklineProps) {
  if (data.length < 2) return null;

  const isUp = data[data.length - 1] >= data[0];
  const label = `Sparkline trending ${isUp ? "up" : "down"}`;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const strokeColor = color || (isUp ? "#00d4aa" : "#ff4444");

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });

  const fillPoints = [`0,${height}`, ...points, `${width},${height}`].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <polygon points={fillPoints} fill={strokeColor} fillOpacity={0.1} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
