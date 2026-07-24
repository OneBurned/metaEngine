import { AppShell } from "@/components/app-shell"
import { DateTimeField } from "@/components/date-time-field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ComparisonPanel } from "@/features/calculations/comparison-panel"
import { calculationDisplayName, calculationMetaLabel } from "@/features/calculations/run-presentation"
import { useSession } from "@/features/session/session-context"
import { getAllCalculationResult, getCalculationRun, getPortfolioBounds, getPresetBounds, listCalculationRuns, listPortfolios, listPresets, listSavedStrategies, queueCalculation, retryCalculationRun, timeframeOptions, type CalculationRun, type CalculationRunDetails, type Portfolio, type PortfolioPoint, type Preset, type SavedStrategy, type Timeframe } from "@/lib/api"
import { aggregatePortfolioPoints, allowedDisplayTimeframes, deriveMetricSeries, downsampleForChart, formatDateTime, formatPercent, toDateTimeLocal, toIsoDateTime } from "@/lib/metrics"
import { Link, useNavigate } from "@tanstack/react-router"
import { AlertCircle, BarChart3, CalendarClock, ChevronDown, ChevronUp, Layers3, LoaderCircle, Play, RefreshCw, RotateCcw, TableProperties } from "lucide-react"
import { Bar, Brush, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

const chartConfig = {
  diff: { label: "Diff", color: "#0f766e" },
  accum: { label: "Accum", color: "#2563eb" },
  highWaterMark: { label: "HWM", color: "#16a34a" },
  drawdown: { label: "DD", color: "#f97316" },
  maxDrawdown: { label: "MDD", color: "#dc2626" },
} satisfies ChartConfig

const activeStatuses = new Set<CalculationRun["status"]>(["queued", "running"])

export function DashboardScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/" })
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const [runs, setRuns] = useState<CalculationRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<CalculationRunDetails | null>(null)
  const [resultPoints, setResultPoints] = useState<PortfolioPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingResult, setIsLoadingResult] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const presentationSources = useMemo(() => ({ portfolios, presets, runs }), [portfolios, presets, runs])

  const refreshOverview = useCallback(async () => {
    if (!workspace) {
      setPortfolios([])
      setPresets([])
      setStrategies([])
      setRuns([])
      setIsLoading(false)
      return
    }

    const [portfolioResult, presetResult, strategyResult, runResult] = await Promise.allSettled([
      listPortfolios(workspace.id),
      listPresets(workspace.id),
      listSavedStrategies(workspace.id),
      listCalculationRuns(workspace.id),
    ])

    if (portfolioResult.status === "fulfilled") {
      setPortfolios(portfolioResult.value)
    }
    if (presetResult.status === "fulfilled") {
      setPresets(presetResult.value)
    }
    if (strategyResult.status === "fulfilled") {
      setStrategies(strategyResult.value)
    }
    if (runResult.status === "fulfilled") {
      const nextBaseRuns = runResult.value.filter((run) => run.kind === "base")
      setRuns(nextBaseRuns)
      setSelectedRunId((current) => current && nextBaseRuns.some((run) => run.id === current) ? current : (nextBaseRuns[0]?.id ?? null))
    }

    const failures = [portfolioResult, presetResult, strategyResult, runResult]
      .filter((result) => result.status === "rejected")
      .map((result) => toDisplayMessage(result.reason))
    setError(failures.length > 0 ? failures.join(" ") : null)
    setIsLoading(false)
  }, [workspace])

  const loadRun = useCallback(async (runId: string) => {
    if (!workspace) {
      return
    }

    setIsLoadingResult(true)
    try {
      const details = await getCalculationRun(workspace.id, runId)
      setSelectedRun(details)
      setResultPoints(details.run.status === "completed" ? await getAllCalculationResult(workspace.id, runId) : [])
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoadingResult(false)
    }
  }, [workspace])

  useEffect(() => {
    setIsLoading(true)
    setSelectedRun(null)
    setResultPoints([])
    void refreshOverview()
  }, [refreshOverview])

  useEffect(() => {
    if (selectedRunId) {
      void loadRun(selectedRunId)
    }
  }, [loadRun, selectedRunId])

  useEffect(() => {
    if (!runs.some((run) => activeStatuses.has(run.status))) {
      return
    }

    const timer = window.setInterval(() => {
      void refreshOverview()
      if (selectedRunId) {
        void loadRun(selectedRunId)
      }
    }, 2_500)
    return () => window.clearInterval(timer)
  }, [loadRun, refreshOverview, runs, selectedRunId])

  async function handleQueue(input: ({ portfolioId: string; presetId?: never } | { portfolioId?: never; presetId: string }) & { periodStart: string; periodEnd: string; timeframe: Timeframe }) {
    if (!workspace) {
      return
    }

    const run = await queueCalculation(workspace.id, input)
    toast.success("Базовый расчёт поставлен в очередь")
    setSelectedRunId(run.id)
    await refreshOverview()
  }

  async function handleRetry(runId: string) {
    if (!workspace) return
    try {
      await retryCalculationRun(workspace.id, runId)
      toast.success("Расчёт снова поставлен в очередь")
      setSelectedRunId(runId)
      await refreshOverview()
      await loadRun(runId)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  async function handleSignOut() {
    await signOut()
    await navigate({ to: "/login" })
  }

  return <AppShell onSignOut={() => void handleSignOut()}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm font-medium text-teal-700">Production workspace</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Расчёты</h1></div>
      <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => void refreshOverview()} aria-label="Обновить данные"><RefreshCw className="size-4" /></Button></TooltipTrigger><TooltipContent>Обновить</TooltipContent></Tooltip>
    </div>

    {error ? <Alert variant="destructive" className="mt-5 rounded-md"><AlertCircle className="size-4" /><AlertTitle>Операция не выполнена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {!workspace ? <Alert className="mt-6 rounded-md border-amber-200 bg-amber-50 text-amber-950"><AlertCircle className="size-4 text-amber-700" /><AlertTitle>Нет доступного workspace</AlertTitle><AlertDescription>Обратитесь к администратору, чтобы получить доступ к workspace.</AlertDescription></Alert> : <>
      <section className="mt-6"><CalculationPanel canWrite={workspace.canWrite} portfolios={portfolios} presets={presets} workspaceId={workspace.id} onQueue={handleQueue} /></section>
      <section className="mt-7" aria-labelledby="runs-heading"><SectionHeading id="runs-heading" icon={<CalendarClock className="size-4" />} title="Последние запуски" /><RecentRunTable isLoading={isLoading} runs={runs} selectedId={selectedRunId} onSelect={setSelectedRunId} onRetry={handleRetry} canWrite={workspace.canWrite} presentationSources={presentationSources} /></section>
      <section className="mt-7" aria-labelledby="analysis-heading"><SectionHeading id="analysis-heading" icon={<BarChart3 className="size-4" />} title="Анализ" /><Tabs defaultValue="result"><TabsList><TabsTrigger value="result">Текущий результат</TabsTrigger><TabsTrigger value="comparison">Сравнение</TabsTrigger></TabsList><TabsContent value="result" className="mt-4"><ResultPanel details={selectedRun} isLoading={isLoadingResult} points={resultPoints} title={selectedRun ? calculationDisplayName(selectedRun.run, presentationSources) : null} canRetry={workspace.canWrite} onRetry={handleRetry} /></TabsContent><TabsContent value="comparison" className="mt-4"><ComparisonPanel workspaceId={workspace.id} portfolios={portfolios} presets={presets} strategies={strategies} runs={runs} /></TabsContent></Tabs></section>
    </>}
  </AppShell>
}

function CalculationPanel({ canWrite, portfolios, presets, workspaceId, onQueue }: { canWrite: boolean; portfolios: Portfolio[]; presets: Preset[]; workspaceId: string; onQueue: (input: ({ portfolioId: string; presetId?: never } | { portfolioId?: never; presetId: string }) & { periodStart: string; periodEnd: string; timeframe: Timeframe }) => Promise<void> }) {
  const [sourceType, setSourceType] = useState<"portfolio" | "preset">("portfolio")
  const [portfolioId, setPortfolioId] = useState("")
  const [presetId, setPresetId] = useState("")
  const [bounds, setBounds] = useState<{ startsAt: string; endsAt: string; timeframe: Timeframe } | null>(null)
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [timeframe, setTimeframe] = useState<Timeframe>("1h")
  const [isLoadingBounds, setIsLoadingBounds] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setPortfolioId((current) => portfolios.some((portfolio) => portfolio.id === current) ? current : (portfolios[0]?.id ?? "")) }, [portfolios])
  useEffect(() => { setPresetId((current) => presets.some((preset) => preset.id === current) ? current : (presets[0]?.id ?? "")) }, [presets])

  const selectedPortfolio = portfolios.find((portfolio) => portfolio.id === portfolioId) ?? null

  useEffect(() => {
    const selectedId = sourceType === "portfolio" ? portfolioId : presetId
    if (!selectedId || (sourceType === "portfolio" && !selectedPortfolio)) {
      setBounds(null)
      setPeriodStart("")
      setPeriodEnd("")
      return
    }

    setIsLoadingBounds(true)
    setError(null)
    const request = sourceType === "portfolio"
      ? getPortfolioBounds(workspaceId, selectedId).then((nextBounds) => ({ ...nextBounds, timeframe: selectedPortfolio!.timeframe }))
      : getPresetBounds(workspaceId, selectedId)
    void request.then((nextBounds) => {
      setBounds(nextBounds)
      setPeriodStart(toDateTimeLocal(nextBounds.startsAt))
      setPeriodEnd(toDateTimeLocal(nextBounds.endsAt))
      setTimeframe(nextBounds.timeframe)
    }).catch((requestError) => setError(toDisplayMessage(requestError))).finally(() => setIsLoadingBounds(false))
  }, [portfolioId, presetId, selectedPortfolio, sourceType, workspaceId])

  const allowedTimeframes = bounds ? timeframeOptions.slice(timeframeOptions.indexOf(bounds.timeframe)) : []

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const selectedId = sourceType === "portfolio" ? portfolioId : presetId
    if (!selectedId || !periodStart || !periodEnd) {
      setError("Выберите источник и период.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await onQueue(sourceType === "portfolio" ? { portfolioId: selectedId, periodStart: toIsoDateTime(periodStart), periodEnd: toIsoDateTime(periodEnd), timeframe } : { presetId: selectedId, periodStart: toIsoDateTime(periodStart), periodEnd: toIsoDateTime(periodEnd), timeframe })
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return <Card className="rounded-lg border-slate-200 shadow-none"><CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="text-base">Новый расчёт</CardTitle><Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">Базовый</Badge></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
    <div className="grid gap-2 md:col-span-3"><Label>Источник</Label><Tabs value={sourceType} onValueChange={(value) => setSourceType(value as "portfolio" | "preset")}><TabsList><TabsTrigger value="portfolio">Портфолио</TabsTrigger><TabsTrigger value="preset">Пресет</TabsTrigger></TabsList></Tabs>{sourceType === "portfolio" ? <Select value={portfolioId} onValueChange={setPortfolioId} disabled={!portfolios.length || isSubmitting}><SelectTrigger><SelectValue placeholder="Выберите портфолио" /></SelectTrigger><SelectContent>{portfolios.map((portfolio) => <SelectItem key={portfolio.id} value={portfolio.id}>{portfolio.name} · v{portfolio.version}</SelectItem>)}</SelectContent></Select> : <Select value={presetId} onValueChange={setPresetId} disabled={!presets.length || isSubmitting}><SelectTrigger><SelectValue placeholder="Выберите пресет" /></SelectTrigger><SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name} · v{preset.version}</SelectItem>)}</SelectContent></Select>}</div>
    <Field label="Таймфрейм" htmlFor="calculation-timeframe"><Select value={timeframe} onValueChange={(value) => setTimeframe(value as Timeframe)} disabled={!bounds || isLoadingBounds || isSubmitting}><SelectTrigger id="calculation-timeframe"><SelectValue /></SelectTrigger><SelectContent>{allowedTimeframes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
    <DateTimeField id="period-start" label="Период с" value={periodStart} onChange={setPeriodStart} disabled={!bounds || isLoadingBounds || isSubmitting} />
    <DateTimeField id="period-end" label="Период по" value={periodEnd} onChange={setPeriodEnd} disabled={!bounds || isLoadingBounds || isSubmitting} />
    {isLoadingBounds ? <Progress className="md:col-span-3" value={55} /> : null}{error ? <p className="md:col-span-3 text-sm text-rose-700">{error}</p> : null}
    <div className="flex md:col-span-3"><Button type="submit" disabled={!canWrite || !bounds || isLoadingBounds || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}Рассчитать</Button></div>
  </form></CardContent></Card>
}

