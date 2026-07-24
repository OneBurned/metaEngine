import { describe, expect, it } from "vitest"

import { calculationCompactLabel, calculationDisplayName, calculationMetaLabel, savedStrategyCompactLabel, savedStrategyDisplayName, savedStrategyMetaLabel, strategyTypeLabel } from "./run-presentation"
import { formatDateTime } from "@/lib/metrics"

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
  startsAt: "2024-01-01T00:00:00Z",
  endsAt: "2024-01-02T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
  createdByUserId: null,
}


const savedStrategy = {
  id: "saved-strategy",
  strategyKey: "strategy-key",
  version: 3,
  name: "Recovery MDD",
  strategyType: "mdd_mean_reversion",
  schemaVersion: 1,
  parametersJson: "{}",
  sourceType: "portfolio" as const,
  sourcePortfolioId: portfolio.id,
  sourcePresetId: null,
  resultArtifactId: "artifact",
  resultCalculationRunId: "strategy-run",
  resultPeriodStart: "2024-01-01T00:00:00Z",
  resultPeriodEnd: "2024-01-02T00:00:00Z",
  resultTimeframe: "1h" as const,
  createdAt: "2026-01-01T05:06:00Z",
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
  errorMessage: null,
  attemptCount: 1,
  retryNotBefore: null,
  lastHeartbeatAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: null,
  completedAt: "2026-01-01T03:04:00Z",
  createdByUserId: null,
}

describe("calculationDisplayName", () => {
  it("uses only the source name for base calculations", () => {
    expect(calculationDisplayName(baseRun, { portfolios: [portfolio], presets: [], runs: [baseRun] }))
      .toBe("Core allocation · v2")
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
  })
})


describe("calculationCompactLabel", () => {
  it("uses source, timeframe, completed date and final Accum", () => {
    const completedAt = formatDateTime(baseRun.completedAt)

    expect(calculationCompactLabel(baseRun, { portfolios: [portfolio], presets: [], runs: [baseRun] }))
      .toBe(`Core allocation · v2 · 1h · ${completedAt} · 10,00%`)
  })

  it("uses timeframe and completed-or-created date as metadata", () => {
    expect(calculationMetaLabel(baseRun)).toBe(`1h · ${formatDateTime(baseRun.completedAt)}`)
  })
})


describe("saved strategy labels", () => {
  it("uses the shared compact label shape for saved strategies", () => {
    const createdAt = formatDateTime(savedStrategy.createdAt)

    expect(savedStrategyDisplayName(savedStrategy)).toBe("Recovery MDD · v3 · MDD Mean Reversion")
    expect(savedStrategyMetaLabel(savedStrategy)).toBe(`1h · ${createdAt}`)
    expect(savedStrategyCompactLabel(savedStrategy)).toBe(`Recovery MDD · v3 · MDD Mean Reversion · 1h · ${createdAt}`)
  })
})
