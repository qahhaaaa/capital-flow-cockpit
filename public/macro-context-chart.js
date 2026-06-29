const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 220;
const DEFAULT_MARGIN = { top: 16, right: 16, bottom: 34, left: 42 };
const DEFAULT_COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f778ba", "#a371f7"];

export function buildMacroChartModel(chart, options = {}) {
  const width = Number(options.width ?? DEFAULT_WIDTH);
  const height = Number(options.height ?? DEFAULT_HEIGHT);
  const margin = { ...DEFAULT_MARGIN, ...(options.margin ?? {}) };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  const ticks = collectTicks(chart.series ?? []);
  const values = collectValues(chart.series ?? []);
  const [yMin, yMax] = paddedRange(values);

  const xFor = (label) => {
    const index = ticks.findIndex((tick) => tick.label === label);
    if (ticks.length <= 1) return margin.left + plotWidth / 2;
    return margin.left + (Math.max(0, index) / (ticks.length - 1)) * plotWidth;
  };
  const yFor = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;

  return {
    width,
    height,
    margin,
    yMin,
    yMax,
    ticks: ticks.map((tick) => ({ ...tick, x: round(xFor(tick.label)) })),
    series: (chart.series ?? []).map((series, index) => {
      const points = (series.points ?? [])
        .filter((point) => Number.isFinite(point.v))
        .map((point) => ({
          t: String(point.t),
          v: point.v,
          x: round(xFor(String(point.t))),
          y: round(yFor(point.v)),
          estimate: point.estimate === true,
          disputed: point.disputed === true,
        }));
      return {
        label: String(series.label ?? ""),
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        path: pointsToPath(points),
        points,
      };
    }),
  };
}

// Parse heterogeneous tick labels (YYYY-MM / YYYY[E] / QxYY[E]) to a comparable month index.
// Needed because first-appearance order mis-orders interleaved series (ai-arr), and pure
// lexical order mis-orders quarters (3Q25 vs 1Q26).
function tickKey(label) {
  let m = /^(\d{4})-(\d{1,2})/.exec(label);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  m = /^([1-4])Q(\d{2})/.exec(label);
  if (m) return (2000 + Number(m[2])) * 12 + (Number(m[1]) - 1) * 3;
  m = /^(\d{4})/.exec(label);
  if (m) return Number(m[1]) * 12;
  return Number.MAX_SAFE_INTEGER;
}

function collectTicks(seriesList) {
  const seen = new Set();
  const ticks = [];
  for (const series of seriesList) {
    for (const point of series.points ?? []) {
      const label = String(point.t ?? "");
      if (!label || seen.has(label)) continue;
      seen.add(label);
      ticks.push({ label });
    }
  }
  return ticks.sort((a, b) => tickKey(a.label) - tickKey(b.label));
}

function collectValues(seriesList) {
  return seriesList.flatMap((series) => (series.points ?? [])
    .map((point) => point.v)
    .filter((value) => Number.isFinite(value)));
}

function paddedRange(values) {
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

function pointsToPath(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function round(value) {
  return Math.round(value * 100) / 100;
}