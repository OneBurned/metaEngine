import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import type { SessionContextValue } from "@/features/session/session-context"

export function getRouter() {
  const router = createTanStackRouter({
  routeTree,
  context: {
    session: undefined as unknown as SessionContextValue,
  },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
