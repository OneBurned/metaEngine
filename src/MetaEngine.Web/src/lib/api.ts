export type WorkspaceAccess = {
  id: string
  name: string
  role: "admin" | "researcher" | "viewer"
  canWrite: boolean
  canAdminister: boolean
}

export type CurrentUser = {
  id: string
  email: string
  displayName: string
  workspaces: WorkspaceAccess[]
}

export type Portfolio = {
  id: string
  portfolioKey: string
  version: number
  name: string
  sourceFileName: string | null
  valueType: string
  valueScale: string
  timeframe: Timeframe
  sourceChecksum: string
  seriesChecksum: string
  pointCount: number
  startsAt: string
  endsAt: string
  createdAt: string
  createdByUserId: string | null
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d" | "1M" | "1Y"

export type PortfolioPoint = {
  timestamp: string
  diff: number
  fields?: Record<string, unknown>
}

export type PresetSourceType = "portfolio" | "strategy"

export type Preset = {
  id: string
  presetKey: string
  version: number
  name: string
  itemCount: number
  createdAt: string
  createdByUserId: string | null
}

export type PresetItem = {
  id: string
  sortOrder: number
  sourceType: PresetSourceType
  sourceId: string
  sourceName: string
  sourceTimeframe: Timeframe
  sourcePeriodStart: string
  sourcePeriodEnd: string
  weight: number
  startsAt: string
  endsAt: string | null
}

export type PresetDetails = {
  preset: Preset
  items: PresetItem[]
}

export type CalculationRunStatus = "queued" | "running" | "completed" | "failed" | "interrupted"

export type CalculationRun = {
  id: string
  kind: "base" | "strategy"
  inputType: "portfolio" | "preset"
  portfolioId: string | null
  presetId: string | null
  sourceCalculationRunId: string | null
  strategyType: string | null
  strategySchemaVersion: number | null
  strategyParametersJson?: string | null
  periodStart: string
  periodEnd: string
  timeframe: Timeframe
  status: CalculationRunStatus
  attemptCount: number
  retryNotBefore: string | null
  lastHeartbeatAt: string | null
  pointCount: number
  tradeCount: number
  finalAccum: number | null
  highWaterMark: number | null
  maxDrawdown: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  createdByUserId: string | null
}

export type StrategyType = {
  strategyType: "rsi" | "mdd_mean_reversion"
  displayName: string
  schemaVersion: number
  isProductionCalculationAvailable: boolean
  isProductionOptimizationAvailable: boolean
}

export type OptimizationJobStatus = "queued" | "running" | "stopping" | "stopped" | "completed" | "failed" | "interrupted"

export type OptimizationJob = {
  id: string
  sourceCalculationRunId: string | null
  inputType: "portfolio" | "preset"
  portfolioId: string | null
  presetId: string | null
  strategyType: string
  strategySchemaVersion: number
  periodStart: string
  periodEnd: string
  timeframe: Timeframe
  sampleCount: number
  seed: number
  topCount: number
  totalCandidates: number | null
  processedCandidates: number
  status: OptimizationJobStatus
  attemptCount: number
  retryNotBefore: string | null
  lastHeartbeatAt: string | null
  stopRequestedAt: string | null
  errorCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export type OptimizationFilters = {
  maximumDrawdownMagnitude: number | null
  minimumTradeCount: number | null
  minimumProfitableSampleCount: number | null
}

export type OptimizationSampleMetric = {
  sample: number
  periodStart: string
  periodEnd: string
  finalAccum: number
  maxDrawdown: number
  tradeCount: number
  score: number
}

export type OptimizationResult = {
  id: string
  rank: number
  parametersJson: string
  score: number
  compoundedAccum: number
  averageAccum: number
  worstAccum: number
  worstMaxDrawdown: number
  tradeCount: number
  profitableSampleCount: number
  samples: OptimizationSampleMetric[]
  createdAt: string
}

export type OptimizationJobDetails = {
  job: OptimizationJob
  filters: OptimizationFilters
  results: OptimizationResult[]
}

export type RsiOptimizationSearchSpace = {
  rsiPeriod: { from: number; to: number; step: number }
  buyLevel: { from: number; to: number; step: number }
  sellLevel: { from: number; to: number; step: number }
}

export type OptimizationNumericRange = { from: number; to: number; step: number }

export type MddOptimizationSearchSpace = {
  parameterMode: "simple" | "detailed"
  levelCount: number
  minEntryDelta: number
  drawdown?: OptimizationNumericRange
  weight?: OptimizationNumericRange
  levels?: Array<{ drawdown: OptimizationNumericRange; weight: OptimizationNumericRange }>
  exitValue: OptimizationNumericRange
  searchMode: "random" | "full"
  maxCandidates: number
}

export type SavedStrategy = {
  id: string
  strategyKey: string
  version: number
  name: string
  strategyType: string
  schemaVersion: number
  parametersJson: string
  sourceType: "portfolio" | "preset"
  sourcePortfolioId: string | null
  sourcePresetId: string | null
  resultArtifactId: string
  resultCalculationRunId: string
  resultPeriodStart: string
  resultPeriodEnd: string
  resultTimeframe: Timeframe
  createdAt: string
}

export type CalculationRunDetails = {
  run: CalculationRun
  artifact: {
    id: string
    kind: string
    pointCount: number
    seriesChecksum: string
  } | null
  warnings: Array<{
    code: string
    timestamp: string | null
    message: string
  }>
}

export type CalculationResultPage = {
  offset: number
  limit: number
  total: number
  items: PortfolioPoint[]
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function getCsrfToken() {
  const response = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" })
  if (!response.ok) {
    throw await toApiError(response, "/api/v1/auth/csrf")
  }

  const body = (await response.json()) as { token: string }
  return body.token
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  requiresCsrf = false,
): Promise<T> {
  const headers = new Headers(init.headers)
  if (requiresCsrf) {
    headers.set("X-CSRF-TOKEN", await getCsrfToken())
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  })

  if (!response.ok) {
    throw await toApiError(response, path)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function toApiError(response: Response, path: string) {
  const fallback = `${path} failed with status ${response.status}.`
  try {
    const body = (await response.json()) as { code?: string; message?: string }
    return new ApiError(body.message ?? fallback, body.code ?? "request_failed", response.status)
  } catch {
    return new ApiError(fallback, "request_failed", response.status)
  }
}

export async function getCurrentUser() {
  return request<CurrentUser>("/api/v1/auth/me")
}

export async function listStrategyTypes() {
  const response = await request<{ items: StrategyType[] }>("/api/v1/strategy-types")
  return response.items.filter((item) => item.isProductionCalculationAvailable)
}

export async function login(email: string, password: string) {
  return request<CurrentUser>(
    "/api/v1/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    true,
  )
}

export async function logout() {
  return request<void>("/api/v1/auth/logout", { method: "POST" }, true)
}

export async function listPortfolios(workspaceId: string) {
  const response = await request<{ items: Portfolio[] }>(
    `/api/v1/workspaces/${workspaceId}/portfolios`,
  )
  return response.items
}

export type PortfolioImportValueType = "accum" | "diff"

export async function importPortfolio(workspaceId: string, file: File, name: string, valueType: PortfolioImportValueType = "accum") {
  const form = new FormData()
  form.set("name", name)
  form.set("valueType", valueType)
  form.set("file", file)
  return request<{ portfolio: Portfolio }>(
    `/api/v1/workspaces/${workspaceId}/portfolios/import`,
    { method: "POST", body: form },
    true,
  )
}

export async function getPortfolioBounds(workspaceId: string, portfolioId: string) {
  const first = await request<CalculationResultPage>(
    `/api/v1/workspaces/${workspaceId}/portfolios/${portfolioId}/points?offset=0&limit=1`,
  )
  if (first.total === 0 || first.items.length === 0) {
    throw new ApiError("The portfolio has no points.", "portfolio_empty", 400)
  }

  const last = await request<CalculationResultPage>(
    `/api/v1/workspaces/${workspaceId}/portfolios/${portfolioId}/points?offset=${first.total - 1}&limit=1`,
  )
  return {
    startsAt: first.items[0].timestamp,
    endsAt: last.items[0]?.timestamp ?? first.items[0].timestamp,
  }
}

export async function getAllPortfolioPoints(workspaceId: string, portfolioId: string) {
  const items: PortfolioPoint[] = []
  let offset = 0
  const limit = 5_000
  let total = 0

  do {
    const page = await request<CalculationResultPage>(
      `/api/v1/workspaces/${workspaceId}/portfolios/${portfolioId}/points?offset=${offset}&limit=${limit}`,
    )
    total = page.total
    items.push(...page.items)
    offset += page.items.length
  } while (offset < total)

  return items
}

export async function listPresets(workspaceId: string) {
  const response = await request<{ items: Preset[] }>(`/api/v1/workspaces/${workspaceId}/presets`)
  return response.items
}

export async function getPreset(workspaceId: string, presetId: string) {
  return request<PresetDetails>(`/api/v1/workspaces/${workspaceId}/presets/${presetId}`)
}

export async function createPreset(
  workspaceId: string,
  input: {
    name: string
    presetKey?: string
    items: Array<{
      sourceType: PresetSourceType
      sourceId: string
      weight: number
      startsAt: string
      endsAt: string | null
    }>
  },
) {
  return request<PresetDetails>(
    `/api/v1/workspaces/${workspaceId}/presets`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, presetKey: input.presetKey ?? null }),
    },
    true,
  )
}

export async function getPresetBounds(workspaceId: string, presetId: string) {
  const details = await getPreset(workspaceId, presetId)
  if (!details.items.length) {
    throw new ApiError("The preset has no items.", "preset_empty", 400)
  }

  const startsAt = details.items
    .map((item) => item.startsAt)
    .sort()[0]
  const endsAt = details.items
    .map((item) => item.endsAt ?? item.sourcePeriodEnd)
    .sort()
    .at(-1)
  if (!endsAt) {
    throw new ApiError("The preset has no valid end time.", "preset_empty", 400)
  }
  const sourceTimeframe = details.items
    .map((item) => item.sourceTimeframe)
    .sort((left, right) => timeframeOptions.indexOf(left) - timeframeOptions.indexOf(right))[0]

  return { startsAt, endsAt, timeframe: sourceTimeframe }
}

export async function queueCalculation(
  workspaceId: string,
  input: ({
    portfolioId: string
    presetId?: never
  } | {
    portfolioId?: never
    presetId: string
  }) & {
    periodStart: string
    periodEnd: string
    timeframe: Timeframe
  },
) {
  return request<CalculationRun>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    true,
  )
}

