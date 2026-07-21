import { AppShell } from "@/components/app-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useSession } from "@/features/session/session-context"
import {
  displayApiError,
  createPreset,
  deletePreset,
  getPortfolioBounds,
  getPreset,
  listPortfolios,
  listPresets,
  listSavedStrategies,
  type Portfolio,
  type Preset,
  type PresetDetails,
  type PresetSourceType,
  type SavedStrategy,
  type Timeframe,
} from "@/lib/api"
import { formatDateTime, formatPercent, toDateTimeLocal, toIsoDateTime } from "@/lib/metrics"
import { useNavigate } from "@tanstack/react-router"
import { AlertCircle, BookOpenCheck, Layers3, LoaderCircle, Plus, Save, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type DraftItem = {
  id: string
  sourceType: PresetSourceType
  sourceId: string
  sourceName: string
  sourceTimeframe: Timeframe
  weight: number
  startsAt: string
  endsAt: string | null
}

type SourceOption = {
  id: string
  type: PresetSourceType
  name: string
  timeframe: Timeframe
  periodStart?: string
  periodEnd?: string
}

export function PresetScreen() {
  const { workspace, signOut } = useSession()
  const navigate = useNavigate({ from: "/presets" })
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [strategies, setStrategies] = useState<SavedStrategy[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState("")
  const [sourceType, setSourceType] = useState<PresetSourceType>("portfolio")
  const [sourceId, setSourceId] = useState("")
  const [weight, setWeight] = useState(1)
  const [startsAt, setStartsAt] = useState("")
  const [endsAt, setEndsAt] = useState("")
  const [isOpenEnded, setIsOpenEnded] = useState(true)
  const [items, setItems] = useState<DraftItem[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState("")
  const [selectedPreset, setSelectedPreset] = useState<PresetDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingBounds, setIsLoadingBounds] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspace) {
      setPortfolios([])
      setStrategies([])
      setPresets([])
      setIsLoading(false)
      return
    }

    try {
      const [nextPortfolios, nextStrategies, nextPresets] = await Promise.all([
        listPortfolios(workspace.id),
        listSavedStrategies(workspace.id),
        listPresets(workspace.id),
      ])
      setPortfolios(nextPortfolios)
      setStrategies(nextStrategies)
      setPresets(nextPresets)
      setSelectedPresetId((current) => nextPresets.some((preset) => preset.id === current) ? current : (nextPresets[0]?.id ?? ""))
      setError(null)
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsLoading(false)
    }
  }, [workspace])

  const options = useMemo<SourceOption[]>(() => [
    ...portfolios.map((portfolio) => ({ id: portfolio.id, type: "portfolio" as const, name: portfolio.name, timeframe: portfolio.timeframe })),
    ...strategies.map((strategy) => ({
      id: strategy.id,
      type: "strategy" as const,
      name: strategy.name,
      timeframe: strategy.resultTimeframe,
      periodStart: strategy.resultPeriodStart,
      periodEnd: strategy.resultPeriodEnd,
    })),
  ], [portfolios, strategies])
  const visibleOptions = useMemo(
    () => options.filter((option) => option.type === sourceType),
    [options, sourceType],
  )
  const selectedSource = visibleOptions.find((option) => option.id === sourceId) ?? null

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    setSourceId((current) => visibleOptions.some((option) => option.id === current) ? current : (visibleOptions[0]?.id ?? ""))
  }, [sourceType, visibleOptions])

  useEffect(() => {
    if (!workspace || !selectedSource) {
      setStartsAt("")
      setEndsAt("")
      return
    }

    if (selectedSource.type === "strategy" && selectedSource.periodStart && selectedSource.periodEnd) {
      setStartsAt(toDateTimeLocal(selectedSource.periodStart))
      setEndsAt(toDateTimeLocal(selectedSource.periodEnd))
      return
    }

    setIsLoadingBounds(true)
    void getPortfolioBounds(workspace.id, selectedSource.id)
      .then((bounds) => {
        setStartsAt(toDateTimeLocal(bounds.startsAt))
        setEndsAt(toDateTimeLocal(bounds.endsAt))
      })
      .catch((requestError) => setError(toDisplayMessage(requestError)))
      .finally(() => setIsLoadingBounds(false))
  }, [selectedSource, workspace])

  useEffect(() => {
    if (!workspace || !selectedPresetId) {
      setSelectedPreset(null)
      return
    }

    void getPreset(workspace.id, selectedPresetId)
      .then(setSelectedPreset)
      .catch((requestError) => setError(toDisplayMessage(requestError)))
  }, [selectedPresetId, workspace])

  function addItem() {
    if (!selectedSource || !startsAt || (!isOpenEnded && !endsAt)) {
      setError("Выберите источник и период участия.")
      return
    }
    if (!Number.isFinite(weight) || weight < 0) {
      setError("Вес должен быть числом не меньше нуля.")
      return
    }

    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sourceType: selectedSource.type,
        sourceId: selectedSource.id,
        sourceName: selectedSource.name,
        sourceTimeframe: selectedSource.timeframe,
        weight,
        startsAt: toIsoDateTime(startsAt),
        endsAt: isOpenEnded ? null : toIsoDateTime(endsAt),
      },
    ])
    setError(null)
  }

  async function handleDeletePreset(preset: Preset) {
    if (!workspace?.canWrite) return
    if (!window.confirm("Удалить сохраненный пресет? Если он используется в расчетах или стратегиях, удаление будет запрещено.")) return
    try {
      await deletePreset(workspace.id, preset.id)
      if (selectedPresetId === preset.id) {
        setSelectedPresetId("")
        setSelectedPreset(null)
      }
      toast.success("Сохраненный пресет удален")
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    }
  }

  async function savePreset() {
    if (!workspace || !presetName.trim() || !items.length) {
      setError("Укажите название и добавьте хотя бы один источник.")
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const created = await createPreset(workspace.id, {
        name: presetName.trim(),
        items: items.map((item) => ({
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          weight: item.weight,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
        })),
      })
      setPresetName("")
      setItems([])
      setSelectedPresetId(created.preset.id)
      toast.success("Пресет сохранён", { description: created.preset.name })
      await refresh()
    } catch (requestError) {
      setError(toDisplayMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <AppShell onSignOut={() => void signOut().then(() => navigate({ to: "/login" }))}>
      <div>
        <p className="text-sm font-medium text-teal-700">Production workspace</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">Пресеты</h1>
      </div>

      {error ? <Alert variant="destructive" className="mt-5 rounded-md"><AlertCircle className="size-4" /><AlertTitle>Операция не выполнена</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {!workspace ? <Alert className="mt-6 rounded-md"><AlertTitle>Нет доступного workspace</AlertTitle><AlertDescription>Для работы с пресетами нужен доступ к workspace.</AlertDescription></Alert> : null}

      {workspace ? <>
        <Card className="mt-6 rounded-lg border-slate-200 shadow-none">
          <CardHeader><CardTitle className="text-base">Новый пресет</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <Field label="Название" htmlFor="preset-name"><Input id="preset-name" value={presetName} onChange={(event) => setPresetName(event.target.value)} disabled={!workspace.canWrite || isSaving} /></Field>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px]">
              <div className="grid gap-1.5"><Label>Тип источника</Label><Tabs value={sourceType} onValueChange={(value) => setSourceType(value as PresetSourceType)}><TabsList className="w-full"><TabsTrigger value="portfolio" className="flex-1">Портфолио</TabsTrigger><TabsTrigger value="strategy" className="flex-1">Стратегия</TabsTrigger></TabsList></Tabs></div>
              <Field label="Источник" htmlFor="preset-source"><Select value={sourceId} onValueChange={setSourceId} disabled={isLoading || !visibleOptions.length}><SelectTrigger id="preset-source"><SelectValue placeholder="Выберите источник" /></SelectTrigger><SelectContent>{visibleOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.name} · {option.timeframe}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Вес" htmlFor="preset-weight"><Input id="preset-weight" type="number" min="0" step="0.01" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Field label="Участие с" htmlFor="preset-start"><Input id="preset-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={!selectedSource || isLoadingBounds} /></Field>
              <Field label="Участие по" htmlFor="preset-end"><Input id="preset-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={!selectedSource || isLoadingBounds || isOpenEnded} /></Field>
              <div className="flex items-end pb-2"><Checkbox id="preset-open-end" checked={isOpenEnded} onCheckedChange={(checked) => setIsOpenEnded(checked === true)} /><Label htmlFor="preset-open-end" className="ml-2">До конца</Label></div>
            </div>

            <div className="flex justify-end"><Button type="button" variant="outline" onClick={addItem} disabled={!workspace.canWrite || !selectedSource || isLoadingBounds}><Plus />Добавить источник</Button></div>

            <DraftItemsTable items={items} onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))} />

            <div className="flex justify-end"><Button type="button" onClick={() => void savePreset()} disabled={!workspace.canWrite || isSaving || !items.length}>{isSaving ? <LoaderCircle className="animate-spin" /> : <Save />}Сохранить пресет</Button></div>
          </CardContent>
        </Card>

        <section className="mt-7"><SectionTitle icon={<Layers3 className="size-4" />} title="Сохранённые пресеты" /><PresetTable presets={presets} selectedId={selectedPresetId} onSelect={setSelectedPresetId} onDelete={(preset) => void handleDeletePreset(preset)} canWrite={workspace.canWrite} isLoading={isLoading} /></section>
        <section className="mt-7"><SectionTitle icon={<BookOpenCheck className="size-4" />} title="Состав пресета" /><PresetDetailsTable details={selectedPreset} /></section>
      </> : null}
    </AppShell>
  )
}

