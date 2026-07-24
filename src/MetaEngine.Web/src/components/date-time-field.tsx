import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function DateTimeField({
  disabled,
  help,
  id,
  label,
  onChange,
  value,
}: {
  disabled?: boolean
  help?: string
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return <div className="grid gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      inputMode="numeric"
      placeholder="2026.07.21 21:56"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
    {help ? <p className="text-xs text-slate-500">{help}</p> : null}
  </div>
}
