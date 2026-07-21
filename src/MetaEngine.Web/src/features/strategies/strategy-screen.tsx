import { AppShell } from "@/components/app-shell"
import { calculationDisplayName, calculationSourceLabel } from "@/features/calculations/run-presentation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MddOptimizationPanel, type MddOptimizationParameters } from "@/features/strategies/mdd-optimization-panel"
import { RsiOptimizationPanel } from "@/features/strategies/rsi-optimization-panel"
import {
  displayApiError,
  deleteCalculationRuns,
  deleteSavedStrategy,
  deleteStrategyRun,
  getAllCalculationResult,
  getCalculationRun,
  listCalculationRuns,
  listPortfolios,
  listPresets,
  listSavedStrategies,
  listStrategyTypes,
  queueStrategyCalculation,
  saveStrategy,
  type CalculationRun,
  type CalculationRunDetails,
  type Portfolio,
  type PortfolioPoint,
  type Preset,
  type SavedStrategy,
  type Timeframe,
  timeframeOptions,
} from "@/lib/api"
import { aggregatePortfolioPoints, allowedDisplayTimeframes, deriveMetricSeries, downsampleForChart, formatDateTime, formatPercent } from "@/lib/metrics"
import { useSession } from "@/features/session/session-context"
import { AlertCircle, BookMarked, ChevronUp, Download, LoaderCircle, Play, Plus, Save, TableProperties, Trash2 } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { Bar, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { toast } from "sonner"

type MddDeal = { entryDrawdown: number; weight: number; exitType: "source_dd" | "strategy_dd" | "source_hwm" | "strategy_hwm"; exitValue: number }

const defaultDeals: MddDeal[] = [
  { entryDrawdown: 10, weight: 10, exitType: "source_dd", exitValue: 0 },
  { entryDrawdown: 20, weight: 20, exitType: "source_dd", exitValue: 0 },
  { entryDrawdown: 30, weight: 30, exitType: "source_dd", exitValue: 0 },
  { entryDrawdown: 40, weight: 40, exitType: "source_dd", exitValue: 0 },
  { entryDrawdown: 50, weight: 50, exitType: "source_dd", exitValue: 0 },
]

const chartConfig = {
  diff: { label: "Diff", color: "#0f766e" },
  accum: { label: "Accum", color: "#2563eb" },
  highWaterMark: { label: "HWM", color: "#16a34a" },
  drawdown: { label: "Просадка", color: "#e11d48" },
  maxDrawdown: { label: "MDD", color: "#7c2d12" },
  sourceDrawdown: { label: "IN DD", color: "#f97316" },
  localDrawdown: { label: "Local DD", color: "#9333ea" },
  rsi: { label: "RSI", color: "#7c3aed" },
} satisfies ChartConfig

const activeStatuses = new Set<CalculationRun["status"]>(["queued", "running"])

export function StrategyScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/strategies" })
  const [runs, setRuns] = useState<CalculationRun[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([])
  const [strategyTypes, setStrategyTypes] = useState<string[]>([])
  const [sourceRunId, setSourceRunId] = useState("")
  const [strategyType, setStrategyType] = useState("rsi")
  const [strategyMode, setStrategyMode] = useState<"manual" | "optimization">("manual")
  const [rsiPeriod, setRsiPeriod] = useState(14)
  const [buyLevel, setBuyLevel] = useState(30)
  const [sellLevel, setSellLevel] = useState(70)
  const [deals, setDeals] = useState<MddDeal[]>(defaultDeals)
  const [selectedRunId, setSelectedRunId] = useState("")
  const [selectedRun, setSelectedRun] = useState<CalculationRunDetails | null>(null)
  const [points, setPoints] = useState<PortfolioPoint[]>([])
  const [saveName, setSaveName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspace) {
      setIsLoading(false)
      return
    }
    try {
      const [allRuns, nextPortfolios, nextPresets, saved, availableTypes] = await Promise.all([
        listCalculationRuns(workspace.id),
        listPortfolios(workspace.id),
        listPresets(workspace.id),
        listSavedStrategies(workspace.id),
        listStrategyTypes(),
      ])
      setRuns(allRuns)
      setPortfolios(nextPortfolios)
      setPresets(nextPresets)
      setSavedStrategies(saved)
      setStrategyTypes(availableTypes.map((item) => item.strategyType))
      const baseRuns = allRuns.filter((run) => run.kind === "base" && run.status === "completed")
      setSourceRunId((current) => baseRuns.some((run) => run.id === current) ? current : (baseRuns[0]?.id ?? ""))
      const strategyRuns = allRuns.filter((run) => run.kind === "strategy")
      setSelectedRunId((current) => strategyRuns.some((run) => run.id === current) ? current : (strategyRuns[0]?.id ?? ""))
      setError(null)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace])

  const loadResult = useCallback(async () => {
    if (!workspace || !selectedRunId) {
      setSelectedRun(null)
      setPoints([])
      return
    }
    try {
      const details = await getCalculationRun(workspace.id, selectedRunId)
      setSelectedRun(details)
      setPoints(details.run.status === "completed" ? await getAllCalculationResult(workspace.id, selectedRunId) : [])
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }, [selectedRunId, workspace])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void loadResult() }, [loadResult])
  useEffect(() => {
    if (!runs.some((run) => run.kind === "strategy" && activeStatuses.has(run.status))) return
    const timer = window.setInterval(() => { void refresh(); void loadResult() }, 2_500)
    return () => window.clearInterval(timer)
  }, [loadResult, refresh, runs])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!workspace || !sourceRunId) {
      setError("Сначала выберите завершенный базовый расчет.")
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const parameters = strategyType === "rsi"
        ? { rsiPeriod, buyLevel, sellLevel }
        : { deals: deals.map((deal) => ({ entryDrawdown: -Math.abs(deal.entryDrawdown) / 100, weight: deal.weight / 100, exitType: deal.exitType, exitValue: deal.exitValue / 100 })) }
      const queued = await queueStrategyCalculation(workspace.id, sourceRunId, strategyType, parameters)
      setSelectedRunId(queued.id)
      setSaveName("")
      toast.success("Стратегия поставлена в очередь")
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDeleteStrategyRun(run: CalculationRun) {
    if (!workspace || !workspace.canWrite) return
    if (activeStatuses.has(run.status)) {
      setError("Запуск стратегии еще выполняется, поэтому его нельзя удалить.")
      return
    }
    if (savedStrategies.some((strategy) => strategy.resultCalculationRunId === run.id)) {
      setError("Этот запуск уже сохранен как стратегия, поэтому его нельзя удалить.")
      return
    }
    if (!window.confirm("Удалить этот запуск стратегии? Это действие нельзя отменить.")) return

    try {
      await deleteStrategyRun(workspace.id, run.id)
      if (selectedRunId === run.id) {
        setSelectedRunId("")
        setSelectedRun(null)
        setPoints([])
      }
      toast.success("Запуск стратегии удален")
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  async function handleDeleteAllStrategyRuns() {
    if (!workspace?.canWrite) return
    if (!window.confirm("Удалить все неактивные и несохраненные запуски стратегий? Активные и сохраненные запуски будут пропущены.")) return
    try {
      const result = await deleteCalculationRuns(workspace.id, "strategy")
      setSelectedRunId("")
      setSelectedRun(null)
      setPoints([])
      toast.success(`Удалено: ${result.deleted}. Пропущено: ${result.skipped}.`)
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  async function handleDeleteSavedStrategy(strategy: SavedStrategy) {
    if (!workspace?.canWrite) return
    if (!window.confirm("Удалить сохраненную стратегию? Если она используется в пресете, удаление будет запрещено.")) return
    try {
      await deleteSavedStrategy(workspace.id, strategy.id)
      toast.success("Сохраненная стратегия удалена")
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  async function handleSave() {
    if (!workspace || !selectedRun || selectedRun.run.status !== "completed") return
    if (!saveName.trim()) {
      setError("Укажите название для сохраненной стратегии.")
      return
    }
    try {
      await saveStrategy(workspace.id, saveName.trim(), selectedRun.run.id)
      toast.success("Стратегия сохранена")
      setSaveName("")
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  function applySaved(saved: SavedStrategy) {
    try {
      const parameters = JSON.parse(saved.parametersJson) as Record<string, unknown>
      setStrategyType(saved.strategyType)
      if (saved.strategyType === "rsi") {
        setRsiPeriod(numberValue(parameters.rsiPeriod, 14))
        setBuyLevel(numberValue(parameters.buyLevel, 30))
        setSellLevel(numberValue(parameters.sellLevel, 70))
      } else if (Array.isArray(parameters.deals) || Array.isArray(parameters.levels)) {
        const rawDeals = (Array.isArray(parameters.deals) ? parameters.deals : parameters.levels) as unknown[]
        setDeals(rawDeals.map((deal: unknown) => {
          const item = deal as Record<string, unknown>
          return {
            entryDrawdown: Math.abs(numberValue(item.entryDrawdown ?? item.drawdown, -0.1) * 100),
            weight: numberValue(item.weight, 0.1) * 100,
            exitType: typeof item.exitType === "string" && ["source_dd", "strategy_dd", "source_hwm", "strategy_hwm"].includes(item.exitType) ? item.exitType as MddDeal["exitType"] : "source_dd",
            exitValue: numberValue(item.exitValue, 0) * 100,
          }
        }))
      }
      setStrategyMode("manual")
      toast.success("Параметры применены")
    } catch {
      setError("Не удалось прочитать параметры сохраненной стратегии.")
    }
  }

  const baseRuns = runs.filter((run) => run.kind === "base" && run.status === "completed")
  const strategyRuns = runs.filter((run) => run.kind === "strategy")
  const presentationSources = { portfolios, presets, runs }

  function handleOptimizationStrategyQueued(queued: CalculationRun, parameters: { rsiPeriod: number; buyLevel: number; sellLevel: number }) {
    setStrategyType("rsi")
    setRsiPeriod(parameters.rsiPeriod)
    setBuyLevel(parameters.buyLevel)
    setSellLevel(parameters.sellLevel)
    setSourceRunId(queued.sourceCalculationRunId ?? sourceRunId)
    setSelectedRunId(queued.id)
    setSaveName("")
    setStrategyMode("manual")
    void refresh()
  }

  function handleMddOptimizationStrategyQueued(queued: CalculationRun, parameters: MddOptimizationParameters) {
    setStrategyType("mdd_mean_reversion")
    setDeals(parameters.deals.map((deal) => ({ entryDrawdown: Math.abs(deal.entryDrawdown) * 100, weight: deal.weight * 100, exitType: deal.exitType, exitValue: deal.exitValue * 100 })))
    setSourceRunId(queued.sourceCalculationRunId ?? sourceRunId)
    setSelectedRunId(queued.id)
    setSaveName("")
    setStrategyMode("manual")
    void refresh()
  }

  return (
    <AppShell onSignOut={() => void signOut().then(() => navigate({ to: "/login" }))}>
      <div>
        <p className="text-sm font-medium text-teal-700">Production workspace</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">Стратегии</h1>
      </div>
      {error ? <Alert variant="destructive" className="mt-5 rounded-md"><AlertCircle className="size-4" /><AlertTitle>Операция не выполнена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!workspace ? <Alert className="mt-6 rounded-md"><AlertTitle>Нет доступного workspace</AlertTitle><AlertDescription>Для работы со стратегиями нужен доступ к workspace.</AlertDescription></Alert> : null}
      {workspace ? <>
        <Card className="mt-6 rounded-lg border-slate-200 shadow-none">
          <CardHeader><CardTitle className="text-base">Стратегии</CardTitle></CardHeader>
          <CardContent>
            <Tabs value={strategyMode} onValueChange={(value) => setStrategyMode(value as "manual" | "optimization")}>
              <TabsList aria-label="Режим работы со стратегией"><TabsTrigger value="manual">Ручной расчет</TabsTrigger><TabsTrigger value="optimization">Оптимизация</TabsTrigger></TabsList>
              <TabsContent value="manual" className="mt-5">
                <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
                  <Field label="Базовый расчет"><Select value={sourceRunId} onValueChange={setSourceRunId} disabled={isLoading || !baseRuns.length}><SelectTrigger><SelectValue placeholder="Выберите базовый расчет" /></SelectTrigger><SelectContent>{baseRuns.map((run) => <SelectItem key={run.id} value={run.id}>{calculationRunOptionLabel(run, presentationSources)}</SelectItem>)}</SelectContent></Select></Field>
                  <Field label="Тип стратегии"><Select value={strategyType} onValueChange={setStrategyType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{strategyTypes.map((type) => <SelectItem key={type} value={type}>{type === "rsi" ? "RSI" : "MDD Mean Reversion"}</SelectItem>)}</SelectContent></Select></Field>
                  <div className="flex items-end"><Button type="submit" className="w-full" disabled={!workspace.canWrite || !sourceRunId || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}Рассчитать стратегию</Button></div>
                  {strategyType === "rsi" ? <RsiFields period={rsiPeriod} buy={buyLevel} sell={sellLevel} onPeriod={setRsiPeriod} onBuy={setBuyLevel} onSell={setSellLevel} /> : <MddFields deals={deals} onDeals={setDeals} />}
                </form>
                {!baseRuns.length ? <p className="mt-4 text-sm text-amber-700">Сначала завершите базовый расчет в разделе «Расчеты».</p> : null}
              </TabsContent>
              <TabsContent value="optimization" className="mt-5"><div className="mb-5 max-w-sm"><Field label="Тип стратегии"><Select value={strategyType} onValueChange={setStrategyType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{strategyTypes.map((type) => <SelectItem key={type} value={type}>{type === "rsi" ? "RSI" : "MDD Mean Reversion"}</SelectItem>)}</SelectContent></Select></Field></div>{strategyType === "mdd_mean_reversion" ? <MddOptimizationPanel workspaceId={workspace.id} canWrite={workspace.canWrite} sourceRuns={baseRuns} sourceRunId={sourceRunId} onSourceRunIdChange={setSourceRunId} sourceRunLabel={(run) => calculationRunOptionLabel(run, presentationSources)} onStrategyQueued={handleMddOptimizationStrategyQueued} /> : <RsiOptimizationPanel workspaceId={workspace.id} canWrite={workspace.canWrite} sourceRuns={baseRuns} sourceRunId={sourceRunId} onSourceRunIdChange={setSourceRunId} sourceRunLabel={(run) => calculationRunOptionLabel(run, presentationSources)} onStrategyQueued={handleOptimizationStrategyQueued} />}</TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <section className="mt-7"><SectionTitle icon={<Play className="size-4" />} title="Запуски стратегий" /><StrategyRunTable runs={strategyRuns} selectedId={selectedRunId} onSelect={setSelectedRunId} onDelete={(run) => void handleDeleteStrategyRun(run)} onDeleteAll={() => void handleDeleteAllStrategyRuns()} canWrite={workspace.canWrite} savedRunIds={new Set(savedStrategies.map((strategy) => strategy.resultCalculationRunId))} presentationSources={presentationSources} /></section>
        <section className="mt-7"><SectionTitle icon={<Save className="size-4" />} title="Сохраненные стратегии" /><SavedStrategyTable items={savedStrategies} onApply={applySaved} onDelete={(strategy) => void handleDeleteSavedStrategy(strategy)} canWrite={workspace.canWrite} /></section>
        <section className="mt-7"><SectionTitle icon={<BookMarked className="size-4" />} title="Результат стратегии" /><StrategyResult workspaceId={workspace.id} details={selectedRun} title={selectedRun ? calculationDisplayName(selectedRun.run, presentationSources) : null} points={points} saveName={saveName} onSaveName={setSaveName} onSave={() => void handleSave()} canWrite={workspace.canWrite} /></section>
      </> : null}
    </AppShell>
  )
}

function calculationRunOptionLabel(run: CalculationRun, presentationSources: { portfolios: Portfolio[]; presets: Preset[]; runs: CalculationRun[] }) {
  return `${calculationSourceLabel(run, presentationSources)} · ${formatCompactDateTime(run.completedAt ?? run.createdAt)} · ${formatCompactPercent(run.finalAccum)}`
}

function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const pad = (item: number) => String(item).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function formatCompactPercent(value: number | null | undefined) {
  return formatPercent(value ?? null).replace(/\s+%$/, "%")
}

function RsiFields({ period, buy, sell, onPeriod, onBuy, onSell }: { period: number; buy: number; sell: number; onPeriod: (value: number) => void; onBuy: (value: number) => void; onSell: (value: number) => void }) {
  return <><NumberField label="RSI период" value={period} onChange={onPeriod} min={1} /><NumberField label="Купить на" value={buy} onChange={onBuy} min={0} max={100} /><NumberField label="Продать на" value={sell} onChange={onSell} min={0} max={100} /></>
}

function MddFields({ deals, onDeals }: { deals: MddDeal[]; onDeals: (items: MddDeal[]) => void }) {
  const sortedDeals = [...deals].sort((left, right) => left.entryDrawdown - right.entryDrawdown)
  const maxConfigWeight = deals.reduce((sum, deal) => sum + deal.weight, 0)
  function update(index: number, key: keyof MddDeal, value: number | MddDeal["exitType"]) { onDeals(deals.map((deal, itemIndex) => itemIndex === index ? { ...deal, [key]: value } : deal)) }
  return <div className="md:col-span-3"><div className="mb-2 flex items-center justify-between"><div><Label>Сделки MDD Mean Reversion</Label><p className="mt-1 text-xs text-slate-500">Каждая строка — независимая сделка. Общий вес равен сумме открытых сделок.</p></div><Button type="button" variant="outline" size="sm" onClick={() => onDeals([...deals, { entryDrawdown: (deals.at(-1)?.entryDrawdown ?? 0) + 10, weight: 10, exitType: "source_dd", exitValue: 0 }])}><Plus />Сделка</Button></div><div className="grid gap-3 md:grid-cols-2">{deals.map((deal, index) => <div key={index} className="grid gap-3 rounded-md border border-slate-200 p-3"><div className="flex items-center justify-between"><p className="text-sm font-medium text-slate-900">Сделка {index + 1}</p><Button type="button" variant="ghost" size="icon" disabled={deals.length === 1} onClick={() => onDeals(deals.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить сделку"><Trash2 /></Button></div><div className="grid gap-2 sm:grid-cols-2"><NumberField label="Вход при Local DD исходника, %" value={deal.entryDrawdown} onChange={(value) => update(index, "entryDrawdown", value)} min={0.01} /><NumberField label="Вес открытия, %" value={deal.weight} onChange={(value) => update(index, "weight", value)} min={0} /><Field label="Выход по"><Select value={deal.exitType} onValueChange={(value) => update(index, "exitType", value as MddDeal["exitType"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="source_dd">DD исходника</SelectItem><SelectItem value="strategy_dd">DD стратегии</SelectItem><SelectItem value="source_hwm">HWM исходника</SelectItem><SelectItem value="strategy_hwm">HWM стратегии</SelectItem></SelectContent></Select></Field><NumberField label="Значение выхода, %" value={deal.exitValue} onChange={(value) => update(index, "exitValue", value)} /></div></div>)}</div><p className="mt-3 text-sm text-slate-600">Максимально возможный вес конфигурации: {formatPercent(maxConfigWeight / 100)}. Порядок расчета: {sortedDeals.map((deal) => `${deal.entryDrawdown}%`).join(" → ")}.</p></div>
}

function StrategyRunTable({ runs, selectedId, onSelect, onDelete, onDeleteAll, canWrite, savedRunIds, presentationSources }: { runs: CalculationRun[]; selectedId: string; onSelect: (id: string) => void; onDelete: (run: CalculationRun) => void; onDeleteAll: () => void; canWrite: boolean; savedRunIds: Set<string>; presentationSources: { portfolios: Portfolio[]; presets: Preset[]; runs: CalculationRun[] } }) {
  return <div className="space-y-3"><div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Расчёт</TableHead><TableHead>Статус</TableHead><TableHead className="hidden md:table-cell">Accum</TableHead><TableHead className="w-44 text-right">Действия</TableHead></TableRow></TableHeader><TableBody>{runs.length === 0 ? <EmptyRow columns={4} text="Запусков стратегий пока нет." /> : runs.map((run) => { const isSaved = savedRunIds.has(run.id); const canDelete = canWrite && !activeStatuses.has(run.status) && !isSaved; return <TableRow key={run.id} data-state={run.id === selectedId ? "selected" : undefined}><TableCell><div className="font-medium">{calculationDisplayName(run, presentationSources)}</div><div className="text-xs text-slate-500">{formatDateTime(run.createdAt)}{isSaved ? " · сохранена" : ""}</div></TableCell><TableCell><Status status={run.status} /></TableCell><TableCell className="hidden md:table-cell">{formatPercent(run.finalAccum)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => onSelect(run.id)}>Открыть</Button><Button size="sm" variant="ghost" disabled={!canDelete} onClick={() => onDelete(run)} aria-label="Удалить запуск стратегии"><Trash2 />Удалить</Button></div></TableCell></TableRow> })}</TableBody></Table></div>{canWrite && runs.length > 0 ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" onClick={onDeleteAll}><Trash2 />Удалить все</Button></div> : null}</div>
}

function StrategyResult({ workspaceId, details, title, points, saveName, onSaveName, onSave, canWrite }: { workspaceId: string; details: CalculationRunDetails | null; title: string | null; points: PortfolioPoint[]; saveName: string; onSaveName: (value: string) => void; onSave: () => void; canWrite: boolean }) {
  const [sourcePoints, setSourcePoints] = useState<PortfolioPoint[]>([])
  const [displayTimeframe, setDisplayTimeframe] = useState<Timeframe | null>(null)
  const [chartMode, setChartMode] = useState<"line" | "histogram">("line")
  const [visibleLines, setVisibleLines] = useState({ diff: false, accum: true, highWaterMark: true, drawdown: true, maxDrawdown: true })
  const [isTableVisible, setIsTableVisible] = useState(false)
  const [visibleTableRows, setVisibleTableRows] = useState(100)
  const strategyParameters = useMemo(() => parseStrategyParameters(details?.run.strategyParametersJson), [details?.run.strategyParametersJson])
  const displayTimeframes = useMemo(() => details ? allowedDisplayTimeframes(details.run.timeframe, timeframeOptions) : [], [details])
  const selectedDisplayTimeframe = displayTimeframe && displayTimeframes.includes(displayTimeframe)
    ? displayTimeframe
    : (details?.run.timeframe ?? "1h")
  const displayedPoints = useMemo(() => details ? aggregatePortfolioPoints(points, details.run.timeframe, selectedDisplayTimeframe) : points, [details, points, selectedDisplayTimeframe])
  const metrics = useMemo(() => deriveMetricSeries(displayedPoints), [displayedPoints])
  const chartPoints = useMemo(() => downsampleForChart(metrics), [metrics])
  const sourceMetrics = useMemo(() => deriveMetricSeries(sourcePoints), [sourcePoints])
  const indicatorPoints = useMemo(() => buildIndicatorPoints(sourceMetrics, details?.run.strategyType ?? null, strategyParameters), [details?.run.strategyType, sourceMetrics, strategyParameters])

  useEffect(() => {
    let cancelled = false
    async function loadSource() {
      if (!details?.run.sourceCalculationRunId) {
        setSourcePoints([])
        return
      }
      const items = await getAllCalculationResult(workspaceId, details.run.sourceCalculationRunId)
      if (!cancelled) setSourcePoints(items)
    }
    void loadSource().catch(() => { if (!cancelled) setSourcePoints([]) })
    return () => { cancelled = true }
  }, [details?.run.sourceCalculationRunId, workspaceId])

  useEffect(() => {
    setDisplayTimeframe(details?.run.timeframe ?? null)
    setChartMode("line")
    setVisibleLines({ diff: false, accum: true, highWaterMark: true, drawdown: true, maxDrawdown: true })
    setIsTableVisible(false)
    setVisibleTableRows(100)
  }, [details?.run.id, details?.run.timeframe])

  useEffect(() => {
    setIsTableVisible(false)
    setVisibleTableRows(100)
  }, [selectedDisplayTimeframe])

  function handleChartModeChange(value: "line" | "histogram") {
    setChartMode(value)
    setVisibleLines(value === "histogram"
      ? { diff: true, accum: false, highWaterMark: false, drawdown: false, maxDrawdown: false }
      : { diff: false, accum: true, highWaterMark: true, drawdown: true, maxDrawdown: true })
  }

  function handleExport() {
    if (!details) return
    const csv = buildStrategyCsv(metrics, indicatorPoints, sourceMetrics, details.run.strategyType)
    downloadCsv(`${slugify(title ?? "strategy_result")}_${formatFileTimestamp(new Date())}.csv`, csv)
  }

  if (!details) return <EmptyPanel text="Выберите запуск стратегии." />
  if (details.run.status !== "completed") return <EmptyPanel text={details.run.status === "failed" || details.run.status === "interrupted" ? `Расчет не завершился: ${details.run.errorCode ?? "unknown_error"}. Повторить его можно на странице «Расчеты».` : "Стратегия выполняется. Статус обновляется автоматически."} />
  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-base font-semibold">{title}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(details.run.periodStart)} - {formatDateTime(details.run.periodEnd)} · расчет {details.run.timeframe} · отображение {selectedDisplayTimeframe}</p></div><Button type="button" variant="outline" onClick={handleExport}><Download />Экспорт CSV</Button></div><div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4"><Metric label="Accum" value={formatPercent(details.run.finalAccum)} /><Metric label="HWM" value={formatPercent(details.run.highWaterMark)} /><Metric label="Макс. просадка" value={formatPercent(details.run.maxDrawdown)} /><Metric label="Сделок" value={details.run.tradeCount.toLocaleString("ru-RU")} /></div><div className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-4 text-sm"><ChartToggle label="Diff" checked={visibleLines.diff} onChange={(checked) => setVisibleLines((current) => ({ ...current, diff: checked }))} /><ChartToggle label="Accum" checked={visibleLines.accum} onChange={(checked) => setVisibleLines((current) => ({ ...current, accum: checked }))} /><ChartToggle label="HWM" checked={visibleLines.highWaterMark} onChange={(checked) => setVisibleLines((current) => ({ ...current, highWaterMark: checked }))} /><ChartToggle label="DD" checked={visibleLines.drawdown} onChange={(checked) => setVisibleLines((current) => ({ ...current, drawdown: checked }))} /><ChartToggle label="MDD" checked={visibleLines.maxDrawdown} onChange={(checked) => setVisibleLines((current) => ({ ...current, maxDrawdown: checked }))} /></div><div className="flex flex-wrap items-center gap-2"><Select value={selectedDisplayTimeframe} onValueChange={(value) => setDisplayTimeframe(value as Timeframe)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{displayTimeframes.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={chartMode} onValueChange={(value) => handleChartModeChange(value as "line" | "histogram")}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="line">Линии</SelectItem><SelectItem value="histogram">Гистограмма</SelectItem></SelectContent></Select></div></div><ChartContainer config={chartConfig} className="h-[360px] w-full aspect-auto" aria-label="Итог стратегии: Diff, Accum, HWM, DD и MDD"><ComposedChart data={chartPoints} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} /><YAxis width={76} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPercent(Number(value))} />}/>{visibleLines.diff ? chartMode === "histogram" ? <Bar dataKey="diff" fill="var(--color-diff)" opacity={0.65} /> : <Line type="monotone" dataKey="diff" stroke="var(--color-diff)" strokeWidth={1.25} dot={false} /> : null}{visibleLines.accum ? <Line type="monotone" dataKey="accum" stroke="var(--color-accum)" strokeWidth={1.75} dot={false} /> : null}{visibleLines.highWaterMark ? <Line type="monotone" dataKey="highWaterMark" stroke="var(--color-highWaterMark)" strokeWidth={1.5} dot={false} /> : null}{visibleLines.drawdown ? <Line type="monotone" dataKey="drawdown" stroke="var(--color-drawdown)" strokeWidth={1.35} dot={false} /> : null}{visibleLines.maxDrawdown ? <Line type="monotone" dataKey="maxDrawdown" stroke="var(--color-maxDrawdown)" strokeWidth={1.35} dot={false} strokeDasharray="5 5" /> : null}<Brush dataKey="label" height={28} stroke="#0f766e" travellerWidth={8} /></ComposedChart></ChartContainer></div><StrategyIndicatorChart strategyType={details.run.strategyType} points={indicatorPoints} parameters={strategyParameters} /><StrategyResultTable strategyType={details.run.strategyType} metrics={metrics} sourceMetrics={sourceMetrics} isVisible={isTableVisible} visibleRows={visibleTableRows} onToggle={() => setIsTableVisible((current) => !current)} onShowMore={() => setVisibleTableRows((current) => Math.min(current + 500, metrics.length))} /><div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4"><Input className="max-w-sm" value={saveName} onChange={(event) => onSaveName(event.target.value)} placeholder="Название сохраненной стратегии" disabled={!canWrite} /><Button onClick={onSave} disabled={!canWrite || !saveName.trim()}><Save />Сохранить стратегию</Button></div></div>
}

function SavedStrategyTable({ items, onApply, onDelete, canWrite }: { items: SavedStrategy[]; onApply: (item: SavedStrategy) => void; onDelete: (item: SavedStrategy) => void; canWrite: boolean }) { return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Название</TableHead><TableHead>Тип</TableHead><TableHead className="hidden md:table-cell">Версия</TableHead><TableHead className="w-44 text-right">Действия</TableHead></TableRow></TableHeader><TableBody>{items.length === 0 ? <EmptyRow columns={4} text="Сохраненных стратегий пока нет." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</div></TableCell><TableCell>{item.strategyType === "rsi" ? "RSI" : "MDD Mean Reversion"}</TableCell><TableCell className="hidden md:table-cell">v{item.version}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => onApply(item)}>Применить</Button>{canWrite ? <Button variant="ghost" size="sm" onClick={() => onDelete(item)}><Trash2 />Удалить</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table></div> }

function StrategyResultTable({ strategyType, metrics, sourceMetrics, isVisible, visibleRows, onToggle, onShowMore }: { strategyType: string | null; metrics: ReturnType<typeof deriveMetricSeries>; sourceMetrics: ReturnType<typeof deriveMetricSeries>; isVisible: boolean; visibleRows: number; onToggle: () => void; onShowMore: () => void }) {
  const rows = metrics.slice(0, visibleRows)
  const sourceFallbackByTimestamp = buildSourceFallbackByTimestamp(sourceMetrics)
  const isMdd = strategyType === "mdd_mean_reversion"
  const remainingRows = Math.max(metrics.length - rows.length, 0)
  return <div className="space-y-3"><div className="flex justify-start"><Button type="button" variant="outline" onClick={onToggle}>{isVisible ? <ChevronUp /> : <TableProperties />}{isVisible ? "Скрыть данные" : `Показать данные (${metrics.length.toLocaleString("ru-RU")})`}</Button></div>{isVisible ? <><div className="px-4 py-3 text-xs text-slate-500">Показаны первые {rows.length.toLocaleString("ru-RU")} строк из {metrics.length.toLocaleString("ru-RU")}. Полный набор строк можно выгрузить через CSV.</div><div className="overflow-x-auto rounded-lg border border-slate-200"><Table className="min-w-[1320px] text-xs"><TableHeader><TableRow><TableHead className="whitespace-nowrap">Время</TableHead>{isMdd ? <><TableHead className="whitespace-nowrap text-right">IN Diff</TableHead><TableHead className="whitespace-nowrap text-right">IN Accum</TableHead><TableHead className="whitespace-nowrap text-right">IN DD</TableHead><TableHead className="whitespace-nowrap text-right">Local DD</TableHead><TableHead className="whitespace-nowrap">Сигнал</TableHead><TableHead className="whitespace-nowrap">Исполнение</TableHead><TableHead className="whitespace-nowrap text-right">Active deals</TableHead><TableHead className="whitespace-nowrap text-right">Weight</TableHead><TableHead className="whitespace-nowrap text-right">OUT Diff</TableHead><TableHead className="whitespace-nowrap text-right">OUT Accum</TableHead><TableHead className="whitespace-nowrap text-right">OUT HWM</TableHead><TableHead className="whitespace-nowrap text-right">OUT DD</TableHead><TableHead className="whitespace-nowrap text-right">OUT MDD</TableHead><TableHead className="whitespace-nowrap text-right">Max config weight</TableHead><TableHead className="whitespace-nowrap text-right">Max realized weight</TableHead></> : <><TableHead className="whitespace-nowrap text-right">IN Diff</TableHead><TableHead className="whitespace-nowrap text-right">IN Accum</TableHead><TableHead className="whitespace-nowrap text-right">RSI</TableHead><TableHead className="whitespace-nowrap">Сигнал</TableHead><TableHead className="whitespace-nowrap">Исполнение</TableHead><TableHead className="whitespace-nowrap text-right">Weight</TableHead><TableHead className="whitespace-nowrap text-right">OUT Diff</TableHead><TableHead className="whitespace-nowrap text-right">OUT Accum</TableHead><TableHead className="whitespace-nowrap text-right">OUT HWM</TableHead><TableHead className="whitespace-nowrap text-right">OUT DD</TableHead><TableHead className="whitespace-nowrap text-right">OUT MDD</TableHead></>}</TableRow></TableHeader><TableBody>{rows.map((point) => <StrategyResultRow key={point.timestamp} point={point} sourceFallback={sourceFallbackByTimestamp.get(point.timestamp)} isMdd={isMdd} />)}</TableBody></Table></div>{remainingRows > 0 ? <div className="border-t border-slate-200 px-4 py-3"><Button type="button" variant="outline" onClick={onShowMore}>Показать ещё {Math.min(500, remainingRows).toLocaleString("ru-RU")}</Button></div> : null}</> : null}</div>
}

function StrategyResultRow({ point, sourceFallback, isMdd }: { point: ReturnType<typeof deriveMetricSeries>[number]; sourceFallback?: SourceFallbackPoint; isMdd: boolean }) {
  const fields = normalizeStrategyFields(point.fields)
  if (fields.source_diff === undefined && sourceFallback) fields.source_diff = sourceFallback.diff
  if (fields.source_accum === undefined && sourceFallback) fields.source_accum = sourceFallback.accum
  if (fields.source_dd === undefined && sourceFallback) fields.source_dd = sourceFallback.drawdown
  if (fields.local_mdd === undefined && sourceFallback) fields.local_mdd = sourceFallback.localDrawdown
  if (fields.weight === undefined && fields.position === undefined) fields.weight = inferWeight(point.diff, numberField(fields.source_diff))
  const weight = numberField(fields.weight ?? fields.position)
  if (isMdd && fields.max_realized_weight === undefined && weight !== null) fields.max_realized_weight = weight
  return <TableRow><TableCell className="whitespace-nowrap py-2">{point.label}</TableCell>{isMdd ? <><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.source_diff), 3)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.source_accum))}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.source_dd ?? fields.base_dd))}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.local_mdd))}</TableCell><TableCell className="max-w-48 py-2">{textField(fields.signal)}</TableCell><TableCell className="max-w-48 py-2">{textField(fields.execution)}</TableCell><TableCell className="py-2 text-right tabular-nums">{textField(fields.active_deals)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(weight)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.diff, 3)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.accum)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.highWaterMark)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.drawdown)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.maxDrawdown)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.max_config_weight))}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.max_realized_weight))}</TableCell></> : <><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.source_diff), 3)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(numberField(fields.source_accum))}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatNumber(numberField(fields.rsi))}</TableCell><TableCell className="max-w-48 py-2">{textField(fields.signal)}</TableCell><TableCell className="max-w-48 py-2">{textField(fields.execution)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(weight)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.diff, 3)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.accum)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.highWaterMark)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.drawdown)}</TableCell><TableCell className="py-2 text-right tabular-nums">{formatPercent(point.maxDrawdown)}</TableCell></>}</TableRow>
}

