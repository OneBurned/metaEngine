import { describe, expect, it } from "vitest"

import { calculationDisplayName, strategyTypeLabel } from "./run-presentation"

const portfolio = {
  id: "portfolio-1",
  portfolioKey: "portfolio-key",
  version: 2,
  name: "Core allocation",
  sourceFileName: null,
  valueType: "diff",
  valueScale: "decimal",
  timeframe: "1h" as const,
  sourceChecksum: "source",
  seriesChecksum: "series",
  pointCount: 3,
  createdAt: "2026-01-01T00:00:00Z",
  createdByUserId: null,
}

const baseRun = {
  id: "base-run",
  kind: "base" as const,
  inputType: "portfolio" as const,
  portfolioId: portfolio.id,
  presetId: null,
  sourceCalculationRunId: null,
  strategyType: null,
  strategySchemaVersion: null,
  periodStart: "2024-01-01T00:00:00Z",
  periodEnd: "2024-01-02T00:00:00Z",
  timeframe: "1h" as const,
  status: "completed" as const,
  pointCount: 3,
  tradeCount: 0,
  finalAccum: 0.1,
  highWaterMark: 0.1,
  maxDrawdown: 0,
  errorCode: null,
  attemptCount: 1,
  retryNotBefore: null,
  lastHeartbeatAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: null,
  completedAt: null,
  createdByUserId: null,
}

describe("calculationDisplayName", () => {
  it("uses the source name and calculation type", () => {
    expect(calculationDisplayName(baseRun, { portfolios: [portfolio], presets: [], runs: [baseRun] }))
      .toBe("Core allocation · v2 · Базовый расчёт")
  })

  it("keeps the base source for strategy results", () => {
    const strategyRun = { ...baseRun, id: "strategy-run", kind: "strategy" as const, sourceCalculationRunId: baseRun.id, strategyType: "rsi" }
    expect(calculationDisplayName(strategyRun, { portfolios: [portfolio], presets: [], runs: [baseRun, strategyRun] }))
      .toBe("Core allocation · v2 · RSI")
  })
})

describe("strategyTypeLabel", () => {
  it("uses readable labels for registered strategies", () => {
    expect(strategyTypeLabel("mdd_mean_reversion")).toBe("MDD Mean Reversion")
    expect(strategyTypeLabel("mdd_grid")).toBe("MDDGrid")
  })
})
