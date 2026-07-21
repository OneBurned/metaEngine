import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { calculationDisplayName, strategyTypeLabel } from "@/features/calculations/run-presentation"
import { getAllCalculationResult, getAllPortfolioPoints, type CalculationRun, type Portfolio, type PortfolioPoint, type Preset, type SavedStrategy } from "@/lib/api"
import { deriveMetricSeries, downsampleForChart, formatPercent } from "@/lib/metrics"
import { LoaderCircle, Plus, X } from "lucide-react"
import { Brush, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { useMemo, useState } from "react"

type ComparisonCandidate = {
  id: string
  title: string
  kind: string
  color: string
  load: () => Promise<PortfolioPoint[]>
}

type ComparisonChartPoint = {
  timestamp: string
  label: string
  [key: string]: string | number | undefined
}

const colors = ["#2563eb", "#0f766e", "#7c3aed", "#d97706", "#db2777"]

export function ComparisonPanel({
  workspaceId,
  portfolios,
  presets,
  strategies,
  runs,
}: {
  workspaceId: string
  portfolios: Portfolio[]
  presets: Preset[]
  strategies: SavedStrategy[]
  runs: CalculationRun[]
}) {
  const [candidateId, setCandidateId] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [seriesById, setSeriesById] = useState<Record<string, PortfolioPoint[]>>({})
  const [showDrawdown, setShowDrawdown] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sources = useMemo<ComparisonCandidate[]>(() => {
    const presentationSources = { portfolios, presets, runs }
    return [
      ...portfolios.map((portfolio, index) => ({
        id: `portfolio-${portfolio.id}`,
        title: portfolio.name,
        kind: "Портфолио",
        color: colors[index % colors.length],
        load: () => getAllPortfolioPoints(workspaceId, portfolio.id),
      })),
      ...strategies.map((strategy, index) => ({
        id: `strategy-${strategy.id}`,
        title: `${strategy.name} · ${strategyTypeLabel(strategy.strategyType)}`,
        kind: "Сохранённая стратегия",
        color: colors[(portfolios.length + index) % colors.length],
        load: () => getAllCalculationResult(workspaceId, strategy.resultCalculationRunId),
      })),
      ...runs.filter((run) => run.status === "completed").map((run, index) => ({
        id: `run-${run.id}`,
        title: calculationDisplayName(run, presentationSources),
        kind: "Готовый расчёт",
        color: colors[(portfolios.length + strategies.length + index) % colors.length],
        load: () => getAllCalculationResult(workspaceId, run.id),
      })),
    ]
  }, [portfolios, presets, runs, strategies, workspaceId])

  const candidateById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const selectedSources = selectedIds.map((id) => candidateById.get(id)).filter((source): source is ComparisonCandidate => Boolean(source))

  const chartConfig = useMemo<ChartConfig>(() => Object.fromEntries(
    selectedSources.map((source) => [source.id, { label: source.title, color: source.color }]),
  ), [selectedSources])

  const chartPoints = useMemo<ComparisonChartPoint[]>(() => {
    const byTimestamp = new Map<string, ComparisonChartPoint>()
    for (const source of selectedSources) {
      const rows = seriesById[source.id]
      if (!rows?.length) {
        continue
      }

      const metrics = deriveMetricSeries(rows)
      const firstEquity = 1 + (metrics[0]?.accum ?? 0)
      for (const point of downsampleForChart(metrics, 850)) {
        const current = byTimestamp.get(point.timestamp) ?? {
          timestamp: point.timestamp,
          label: point.label,
        }
        current[source.id] = (1 + point.accum) / firstEquity - 1
        if (showDrawdown) {
          current[`${source.id}:drawdown`] = point.drawdown
        }
        byTimestamp.set(point.timestamp, current)
      }
    }

    return [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  }, [selectedSources, seriesById, showDrawdown])

  async function addSource() {
    const source = candidateById.get(candidateId)
    if (!source || selectedIds.includes(source.id) || selectedIds.length >= colors.length) {
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const rows = seriesById[source.id] ?? await source.load()
      setSeriesById((current) => ({ ...current, [source.id]: rows }))
      setSelectedIds((current) => [...current, source.id])
      setCandidateId("")
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить ряд для сравнения.")
    } finally {
      setIsLoading(false)
    }
  }

  return <div className="space-y-5">
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid gap-1.5"><Label htmlFor="comparison-source">Добавить ряд</Label><Select value={candidateId} onValueChange={setCandidateId} disabled={isLoading || selectedIds.length >= colors.length || sources.length === 0}><SelectTrigger id="comparison-source"><SelectValue placeholder="Портфолио, стратегия или готовый расчёт" /></SelectTrigger><SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id} disabled={selectedIds.includes(source.id)}>{source.kind} · {source.title}</SelectItem>)}</SelectContent></Select></div>
      <div className="flex items-end"><Button type="button" variant="outline" onClick={() => void addSource()} disabled={!candidateId || isLoading || selectedIds.length >= colors.length}>{isLoading ? <LoaderCircle className="animate-spin" /> : <Plus />}Добавить</Button></div>
      <div className="lg:col-span-2 flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-sm"><Checkbox checked={showDrawdown} onCheckedChange={(checked) => setShowDrawdown(checked === true)} />Просадка</label>{selectedSources.map((source) => <span key={source.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-sm"><span className="size-2 rounded-full" style={{ backgroundColor: source.color }} /><span>{source.title}</span><Button type="button" variant="ghost" size="icon" className="size-7" aria-label={`Убрать ${source.title}`} onClick={() => setSelectedIds((current) => current.filter((id) => id !== source.id))}><X className="size-3.5" /></Button></span>)}</div>
      {error ? <p className="lg:col-span-2 text-sm text-rose-700">{error}</p> : null}
    </div>

    {selectedSources.length === 0 ? <EmptyComparison text="Добавьте два или больше рядов, чтобы сравнить Accum." /> : <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">Сравнение Accum</p><p className="text-xs text-slate-500">Каждый ряд начинается с 0% в своей первой точке.</p></div>
      <ChartContainer config={chartConfig} className="h-[420px] w-full aspect-auto" aria-label="Сравнение рядов">
        <LineChart data={chartPoints} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} />
          {showDrawdown ? <YAxis yAxisId="drawdown" width={72} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} /> : null}
          <YAxis yAxisId="accum" orientation="right" width={76} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} />
          <ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPercent(Number(value))} />} />
          {selectedSources.map((source) => <Line key={source.id} yAxisId="accum" type="monotone" dataKey={source.id} name={source.title} stroke={source.color} strokeWidth={1.75} dot={false} connectNulls />)}
          {showDrawdown ? selectedSources.map((source) => <Line key={`${source.id}:drawdown`} yAxisId="drawdown" type="monotone" dataKey={`${source.id}:drawdown`} name={`${source.title} · DD`} stroke={source.color} strokeWidth={1.2} strokeDasharray="4 4" dot={false} connectNulls />) : null}
          <Brush dataKey="label" height={28} stroke="#0f766e" travellerWidth={8} />
        </LineChart>
      </ChartContainer>
    </div>}
  </div>
}

function EmptyComparison({ text }: { text: string }) { return <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500">{text}</div> }