function RecentRunTable({ isLoading, runs, selectedId, onSelect, onRetry, canWrite, presentationSources }: { isLoading: boolean; runs: CalculationRun[]; selectedId: string | null; onSelect: (id: string) => void; onRetry: (id: string) => void; canWrite: boolean; presentationSources: { portfolios: Portfolio[]; presets: Preset[]; runs: CalculationRun[] } }) {
  const [showAll, setShowAll] = useState(false)
  const visibleRuns = showAll ? runs : runs.slice(0, 5)

  return <div className="space-y-3"><div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Расчёт</TableHead><TableHead>Статус</TableHead><TableHead className="hidden md:table-cell">Период</TableHead><TableHead className="hidden lg:table-cell text-right">Accum</TableHead><TableHead className="w-28 text-right">Детали</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <LoadingRows columns={5} /> : null}{!isLoading && runs.length === 0 ? <EmptyRow columns={5} text="Запусков пока нет." /> : visibleRuns.map((run) => <TableRow key={run.id} data-state={run.id === selectedId ? "selected" : undefined}><TableCell><div className="font-medium">{calculationDisplayName(run, presentationSources)}</div><div className="text-xs text-slate-500">{calculationMetaLabel(run)}</div></TableCell><TableCell><StatusBadge status={run.status} />{queueStatusNote(run) ? <div className="mt-1 text-xs text-slate-500">{queueStatusNote(run)}</div> : null}</TableCell><TableCell className="hidden md:table-cell text-sm">{formatDateTime(run.periodStart)} - {formatDateTime(run.periodEnd)}</TableCell><TableCell className="hidden lg:table-cell text-right tabular-nums">{formatPercent(run.finalAccum)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1">{canWrite && isRetryable(run) ? <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => onRetry(run.id)} aria-label="Повторить расчёт"><RotateCcw className="size-4" /></Button></TooltipTrigger><TooltipContent>Повторить</TooltipContent></Tooltip> : null}<Button variant="outline" size="sm" onClick={() => onSelect(run.id)}>Открыть</Button></div></TableCell></TableRow>)}</TableBody></Table></div>{runs.length > 5 ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" onClick={() => setShowAll((current) => !current)}>{showAll ? <ChevronUp /> : <ChevronDown />}{showAll ? "Скрыть старые" : `Вся история (${runs.length})`}</Button></div> : null}</div>
}

function ResultPanel({ details, isLoading, points, title, canRetry, onRetry }: { details: CalculationRunDetails | null; isLoading: boolean; points: PortfolioPoint[]; title: string | null; canRetry: boolean; onRetry: (id: string) => void }) {
  const [visibleLines, setVisibleLines] = useState({ diff: false, accum: true, highWaterMark: true, drawdown: true, maxDrawdown: true })
  const [chartMode, setChartMode] = useState<"line" | "histogram">("line")
  const [displayTimeframe, setDisplayTimeframe] = useState<Timeframe>("1h")
  const [showData, setShowData] = useState(false)
  const [visibleRows, setVisibleRows] = useState(100)
  const displayTimeframes = useMemo(() => details ? allowedDisplayTimeframes(details.run.timeframe, timeframeOptions) : [], [details])
  const displayPoints = useMemo(() => details ? aggregatePortfolioPoints(points, details.run.timeframe, displayTimeframe) : points, [details, displayTimeframe, points])
  const metrics = useMemo(() => deriveMetricSeries(displayPoints), [displayPoints])
  const chartPoints = useMemo(() => downsampleForChart(metrics), [metrics])

  useEffect(() => { if (details) setDisplayTimeframe(details.run.timeframe) }, [details?.run.id, details])
  useEffect(() => { setShowData(false); setVisibleRows(100) }, [details?.run.id, displayTimeframe])

  if (isLoading) return <div className="grid min-h-56 place-items-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" /> Загрузка результата</div>
  if (!details) return <EmptyResult text="Выберите запуск расчёта." />
  if (details.run.status !== "completed") return <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500"><div className="grid max-w-xl justify-items-center gap-3">{isRetryable(details.run) ? <><p className="font-medium text-slate-700">Расчёт не завершился.</p><p>{calculationFailureMessage(details.run)}</p></> : <p>Расчёт выполняется. Статус обновляется автоматически.</p>}{canRetry && isRetryable(details.run) ? <Button variant="outline" onClick={() => onRetry(details.run.id)}><RotateCcw />Повторить расчёт</Button> : null}</div></div>

  const displayedSummary = summarizeMetrics(metrics)
  function handleChartModeChange(value: "line" | "histogram") {
    setChartMode(value)
    setVisibleLines(value === "histogram"
      ? { diff: true, accum: false, highWaterMark: false, drawdown: false, maxDrawdown: false }
      : { diff: false, accum: true, highWaterMark: true, drawdown: true, maxDrawdown: true })
  }

  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-base font-semibold">{title}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(details.run.periodStart)} - {formatDateTime(details.run.periodEnd)} · расчетный ТФ {details.run.timeframe} · отображение {displayTimeframe}</p></div>{details.run.kind === "base" ? <Button asChild variant="outline"><Link to="/strategies"><Layers3 />Рассчитать стратегию</Link></Button> : <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">{calculationKindLabel(details.run)}</Badge>}</div><div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Accum" value={formatPercent(displayedSummary.finalAccum)} /><Metric label="HWM" value={formatPercent(displayedSummary.highWaterMark)} /><Metric label="MDD" value={formatPercent(displayedSummary.maxDrawdown)} /><Metric label="Точек" value={metrics.length.toLocaleString("ru-RU")} /></div>
    <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-4 text-sm"><ChartToggle label="Diff" checked={visibleLines.diff} onChange={(checked) => setVisibleLines((current) => ({ ...current, diff: checked }))} /><ChartToggle label="Accum" checked={visibleLines.accum} onChange={(checked) => setVisibleLines((current) => ({ ...current, accum: checked }))} /><ChartToggle label="HWM" checked={visibleLines.highWaterMark} onChange={(checked) => setVisibleLines((current) => ({ ...current, highWaterMark: checked }))} /><ChartToggle label="DD" checked={visibleLines.drawdown} onChange={(checked) => setVisibleLines((current) => ({ ...current, drawdown: checked }))} /><ChartToggle label="MDD" checked={visibleLines.maxDrawdown} onChange={(checked) => setVisibleLines((current) => ({ ...current, maxDrawdown: checked }))} /></div><div className="flex flex-wrap items-center gap-2"><Select value={displayTimeframe} onValueChange={(value) => setDisplayTimeframe(value as Timeframe)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{displayTimeframes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={chartMode} onValueChange={(value) => handleChartModeChange(value as "line" | "histogram")}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="line">Линии</SelectItem><SelectItem value="histogram">Гистограмма</SelectItem></SelectContent></Select></div></div><ChartContainer config={chartConfig} className="h-[420px] w-full aspect-auto" aria-label="График Accum, HWM, DD и MDD"><ComposedChart data={chartPoints} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} /><YAxis width={76} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPercent(Number(value))} />}/>{visibleLines.diff ? chartMode === "histogram" ? <Bar dataKey="diff" fill="var(--color-diff)" opacity={0.65} /> : <Line type="monotone" dataKey="diff" stroke="var(--color-diff)" strokeWidth={1.25} dot={false} /> : null}{visibleLines.accum ? chartMode === "histogram" ? <Bar dataKey="accum" fill="var(--color-accum)" opacity={0.45} /> : <Line type="monotone" dataKey="accum" stroke="var(--color-accum)" strokeWidth={1.75} dot={false} /> : null}{visibleLines.highWaterMark ? <Line type="monotone" dataKey="highWaterMark" stroke="var(--color-highWaterMark)" strokeWidth={1.5} dot={false} /> : null}{visibleLines.drawdown ? chartMode === "histogram" ? <Bar dataKey="drawdown" fill="var(--color-drawdown)" opacity={0.45} /> : <Line type="monotone" dataKey="drawdown" stroke="var(--color-drawdown)" strokeWidth={1.35} dot={false} /> : null}{visibleLines.maxDrawdown ? <Line type="monotone" dataKey="maxDrawdown" stroke="var(--color-maxDrawdown)" strokeWidth={1.35} dot={false} strokeDasharray="5 5" /> : null}<Brush dataKey="label" height={28} stroke="#0f766e" travellerWidth={8} /></ComposedChart></ChartContainer></div>
    <div className="flex justify-start"><Button type="button" variant="outline" onClick={() => setShowData((current) => !current)}>{showData ? <ChevronUp /> : <TableProperties />}{showData ? "Скрыть данные" : `Показать данные (${metrics.length.toLocaleString("ru-RU")})`}</Button></div>
    {showData ? <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Время</TableHead><TableHead className="text-right">Diff</TableHead><TableHead className="hidden sm:table-cell text-right">Accum</TableHead><TableHead className="hidden sm:table-cell text-right">HWM</TableHead><TableHead className="hidden sm:table-cell text-right">DD</TableHead><TableHead className="hidden sm:table-cell text-right">MDD</TableHead></TableRow></TableHeader><TableBody>{metrics.slice(0, visibleRows).map((point) => <TableRow key={point.timestamp}><TableCell>{formatDateTime(point.timestamp)}</TableCell><TableCell className="text-right tabular-nums">{formatPercent(point.diff, 3)}</TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.accum)}</TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.highWaterMark)}</TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.drawdown)}</TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.maxDrawdown)}</TableCell></TableRow>)}</TableBody></Table>{visibleRows < metrics.length ? <div className="border-t border-slate-200 p-3 text-center"><Button type="button" variant="outline" size="sm" onClick={() => setVisibleRows((current) => Math.min(current + 500, metrics.length))}>Показать ещё {Math.min(500, metrics.length - visibleRows).toLocaleString("ru-RU")}</Button></div> : null}</div> : null}
  </div>
}

