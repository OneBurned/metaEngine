import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  displayApiError,
  getOptimizationJob,
  listOptimizationJobs,
  queueOptimization,
  queueStrategyFromOptimization,
  retryOptimizationJob,
  stopOptimizationJob,
  type CalculationRun,
  type MddOptimizationSearchSpace,
  type OptimizationJob,
  type OptimizationJobDetails,
  type OptimizationJobStatus,
  type OptimizationNumericRange,
  type OptimizationResult,
} from "@/lib/api"
import { formatDateTime, formatPercent } from "@/lib/metrics"
import { ArrowDown, ArrowUp, ArrowUpDown, LoaderCircle, Play, RotateCcw, Square } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

export type MddOptimizationParameters = {
  deals: Array<{ entryDrawdown: number; weight: number; exitType: "source_dd" | "strategy_dd" | "source_hwm" | "strategy_hwm"; exitValue: number }>
}

type MddSearchLevel = { drawdown: OptimizationNumericRange; weight: OptimizationNumericRange }
type SortKey = "rank" | "score" | "compoundedAccum" | "averageAccum" | "worstAccum" | "worstMaxDrawdown" | "tradeCount"
type SortOrder = "asc" | "desc"

const activeStatuses = new Set<OptimizationJobStatus>(["queued", "running", "stopping"])

