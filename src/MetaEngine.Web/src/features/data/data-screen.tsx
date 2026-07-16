import { AppShell } from "@/components/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSession } from "@/features/session/session-context"
import { importPortfolio, listPortfolios, listPresets, listSavedStrategies, type Portfolio, type Preset, type SavedStrategy } from "@/lib/api"
import { formatDateTime } from "@/lib/metrics"
import { useNavigate } from "@tanstack/react-router"
import { AlertCircle, Database, LoaderCircle, RefreshCw, Upload } from "lucide-react"
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react"
import { toast } from "sonner"

export function DataScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/data" })
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspace) {
      setPortfolios([])
      setStrategies([])
      setPresets([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const [nextPortfolios, nextStrategies, nextPresets] = await Promise.all([
        listPortfolios(workspace.id),
        listSavedStrategies(workspace.id),
        listPresets(workspace.id),
      ])
      setPortfolios(nextPortfolios)
      setStrategies(nextStrategies)
      setPresets(nextPresets)
      setError(null)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace])

  useEffect(() => { void refresh() }, [refresh])

  async function handleSignOut() {
    await signOut()
    await navigate({ to: "/login" })
  }

  async function handleImport(file: File, name: string) {
    if (!workspace) {
      return
    }

    const result = await importPortfolio(workspace.id, file, name)
    toast.success("Портфолио импортировано", { description: result.portfolio.name })
    await refresh()
  }

  return (
    <AppShell onSignOut={() => void handleSignOut()}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-teal-700">Production workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Данные</h1>
        </div>
        <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={() => void refresh()} aria-label="Обновить данные"><RefreshCw className="size-4" /></Button></TooltipTrigger><TooltipContent>Обновить</TooltipContent></Tooltip>
      </div>

      {error ? <Alert variant="destructive" className="mt-5 rounded-md"><AlertCircle className="size-4" /><AlertTitle>Операция не выполнена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!workspace ? <Alert className="mt-6 rounded-md"><AlertTitle>Нет доступного workspace</AlertTitle><AlertDescription>Для работы с данными нужен доступ к workspace.</AlertDescription></Alert> : null}

      {workspace ? <>
        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
          <LibraryMetric label="Портфели" value={portfolios.length} />
          <LibraryMetric label="Стратегии" value={strategies.length} />
          <LibraryMetric label="Пресеты" value={presets.length} />
        </div>

        <Card className="mt-6 rounded-lg border-slate-200 shadow-none">
          <CardHeader><CardTitle className="text-base">Импорт портфолио</CardTitle></CardHeader>
          <CardContent><ImportForm disabled={!workspace.canWrite} onImport={handleImport} /></CardContent>
        </Card>

        <section className="mt-7" aria-labelledby="library-heading">
          <div className="mb-3 flex items-center gap-2"><Database className="size-4 text-teal-700" /><h2 id="library-heading" className="text-base font-semibold">Библиотека</h2></div>
          <Tabs defaultValue="portfolios">
            <TabsList><TabsTrigger value="portfolios">Портфели ({portfolios.length})</TabsTrigger><TabsTrigger value="strategies">Стратегии ({strategies.length})</TabsTrigger><TabsTrigger value="presets">Пресеты ({presets.length})</TabsTrigger></TabsList>
            <TabsContent value="portfolios" className="mt-4"><PortfolioLibrary items={portfolios} isLoading={isLoading} /></TabsContent>
            <TabsContent value="strategies" className="mt-4"><StrategyLibrary items={strategies} isLoading={isLoading} /></TabsContent>
            <TabsContent value="presets" className="mt-4"><PresetLibrary items={presets} isLoading={isLoading} /></TabsContent>
          </Tabs>
        </section>
      </> : null}
    </AppShell>
  )
}

