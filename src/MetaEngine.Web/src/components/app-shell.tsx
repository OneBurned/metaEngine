import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSession } from "@/features/session/session-context"
import { BarChart3, Database, LogOut, Workflow } from "lucide-react"
import type { PropsWithChildren } from "react"

export function AppShell({ children, onSignOut }: PropsWithChildren<{ onSignOut: () => void }>) {
  const { user, workspace, selectWorkspace } = useSession()

  return (
    <div className="min-h-dvh bg-[#f5f7f9] text-slate-950">
      <div className="mx-auto grid min-h-dvh max-w-[1600px] grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white px-4 py-5 lg:border-r lg:border-b-0">
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-9 place-items-center rounded-md bg-teal-700 text-white">
              <Workflow className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-base font-semibold">MetaEngine</p>
              <p className="text-xs text-slate-500">Research workspace</p>
            </div>
          </div>

          <Separator className="my-6" />

          <nav className="space-y-1" aria-label="Разделы приложения">
            <div className="flex items-center gap-3 rounded-md bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800">
              <BarChart3 className="size-4" aria-hidden="true" />
              Расчеты
            </div>
            <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-500">
              <Database className="size-4" aria-hidden="true" />
              Портфолио
            </div>
          </nav>
        </aside>

        <div className="min-w-0">
          <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 sm:px-7">
            <div className="min-w-48">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Workspace</p>
              <Select value={workspace?.id} onValueChange={selectWorkspace}>
                <SelectTrigger className="mt-1 w-full max-w-72 bg-white" aria-label="Выбор workspace">
                  <SelectValue placeholder="Выберите workspace" />
                </SelectTrigger>
                <SelectContent>
                  {user?.workspaces.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium">{user?.displayName}</p>
                <p className="text-xs text-slate-500">{workspace?.role}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={onSignOut} aria-label="Выйти">
                    <LogOut className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Выйти</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <main className="px-5 py-6 sm:px-7 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
