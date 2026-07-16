import { AppShell } from "@/components/app-shell"
import { calculationDisplayName } from "@/features/calculations/run-presentation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
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
} from "@/lib/api"
import { deriveMetricSeries, downsampleForChart, formatDateTime, formatPercent } from "@/lib/metrics"
import { useSession } from "@/features/session/session-context"
import { AlertCircle, BookMarked, LoaderCircle, Play, Plus, Save, Trash2 } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { toast } from "sonner"

type MddLevel = { drawdown: number; weight: number }

const defaultLevels: MddLevel[] = [
  { drawdown: 10, weight: 10 },
  { drawdown: 20, weight: 20 },
  { drawdown: 30, weight: 30 },
  { drawdown: 40, weight: 40 },
  { drawdown: 50, weight: 50 },
]

const chartConfig = {
  accum: { label: "Доходность", color: "#2563eb" },
  drawdown: { label: "Просадка", color: "#e11d48" },
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
  const [rsiPeriod, setRsiPeriod] = useState(14)
  const [buyLevel, setBuyLevel] = useState(30)
  const [sellLevel, setSellLevel] = useState(70)
  const [takeProfit, setTakeProfit] = useState(1)
  const [levels, setLevels] = useState<MddLevel[]>(defaultLevels)
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
        : { levels: levels.map((level) => ({ drawdown: -Math.abs(level.drawdown) / 100, weight: level.weight / 100 })), takeProfit: takeProfit / 100 }
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
      } else if (Array.isArray(parameters.levels)) {
        setLevels(parameters.levels.map((level) => {
          const item = level as Record<string, unknown>
          return { drawdown: Math.abs(numberValue(item.drawdown, -0.1) * 100), weight: numberValue(item.weight, 0.1) * 100 }
        }))
        setTakeProfit(numberValue(parameters.takeProfit, 0.01) * 100)
      }
      toast.success("Параметры применены")
    } catch {
      setError("Не удалось прочитать параметры сохраненной стратегии.")
    }
  }

  const baseRuns = runs.filter((run) => run.kind === "base" && run.status === "completed")
  const strategyRuns = runs.filter((run) => run.kind === "strategy")
  const presentationSources = { portfolios, presets, runs }

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
          <CardHeader><CardTitle className="text-base">Новая стратегия</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-3" onSubmit={handleSubmit}>
              <Field label="Базовый расчет"><Select value={sourceRunId} onValueChange={setSourceRunId} disabled={isLoading || !baseRuns.length}><SelectTrigger><SelectValue placeholder="Выберите базовый расчет" /></SelectTrigger><SelectContent>{baseRuns.map((run) => <SelectItem key={run.id} value={run.id}>{calculationDisplayName(run, presentationSources)} · {formatPercent(run.finalAccum)}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Тип стратегии"><Select value={strategyType} onValueChange={setStrategyType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{strategyTypes.map((type) => <SelectItem key={type} value={type}>{type === "rsi" ? "RSI" : "MDD Mean Reversion"}</SelectItem>)}</SelectContent></Select></Field>
              <div className="flex items-end"><Button type="submit" className="w-full" disabled={!workspace.canWrite || !sourceRunId || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}Рассчитать стратегию</Button></div>
              {strategyType === "rsi" ? <RsiFields period={rsiPeriod} buy={buyLevel} sell={sellLevel} onPeriod={setRsiPeriod} onBuy={setBuyLevel} onSell={setSellLevel} /> : <MddFields levels={levels} takeProfit={takeProfit} onLevels={setLevels} onTakeProfit={setTakeProfit} />}
            </form>
            {!baseRuns.length ? <p className="mt-4 text-sm text-amber-700">Сначала завершите базовый расчет в разделе «Расчеты».</p> : null}
          </CardContent>
        </Card>

        <section className="mt-7"><SectionTitle icon={<Play className="size-4" />} title="Запуски стратегий" /><StrategyRunTable runs={strategyRuns} selectedId={selectedRunId} onSelect={setSelectedRunId} presentationSources={presentationSources} /></section>
        <section className="mt-7"><SectionTitle icon={<BookMarked className="size-4" />} title="Результат стратегии" /><StrategyResult details={selectedRun} title={selectedRun ? calculationDisplayName(selectedRun.run, presentationSources) : null} points={points} saveName={saveName} onSaveName={setSaveName} onSave={() => void handleSave()} canWrite={workspace.canWrite} /></section>
        <section className="mt-7"><SectionTitle icon={<Save className="size-4" />} title="Сохраненные стратегии" /><SavedStrategyTable items={savedStrategies} onApply={applySaved} /></section>
      </> : null}
    </AppShell>
  )
}