function DraftItemsTable({ items, onRemove }: { items: DraftItem[]; onRemove: (id: string) => void }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead className="hidden md:table-cell">Тип</TableHead><TableHead>Вес</TableHead><TableHead className="hidden lg:table-cell">Период</TableHead><TableHead className="w-14 text-right"> </TableHead></TableRow></TableHeader><TableBody>{items.length === 0 ? <EmptyRow columns={5} text="Добавьте источник для пресета." /> : items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.sourceName}</div><div className="text-xs text-slate-500">{item.sourceTimeframe}</div></TableCell><TableCell className="hidden md:table-cell">{item.sourceType === "portfolio" ? "Портфолио" : "Стратегия"}</TableCell><TableCell className="tabular-nums">{formatPercent(item.weight)}</TableCell><TableCell className="hidden lg:table-cell text-sm">{formatDateTime(item.startsAt)} - {item.endsAt ? formatDateTime(item.endsAt) : "До конца"}</TableCell><TableCell className="text-right"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={() => onRemove(item.id)} aria-label="Удалить источник"><Trash2 className="size-4" /></Button></TooltipTrigger><TooltipContent>Удалить источник</TooltipContent></Tooltip></TableCell></TableRow>)}</TableBody></Table></div>
}

function PresetTable({ presets, selectedId, onSelect, onDelete, canWrite, isLoading }: { presets: Preset[]; selectedId: string; onSelect: (id: string) => void; onDelete: (preset: Preset) => void; canWrite: boolean; isLoading: boolean }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Название</TableHead><TableHead className="hidden md:table-cell">Источников</TableHead><TableHead className="hidden lg:table-cell">Создан</TableHead><TableHead className="w-44 text-right">Действия</TableHead></TableRow></TableHeader><TableBody>{isLoading ? <EmptyRow columns={4} text="Загрузка..." /> : null}{!isLoading && presets.length === 0 ? <EmptyRow columns={4} text="Сохранённых пресетов пока нет." /> : null}{presets.map((preset) => <TableRow key={preset.id} data-state={selectedId === preset.id ? "selected" : undefined}><TableCell><div className="font-medium">{preset.name}</div><div className="text-xs text-slate-500">v{preset.version}</div></TableCell><TableCell className="hidden md:table-cell tabular-nums">{preset.itemCount}</TableCell><TableCell className="hidden lg:table-cell">{formatDateTime(preset.createdAt)}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant={selectedId === preset.id ? "default" : "outline"} size="sm" onClick={() => onSelect(preset.id)}>Открыть</Button>{canWrite ? <Button variant="ghost" size="sm" onClick={() => onDelete(preset)}><Trash2 />Удалить</Button> : null}</div></TableCell></TableRow>)}</TableBody></Table></div>
}

