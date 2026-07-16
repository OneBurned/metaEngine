import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSession } from "@/features/session/session-context"
import { Activity, LoaderCircle } from "lucide-react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session.isAuthenticated) {
      throw redirect({ to: "/" })
    }
  },
  component: LoginScreen,
})

function LoginScreen() {
  const { signIn } = useSession()
  const navigate = useNavigate({ from: "/login" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await signIn(email, password)
      await navigate({ to: "/" })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось войти.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f7f9] px-5 py-10">
      <Card className="w-full max-w-md rounded-lg border-slate-200 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="grid size-10 place-items-center rounded-md bg-teal-700 text-white"><Activity className="size-5" /></div>
          <div>
            <p className="text-sm font-medium text-teal-700">MetaEngine</p>
            <CardTitle className="mt-1 text-2xl">Вход в workspace</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
            <Field label="Пароль" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>
            {error ? <Alert variant="destructive" className="rounded-md"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <LoaderCircle className="animate-spin" /> : null}
              Войти
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>
}
