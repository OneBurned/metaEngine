import { AppShell } from "@/components/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getAllCalculationResult,
  getCalculationRun,
  getPortfolioBounds,
  getPresetBounds,
  importPortfolio,
  listCalculationRuns,
  listPortfolios,
  listPresets,
  queueCalculation,
  timeframeOptions,
  type CalculationRun,
  type CalculationRunDetails,
  type Portfolio,
  type PortfolioPoint,
  type Preset,
  type Timeframe,
} from "@/lib/api"
import {
  deriveMetricSeries,
  downsampleForChart,
  formatDateTime,
  formatPercent,
  toDateTimeLocal,
  toIsoDateTime,
} from "@/lib/metrics"
import { useSession } from "@/features/session/session-context"
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  FileUp,
  LoaderCircle,
  Play,
  RefreshCw,
  Upload,
} from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { Brush, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react"

const chartConfig = {
  accum: { label: "Доходность", color: "#2563eb" },
  drawdown: { label: "Просадка", color: "#e11d48" },
} satisfies ChartConfig

const activeStatuses = new Set<CalculationRun["status"]>(["queued", "running"])

export function DashboardScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/" })
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [runs, setRuns] = useState<CalculationRun[]>([])
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<CalculationRunDetails | null>(null)
  const [resultPoints, setResultPoints] = useState<PortfolioPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingResult, setIsLoadingResult] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshOverview = useCallback(async () => {
    if (!workspace) {
      setPortfolios([])
      setPresets([])
      setRuns([])
      setIsLoading(false)
      return
    }

    try {
      const [nextPortfolios, nextPresets, nextRuns] = await Promise.all([
        listPortfolios(workspace.id),
        listPresets(workspace.id),
        listCalculationRuns(workspace.id),
      ])
      setPortfolios(nextPortfolios)
      setPresets(nextPresets)
      setRuns(nextRuns)
      setSelectedPortfolioId((current) => current ?? nextPortfolios[0]?.id ?? null)
      setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null)
      setError(null)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace])

  const loadRun = useCallback(async (runId: string) => {
    if (!workspace) {
      return
    }

    setIsLoadingResult(true)
    try {
      const details = await getCalculationRun(workspace.id, runId)
      setSelectedRun(details)
      if (details.run.status === "completed") {
        setResultPoints(await getAllCalculationResult(workspace.id, runId))
      } else {
        setResultPoints([])
      }
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

  const selectedPortfolio = portfolios.find((portfolio) => portfolio.id === selectedPortfolioId) ?? null

  async function handleImport(file: File, name: string) {
    if (!workspace) {
      return
    }

    const result = await importPortfolio(workspace.id, file, name)
    toast.success("Портфолио импортировано", { description: result.portfolio.name })
    setSelectedPortfolioId(result.portfolio.id)
    await refreshOverview()
  }

  async function handleQueue(input: ({
    portfolioId: string
    presetId?: never
  } | {
    portfolioId?: never
    presetId: string
  }) & {
    periodStart: string
    periodEnd: string
    timeframe: Timeframe
  }) {
    if (!workspace) {
      return
    }

    const run = await queueCalculation(workspace.id, input)
    toast.success("Расчёт поставлен в очередь")
    setSelectedRunId(run.id)
    await refreshOverview()
  }

  async function handleSignOut() {
    await signOut()
    await navigate({ to: "/login" })
  }

  return (
    <AppShell onSignOut={() => void handleSignOut()}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-700">Production workspace</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Базовые расчеты</h1>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" onClick={() => void refreshOverview()} aria-label="Обновить данные">
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Обновить</TooltipContent>
        </Tooltip>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-5 rounded-md">
          <AlertCircle className="size-4" />
          <AlertTitle>Операция не выполнена</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!workspace ? (
        <Alert className="mt-6 rounded-md border-amber-200 bg-amber-50 text-amber-950">
          <AlertCircle className="size-4 text-amber-700" />
          <AlertTitle>Нет доступного workspace</AlertTitle>
          <AlertDescription>Обратитесь к администратору, чтобы получить доступ к workspace.</AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <ImportPortfolioPanel disabled={!workspace.canWrite} onImport={handleImport} />
            <CalculationPanel
              canWrite={workspace.canWrite}
              portfolio={selectedPortfolio}
              presets={presets}
              workspaceId={workspace.id}
              onQueue={handleQueue}
            />
          </div>

          <section className="mt-7" aria-labelledby="portfolios-heading">
            <SectionHeading id="portfolios-heading" icon={<FileUp className="size-4" />} title="Портфолио" />
            <PortfolioTable
              isLoading={isLoading}
              portfolios={portfolios}
              selectedId={selectedPortfolioId}
              onSelect={setSelectedPortfolioId}
            />
          </section>

          <section className="mt-7" aria-labelledby="runs-heading">
            <SectionHeading id="runs-heading" icon={<CalendarClock className="size-4" />} title="Запуски расчета" />
            <RunTable
              isLoading={isLoading}
              runs={runs}
              selectedId={selectedRunId}
              onSelect={setSelectedRunId}
            />
          </section>

          <section className="mt-7" aria-labelledby="result-heading">
            <SectionHeading id="result-heading" icon={<BarChart3 className="size-4" />} title="Результат расчета" />
            <ResultPanel details={selectedRun} isLoading={isLoadingResult} points={resultPoints} />
          </section>
        </>
      )}
    </AppShell>
  )
}

function SectionHeading({ id, icon, title }: { id: string; icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-teal-700" aria-hidden="true">{icon}</span>
      <h2 id={id} className="text-base font-semibold">{title}</h2>
    </div>
  )
}

function ImportPortfolioPanel({
  disabled,
  onImport,
}: {
  disabled: boolean
  onImport: (file: File, name: string) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    if (nextFile && !name) {
      setName(nextFile.name.replace(/\.csv$/i, ""))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || !name.trim()) {
      setError("Выберите CSV и укажите название.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await onImport(file, name.trim())
      setFile(null)
      setName("")
      event.currentTarget.reset()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Импорт портфолио</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <Field label="Название" htmlFor="portfolio-name">
            <Input
              id="portfolio-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Core allocation"
              disabled={disabled || isSubmitting}
            />
          </Field>
          <Field label="CSV, timestamp,diff" htmlFor="portfolio-file">
            <Input
              id="portfolio-file"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={disabled || isSubmitting}
            />
          </Field>
          {error ? <p className="sm:col-span-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex sm:col-span-2">
            <Button type="submit" disabled={disabled || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : <Upload />}
              Импортировать
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function CalculationPanel({
  canWrite,
  portfolio,
  presets,
  workspaceId,
  onQueue,
}: {
  canWrite: boolean
  portfolio: Portfolio | null
  presets: Preset[]
  workspaceId: string | null
  onQueue: (input: ({
    portfolioId: string
    presetId?: never
  } | {
    portfolioId?: never
    presetId: string
  }) & {
    periodStart: string
    periodEnd: string
    timeframe: Timeframe
  }) => Promise<void>
}) {
  const [sourceType, setSourceType] = useState<"portfolio" | "preset">("portfolio")
  const [presetId, setPresetId] = useState("")
  const [bounds, setBounds] = useState<{ startsAt: string; endsAt: string; timeframe: Timeframe } | null>(null)
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [timeframe, setTimeframe] = useState<Timeframe>("1h")
  const [isLoadingBounds, setIsLoadingBounds] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sourceType === "portfolio" && (!workspaceId || !portfolio)) {
      setBounds(null)
      setPeriodStart("")
      setPeriodEnd("")
      return
    }
    if (sourceType === "preset" && (!workspaceId || !presetId)) {
      setBounds(null)
      setPeriodStart("")
      setPeriodEnd("")
      return
    }

    setIsLoadingBounds(true)
    setError(null)
    const request = sourceType === "portfolio"
      ? getPortfolioBounds(workspaceId!, portfolio!.id).then((nextBounds) => ({ ...nextBounds, timeframe: portfolio!.timeframe }))
      : getPresetBounds(workspaceId!, presetId)
    void request
      .then((nextBounds) => {
        setBounds(nextBounds)
        setPeriodStart(toDateTimeLocal(nextBounds.startsAt))
        setPeriodEnd(toDateTimeLocal(nextBounds.endsAt))
        setTimeframe(nextBounds.timeframe)
      })
      .catch((requestError) => setError(toDisplayMessage(requestError)))
      .finally(() => setIsLoadingBounds(false))
  }, [portfolio, presetId, sourceType, workspaceId])

  useEffect(() => {
    setPresetId((current) => presets.some((preset) => preset.id === current) ? current : (presets[0]?.id ?? ""))
  }, [presets])

  const allowedTimeframes = bounds
    ? timeframeOptions.slice(timeframeOptions.indexOf(bounds.timeframe))
    : []

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const hasSource = sourceType === "portfolio" ? portfolio : presetId
    if (!hasSource || !periodStart || !periodEnd) {
      setError("Выберите источник и период.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      if (sourceType === "portfolio" && portfolio) {
        await onQueue({
          portfolioId: portfolio.id,
          periodStart: toIsoDateTime(periodStart),
          periodEnd: toIsoDateTime(periodEnd),
          timeframe,
        })
      } else if (sourceType === "preset" && presetId) {
        await onQueue({
          presetId,
          periodStart: toIsoDateTime(periodStart),
          periodEnd: toIsoDateTime(periodEnd),
          timeframe,
        })
      }
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="rounded-lg border-slate-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Новый расчет</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <div className="grid gap-2 sm:col-span-2"><Label>Источник</Label><Tabs value={sourceType} onValueChange={(value) => setSourceType(value as "portfolio" | "preset")}><TabsList><TabsTrigger value="portfolio">Портфолио</TabsTrigger><TabsTrigger value="preset">Пресет</TabsTrigger></TabsList></Tabs>{sourceType === "portfolio" ? <Input value={portfolio ? `${portfolio.name} · v${portfolio.version}` : "Выберите портфолио в таблице"} readOnly disabled /> : <Select value={presetId} onValueChange={setPresetId} disabled={!presets.length}><SelectTrigger><SelectValue placeholder="Выберите пресет" /></SelectTrigger><SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.name} · v{preset.version}</SelectItem>)}</SelectContent></Select>}</div>
          <Field label="Таймфрейм" htmlFor="calculation-timeframe">
            <Select value={timeframe} onValueChange={(value) => setTimeframe(value as Timeframe)} disabled={!bounds || isLoadingBounds}>
              <SelectTrigger id="calculation-timeframe" className="w-full bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedTimeframes.map((item) => (
                  <SelectItem key={item} value={item}>{item}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Период с" htmlFor="period-start">
            <Input
              id="period-start"
              type="datetime-local"
              value={periodStart}
              min={bounds ? toDateTimeLocal(bounds.startsAt) : undefined}
              max={bounds ? toDateTimeLocal(bounds.endsAt) : undefined}
              onChange={(event) => setPeriodStart(event.target.value)}
              disabled={!bounds || isLoadingBounds || isSubmitting}
            />
          </Field>
          <Field label="Период по" htmlFor="period-end">
            <Input
              id="period-end"
              type="datetime-local"
              value={periodEnd}
              min={bounds ? toDateTimeLocal(bounds.startsAt) : undefined}
              max={bounds ? toDateTimeLocal(bounds.endsAt) : undefined}
              onChange={(event) => setPeriodEnd(event.target.value)}
              disabled={!bounds || isLoadingBounds || isSubmitting}
            />
          </Field>
          {isLoadingBounds ? <Progress className="sm:col-span-2" value={55} /> : null}
          {error ? <p className="sm:col-span-2 text-sm text-rose-700">{error}</p> : null}
          <div className="flex sm:col-span-2">
            <Button type="submit" disabled={!canWrite || !bounds || isLoadingBounds || isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : <Play />}
              Рассчитать
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function PortfolioTable({
  isLoading,
  portfolios,
  selectedId,
  onSelect,
}: {
  isLoading: boolean
  portfolios: Portfolio[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Название</TableHead>
            <TableHead className="hidden md:table-cell">ТФ</TableHead>
            <TableHead className="hidden md:table-cell">Точек</TableHead>
            <TableHead className="hidden lg:table-cell">Создано</TableHead>
            <TableHead className="w-24 text-right">Выбор</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? <LoadingRows columns={5} /> : null}
          {!isLoading && portfolios.length === 0 ? <EmptyRow columns={5} text="Нет импортированных портфолио." /> : null}
          {portfolios.map((portfolio) => (
            <TableRow key={portfolio.id} data-state={selectedId === portfolio.id ? "selected" : undefined}>
              <TableCell>
                <div className="font-medium">{portfolio.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">v{portfolio.version} · {portfolio.sourceFileName}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{portfolio.timeframe}</TableCell>
              <TableCell className="hidden md:table-cell tabular-nums">{portfolio.pointCount.toLocaleString("ru-RU")}</TableCell>
              <TableCell className="hidden lg:table-cell">{formatDateTime(portfolio.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Button variant={selectedId === portfolio.id ? "default" : "outline"} size="sm" onClick={() => onSelect(portfolio.id)}>
                  Выбрать
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function RunTable({
  isLoading,
  runs,
  selectedId,
  onSelect,
}: {
  isLoading: boolean
  runs: CalculationRun[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Статус</TableHead>
            <TableHead className="hidden md:table-cell">Период</TableHead>
            <TableHead className="hidden lg:table-cell">Доходность</TableHead>
            <TableHead className="hidden lg:table-cell">MDD</TableHead>
            <TableHead className="w-24 text-right">Детали</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? <LoadingRows columns={5} /> : null}
          {!isLoading && runs.length === 0 ? <EmptyRow columns={5} text="Запусков пока нет." /> : null}
          {runs.map((run) => (
            <TableRow key={run.id} data-state={selectedId === run.id ? "selected" : undefined}>
              <TableCell><StatusBadge status={run.status} /></TableCell>
              <TableCell className="hidden md:table-cell text-sm">{formatDateTime(run.periodStart)} - {formatDateTime(run.periodEnd)}</TableCell>
              <TableCell className="hidden lg:table-cell tabular-nums">{formatPercent(run.finalAccum)}</TableCell>
              <TableCell className="hidden lg:table-cell tabular-nums">{formatPercent(run.maxDrawdown)}</TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => onSelect(run.id)}>Открыть</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ResultPanel({
  details,
  isLoading,
  points,
}: {
  details: CalculationRunDetails | null
  isLoading: boolean
  points: PortfolioPoint[]
}) {
  const [showAccum, setShowAccum] = useState(true)
  const [showDrawdown, setShowDrawdown] = useState(true)
  const metrics = useMemo(() => deriveMetricSeries(points), [points])
  const chartPoints = useMemo(() => downsampleForChart(metrics), [metrics])

  if (isLoading) {
    return <div className="grid min-h-56 place-items-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"><LoaderCircle className="mr-2 inline size-4 animate-spin" /> Загрузка результата</div>
  }

  if (!details) {
    return <EmptyResult text="Выберите запуск расчета." />
  }

  if (details.run.status !== "completed") {
    return <EmptyResult text={details.run.status === "failed" ? `Расчет завершился с ошибкой: ${details.run.errorCode ?? "unknown_error"}.` : "Расчет выполняется. Статус обновляется автоматически."} />
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Доходность" value={formatPercent(details.run.finalAccum)} />
        <Metric label="HWM" value={formatPercent(details.run.highWaterMark)} />
        <Metric label="Макс. просадка" value={formatPercent(details.run.maxDrawdown)} />
        <Metric label="Точек" value={details.run.pointCount.toLocaleString("ru-RU")} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={showAccum} onCheckedChange={(value) => setShowAccum(value === true)} /> Доходность</label>
            <label className="flex items-center gap-2"><Checkbox checked={showDrawdown} onCheckedChange={(value) => setShowDrawdown(value === true)} /> Просадка</label>
          </div>
          <p className="text-xs text-slate-500">Перетаскивайте нижний диапазон для детализации.</p>
        </div>
        <ChartContainer config={chartConfig} className="h-[360px] w-full aspect-auto" aria-label="График доходности и просадки">
          <LineChart data={chartPoints} margin={{ top: 12, right: 16, left: 8, bottom: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" minTickGap={70} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="drawdown"
              orientation="left"
              width={72}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatPercent(Number(value), 1)}
            />
            <YAxis
              yAxisId="accum"
              orientation="right"
              width={76}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => formatPercent(Number(value), 0)}
            />
            <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${(Number(value) * 100).toFixed(2)}%`} />} />
            {showAccum ? <Line yAxisId="accum" type="monotone" dataKey="accum" stroke="var(--color-accum)" strokeWidth={1.75} dot={false} /> : null}
            {showDrawdown ? <Line yAxisId="drawdown" type="monotone" dataKey="drawdown" stroke="var(--color-drawdown)" strokeWidth={1.5} dot={false} /> : null}
            <Brush dataKey="label" height={28} stroke="#0f766e" travellerWidth={8} />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Время</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Accum</TableHead>
              <TableHead className="hidden sm:table-cell text-right">DD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.slice(0, 20).map((point) => (
              <TableRow key={point.timestamp}>
                <TableCell>{formatDateTime(point.timestamp)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(point.diff, 3)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.accum)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{formatPercent(point.drawdown)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: CalculationRun["status"] }) {
  const styles: Record<CalculationRun["status"], string> = {
    queued: "border-amber-200 bg-amber-50 text-amber-800",
    running: "border-sky-200 bg-sky-50 text-sky-800",
    completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    failed: "border-rose-200 bg-rose-50 text-rose-800",
  }
  const labels: Record<CalculationRun["status"], string> = {
    queued: "В очереди",
    running: "Считается",
    completed: "Готово",
    failed: "Ошибка",
  }
  return <Badge variant="outline" className={styles[status]}>{labels[status]}</Badge>
}

function LoadingRows({ columns }: { columns: number }) {
  return <TableRow><TableCell colSpan={columns} className="py-9 text-center text-sm text-slate-500">Загрузка...</TableCell></TableRow>
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <TableRow><TableCell colSpan={columns} className="py-9 text-center text-sm text-slate-500">{text}</TableCell></TableRow>
}

function EmptyResult({ text }: { text: string }) {
  return <div className="grid min-h-56 place-items-center rounded-lg border border-dashed border-slate-300 bg-white px-5 text-center text-sm text-slate-500">{text}</div>
}

function toDisplayMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить запрос."
}