function PresetDetailsTable({ details }: { details: PresetDetails | null }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white"><Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead>Тип</TableHead><TableHead>Вес</TableHead><TableHead className="hidden lg:table-cell">Период</TableHead></TableRow></TableHeader><TableBody>{!details ? <EmptyRow columns={4} text="Выберите сохранённый пресет." /> : details.items.map((item) => <TableRow key={item.id}><TableCell><div className="font-medium">{item.sourceName}</div><div className="text-xs text-slate-500">{item.sourceTimeframe}</div></TableCell><TableCell>{item.sourceType === "portfolio" ? "Портфолио" : "Стратегия"}</TableCell><TableCell className="tabular-nums">{formatPercent(item.weight)}</TableCell><TableCell className="hidden lg:table-cell text-sm">{formatDateTime(item.startsAt)} - {item.endsAt ? formatDateTime(item.endsAt) : "До конца"}</TableCell></TableRow>)}</TableBody></Table></div>
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="mb-3 flex items-center gap-2"><span className="text-teal-700">{icon}</span><h2 className="text-base font-semibold">{title}</h2></div>
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <TableRow><TableCell colSpan={columns} className="h-24 text-center text-sm text-slate-500">{text}</TableCell></TableRow>
}

function toDisplayMessage(error: unknown) {
  return displayApiError(error)
}