export async function queueStrategyCalculation(
  workspaceId: string,
  sourceRunId: string,
  strategyType: string,
  parameters: unknown,
) {
  return request<CalculationRun>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs/${sourceRunId}/strategies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategyType, parameters }),
    },
    true,
  )
}

export async function queueOptimization(
  workspaceId: string,
  sourceRunId: string,
  input: {
    strategyType: "rsi" | "mdd_mean_reversion"
    searchSpace: RsiOptimizationSearchSpace | MddOptimizationSearchSpace
    sampleCount: number
    seed: number
    topCount: number
    maximumDrawdownMagnitude?: number | null
    minimumTradeCount?: number | null
    minimumProfitableSampleCount?: number | null
  },
) {
  return request<OptimizationJob>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs/${sourceRunId}/optimizations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    true,
  )
}

export async function listOptimizationJobs(workspaceId: string) {
  const response = await request<{ items: OptimizationJob[] }>(
    `/api/v1/workspaces/${workspaceId}/optimization-jobs`,
  )
  return response.items
}

export async function getOptimizationJob(workspaceId: string, jobId: string) {
  return request<OptimizationJobDetails>(
    `/api/v1/workspaces/${workspaceId}/optimization-jobs/${jobId}`,
  )
}

export async function stopOptimizationJob(workspaceId: string, jobId: string) {
  return request<OptimizationJob>(
    `/api/v1/workspaces/${workspaceId}/optimization-jobs/${jobId}/stop`,
    { method: "POST" },
    true,
  )
}

