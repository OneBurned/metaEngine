import { AppShell } from "@/components/app-shell"
import { calculationDisplayName, strategyTypeLabel } from "@/features/calculations/run-presentation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useSession } from "@/features/session/session-context"
import { getAllCalculationResult, getAllPortfolioPoints, getCalculationRun, listCalculationRuns, listPortfolios, listPresets, listSavedStrategies, type CalculationRun, type Portfolio, type PortfolioPoint, type Preset, type SavedStrategy } from "@/lib/api"
import { deriveMetricSeries, formatDateTime } from "@/lib/metrics"
import { useNavigate } from "@tanstack/react-router"
import { AlertCircle, Download, FileDown } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type SourceType = "portfolio" | "calculation" | "savedStrategy"
type ExportSource = { id: string; type: SourceType; title: string; subtitle: string; run?: CalculationRun; portfolio?: Portfolio; savedStrategy?: SavedStrategy }
type ExportColumn = { id: string; label: string }

const baseColumns: ExportColumn[] = [
  { id: "timestamp", label: "Timestamp" }, { id: "date", label: "Дата" }, { id: "diff", label: "Diff" }, { id: "accum", label: "Accum" }, { id: "hwm", label: "HWM" }, { id: "dd", label: "DD" }, { id: "mdd", label: "MDD" },
]
const rsiColumns: ExportColumn[] = [{ id: "rsi", label: "RSI" }, { id: "signal", label: "Сигнал" }, { id: "execution", label: "Исполнение" }, { id: "position", label: "Вес" }, { id: "source_diff", label: "IN Diff" }, { id: "source_accum", label: "IN Accum" }, { id: "strategy_accum", label: "OUT Accum" }, { id: "strategy_hwm", label: "OUT HWM" }, { id: "strategy_dd", label: "OUT DD" }, { id: "strategy_mdd", label: "OUT MDD" }]
const mddColumns: ExportColumn[] = [{ id: "source_diff", label: "IN Diff" }, { id: "source_accum", label: "IN Accum" }, { id: "source_dd", label: "DD исходника" }, { id: "local_mdd", label: "Local DD" }, { id: "signal", label: "Сигнал" }, { id: "execution", label: "Исполнение" }, { id: "active_deals", label: "Активные сделки" }, { id: "weight", label: "Вес" }, { id: "max_config_weight", label: "Макс. вес конфигурации" }, { id: "max_realized_weight", label: "Макс. набранный вес" }, { id: "strategy_accum", label: "OUT Accum" }, { id: "strategy_hwm", label: "OUT HWM" }, { id: "strategy_dd", label: "OUT DD" }, { id: "strategy_mdd", label: "OUT MDD" }]

