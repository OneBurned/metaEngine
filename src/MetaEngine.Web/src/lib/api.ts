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
  createdAt: string
  createdByUserId: string | null
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d"

export type PortfolioPoint = {
  timestamp: string
  diff: number
}

export type CalculationRun = {
  id: string
  kind: "base" | "strategy"
  inputType: "portfolio" | "preset"
  portfolioId: string | null
  presetId: string | null
  periodStart: string
  periodEnd: string
  timeframe: Timeframe
  status: "queued" | "running" | "completed" | "failed"
  pointCount: number
  tradeCount: number
  finalAccum: number | null
  highWaterMark: number | null
  maxDrawdown: number | null
  errorCode: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  createdByUserId: string | null
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
    throw await toApiError(response)
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
    throw await toApiError(response)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function toApiError(response: Response) {
  const fallback = `Request failed with status ${response.status}.`
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

export async function importPortfolio(workspaceId: string, file: File, name: string) {
  const form = new FormData()
  form.set("name", name)
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

export async function queueCalculation(
  workspaceId: string,
  input: {
    portfolioId: string
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
      body: JSON.stringify({ ...input, presetId: null }),
    },
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

export const timeframeOptions: Timeframe[] = ["1m", "5m", "15m", "1h", "1d"]
