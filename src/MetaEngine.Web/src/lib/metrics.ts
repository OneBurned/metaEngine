import type { PortfolioPoint } from "@/lib/api"

export type MetricPoint = PortfolioPoint & {
  index: number
  label: string
  accum: number
  highWaterMark: number
  drawdown: number
}

export function deriveMetricSeries(points: PortfolioPoint[]) {
  let equity = 1
  let peak = 1

  return points.map((point, index): MetricPoint => {
    equity *= 1 + point.diff
    peak = Math.max(peak, equity)
    return {
      ...point,
      index,
      label: formatChartTimestamp(point.timestamp),
      accum: equity - 1,
      highWaterMark: peak - 1,
      drawdown: equity === 0 ? -1 : equity / peak - 1,
    }
  })
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

function formatChartTimestamp(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "2-digit",
    year: "2-digit",
  }).format(new Date(value))
}
