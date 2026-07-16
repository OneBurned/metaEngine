import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentUser, queueOptimization } from "./api"

describe("getCurrentUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps the workspace id and name returned by the production API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "user-1",
      email: "admin@metaengine.local",
      displayName: "Admin",
      workspaces: [{
        id: "workspace-1",
        name: "Personal",
        role: "admin",
        canWrite: true,
        canAdminister: true,
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })))

    const user = await getCurrentUser()

    expect(user.workspaces[0]).toMatchObject({
      id: "workspace-1",
      name: "Personal",
      canWrite: true,
    })
  })

  it("sends the RSI search space and optional filters to the optimization queue", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "csrf-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "queued" }), { status: 202 }))
    vi.stubGlobal("fetch", fetch)

    await queueOptimization("workspace-1", "base-run-1", {
      strategyType: "rsi",
      searchSpace: {
        rsiPeriod: { from: 5, to: 30, step: 1 },
        buyLevel: { from: 20, to: 45, step: 5 },
        sellLevel: { from: 55, to: 80, step: 5 },
      },
      sampleCount: 3,
      seed: 42,
      topCount: 100,
      maximumDrawdownMagnitude: 0.2,
      minimumTradeCount: 2,
      minimumProfitableSampleCount: 2,
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe("/api/v1/workspaces/workspace-1/calculation-runs/base-run-1/optimizations")
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toMatchObject({
      strategyType: "rsi",
      sampleCount: 3,
      maximumDrawdownMagnitude: 0.2,
      minimumTradeCount: 2,
      minimumProfitableSampleCount: 2,
    })
  })
})
