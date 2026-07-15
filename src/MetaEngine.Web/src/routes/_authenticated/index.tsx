import { DashboardScreen } from "@/features/dashboard/dashboard-screen"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({ component: DashboardScreen })
