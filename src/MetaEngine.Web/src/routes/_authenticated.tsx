import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context, location }) => {
    if (!context.session.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } })
    }
  },
  component: Outlet,
})