export function ExportScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/export" })
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [runs, setRuns] = useState<CalculationRun[]>([])
  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>([])
  const [sourceType, setSourceType] = useState<SourceType>("calculation")
  const [sourceId, setSourceId] = useState("")
  const [selectedColumns, setSelectedColumns] = useState<string[]>(baseColumns.map((column) => column.id))
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspace) { setIsLoading(false); return }
    try {
      const [nextPortfolios, nextPresets, nextRuns, nextStrategies] = await Promise.all([listPortfolios(workspace.id), listPresets(workspace.id), listCalculationRuns(workspace.id), listSavedStrategies(workspace.id)])
      setPortfolios(nextPortfolios); setPresets(nextPresets); setRuns(nextRuns); setSavedStrategies(nextStrategies); setError(null)
    } catch (requestError) { setError(toDisplayMessage(requestError)) } finally { setIsLoading(false) }
  }, [workspace])
  useEffect(() => { void refresh() }, [refresh])

  const sources = useMemo(() => buildSources(sourceType, portfolios, presets, runs, savedStrategies), [portfolios, presets, runs, savedStrategies, sourceType])
  const selectedSource = sources.find((source) => source.id === sourceId) ?? sources[0]
  const availableColumns = useMemo(() => buildColumns(selectedSource), [selectedSource])
  useEffect(() => { if (selectedSource && selectedSource.id !== sourceId) setSourceId(selectedSource.id) }, [selectedSource, sourceId])
  useEffect(() => { setSelectedColumns((current) => { const allowed = new Set(availableColumns.map((column) => column.id)); const kept = current.filter((column) => allowed.has(column)); return kept.length > 0 ? kept : availableColumns.map((column) => column.id) }) }, [availableColumns])

  async function handleExport() {
    if (!workspace || !selectedSource) return
    setIsExporting(true); setError(null)
    try { const csv = await buildExportCsv(workspace.id, selectedSource, selectedColumns); downloadCsv(`${slugify(selectedSource.title)}_${formatFileTimestamp(new Date())}_${selectedColumns.join("_")}.csv`, csv); toast.success("CSV экспортирован") }
    catch (requestError) { setError(toDisplayMessage(requestError)) }
    finally { setIsExporting(false) }
  }

  return <AppShell onSignOut={() => void signOut().then(() => navigate({ to: "/login" }))}>
    <div><p className="text-sm font-medium text-teal-700">Production workspace</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">Экспорт CSV</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Отдельный модуль экспорта: выберите источник и любые колонки — от даты с одним показателем до всего доступного массива.</p></div>
    {error ? <Alert variant="destructive" className="mt-5 rounded-md"><AlertCircle className="size-4" /><AlertTitle>Экспорт не выполнен</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    <Card className="mt-6 rounded-lg border-slate-200 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileDown className="size-4" />Настройки экспорта</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 lg:grid-cols-2"><Field label="Что экспортировать"><Select value={sourceType} onValueChange={(value) => { setSourceType(value as SourceType); setSourceId("") }} disabled={isLoading}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portfolio">Портфолио</SelectItem><SelectItem value="calculation">Расчет / результат стратегии</SelectItem><SelectItem value="savedStrategy">Сохраненная стратегия</SelectItem></SelectContent></Select></Field><Field label="Источник"><Select value={selectedSource?.id ?? ""} onValueChange={setSourceId} disabled={isLoading || sources.length === 0}><SelectTrigger><SelectValue placeholder="Выберите источник" /></SelectTrigger><SelectContent>{sources.map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent></Select></Field></div>{selectedSource ? <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm"><div className="font-medium text-slate-900">{selectedSource.title}</div><div className="mt-1 text-slate-500">{selectedSource.subtitle}</div></div> : <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Нет доступных источников для выбранного типа.</div>}<section aria-labelledby="export-columns"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="export-columns" className="text-sm font-semibold text-slate-950">Колонки</h2><p className="mt-1 text-sm text-slate-500">Timestamp и дата — обычные колонки: их тоже можно включать или выключать.</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setSelectedColumns(availableColumns.map((column) => column.id))}>Выбрать всё</Button><Button type="button" variant="outline" size="sm" onClick={() => setSelectedColumns([])}>Снять всё</Button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{availableColumns.map((column) => <label key={column.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"><Checkbox checked={selectedColumns.includes(column.id)} onCheckedChange={(checked) => setSelectedColumns((current) => checked === true ? [...new Set([...current, column.id])] : current.filter((item) => item !== column.id))} />{column.label}</label>)}</div></section><div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5"><Button type="button" onClick={() => void handleExport()} disabled={!selectedSource || selectedColumns.length === 0 || isExporting}>{isExporting ? null : <Download />}Скачать CSV</Button><p className="text-sm text-slate-500">Выбрано колонок: {selectedColumns.length.toLocaleString("ru-RU")} / {availableColumns.length.toLocaleString("ru-RU")}</p></div></CardContent></Card>
  </AppShell>
}

function buildSources(type: SourceType, portfolios: Portfolio[], presets: Preset[], runs: CalculationRun[], strategies: SavedStrategy[]): ExportSource[] { const presentationSources = { portfolios, presets, runs }; if (type === "portfolio") return portfolios.map((portfolio) => ({ id: portfolio.id, type, title: `${portfolio.name} · v${portfolio.version}`, subtitle: `${formatDateTime(portfolio.startsAt)} — ${formatDateTime(portfolio.endsAt)} · ТФ ${portfolio.timeframe} · ${portfolio.pointCount.toLocaleString("ru-RU")} точек`, portfolio })); if (type === "savedStrategy") return strategies.map((strategy) => ({ id: strategy.id, type, title: `${strategy.name} · v${strategy.version}`, subtitle: `${strategyTypeLabel(strategy.strategyType)} · ${formatDateTime(strategy.resultPeriodStart)} — ${formatDateTime(strategy.resultPeriodEnd)} · ТФ ${strategy.resultTimeframe}`, savedStrategy: strategy })); return runs.filter((run) => run.status === "completed").map((run) => ({ id: run.id, type, title: calculationDisplayName(run, presentationSources), subtitle: `${run.kind === "strategy" ? strategyTypeLabel(run.strategyType) : "Базовый расчет"} · ${formatDateTime(run.periodStart)} — ${formatDateTime(run.periodEnd)} · ТФ ${run.timeframe}`, run })) }
function buildColumns(source: ExportSource | undefined) { const strategyType = source?.run?.strategyType ?? source?.savedStrategy?.strategyType ?? null; return strategyType ? [...baseColumns, ...(strategyType === "rsi" ? rsiColumns : mddColumns)] : baseColumns }
async function buildExportCsv(workspaceId: string, source: ExportSource, columns: string[]) { const { points, run } = await loadSourcePoints(workspaceId, source); const metrics = deriveMetricSeries(points); const indicator = run?.kind === "strategy" ? await loadStrategyIndicators(workspaceId, run, points) : new Map<string, Record<string, string | number | null>>(); const rows = metrics.map((point) => { const extra = indicator.get(point.timestamp) ?? {}; const values: Record<string, string | number | boolean | null> = { timestamp: point.timestamp, date: formatCsvDate(point.timestamp), diff: point.diff, accum: point.accum, hwm: point.highWaterMark, dd: point.drawdown, mdd: point.maxDrawdown, ...normalizePointFields(point.fields), ...extra }; return columns.map((column) => csvCell(values[column])).join(",") }); return [columns.join(","), ...rows].join("\n") }
async function loadSourcePoints(workspaceId: string, source: ExportSource) { if (source.portfolio) return { points: await getAllPortfolioPoints(workspaceId, source.portfolio.id), run: null as CalculationRun | null }; if (source.savedStrategy) { const details = await getCalculationRun(workspaceId, source.savedStrategy.resultCalculationRunId); return { points: await getAllCalculationResult(workspaceId, source.savedStrategy.resultCalculationRunId), run: details.run } } if (!source.run) throw new Error("Источник не выбран."); return { points: await getAllCalculationResult(workspaceId, source.run.id), run: source.run } }
async function loadStrategyIndicators(workspaceId: string, run: CalculationRun, resultPoints: PortfolioPoint[]) { const sourcePoints = run.sourceCalculationRunId ? await getAllCalculationResult(workspaceId, run.sourceCalculationRunId) : resultPoints; const sourceMetrics = deriveMetricSeries(sourcePoints); if (run.strategyType === "rsi") { const params = parseJson(run.strategyParametersJson); const rsi = calculateRsi(sourceMetrics.map((point) => point.accum), Math.max(1, Math.trunc(numberValue(params.rsiPeriod, 14)))); return new Map(sourceMetrics.map((point, index) => [point.timestamp, { rsi: rsi[index], source_accum: point.accum }])) } let localDd = 0; return new Map(sourceMetrics.map((point) => { localDd = point.drawdown >= 0 ? 0 : Math.min(localDd, point.drawdown); return [point.timestamp, { source_dd: point.drawdown, local_dd: localDd, source_accum: point.accum }] })) }
function calculateRsi(accumValues: number[], period: number) { const values: Array<number | null> = Array(accumValues.length).fill(null); if (accumValues.length <= period) return values; let gainSum = 0; let lossSum = 0; for (let index = 1; index <= period; index++) { const delta = accumValues[index] - accumValues[index - 1]; if (delta >= 0) gainSum += delta; else lossSum -= delta } let averageGain = gainSum / period; let averageLoss = lossSum / period; values[period] = toRsi(averageGain, averageLoss); for (let index = period + 1; index < accumValues.length; index++) { const delta = accumValues[index] - accumValues[index - 1]; averageGain = (averageGain * (period - 1) + Math.max(delta, 0)) / period; averageLoss = (averageLoss * (period - 1) + Math.max(-delta, 0)) / period; values[index] = toRsi(averageGain, averageLoss) } return values }
function toRsi(averageGain: number, averageLoss: number) { return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss) }
function parseJson(json: string | null | undefined) { try { return json ? JSON.parse(json) as Record<string, unknown> : {} } catch { return {} } }
function numberValue(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback }
function formatCsvDate(value: string) { return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") }
function formatFileTimestamp(value: Date) { return value.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15) }
function normalizePointFields(fields: Record<string, unknown> | undefined) { const values = Object.fromEntries(Object.entries(fields ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null)) as Record<string, string | number | boolean | null>; if (values.base_dd !== undefined && values.source_dd === undefined) values.source_dd = values.base_dd; if (values.position !== undefined && values.weight === undefined) values.weight = values.position; return values }
function csvCell(value: string | number | boolean | null | undefined) { const text = value === null || value === undefined ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }
function downloadCsv(fileName: string, csv: string) { const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url) }
function slugify(value: string) { return value.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "export" }
function toDisplayMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить экспорт." }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div> }
