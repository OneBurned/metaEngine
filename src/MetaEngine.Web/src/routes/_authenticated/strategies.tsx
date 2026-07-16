import { StrategyScreen } from "@/features/strategies/strategy-screen"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/strategies")({
  component: StrategyScreen,
})
