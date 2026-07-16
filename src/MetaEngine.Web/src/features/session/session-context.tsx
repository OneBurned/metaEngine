import {
  ApiError,
  getCurrentUser,
  login,
  logout,
  type CurrentUser,
  type WorkspaceAccess,
} from "@/lib/api"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react"

type SessionStatus = "loading" | "anonymous" | "authenticated"

export type SessionContextValue = {
  status: SessionStatus
  user: CurrentUser | null
  workspace: WorkspaceAccess | null
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  selectWorkspace: (workspaceId: string) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<SessionStatus>("loading")
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)

  const applyUser = useCallback((nextUser: CurrentUser | null) => {
    setUser(nextUser)
    setStatus(nextUser ? "authenticated" : "anonymous")
    setWorkspaceId((current) => {
      if (nextUser?.workspaces.some((workspace) => workspace.id === current)) {
        return current
      }
      return nextUser?.workspaces[0]?.id ?? null
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      applyUser(await getCurrentUser())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        applyUser(null)
        return
      }
      applyUser(null)
    }
  }, [applyUser])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<SessionContextValue>(() => {
    const workspace = user?.workspaces.find((item) => item.id === workspaceId) ?? null
    return {
      status,
      user,
      workspace,
      isAuthenticated: status === "authenticated",
      signIn: async (email, password) => {
        applyUser(await login(email, password))
      },
      signOut: async () => {
        await logout()
        applyUser(null)
      },
      refresh,
      selectWorkspace: setWorkspaceId,
    }
  }, [applyUser, refresh, status, user, workspaceId])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within SessionProvider.")
  }
  return context
}
