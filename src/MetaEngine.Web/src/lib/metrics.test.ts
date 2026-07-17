import { describe, expect, it } from "vitest"

import { aggregatePortfolioPoints, allowedDisplayTimeframes, deriveMetricSeries, downsampleForChart, formatPercent } from "./metrics"

describe("deriveMetricSeries", () => {
  it("builds accum, high water mark and drawdown from canonical diffs", () => {
    const rows = deriveMetricSeries([
      { timestamp: "2024-01-01T00:00:00Z", diff: 0.1 },
      { timestamp: "2024-01-02T00:00:00Z", diff: -0.1 },
    ])

    expect(rows[0].accum).toBeCloseTo(0.1)
    expect(rows[1].accum).toBeCloseTo(-0.01)
    expect(rows[1].highWaterMark).toBeCloseTo(0.1)
    expect(rows[1].drawdown).toBeCloseTo(-0.1)
  })
})

describe("display timeframe helpers", () => {
  it("offers calendar display timeframes for hourly results", () => {
    expect(allowedDisplayTimeframes("1h", ["1m", "5m", "15m", "1h", "1d", "1M", "1Y"]))
      .toEqual(["1h", "1d", "1M", "1Y"])
  })

  it("aggregates hourly points to monthly and yearly checkpoints", () => {
    const points = [
      { timestamp: "2024-01-01T00:00:00Z", diff: 0.01 },
      { timestamp: "2024-02-01T00:00:00Z", diff: 0.02 },
      { timestamp: "2025-01-01T00:00:00Z", diff: 0.03 },
    ]

    expect(aggregatePortfolioPoints(points, "1h", "1M").map((point) => point.timestamp))
      .toEqual(["2024-01-01T00:00:00Z", "2024-02-01T00:00:00Z", "2025-01-01T00:00:00Z"])
    expect(aggregatePortfolioPoints(points, "1h", "1Y").map((point) => point.timestamp))
      .toEqual(["2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"])
  })
})

describe("downsampleForChart", () => {
  it("keeps the final point after reducing a long series", () => {
    const rows = downsampleForChart([0, 1, 2, 3, 4, 5], 3)

    expect(rows.at(-1)).toBe(5)
    expect(rows.length).toBeLessThanOrEqual(4)
  })
})

describe("formatPercent", () => {
  it("formats decimal coefficients for chart axes as percentages", () => {
    expect(formatPercent(7.4, 0).replace(/\s/g, "")).toBe("740%")
    expect(formatPercent(-0.316, 1).replace(/\s/g, "")).toBe("-31,6%")
  })
})