function ImportForm({ disabled, onImport }: { disabled: boolean; onImport: (file: File, name: string) => Promise<void> }) {
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

  return <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={handleSubmit}>
    <Field label="Название" htmlFor="portfolio-name"><Input id="portfolio-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Core allocation" disabled={disabled || isSubmitting} /></Field>
    <Field label="CSV, timestamp,diff" htmlFor="portfolio-file"><Input id="portfolio-file" type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={disabled || isSubmitting} /></Field>
    <div className="flex items-end"><Button type="submit" disabled={disabled || isSubmitting}>{isSubmitting ? <LoaderCircle className="animate-spin" /> : <Upload />}Импортировать</Button></div>
    {error ? <p className="sm:col-span-3 text-sm text-rose-700">{error}</p> : null}
  </form>
}

function PortfolioLibrary({ items, isLoading }: { items: Portfolio[]; isLoading: boolean }) {
  return <LibraryTable><TableHeader><TableRow><TableHead>Название</TableHead><TableHead className="hidden sm:table-cell">ТФ</TableHead><TableHead className="hidden sm:table-cell text-right">Точек</TableHead><TableHead className="hidden lg:table-cell">Создан</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <LoadingRow columns={4} /> : null}{!isLoading && items.length === 0 ? <EmptyRow columns={4} text="Портфелей пока нет." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">v{item.version} · {item.sourceFileName ?? "CSV"}</div></TableCell><TableCell className="hidden sm:table-cell">{item.timeframe}</TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{item.pointCount.toLocaleString("ru-RU")}</TableCell><TableCell className="hidden lg:table-cell">{formatDateTime(item.createdAt)}</TableCell></TableRow>)}</TableBody></LibraryTable>
}

function StrategyLibrary({ items, isLoading }: { items: SavedStrategy[]; isLoading: boolean }) {
  return <LibraryTable><TableHeader><TableRow><TableHead>Название</TableHead><TableHead>Тип</TableHead><TableHead className="hidden sm:table-cell">Источник</TableHead><TableHead className="hidden lg:table-cell">Сохранена</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <LoadingRow columns={4} /> : null}{!isLoading && items.length === 0 ? <EmptyRow columns={4} text="Сохранённых стратегий пока нет." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">v{item.version}</div></TableCell><TableCell><Badge variant="outline">{item.strategyType === "rsi" ? "RSI" : "MDD Mean Reversion"}</Badge></TableCell><TableCell className="hidden sm:table-cell">{item.sourceType === "portfolio" ? "Портфолио" : "Пресет"}</TableCell><TableCell className="hidden lg:table-cell">{formatDateTime(item.createdAt)}</TableCell></TableRow>)}</TableBody></LibraryTable>
}

function PresetLibrary({ items, isLoading }: { items: Preset[]; isLoading: boolean }) {
  return <LibraryTable><TableHeader><TableRow><TableHead>Название</TableHead><TableHead className="hidden sm:table-cell text-right">Источников</TableHead><TableHead className="hidden lg:table-cell">Создан</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <LoadingRow columns={3} /> : null}{!isLoading && items.length === 0 ? <EmptyRow columns={3} text="Пресетов пока нет." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">v{item.version}</div></TableCell><TableCell className="hidden sm:table-cell text-right tabular-nums">{item.itemCount}</TableCell><TableCell className="hidden lg:table-cell">{formatDateTime(item.createdAt)}</TableCell></TableRow>)}</TableBody></LibraryTable>
}

function LibraryTable({ children }: { children: React.ReactNode }) { return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table>{children}</Table></div> }
function LibraryMetric({ label, value }: { label: string; value: number }) { return <div className="bg-white px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div> }
function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) { return <div className="grid gap-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div> }
function LoadingRow({ columns }: { columns: number }) { return <TableRow><TableCell colSpan={columns} className="py-8 text-center text-sm text-slate-500">Загрузка...</TableCell></TableRow> }
function EmptyRow({ columns, text }: { columns: number; text: string }) { return <TableRow><TableCell colSpan={columns} className="py-8 text-center text-sm text-slate-500">{text}</TableCell></TableRow> }
function toDisplayMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить запрос." }
