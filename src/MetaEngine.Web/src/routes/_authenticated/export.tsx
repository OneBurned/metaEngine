import { ExportScreen } from "@/features/export/export-screen"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/export")({
  component: ExportScreen,
})
