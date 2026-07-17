import type { PortfolioPoint, Timeframe } from "@/lib/api"

export type MetricPoint = PortfolioPoint & {
  index: number
  label: string
  accum: number
  highWaterMark: number
  drawdown: number
  maxDrawdown: number
}

const timeframeMilliseconds: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
}

export function deriveMetricSeries(points: PortfolioPoint[]) {
  let equity = 1
  let peak = 1
  let maxDrawdown = 0

  return points.map((point, index): MetricPoint => {
    equity *= 1 + point.diff
    peak = Math.max(peak, equity)
    const drawdown = equity === 0 ? -1 : equity / peak - 1
    maxDrawdown = Math.min(maxDrawdown, drawdown)
    return {
      ...point,
      index,
      label: formatChartTimestamp(point.timestamp),
      accum: equity - 1,
      highWaterMark: peak - 1,
      drawdown,
      maxDrawdown,
    }
  })
}

export function aggregatePortfolioPoints(points: PortfolioPoint[], sourceTimeframe: Timeframe, displayTimeframe: Timeframe) {
  if (points.length === 0 || sourceTimeframe === displayTimeframe) {
    return points
  }

  const sourceStep = timeframeMilliseconds[sourceTimeframe]
  const displayStep = timeframeMilliseconds[displayTimeframe]
  if (displayStep < sourceStep) {
    return points
  }

  const sourceMetrics = deriveMetricSeries(points)
  const checkpoints = sourceMetrics.filter((point, index) =>
    index === 0 ||
    index === sourceMetrics.length - 1 ||
    isFixedBoundary(point.timestamp, displayStep),
  )

  let previousEquity = 1
  return checkpoints.map((point) => {
    const equity = 1 + point.accum
    const diff = previousEquity === 0 ? 0 : equity / previousEquity - 1
    previousEquity = equity
    return { timestamp: point.timestamp, diff }
  })
}

export function allowedDisplayTimeframes(sourceTimeframe: Timeframe, options: Timeframe[]) {
  return options.slice(options.indexOf(sourceTimeframe))
}

export function downsampleForChart<T>(items: T[], maximum = 3_000) {
  if (items.length <= maximum) {
    return items
  }

  const step = Math.ceil(items.length / maximum)
  const sampled = items.filter((_, index) => index % step === 0)
  const last = items.at(-1)
  if (last && sampled.at(-1) !== last) {
    sampled.push(last)
  }
  return sampled
}

export function formatPercent(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return "-"
  }
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "-"
  }
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function toDateTimeLocal(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function toIsoDateTime(value: string) {
  return new Date(value).toISOString()
}

function isFixedBoundary(value: string, stepMilliseconds: number) {
  return new Date(value).getTime() % stepMilliseconds === 0
}

function formatChartTimestamp(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "2-digit",
    year: "2-digit",
  }).format(new Date(value))
}