export function MddOptimizationPanel({
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
  onStrategyQueued: (run: CalculationRun, parameters: MddOptimizationParameters) => void
}) {
  const [parameterMode, setParameterMode] = useState<"simple" | "detailed">("simple")
  const [levelCount, setLevelCount] = useState(5)
  const [minEntryDelta, setMinEntryDelta] = useState(5)
  const [drawdownRange, setDrawdownRange] = useState<OptimizationNumericRange>({ from: 5, to: 50, step: 5 })
  const [weightRange, setWeightRange] = useState<OptimizationNumericRange>({ from: 10, to: 100, step: 10 })
  const [detailedLevels, setDetailedLevels] = useState<MddSearchLevel[]>(() => makeLevels(5))
  const [exitValueRange, setExitValueRange] = useState<OptimizationNumericRange>({ from: 0, to: 0, step: 1 })
  const [searchMode, setSearchMode] = useState<"random" | "full">("random")
  const [maxCandidates, setMaxCandidates] = useState(100_000)
  const [seed, setSeed] = useState(42)
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

  useEffect(() => {
    setDetailedLevels((current) => {
      const targetCount = Math.max(1, Math.min(10, levelCount))
      if (current.length === targetCount) return current
      return [...current.slice(0, targetCount), ...makeLevels(targetCount).slice(current.length)]
    })
  }, [levelCount])

  const refreshJobs = useCallback(async () => {
    try {
      const items = (await listOptimizationJobs(workspaceId)).filter((item) => item.strategyType === "mdd_mean_reversion")
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
    const searchSpace: MddOptimizationSearchSpace = {
      parameterMode,
      levelCount,
      minEntryDelta,
      exitValue: exitValueRange,
      searchMode,
      maxCandidates,
      ...(parameterMode === "simple" ? { drawdown: drawdownRange, weight: weightRange } : { levels: detailedLevels }),
    }
    try {
      const queued = await queueOptimization(workspaceId, sourceRunId, {
        strategyType: "mdd_mean_reversion",
        searchSpace,
        sampleCount,
        seed,
        topCount,
        maximumDrawdownMagnitude: optionalPercent(maxDrawdown),
        minimumTradeCount: optionalNumber(minimumTrades),
        minimumProfitableSampleCount: optionalNumber(minimumProfitableSamples),
      })
      setSelectedJobId(queued.id)
      setDetails({ job: queued, filters: { maximumDrawdownMagnitude: optionalPercent(maxDrawdown), minimumTradeCount: optionalNumber(minimumTrades), minimumProfitableSampleCount: optionalNumber(minimumProfitableSamples) }, results: [] })
      toast.success("Оптимизация MDD поставлена в очередь")
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

  async function handleRetry() {
    if (!details) return
    setIsSubmitting(true)
    try {
      const job = await retryOptimizationJob(workspaceId, details.job.id)
      setDetails((current) => current ? { ...current, job, results: [] } : current)
      toast.success("Оптимизация снова поставлена в очередь")
      await refreshJobs()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUseResult(result: OptimizationResult) {
    if (!details) return
    const parameters = parseMddParameters(result.parametersJson)
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

  function updateDetailedLevel(index: number, key: keyof MddSearchLevel, value: OptimizationNumericRange) {
    setDetailedLevels((current) => current.map((level, levelIndex) => levelIndex === index ? { ...level, [key]: value } : level))
  }

  function toggleSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, order: current.order === "asc" ? "desc" : "asc" }
      : { key, order: key === "rank" ? "asc" : "desc" })
  }

  return <div className="space-y-6">
    {error ? <Alert variant="destructive" className="rounded-md"><AlertTitle>Оптимизация не запущена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="grid gap-4 border-b border-slate-200 pb-6 lg:grid-cols-3">
      <Field label="Базовый расчет"><Select value={sourceRunId} onValueChange={onSourceRunIdChange} disabled={isLoading || !sourceRuns.length}><SelectTrigger><SelectValue placeholder="Выберите базовый расчет" /></SelectTrigger><SelectContent>{sourceRuns.map((run) => <SelectItem key={run.id} value={run.id}>{sourceRunLabel(run)}</SelectItem>)}</SelectContent></Select></Field>
      <Field label="Режим параметров"><Select value={parameterMode} onValueChange={(value) => setParameterMode(value as "simple" | "detailed")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="simple">Простой</SelectItem><SelectItem value="detailed">Детальный</SelectItem></SelectContent></Select></Field>
      <Field label="Режим поиска"><Select value={searchMode} onValueChange={(value) => setSearchMode(value as "random" | "full")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="random">Случайный</SelectItem><SelectItem value="full">Полный</SelectItem></SelectContent></Select></Field>
    </div>

    <section aria-labelledby="mdd-entry-settings"><h3 id="mdd-entry-settings" className="text-sm font-semibold text-slate-950">Настройки входов</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><NumberField label="Кол-во входов" value={levelCount} onChange={setLevelCount} min={1} max={10} /><NumberField label="Мин. дельта DD, %" value={minEntryDelta} onChange={setMinEntryDelta} min={0} /></div></section>

    {parameterMode === "simple" ? <section className="border-t border-slate-200 pt-5" aria-labelledby="mdd-simple-ranges"><h3 id="mdd-simple-ranges" className="text-sm font-semibold text-slate-950">Диапазоны MDD</h3><div className="mt-3 space-y-3"><RangeFields label="Вход DD, %" value={drawdownRange} onChange={setDrawdownRange} min={0.01} max={100} /><RangeFields label="Вес входа, %" value={weightRange} onChange={setWeightRange} min={0} /><RangeFields label="Выход DD исходника, %" value={exitValueRange} onChange={setExitValueRange} min={0} /></div></section> : <section className="border-t border-slate-200 pt-5" aria-labelledby="mdd-detailed-ranges"><h3 id="mdd-detailed-ranges" className="text-sm font-semibold text-slate-950">Точные диапазоны</h3><div className="mt-3 space-y-3">{detailedLevels.map((level, index) => <section key={index} className="rounded-md border border-slate-200 p-4"><h4 className="text-sm font-medium text-slate-900">Вход {index + 1}</h4><div className="mt-3 space-y-3"><RangeFields label="DD, %" value={level.drawdown} onChange={(value) => updateDetailedLevel(index, "drawdown", value)} min={0.01} max={100} /><RangeFields label="Вес, %" value={level.weight} onChange={(value) => updateDetailedLevel(index, "weight", value)} min={0} /></div></section>)}<section className="rounded-md border border-slate-200 p-4"><h4 className="text-sm font-medium text-slate-900">Выход</h4><div className="mt-3"><RangeFields label="Выход DD исходника, %" value={exitValueRange} onChange={setExitValueRange} min={0} /></div></section></div></section>}

    <section className="border-t border-slate-200 pt-5" aria-labelledby="mdd-search-settings"><h3 id="mdd-search-settings" className="text-sm font-semibold text-slate-950">Поиск, семплы и отсечения</h3><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><NumberField label="Кандидатов" value={maxCandidates} onChange={setMaxCandidates} min={1} disabled={searchMode === "full"} /><NumberField label="Seed" value={seed} onChange={setSeed} min={0} /><NumberField label="Семплов" value={sampleCount} onChange={setSampleCount} min={1} /><NumberField label="Показать лучших" value={topCount} onChange={setTopCount} min={1} max={1000} /><OptionalNumberField label="Макс. просадка, %" value={maxDrawdown} onChange={setMaxDrawdown} min={0} placeholder="Без ограничения" /><OptionalNumberField label="Мин. сделок" value={minimumTrades} onChange={setMinimumTrades} min={0} placeholder="Без ограничения" /><OptionalNumberField label="Мин. прибыльных семплов" value={minimumProfitableSamples} onChange={setMinimumProfitableSamples} min={0} max={sampleCount} placeholder="Без ограничения" /></div></section>

    <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void handleQueue()} disabled={!canWrite || !sourceRunId || isSubmitting}><Play />Запустить оптимизацию MDD</Button></div>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="mdd-optimization-progress"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="mdd-optimization-progress" className="text-sm font-semibold text-slate-950">Текущая оптимизация</h3><p className="mt-1 text-sm text-slate-500">{details ? `${optimizationStatusLabel(details.job.status)} · ${formatDateTime(details.job.createdAt)}` : "Выберите оптимизацию из списка ниже."}</p></div><div className="flex gap-2">{details && isRetryable(details.job) ? <Button variant="outline" onClick={() => void handleRetry()} disabled={!canWrite || isSubmitting}><RotateCcw />Повторить</Button> : null}{details && activeStatuses.has(details.job.status) ? <Button variant="outline" onClick={() => void handleStop()} disabled={!canWrite || isSubmitting}><Square />Остановить оптимизацию</Button> : null}</div></div>{details ? <div className="mt-4 space-y-2"><div className="flex justify-between gap-4 text-sm tabular-nums text-slate-600"><span>{details.job.processedCandidates.toLocaleString("ru-RU")} обработано</span><span>{details.job.totalCandidates === null ? "Полный перебор" : `${details.job.totalCandidates.toLocaleString("ru-RU")} кандидатов`}</span></div><Progress value={progress} /><p className="text-sm text-slate-500">Семплов: {details.job.sampleCount}. {optimizationQueueNote(details.job) ?? "Результаты сохраняются и после остановки."}</p></div> : null}</section>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="mdd-optimization-results"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 id="mdd-optimization-results" className="text-sm font-semibold text-slate-950">Лучшие результаты</h3><p className="mt-1 text-sm text-slate-500">Нажмите «Рассчитать стратегию», чтобы поставить конкретную настройку в обычную очередь и затем сохранить ее.</p></div>{details ? <Badge variant="outline">Показано: {details.results.length}</Badge> : null}</div>{details && sortedResults.length > 0 ? <MddResultsTable results={sortedResults} sort={sort} onSort={toggleSort} canUse={canWrite && (details.job.status === "completed" || details.job.status === "stopped")} isSubmitting={isSubmitting} onUse={handleUseResult} /> : <div className="mt-4 rounded-md border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">{details && isRetryable(details.job) ? `Оптимизация не завершилась: ${details.job.errorCode ?? "optimization_failed"}. Попыток: ${details.job.attemptCount}.` : "После завершения оптимизации здесь появятся лучшие комбинации."}</div>}</section>

    <section className="border-t border-slate-200 pt-6" aria-labelledby="mdd-optimization-history"><div className="flex flex-wrap items-center justify-between gap-3"><h3 id="mdd-optimization-history" className="text-sm font-semibold text-slate-950">Последние оптимизации</h3>{jobs.length > 5 ? <Button variant="ghost" size="sm" onClick={() => setShowAllJobs((current) => !current)}>{showAllJobs ? "Свернуть историю" : `Вся история (${jobs.length})`}</Button> : null}</div><div className="mt-3 overflow-hidden rounded-md border border-slate-200"><Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead>Статус</TableHead><TableHead className="hidden md:table-cell">Семплов</TableHead><TableHead className="hidden lg:table-cell">Прогресс</TableHead><TableHead className="w-24 text-right">Детали</TableHead></TableRow></TableHeader><TableBody>{visibleJobs.length === 0 ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-slate-500">Оптимизаций MDD пока нет.</TableCell></TableRow> : visibleJobs.map((job) => <TableRow key={job.id} data-state={job.id === selectedJobId ? "selected" : undefined}><TableCell><div className="font-medium">MDD Mean Reversion</div><div className="text-xs text-slate-500">{formatDateTime(job.createdAt)}</div></TableCell><TableCell><OptimizationStatus status={job.status} /></TableCell><TableCell className="hidden md:table-cell">{job.sampleCount}</TableCell><TableCell className="hidden lg:table-cell tabular-nums">{job.processedCandidates.toLocaleString("ru-RU")} / {job.totalCandidates?.toLocaleString("ru-RU") ?? "?"}</TableCell><TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setSelectedJobId(job.id)}>Открыть</Button></TableCell></TableRow>)}</TableBody></Table></div></section>
  </div>
}

function MddResultsTable({ results, sort, onSort, canUse, isSubmitting, onUse }: { results: OptimizationResult[]; sort: { key: SortKey; order: SortOrder }; onSort: (key: SortKey) => void; canUse: boolean; isSubmitting: boolean; onUse: (result: OptimizationResult) => void }) {
  const sampleNumbers = Array.from(new Set(results.flatMap((result) => result.samples.map((sample) => sample.sample)))).sort((left, right) => left - right)
  return <div className="mt-4 overflow-x-auto rounded-md border border-slate-200"><Table className="min-w-[1180px]"><TableHeader><TableRow><SortableHead label="#" sortKey="rank" sort={sort} onSort={onSort} /><TableHead>Входы и веса</TableHead><TableHead>Выход</TableHead><SortableHead label="Устойчивость" sortKey="score" sort={sort} onSort={onSort} /><SortableHead label="Совм. Accum" sortKey="compoundedAccum" sort={sort} onSort={onSort} /><SortableHead label="Ср. Accum" sortKey="averageAccum" sort={sort} onSort={onSort} /><SortableHead label="Худш. Accum" sortKey="worstAccum" sort={sort} onSort={onSort} /><SortableHead label="Худш. MDD" sortKey="worstMaxDrawdown" sort={sort} onSort={onSort} /><SortableHead label="Сделок" sortKey="tradeCount" sort={sort} onSort={onSort} />{sampleNumbers.map((sample) => <TableHead key={sample}>Семпл {sample}</TableHead>)}<TableHead className="sticky right-0 bg-white text-right">Действие</TableHead></TableRow></TableHeader><TableBody>{results.map((result) => { const parameters = parseMddParameters(result.parametersJson); return <TableRow key={result.id}><TableCell>{result.rank}</TableCell><TableCell className="min-w-56 text-xs leading-5">{parameters?.deals.map((deal) => <div key={`${deal.entryDrawdown}-${deal.weight}`}>Local DD {formatPercent(deal.entryDrawdown)} · вес {formatPercent(deal.weight)}</div>) ?? "-"}</TableCell><TableCell>{parameters ? `DD исходника ${formatPercent(parameters.deals[0]?.exitValue ?? 0)}` : "-"}</TableCell><TableCell>{formatScore(result.score)}</TableCell><TableCell>{formatPercent(result.compoundedAccum)}</TableCell><TableCell>{formatPercent(result.averageAccum)}</TableCell><TableCell>{formatPercent(result.worstAccum)}</TableCell><TableCell>{formatPercent(result.worstMaxDrawdown)}</TableCell><TableCell>{result.tradeCount.toLocaleString("ru-RU")}</TableCell>{sampleNumbers.map((sampleNumber) => { const sample = result.samples.find((item) => item.sample === sampleNumber); return <TableCell key={sampleNumber} className="min-w-32 text-xs leading-5">{sample ? <><div>{formatPercent(sample.finalAccum)}</div><div className="text-slate-500">MDD {formatPercent(sample.maxDrawdown)}</div><div className="text-slate-500">{sample.tradeCount} сделок</div></> : "-"}</TableCell> })}<TableCell className="sticky right-0 bg-white text-right"><Button size="sm" onClick={() => onUse(result)} disabled={!canUse || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}Рассчитать стратегию</Button></TableCell></TableRow> })}</TableBody></Table></div>
}

function SortableHead({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; order: SortOrder }; onSort: (key: SortKey) => void }) { const Icon = sort.key === sortKey ? (sort.order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown; return <TableHead><Button variant="ghost" size="sm" className="h-8 px-1" onClick={() => onSort(sortKey)}>{label}<Icon /></Button></TableHead> }
function OptimizationStatus({ status }: { status: OptimizationJobStatus }) { const classes = { queued: "border-amber-200 bg-amber-50 text-amber-800", running: "border-sky-200 bg-sky-50 text-sky-800", stopping: "border-orange-200 bg-orange-50 text-orange-800", stopped: "border-slate-200 bg-slate-50 text-slate-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-rose-200 bg-rose-50 text-rose-800", interrupted: "border-orange-200 bg-orange-50 text-orange-800" }; return <Badge variant="outline" className={classes[status]}>{optimizationStatusLabel(status)}</Badge> }
function optimizationStatusLabel(status: OptimizationJobStatus) { return { queued: "В очереди", running: "Считается", stopping: "Останавливается", stopped: "Остановлена", completed: "Готово", failed: "Ошибка", interrupted: "Прервана" }[status] }
function isRetryable(job: OptimizationJob) { return job.status === "failed" || job.status === "interrupted" }
function optimizationQueueNote(job: OptimizationJob) { if (job.status === "queued" && job.retryNotBefore) return `Автоповтор после ${formatDateTime(job.retryNotBefore)}.`; if (job.status === "running" && job.attemptCount > 1) return `Попытка ${job.attemptCount}.`; return null }
function RangeFields({ label, value, onChange, min, max }: { label: string; value: OptimizationNumericRange; onChange: (value: OptimizationNumericRange) => void; min?: number; max?: number }) { return <div className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_104px_104px_104px]"><p className="text-sm font-medium text-slate-900 sm:self-center">{label}</p><NumberField label="От" value={value.from} onChange={(from) => onChange({ ...value, from })} min={min} max={max} /><NumberField label="До" value={value.to} onChange={(to) => onChange({ ...value, to })} min={min} max={max} /><NumberField label="Шаг" value={value.step} onChange={(step) => onChange({ ...value, step })} min={0.000001} /></div> }
function NumberField({ label, value, onChange, min, max, disabled }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></Field> }
function OptionalNumberField({ label, value, onChange, min, max, placeholder }: { label: string; value: string; onChange: (value: string) => void; min?: number; max?: number; placeholder: string }) { return <Field label={label}><Input type="number" value={value} min={min} max={max} step="any" placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></Field> }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div> }
function makeLevels(count: number): MddSearchLevel[] { return Array.from({ length: count }, (_, index) => ({ drawdown: { from: (index + 1) * 5, to: (index + 1) * 10, step: 5 }, weight: { from: 10, to: 100, step: 10 } })) }
function optionalNumber(value: string) { if (!value.trim()) return null; const numeric = Number(value); return Number.isFinite(numeric) ? numeric : null }
function optionalPercent(value: string) { const numeric = optionalNumber(value); return numeric === null ? null : numeric / 100 }
function parseMddParameters(parametersJson: string): MddOptimizationParameters | null { try { const value = JSON.parse(parametersJson) as { deals?: unknown }; if (!Array.isArray(value.deals)) return null; const deals = value.deals.filter((deal): deal is { entryDrawdown: number; weight: number; exitType: "source_dd" | "strategy_dd" | "source_hwm" | "strategy_hwm"; exitValue: number } => typeof deal === "object" && deal !== null && typeof (deal as { entryDrawdown?: unknown }).entryDrawdown === "number" && typeof (deal as { weight?: unknown }).weight === "number" && typeof (deal as { exitType?: unknown }).exitType === "string" && typeof (deal as { exitValue?: unknown }).exitValue === "number"); return deals.length === value.deals.length ? { deals } : null } catch { return null } }
function formatScore(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(value) }
function toDisplayMessage(error: unknown) { return displayApiError(error) }
