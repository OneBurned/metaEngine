import type { PortfolioPoint, Timeframe } from "@/lib/api"

export type MetricPoint = PortfolioPoint & {
  index: number
  label: string
  accum: number
  highWaterMark: number
  drawdown: number
  maxDrawdown: number
}

const timeframeOrder: Timeframe[] = ["1m", "5m", "15m", "1h", "1d", "1M", "1Y"]

const fixedTimeframeMilliseconds: Partial<Record<Timeframe, number>> = {
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

  if (timeframeOrder.indexOf(displayTimeframe) < timeframeOrder.indexOf(sourceTimeframe)) {
    return points
  }

  const sourceMetrics = deriveMetricSeries(points)
  const checkpoints = sourceMetrics.filter((point, index) =>
    index === 0 ||
    index === sourceMetrics.length - 1 ||
    isBoundary(point.timestamp, displayTimeframe),
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
  const sourceIndex = timeframeOrder.indexOf(sourceTimeframe)
  return options.filter((option) => timeframeOrder.indexOf(option) >= sourceIndex)
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

function isBoundary(value: string, timeframe: Timeframe) {
  const fixedStep = fixedTimeframeMilliseconds[timeframe]
  const date = new Date(value)
  if (fixedStep) {
    return date.getTime() % fixedStep === 0
  }

  if (timeframe === "1M") {
    return date.getUTCDate() === 1 &&
      date.getUTCHours() === 0 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0
  }

  if (timeframe === "1Y") {
    return date.getUTCMonth() === 0 &&
      date.getUTCDate() === 1 &&
      date.getUTCHours() === 0 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0
  }

  return false
}

function formatChartTimestamp(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}.${month}.${day} ${hours}:${minutes}`
}