export async function retryOptimizationJob(workspaceId: string, jobId: string) {
  return request<OptimizationJob>(
    `/api/v1/workspaces/${workspaceId}/optimization-jobs/${jobId}/retry`,
    { method: "POST" },
    true,
  )
}

export async function queueStrategyFromOptimization(
  workspaceId: string,
  jobId: string,
  resultId: string,
) {
  return request<CalculationRun>(
    `/api/v1/workspaces/${workspaceId}/optimization-jobs/${jobId}/results/${resultId}/strategy-runs`,
    { method: "POST" },
    true,
  )
}

export async function listCalculationRuns(workspaceId: string) {
  const response = await request<{ items: CalculationRun[] }>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs`,
  )
  return response.items
}

export async function getCalculationRun(workspaceId: string, runId: string) {
  return request<CalculationRunDetails>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs/${runId}`,
  )
}

export async function retryCalculationRun(workspaceId: string, runId: string) {
  return request<CalculationRun>(
    `/api/v1/workspaces/${workspaceId}/calculation-runs/${runId}/retry`,
    { method: "POST" },
    true,
  )
}

export async function getAllCalculationResult(workspaceId: string, runId: string) {
  const items: PortfolioPoint[] = []
  let offset = 0
  const limit = 5_000
  let total = 0

  do {
    const page = await request<CalculationResultPage>(
      `/api/v1/workspaces/${workspaceId}/calculation-runs/${runId}/result?offset=${offset}&limit=${limit}`,
    )
    total = page.total
    items.push(...page.items)
    offset += page.items.length
  } while (offset < total)

  return items
}

export async function listSavedStrategies(workspaceId: string) {
  const response = await request<{ items: SavedStrategy[] }>(`/api/v1/workspaces/${workspaceId}/strategies`)
  return response.items
}

export async function saveStrategy(workspaceId: string, name: string, strategyRunId: string, strategyKey?: string) {
  return request<SavedStrategy>(
    `/api/v1/workspaces/${workspaceId}/strategies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, strategyRunId, strategyKey: strategyKey ?? null }),
    },
    true,
  )
}

export const timeframeOptions: Timeframe[] = ["1m", "5m", "15m", "1h", "1d", "1M", "1Y"]
