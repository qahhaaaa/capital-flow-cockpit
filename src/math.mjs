export function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(safeNumber(value) * factor) / factor;
}

export function minMaxScore(value, values, fallback = 50) {
  const clean = values.map((item) => safeNumber(item)).filter((item) => item >= 0);
  if (clean.length === 0) {
    return fallback;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max === min) {
    return fallback;
  }
  return clamp(((safeNumber(value) - min) / (max - min)) * 100);
}

export function average(values) {
  const clean = values.map((item) => safeNumber(item)).filter(Number.isFinite);
  if (clean.length === 0) {
    return 0;
  }
  return clean.reduce((sum, item) => sum + item, 0) / clean.length;
}
