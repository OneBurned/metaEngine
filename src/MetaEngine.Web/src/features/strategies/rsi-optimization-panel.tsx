import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  getOptimizationJob,
  listOptimizationJobs,
  queueOptimization,
  queueStrategyFromOptimization,
  stopOptimizationJob,
  type CalculationRun,
  type OptimizationJob,
  type OptimizationJobDetails,
  type OptimizationJobStatus,
  type OptimizationResult,
} from "@/lib/api"
import { formatDateTime, formatPercent } from "@/lib/metrics"
import { ArrowDown, ArrowUp, ArrowUpDown, LoaderCircle, Play, Square } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type RsiParameters = { rsiPeriod: number; buyLevel: number; sellLevel: number }
type SortKey = "rank" | "score" | "compoundedAccum" | "averageAccum" | "worstAccum" | "worstMaxDrawdown" | "tradeCount"
type SortOrder = "asc" | "desc"

const activeStatuses = new Set<OptimizationJobStatus>(["queued", "running", "stopping"])

export function RsiOptimizationPanel({
  workspaceId,
  canWrite,
  sourceRuns,
  sourceRunId,
  onSourceRunIdChange,
  sourceRunLabel,
  onStrategyQueued,
}: {
  workspaceId: string
  canWrite: boolean
  sourceRuns: CalculationRun[]
  sourceRunId: string
  onSourceRunIdChange: (value: string) => void
  sourceRunLabel: (run: CalculationRun) => string
  onStrategyQueued: (run: CalculationRun, parameters: RsiParameters) => void
}) {
  const [periodFrom, setPeriodFrom] = useState(5)
  const [periodTo, setPeriodTo] = useState(30)
  const [periodStep, setPeriodStep] = useState(1)
  const [buyFrom, setBuyFrom] = useState(20)
  const [buyTo, setBuyTo] = useState(45)
  const [buyStep, setBuyStep] = useState(5)
  const [sellFrom, setSellFrom] = useState(55)
  const [sellTo, setSellTo] = useState(80)
  const [sellStep, setSellStep] = useState(5)
  const [sampleCount, setSampleCount] = useState(3)
  const [topCount, setTopCount] = useState(100)
  const [maxDrawdown, setMaxDrawdown] = useState("")
  const [minimumTrades, setMinimumTrades] = useState("")
  const [minimumProfitableSamples, setMinimumProfitableSamples] = useState("")
  const [jobs, setJobs] = useState<OptimizationJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState("")
  const [details, setDetails] = useState<OptimizationJobDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAllJobs, setShowAllJobs] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; order: SortOrder }>({ key: "score", order: "desc" })

  const refreshJobs = useCallback(async () => {
    try {
      const items = await listOptimizationJobs(workspaceId)
      setJobs(items)
      setSelectedJobId((current) => items.some((item) => item.id === current) ? current : (items[0]?.id ?? ""))
      setError(null)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  const refreshDetails = useCallback(async () => {
    if (!selectedJobId) {
      setDetails(null)
      return
    }
    try {
      setDetails(await getOptimizationJob(workspaceId, selectedJobId))
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }, [selectedJobId, workspaceId])

  useEffect(() => { void refreshJobs() }, [refreshJobs])
  useEffect(() => { void refreshDetails() }, [refreshDetails])
  useEffect(() => {
    if (!jobs.some((job) => activeStatuses.has(job.status))) return
    const timer = window.setInterval(() => { void refreshJobs(); void refreshDetails() }, 2_500)
    return () => window.clearInterval(timer)
  }, [jobs, refreshDetails, refreshJobs])

  const visibleJobs = showAllJobs ? jobs : jobs.slice(0, 5)
  const progress = details?.job.totalCandidates && details.job.totalCandidates > 0
    ? Math.min(100, (details.job.processedCandidates / details.job.totalCandidates) * 100)
    : 0
  const sortedResults = useMemo(() => {
    if (!details) return []
    const multiplier = sort.order === "asc" ? 1 : -1
    return [...details.results].sort((left, right) => {
      const value = left[sort.key] - right[sort.key]
      return value === 0 ? left.rank - right.rank : value * multiplier
    })
  }, [details, sort])

  async function handleQueue() {
    if (!sourceRunId) {
      setError("Выберите завершенный базовый расчет.")
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const queued = await queueOptimization(workspaceId, sourceRunId, {
        strategyType: "rsi",
        searchSpace: {
          rsiPeriod: { from: periodFrom, to: periodTo, step: periodStep },
          buyLevel: { from: buyFrom, to: buyTo, step: buyStep },
          sellLevel: { from: sellFrom, to: sellTo, step: sellStep },
        },
        sampleCount,
        seed: 42,
        topCount,
        maximumDrawdownMagnitude: optionalPercent(maxDrawdown),
        minimumTradeCount: optionalNumber(minimumTrades),
        minimumProfitableSampleCount: optionalNumber(minimumProfitableSamples),
      })
      setSelectedJobId(queued.id)
      setDetails({ job: queued, filters: { maximumDrawdownMagnitude: optionalPercent(maxDrawdown), minimumTradeCount: optionalNumber(minimumTrades), minimumProfitableSampleCount: optionalNumber(minimumProfitableSamples) }, results: [] })
      toast.success("Оптимизация RSI поставлена в очередь")
      await refreshJobs()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStop() {
    if (!details) return
    setIsSubmitting(true)
    try {
      const job = await stopOptimizationJob(workspaceId, details.job.id)
      setDetails((current) => current ? { ...current, job } : current)
      toast.success(job.status === "stopped" ? "Оптимизация остановлена" : "Остановка оптимизации запрошена")
      await refreshJobs()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUseResult(result: OptimizationResult) {
    if (!details) return
    const parameters = parseRsiParameters(result.parametersJson)
    if (!parameters) {
      setError("Не удалось прочитать параметры результата оптимизации.")
      return
    }
    setIsSubmitting(true)
    try {
      const queued = await queueStrategyFromOptimization(workspaceId, details.job.id, result.id)
      onStrategyQueued(queued, parameters)
      toast.success("Выбранная стратегия поставлена в очередь")
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  function toggleSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, order: current.order === "asc" ? "desc" : "asc" }
      : { key, order: key === "rank" ? "asc" : "desc" })
  }

  return <div className="space-y-6">
    {error ? <Alert variant="destructive" className="rounded-md"><AlertTitle>Оптимизация не запущена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="grid gap-4 border-b border-slate-200 pb-6 lg:grid-cols-3">
      <Field label="Базовый расчет"><Select value={sourceRunId} onValueChange={onSourceRunIdChange} disabled={isLoading || !sourceRuns.length}><SelectTrigger><SelectValue placeholder="Выберите базовый расчет" /></SelectTrigger><SelectContent>{sourceRuns.map((run) => <SelectItem key={run.id} value={run.id}>{sourceRunLabel(run)} · {formatPercent(run.finalAccum)}</SelectItem>)}</SelectContent></Select></Field>
      <div className="lg:col-span-2"><p className="text-sm font-medium text-slate-900">Оптимизация MDD Mean Reversion</p><p className="mt-1 text-sm text-slate-500">Следующий этап. Сейчас в production доступен полный цикл оптимизации RSI.</p></div>
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section aria-labelledby="rsi-search-space"><h3 id="rsi-search-space" className="text-sm font-semibold text-slate-950">Диапазоны RSI</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><RangeFields label="RSI период" from={periodFrom} to={periodTo} step={periodStep} onFrom={setPeriodFrom} onTo={setPeriodTo} onStep={setPeriodStep} min={1} /><RangeFields label="Купить на" from={buyFrom} to={buyTo} step={buyStep} onFrom={setBuyFrom} onTo={setBuyTo} onStep={setBuyStep} min={0} max={100} /><RangeFields label="Продать на" from={sellFrom} to={sellTo} step={sellStep} onFrom={setSellFrom} onTo={setSellTo} onStep={setSellStep} min={0} max={100} /></div></section>
      <section aria-labelledby="optimization-filters"><h3 id="optimization-filters" className="text-sm font-semibold text-slate-950">Семплы и отсечения</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label="Семплов" value={sampleCount} onChange={setSampleCount} min={1} /><NumberField label="Показать лучших" value={topCount} onChange={setTopCount} min={1} max={1000} /><OptionalNumberField label="Макс. просадка, %" value={maxDrawdown} onChange={setMaxDrawdown} min={0} placeholder="Без ограничения" /><OptionalNumberField label="Мин. сделок" value={minimumTrades} onChange={setMinimumTrades} min={0} placeholder="Без ограничения" /><OptionalNumberField label="Мин. прибыльных семплов" value={minimumProfitableSamples} onChange={setMinimumProfitableSamples} min={0} max={sampleCount} placeholder="Без ограничения" /></div></section>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void handleQueue()} disabled={!canWrite || !sourceRunId || isSubmitting}><Play />Запустить оптимизацию RSI</Button><p className="text-sm text-slate-500">Каждая комбинация проверяется отдельно на каждом семпле.</p></div>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="optimization-progress"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="optimization-progress" className="text-sm font-semibold text-slate-950">Текущая оптимизация</h3><p className="mt-1 text-sm text-slate-500">{details ? `${optimizationStatusLabel(details.job.status)} · ${formatDateTime(details.job.createdAt)}` : "Выберите оптимизацию из списка ниже."}</p></div>{details && activeStatuses.has(details.job.status) ? <Button variant="outline" onClick={() => void handleStop()} disabled={!canWrite || isSubmitting}><Square />Остановить оптимизацию</Button> : null}</div>{details ? <div className="mt-4 space-y-2"><div className="flex justify-between gap-4 text-sm tabular-nums text-slate-600"><span>{details.job.processedCandidates.toLocaleString("ru-RU")} обработано</span><span>{details.job.totalCandidates === null ? "Количество комбинаций не ограничено" : `${details.job.totalCandidates.toLocaleString("ru-RU")} комбинаций`}</span></div><Progress value={progress} /><p className="text-sm text-slate-500">Семплов: {details.job.sampleCount}. Результаты сохраняются и после остановки.</p></div> : null}</section>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="optimization-results"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="optimization-results" className="text-sm font-semibold text-slate-950">Лучшие результаты</h3><p className="mt-1 text-sm text-slate-500">Нажмите «Рассчитать стратегию», чтобы поставить конкретную настройку в обычную очередь и затем сохранить ее.</p></div>{details ? <Badge variant="outline">Показано: {details.results.length}</Badge> : null}</div>{details && sortedResults.length > 0 ? <OptimizationResultsTable results={sortedResults} sort={sort} onSort={toggleSort} canUse={canWrite && (details.job.status === "completed" || details.job.status === "stopped")} isSubmitting={isSubmitting} onUse={handleUseResult} /> : <div className="mt-4 rounded-md border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">{details?.job.status === "failed" ? `Оптимизация завершилась с ошибкой: ${details.job.errorCode ?? "optimization_failed"}.` : "После завершения оптимизации здесь появятся лучшие комбинации."}</div>}</section>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="optimization-history"><div className="flex flex-wrap items-center justify-between gap-3"><h3 id="optimization-history" className="text-sm font-semibold text-slate-950">Последние оптимизации</h3>{jobs.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? "Свернуть историю" : `Вся история (${jobs.length})`}</Button> : null}</div><div className="mt-3 overflow-hidden rounded-md border border-slate-200"><Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead>Статус</TableHead><TableHead className="hidden md:table-cell">Семплов</TableHead><TableHead className="hidden lg:table-cell">Прогресс</TableHead><TableHead className="w-24 text-right">Детали</TableHead></TableRow></TableHeader><TableBody>{visibleJobs.length === 0 ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">Оптимизаций RSI пока нет.</TableCell></TableRow> : visibleJobs.map((job) => <TableRow key={job.id} data-state={job.id === selectedJobId ? "selected" : undefined}><TableCell><div className="font-medium">RSI</div><div className="text-xs text-slate-500">{formatDateTime(job.createdAt)}</div></TableCell><TableCell><OptimizationStatus status={job.status} /></TableCell><TableCell className="hidden md:table-cell">{job.sampleCount}</TableCell><TableCell className="hidden lg:table-cell tabular-nums">{job.processedCandidates.toLocaleString("ru-RU")} / {job.totalCandidates?.toLocaleString("ru-RU") ?? "?"}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelectedJobId(job.id)}>Открыть</Button></TableCell></TableRow>)}</TableBody></Table></div></section>
  </div>
}

function OptimizationResultsTable({ results, sort, onSort, canUse, isSubmitting, onUse }: { results: OptimizationResult[]; sort: { key: SortKey; order: SortOrder }; onSort: (key: SortKey) => void; canUse: boolean; isSubmitting: boolean; onUse: (result: OptimizationResult) => void }) {
  const sampleNumbers = Array.from(new Set(results.flatMap((result) => result.samples.map((sample) => sample.sample)))).sort((left, right) => left - right)
  return <div className="mt-4 overflow-x-auto rounded-md border border-slate-200"><Table className="min-w-[1180px]"><TableHeader><TableRow><SortableHead label="#" sortKey="rank" sort={sort} onSort={onSort} /><TableHead>RSI</TableHead><TableHead>Купить</TableHead><TableHead>Продать</TableHead><SortableHead label="Устойчивость" sortKey="score" sort={sort} onSort={onSort} /><SortableHead label="Совм. доходность" sortKey="compoundedAccum" sort={sort} onSort={onSort} /><SortableHead label="Ср. доходность" sortKey="averageAccum" sort={sort} onSort={onSort} /><SortableHead label="Худш. доходность" sortKey="worstAccum" sort={sort} onSort={onSort} /><SortableHead label="Худш. MDD" sortKey="worstMaxDrawdown" sort={sort} onSort={onSort} /><SortableHead label="Сделок" sortKey="tradeCount" sort={sort} onSort={onSort} />{sampleNumbers.map((sample) => <TableHead key={sample}>Семпл {sample}</TableHead>)}<TableHead className="sticky right-0 bg-white text-right">Действие</TableHead></TableRow></TableHeader><TableBody>{results.map((result) => { const parameters = parseRsiParameters(result.parametersJson); return <TableRow key={result.id}><TableCell>{result.rank}</TableCell><TableCell>{parameters?.rsiPeriod ?? "-"}</TableCell><TableCell>{parameters?.buyLevel ?? "-"}</TableCell><TableCell>{parameters?.sellLevel ?? "-"}</TableCell><TableCell>{formatScore(result.score)}</TableCell><TableCell>{formatPercent(result.compoundedAccum)}</TableCell><TableCell>{formatPercent(result.averageAccum)}</TableCell><TableCell>{formatPercent(result.worstAccum)}</TableCell><TableCell>{formatPercent(result.worstMaxDrawdown)}</TableCell><TableCell>{result.tradeCount.toLocaleString("ru-RU")}</TableCell>{sampleNumbers.map((sampleNumber) => { const sample = result.samples.find((item) => item.sample === sampleNumber); return <TableCell key={sampleNumber} className="min-w-32 text-xs leading-5">{sample ? <><div>{formatPercent(sample.finalAccum)}</div><div className="text-slate-500">MDD {formatPercent(sample.maxDrawdown)}</div><div className="text-slate-500">{sample.tradeCount} сделок</div></> : "-"}</TableCell> })}<TableCell className="sticky right-0 bg-white text-right"><Button size="sm" onClick={() => onUse(result)} disabled={!canUse || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}Рассчитать стратегию</Button></TableCell></TableRow> })}</TableBody></Table></div>
}

function SortableHead({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; order: SortOrder }; onSort: (key: SortKey) => void }) {
  const isCurrent = sort.key === sortKey
  const Icon = isCurrent ? sort.order === "asc" ? ArrowUp : ArrowDown : ArrowUpDown
  return <TableHead><Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-xs" onClick={() => onSort(sortKey)}>{label}<Icon /></Button></TableHead>
}

function RangeFields({ label, from, to, step, onFrom, onTo, onStep, min, max }: { label: string; from: number; to: number; step: number; onFrom: (value: number) => void; onTo: (value: number) => void; onStep: (value: number) => void; min?: number; max?: number }) {
  return <div className="rounded-md border border-slate-200 p-3"><p className="text-sm font-medium text-slate-900">{label}</p><div className="mt-3 grid grid-cols-3 gap-2"><NumberField label="От" value={from} onChange={onFrom} min={min} max={max} /><NumberField label="До" value={to} onChange={onTo} min={min} max={max} /><NumberField label="Шаг" value={step} onChange={onStep} min={0.0001} max={max} /></div></div>
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" onChange={(event) => onChange(Number(event.target.value))} /></Field> }
function OptionalNumberField({ label, value, onChange, min, max, placeholder }: { label: string; value: string; onChange: (value: string) => void; min?: number; max?: number; placeholder: string }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></Field> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label className="text-xs">{label}</Label>{children}</div> }
function OptimizationStatus({ status }: { status: OptimizationJobStatus }) { const classes = { queued: "border-amber-200 bg-amber-50 text-amber-800", running: "border-sky-200 bg-sky-50 text-sky-800", stopping: "border-orange-200 bg-orange-50 text-orange-800", stopped: "border-slate-200 bg-slate-50 text-slate-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-rose-200 bg-rose-50 text-rose-800" }; return <Badge variant="outline" className={classes[status]}>{optimizationStatusLabel(status)}</Badge> }
function optimizationStatusLabel(status: OptimizationJobStatus) { return { queued: "В очереди", running: "Считается", stopping: "Останавливается", stopped: "Остановлена", completed: "Готово", failed: "Ошибка" }[status] }
function optionalNumber(value: string) { if (!value.trim()) return null; const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null }
function optionalPercent(value: string) { const numeric = optionalNumber(value); return numeric === null ? null : numeric / 100 }
function parseRsiParameters(parametersJson: string): RsiParameters | null { try { const value = JSON.parse(parametersJson) as Record<string, unknown>; return typeof value.rsiPeriod === "number" && typeof value.buyLevel === "number" && typeof value.sellLevel === "number" ? { rsiPeriod: value.rsiPeriod, buyLevel: value.buyLevel, sellLevel: value.sellLevel } : null } catch { return null } }
function formatScore(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value) }
function toDisplayMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить запрос." }