type SourceFallbackPoint = { diff: number; accum: number; drawdown: number; localDrawdown: number }

function buildSourceFallbackByTimestamp(sourceMetrics: ReturnType<typeof deriveMetricSeries>) {
  let localDrawdown = 0
  return new Map(sourceMetrics.map((point) => {
    localDrawdown = point.drawdown >= 0 ? 0 : Math.min(localDrawdown, point.drawdown)
    return [point.timestamp, { diff: point.diff, accum: point.accum, drawdown: point.drawdown, localDrawdown } satisfies SourceFallbackPoint]
  }))
}

function inferWeight(outDiff: number, sourceDiff: number | null) {
  if (sourceDiff === null || Math.abs(sourceDiff) < 1e-12) return Math.abs(outDiff) < 1e-12 ? 0 : null
  const weight = outDiff / sourceDiff
  return Number.isFinite(weight) ? weight : null
}

function StrategyIndicatorChart({ strategyType, points, parameters }: { strategyType: string | null; points: StrategyIndicatorPoint[]; parameters: StrategyParameters | null }) {
  if (points.length === 0) return <EmptyPanel text="График торговли появится после загрузки исходного ряда стратегии." />
  if (strategyType === "rsi") {
    const rsiParameters = parameters?.type === "rsi" ? parameters : null
    return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-3"><p className="text-sm font-semibold text-slate-950">График торговли RSI</p><p className="mt-1 text-xs text-slate-500">RSI считается по исходной equity-кривой базового расчета. Линии покупки/продажи показывают выбранные уровни.</p></div><ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto" aria-label="График RSI"><ComposedChart data={downsampleForChart(points)} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} width={56} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => Number(value).toFixed(2)} />} /><ReferenceLine y={rsiParameters?.buyLevel ?? 30} stroke="#16a34a" strokeDasharray="4 4" label="Купить" /><ReferenceLine y={rsiParameters?.sellLevel ?? 70} stroke="#dc2626" strokeDasharray="4 4" label="Продать" /><Line type="monotone" dataKey="rsi" stroke="var(--color-rsi)" strokeWidth={1.6} dot={false} connectNulls /></ComposedChart></ChartContainer></div>
  }
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-3"><p className="text-sm font-semibold text-slate-950">График модели MDD</p><p className="mt-1 text-xs text-slate-500">Показывает текущий DD исходника и Local DD текущего цикла, по которому срабатывают входы сделок.</p></div><ChartContainer config={chartConfig} className="h-[280px] w-full aspect-auto" aria-label="График MDD модели"><ComposedChart data={downsampleForChart(points)} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} /><YAxis width={76} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPercent(Number(value))} />} /><ReferenceLine y={0} stroke="#94a3b8" /><Line type="monotone" dataKey="sourceDrawdown" stroke="var(--color-sourceDrawdown)" strokeWidth={1.45} dot={false} /><Line type="monotone" dataKey="localDrawdown" stroke="var(--color-localDrawdown)" strokeWidth={1.45} dot={false} strokeDasharray="5 5" /></ComposedChart></ChartContainer></div>
}

