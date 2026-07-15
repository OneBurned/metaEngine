import { describe, expect, it } from "vitest"

import { deriveMetricSeries, downsampleForChart } from "./metrics"

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

describe("downsampleForChart", () => {
  it("keeps the final point after reducing a long series", () => {
    const rows = downsampleForChart([0, 1, 2, 3, 4, 5], 3)

    expect(rows.at(-1)).toBe(5)
    expect(rows.length).toBeLessThanOrEqual(4)
  })
})
