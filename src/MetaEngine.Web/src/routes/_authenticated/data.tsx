import { DataScreen } from "@/features/data/data-screen"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/data")({
  component: DataScreen,
})