type StrategyParameters =
  | { type: "rsi"; period: number; buyLevel: number; sellLevel: number }
  | { type: "mdd"; deals: MddDeal[] }

type StrategyIndicatorPoint = {
  timestamp: string
  label: string
  rsi?: number | null
  sourceDrawdown?: number
  localDrawdown?: number
}

function parseStrategyParameters(json: string | null | undefined): StrategyParameters | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as Record<string, unknown>
    if (typeof value.rsiPeriod === "number") {
      return {
        type: "rsi",
        period: Math.max(1, Math.trunc(value.rsiPeriod)),
        buyLevel: numberValue(value.buyLevel, 30),
        sellLevel: numberValue(value.sellLevel, 70),
      }
    }
    if (Array.isArray(value.deals)) {
      return {
        type: "mdd",
        deals: value.deals.map((deal) => {
          const item = deal as Record<string, unknown>
          return {
            entryDrawdown: Math.abs(numberValue(item.entryDrawdown, -0.1) * 100),
            weight: numberValue(item.weight, 0.1) * 100,
            exitType: typeof item.exitType === "string" && ["source_dd", "strategy_dd", "source_hwm", "strategy_hwm"].includes(item.exitType) ? item.exitType as MddDeal["exitType"] : "source_dd",
            exitValue: numberValue(item.exitValue, 0) * 100,
          }
        }),
      }
    }
  } catch {
    return null
  }
  return null
}