function SectionHeading({ id, icon, title }: { id: string; icon: React.ReactNode; title: string }) { return <div className="mb-3 flex items-center gap-2"><span className="text-teal-700">{icon}</span><h2 id={id} className="text-base font-semibold">{title}</h2></div> }
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-white px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div> }
function StatusBadge({ status }: { status: CalculationRun["status"] }) { const styles: Record<CalculationRun["status"], string> = { queued: "border-amber-200 bg-amber-50 text-amber-800", running: "border-sky-200 bg-sky-50 text-sky-800", completed: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-rose-200 bg-rose-50 text-rose-800", interrupted: "border-orange-200 bg-orange-50 text-orange-800" }; const labels: Record<CalculationRun["status"], string> = { queued: "В очереди", running: "Считается", completed: "Готово", failed: "Ошибка", interrupted: "Прервана" }; return <Badge variant="outline" className={styles[status]}>{labels[status]}</Badge> }
function isRetryable(run: CalculationRun) { return run.status === "failed" || run.status === "interrupted" }
function queueStatusNote(run: CalculationRun) { if (run.status === "queued" && run.retryNotBefore) return `Автоповтор после ${formatDateTime(run.retryNotBefore)}`; if (run.status === "running" && run.attemptCount > 1) return `Попытка ${run.attemptCount}`; if (isRetryable(run)) return `${calculationFailureMessage(run)} Попыток: ${run.attemptCount}`; return null }
function calculationFailureMessage(run: CalculationRun) { const code = run.errorCode ?? "unknown_error"; const details = run.errorMessage ? ` Причина: ${run.errorMessage}` : ""; const messages: Record<string, string> = { calculation_failed: "Внутренняя ошибка расчёта.", invalid_period: "Период расчёта задан неверно: дата окончания раньше даты начала.", portfolio_not_found: "Портфолио для расчёта не найдено в текущем workspace.", preset_not_found: "Пресет для расчёта не найден в текущем workspace.", unsupported_timeframe: "Выбранный таймфрейм нельзя посчитать из этого источника.", unknown_timeframe: "Выбранный таймфрейм не поддерживается.", transient_database_error: "Временная ошибка базы данных. Расчёт будет повторён автоматически или его можно повторить вручную.", unknown_error: "Backend не вернул код причины. Нужно смотреть logs API/Worker." }; return `${messages[code] ?? `Backend вернул код ошибки: ${code}.`} Код: ${code}.${details}` }
function LoadingRows({ columns }: { columns: number }) { return <TableRow><TableCell colSpan={columns} className="py-9 text-center text-sm text-slate-500">Загрузка...</TableCell></TableRow> }
function EmptyRow({ columns, text }: { columns: number; text: string }) { return <TableRow><TableCell colSpan={columns} className="py-9 text-center text-sm text-slate-500">{text}</TableCell></TableRow> }
function EmptyResult({ text }: { text: string }) { return <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500">{text}</div> }
function toDisplayMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить запрос." }

function ChartToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />{label}</label> }
function summarizeMetrics(metrics: ReturnType<typeof deriveMetricSeries>) { const last = metrics.at(-1); return { finalAccum: last?.accum ?? null, highWaterMark: last?.highWaterMark ?? null, maxDrawdown: last?.maxDrawdown ?? null } }
