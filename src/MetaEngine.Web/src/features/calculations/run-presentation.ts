import type { CalculationRun, Portfolio, Preset } from "@/lib/api"
import { formatDateTime, formatPercent } from "@/lib/metrics"

export type RunPresentationSources = {
  portfolios: Portfolio[]
  presets: Preset[]
  runs: CalculationRun[]
}

export function calculationKindLabel(run: CalculationRun) {
  if (run.kind === "base") {
    return "Базовый расчёт"
  }

  return strategyTypeLabel(run.strategyType)
}

export function strategyTypeLabel(strategyType: string | null) {
  if (strategyType === "rsi") {
    return "RSI"
  }
  if (strategyType === "mdd_mean_reversion") {
    return "MDD Mean Reversion"
  }
  return "Стратегия"
}

export function calculationSourceLabel(run: CalculationRun, sources: RunPresentationSources) {
  const sourceRun = run.sourceCalculationRunId
    ? sources.runs.find((candidate) => candidate.id === run.sourceCalculationRunId) ?? run
    : run

  if (sourceRun.inputType === "portfolio") {
    const portfolio = sources.portfolios.find((candidate) => candidate.id === sourceRun.portfolioId)
    return portfolio ? `${portfolio.name} · v${portfolio.version}` : "Портфолио"
  }

  const preset = sources.presets.find((candidate) => candidate.id === sourceRun.presetId)
  return preset ? `${preset.name} · v${preset.version}` : "Пресет"
}

export function calculationDisplayName(run: CalculationRun, sources: RunPresentationSources) {
  const source = calculationSourceLabel(run, sources)
  return run.kind === "strategy" ? `${source} · ${calculationKindLabel(run)}` : source
}

export function calculationMetaLabel(run: CalculationRun) {
  return `${run.timeframe} · ${formatDateTime(run.completedAt ?? run.createdAt)}`
}

export function calculationCompactLabel(run: CalculationRun, sources: RunPresentationSources) {
  const finalAccum = formatPercent(run.finalAccum)
  const parts = [calculationDisplayName(run, sources), calculationMetaLabel(run)]
  if (finalAccum !== "-") {
    parts.push(finalAccum)
  }
  return parts.join(" · ")
}