function RsiFields({ period, buy, sell, onPeriod, onBuy, onSell }: { period: number; buy: number; sell: number; onPeriod: (value: number) => void; onBuy: (value: number) => void; onSell: (value: number) => void }) {
  return <><NumberField label="RSI период" value={period} onChange={onPeriod} min={1} /><NumberField label="Купить на" value={buy} onChange={onBuy} min={0} max={100} /><NumberField label="Продать на" value={sell} onChange={onSell} min={0} max={100} /></>
}

function MddFields({ levels, takeProfit, onLevels, onTakeProfit }: { levels: MddLevel[]; takeProfit: number; onLevels: (items: MddLevel[]) => void; onTakeProfit: (value: number) => void }) {
  function update(index: number, key: keyof MddLevel, value: number) { onLevels(levels.map((level, itemIndex) => itemIndex === index ? { ...level, [key]: value } : level)) }
  return <div className="md:col-span-3"><div className="mb-2 flex items-center justify-between"><Label>Уровни входа MDD</Label><Button type="button" variant="outline" size="sm" onClick={() => onLevels([...levels, { drawdown: (levels.at(-1)?.drawdown ?? 0) + 5, weight: levels.at(-1)?.weight ?? 0 }])}><Plus />Уровень</Button></div><div className="grid gap-3 md:grid-cols-3">{levels.map((level, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-md border border-slate-200 p-3"><NumberField label={`DD ${index + 1}, %`} value={level.drawdown} onChange={(value) => update(index, "drawdown", value)} min={0.01} /><NumberField label={`Вес ${index + 1}, %`} value={level.weight} onChange={(value) => update(index, "weight", value)} min={0} /><Button type="button" variant="ghost" size="icon" disabled={levels.length === 1} onClick={() => onLevels(levels.filter((_, itemIndex) => itemIndex !== index))} aria-label="Удалить уровень"><Trash2 /></Button></div>)}</div><div className="mt-3 max-w-xs"><NumberField label="Выход TP, %" value={takeProfit} onChange={onTakeProfit} min={0} /></div></div>
}

function StrategyRunTable({ runs, selectedId, onSelect, presentationSources }: { runs: CalculationRun[]; selectedId: string; onSelect: (id: string) => void; presentationSources: { portfolios: Portfolio[]; presets: Preset[]; runs: CalculationRun[] } }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Расчёт</TableHead><TableHead>Статус</TableHead><TableHead className="hidden md:table-cell">Доходность</TableHead><TableHead className="w-24 text-right">Результат</TableHead></TableRow></TableHeader><TableBody>{runs.length === 0 ? <EmptyRow columns={4} text="Запусков стратегий пока нет." /> : runs.map((run) => <TableRow key={run.id} data-state={run.id === selectedId ? "selected" : undefined}><TableCell><div className="font-medium">{calculationDisplayName(run, presentationSources)}</div><div className="text-xs text-slate-500">{formatDateTime(run.createdAt)}</div></TableCell><TableCell><Status status={run.status} /></TableCell><TableCell className="hidden md:table-cell">{formatPercent(run.finalAccum)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => onSelect(run.id)}>Открыть</Button></TableCell></TableRow>)}</TableBody></Table></div>
}

function StrategyResult({ details, title, points, saveName, onSaveName, onSave, canWrite }: { details: CalculationRunDetails | null; title: string | null; points: PortfolioPoint[]; saveName: string; onSaveName: (value: string) => void; onSave: () => void; canWrite: boolean }) {
  const metrics = useMemo(() => deriveMetricSeries(points), [points])
  const chartPoints = useMemo(() => downsampleForChart(metrics), [metrics])
  if (!details) return <EmptyPanel text="Выберите запуск стратегии." />
  if (details.run.status !== "completed") return <EmptyPanel text={details.run.status === "failed" ? `Расчет завершился с ошибкой: ${details.run.errorCode ?? "unknown_error"}.` : "Стратегия выполняется. Статус обновляется автоматически."} />
  return <div className="space-y-5"><div><p className="text-base font-semibold">{title}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(details.run.periodStart)} - {formatDateTime(details.run.periodEnd)} · {details.run.timeframe}</p></div><div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4"><Metric label="Доходность" value={formatPercent(details.run.finalAccum)} /><Metric label="HWM" value={formatPercent(details.run.highWaterMark)} /><Metric label="Макс. просадка" value={formatPercent(details.run.maxDrawdown)} /><Metric label="Сделок" value={details.run.tradeCount.toLocaleString("ru-RU")} /></div><div className="rounded-lg border border-slate-200 bg-white p-4"><ChartContainer config={chartConfig} className="h-[340px] w-full aspect-auto"><LineChart data={chartPoints}><CartesianGrid vertical={false} /><XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} /><YAxis yAxisId="dd" width={72} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 1)} /><YAxis yAxisId="accum" orientation="right" width={76} tickLine={false} axisLine={false} tickFormatter={(value) => formatPercent(Number(value), 0)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => formatPercent(Number(value))} />} /><Line yAxisId="accum" dataKey="accum" stroke="var(--color-accum)" dot={false} strokeWidth={1.75} /><Line yAxisId="dd" dataKey="drawdown" stroke="var(--color-drawdown)" dot={false} strokeWidth={1.5} /></LineChart></ChartContainer></div><div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4"><Input className="max-w-sm" value={saveName} onChange={(event) => onSaveName(event.target.value)} placeholder="Название сохраненной стратегии" disabled={!canWrite} /><Button onClick={onSave} disabled={!canWrite || !saveName.trim()}><Save />Сохранить стратегию</Button></div></div>
}

function SavedStrategyTable({ items, onApply }: { items: SavedStrategy[]; onApply: (item: SavedStrategy) => void }) { return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Название</TableHead><TableHead>Тип</TableHead><TableHead className="hidden md:table-cell">Версия</TableHead><TableHead className="w-28 text-right">Параметры</TableHead></TableRow></TableHeader><TableBody>{items.length === 0 ? <EmptyRow columns={4} text="Сохраненных стратегий пока нет." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">{formatDateTime(item.createdAt)}</div></TableCell><TableCell>{item.strategyType === "rsi" ? "RSI" : "MDD Mean Reversion"}</TableCell><TableCell className="hidden md:table-cell">v{item.version}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => onApply(item)}>Применить</Button></TableCell></TableRow>)}</TableBody></Table></div> }

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" onChange={(event) => onChange(Number(event.target.value))} /></Field> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div> }
function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) { return <div className="mb-3 flex items-center gap-2 text-teal-700"><span>{icon}</span><h2 className="text-base font-semibold text-slate-950">{title}</h2></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-white px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div> }
function EmptyRow({ columns, text }: { columns: number; text: string }) { return <TableRow><TableCell colSpan={columns} className="py-8 text-center text-sm text-slate-500">{text}</TableCell></TableRow> }
function EmptyPanel({ text }: { text: string }) { return <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500">{text}</div> }
function Status({ status }: { status: CalculationRun["status"] }) { const labels = { queued: "В очереди", running: "Считается", completed: "Готово", failed: "Ошибка" }; const classes = { queued: "border-amber-200 bg-amber-50 text-amber-800", running: "border-sky-200 bg-sky-50 text-sky-800", completed: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-rose-200 bg-rose-50 text-rose-800" }; return <Badge variant="outline" className={classes[status]}>{labels[status]}</Badge> }
function numberValue(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback }
function toDisplayMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить запрос." }
