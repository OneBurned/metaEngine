import { afterEach, describe, expect, it, vi } from "vitest"

import { getCurrentUser } from "./api"

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
})