function buildIndicatorPoints(sourceMetrics: ReturnType<typeof deriveMetricSeries>, strategyType: string | null, parameters: StrategyParameters | null): StrategyIndicatorPoint[] {
  if (strategyType === "rsi") {
    const period = parameters?.type === "rsi" ? parameters.period : 14
    const rsi = calculateRsi(sourceMetrics.map((point) => point.accum), period)
    return sourceMetrics.map((point, index) => ({ timestamp: point.timestamp, label: point.label, rsi: rsi[index] }))
  }

  let localDrawdown = 0
  return sourceMetrics.map((point) => {
    if (point.drawdown >= 0) {
      localDrawdown = 0
    } else {
      localDrawdown = Math.min(localDrawdown, point.drawdown)
    }
    return {
      timestamp: point.timestamp,
      label: point.label,
      sourceDrawdown: point.drawdown,
      localDrawdown,
    }
  })
}

function calculateRsi(accumValues: number[], period: number) {
  const values: Array<number | null> = Array(accumValues.length).fill(null)
  if (accumValues.length <= period) return values
  let gainSum = 0
  let lossSum = 0
  for (let index = 1; index <= period; index++) {
    const delta = accumValues[index] - accumValues[index - 1]
    if (delta >= 0) gainSum += delta
    else lossSum -= delta
  }
  let averageGain = gainSum / period
  let averageLoss = lossSum / period
  values[period] = toRsi(averageGain, averageLoss)
  for (let index = period + 1; index < accumValues.length; index++) {
    const delta = accumValues[index] - accumValues[index - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
    values[index] = toRsi(averageGain, averageLoss)
  }
  return values
}

function toRsi(averageGain: number, averageLoss: number) {
  if (averageLoss === 0) return 100
  const rs = averageGain / averageLoss
  return 100 - 100 / (1 + rs)
}

function buildStrategyCsv(metrics: ReturnType<typeof deriveMetricSeries>, indicators: StrategyIndicatorPoint[], sourceMetrics: ReturnType<typeof deriveMetricSeries>, strategyType: string | null) {
  const indicatorByTimestamp = new Map(indicators.map((point) => [point.timestamp, point]))
  const sourceByTimestamp = buildSourceFallbackByTimestamp(sourceMetrics)
  const isRsi = strategyType === "rsi"
  const columns = isRsi
    ? [
      { id: "time", label: "Time" },
      { id: "source_diff", label: "IN Diff" },
      { id: "source_accum", label: "IN Accum" },
      { id: "rsi", label: "RSI" },
      { id: "signal", label: "Signal" },
      { id: "execution", label: "Execution" },
      { id: "weight", label: "Weight" },
      { id: "out_diff", label: "OUT Diff" },
      { id: "out_accum", label: "OUT Accum" },
      { id: "out_hwm", label: "OUT HWM" },
      { id: "out_dd", label: "OUT DD" },
      { id: "out_mdd", label: "OUT MDD" },
    ]
    : [
      { id: "time", label: "Time" },
      { id: "source_diff", label: "IN Diff" },
      { id: "source_accum", label: "IN Accum" },
      { id: "source_dd", label: "IN DD" },
      { id: "local_mdd", label: "Local DD" },
      { id: "signal", label: "Signal" },
      { id: "execution", label: "Execution" },
      { id: "active_deals", label: "Active deals" },
      { id: "weight", label: "Weight" },
      { id: "out_diff", label: "OUT Diff" },
      { id: "out_accum", label: "OUT Accum" },
      { id: "out_hwm", label: "OUT HWM" },
      { id: "out_dd", label: "OUT DD" },
      { id: "out_mdd", label: "OUT MDD" },
      { id: "max_config_weight", label: "Max config weight" },
      { id: "max_realized_weight", label: "Max realized weight" },
    ]
  const lines = metrics.map((point) => {
    const indicator = indicatorByTimestamp.get(point.timestamp)
    const sourcePoint = sourceByTimestamp.get(point.timestamp)
    const fields = normalizeStrategyFields(point.fields)
    if (fields.source_diff === undefined) fields.source_diff = sourcePoint?.diff ?? null
    if (fields.source_accum === undefined) fields.source_accum = sourcePoint?.accum ?? null
    if (isRsi && fields.rsi === undefined) fields.rsi = indicator?.rsi ?? null
    if (!isRsi) {
      if (fields.source_dd === undefined) fields.source_dd = sourcePoint?.drawdown ?? indicator?.sourceDrawdown ?? null
      if (fields.local_mdd === undefined) fields.local_mdd = sourcePoint?.localDrawdown ?? indicator?.localDrawdown ?? null
    }
    if (fields.weight === undefined && fields.position === undefined) fields.weight = inferWeight(point.diff, numberField(fields.source_diff))
    if (fields.position !== undefined && fields.weight === undefined) fields.weight = fields.position
    const values: Record<string, string | number | boolean | null | undefined> = {
      time: point.label,
      source_diff: fields.source_diff,
      source_accum: fields.source_accum,
      source_dd: fields.source_dd,
      local_mdd: fields.local_mdd,
      rsi: fields.rsi,
      signal: fields.signal,
      execution: fields.execution,
      active_deals: fields.active_deals,
      weight: fields.weight,
      out_diff: point.diff,
      out_accum: point.accum,
      out_hwm: point.highWaterMark,
      out_dd: point.drawdown,
      out_mdd: point.maxDrawdown,
      max_config_weight: fields.max_config_weight,
      max_realized_weight: fields.max_realized_weight,
    }
    return columns.map((column) => formatCsvValue(values[column.id])).join(",")
  })
  return [columns.map((column) => formatCsvValue(column.label)).join(","), ...lines].join("\n")
}

function normalizeStrategyFields(fields: Record<string, unknown> | undefined) { const values = Object.fromEntries(Object.entries(fields ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null)) as Record<string, string | number | boolean | null>; if (values.base_dd !== undefined && values.source_dd === undefined) values.source_dd = values.base_dd; if (values.position !== undefined && values.weight === undefined) values.weight = values.position; return values }
function formatCsvValue(value: number | null | undefined | string | boolean) {
  const raw = value === null || value === undefined ? "" : String(value)
  const text = stripSpreadsheetApostrophe(raw)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
function stripSpreadsheetApostrophe(value: string) {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith("'")) return value
  const candidate = trimmed.slice(1).replace(",", ".")
  return /^[-+]?\d+(\.\d+)?$/.test(candidate) ? value.slice(0, value.length - trimmed.length) + trimmed.slice(1) : value
}

function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function formatFileTimestamp(value: Date) { return value.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15) }
function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "strategy_result"
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" onChange={(event) => onChange(Number(event.target.value))} /></Field> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div> }
function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) { return <div className="mb-3 flex items-center gap-2 text-teal-700"><span>{icon}</span><h2 className="text-base font-semibold text-slate-950">{title}</h2></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-white px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div> }
function EmptyRow({ columns, text }: { columns: number; text: string }) { return <TableRow><TableCell colSpan={columns} className="py-8 text-center text-sm text-slate-500">{text}</TableCell></TableRow> }
function EmptyPanel({ text }: { text: string }) { return <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500">{text}</div> }
function Status({ status }: { status: CalculationRun["status"] }) { const labels = { queued: "В очереди", running: "Считается", completed: "Готово", failed: "Ошибка", interrupted: "Прервана" }; const classes = { queued: "border-amber-200 bg-amber-50 text-amber-800", running: "border-sky-200 bg-sky-50 text-sky-800", completed: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-rose-200 bg-rose-50 text-rose-800", interrupted: "border-orange-200 bg-orange-50 text-orange-800" }; return <Badge variant="outline" className={classes[status]}>{labels[status]}</Badge> }
function numberValue(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback }
function numberField(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null }
function textField(value: unknown) { return value === null || value === undefined || value === "" ? "-" : String(value) }
function formatNumber(value: number | null) { return value === null ? "-" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) }
function toDisplayMessage(error: unknown) { return displayApiError(error) }
function ChartToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="flex items-center gap-2"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />{label}</label> }
