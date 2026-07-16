import { PresetScreen } from "@/features/presets/preset-screen"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/presets")({
  component: PresetScreen,
})
