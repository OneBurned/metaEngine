import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { SessionProvider, useSession } from "@/features/session/session-context"
import { getRouter } from "./router"

const router = getRouter()

const rootElement = document.getElementById('app')!

function RouterApp() {
  const session = useSession()
  if (session.status === "loading") {
    return <div className="grid min-h-dvh place-items-center bg-[#f5f7f9] text-sm text-slate-500">Подключение к MetaEngine...</div>
  }

  return <RouterProvider router={router} context={{ session }} />
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <SessionProvider>
      <RouterApp />
    </SessionProvider>,
  )
}
