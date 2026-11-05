import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { parseDotEnv } from "../lib/format";
import { Button, Input } from "./ui";

/**
 * Key/value rows for the New Project form, plus "paste a .env block".
 * value: [{ key, value }]  onChange(rows)
 */
export function EnvEditor({ rows, onChange }) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState([]);

  const update = (i, field, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: v } : r)));

  function applyPaste() {
    const { vars, errors } = parseDotEnv(text);
    setErrors(errors);
    if (errors.length) return;
    const merged = new Map(rows.filter((r) => r.key).map((r) => [r.key, r.value]));
    Object.entries(vars).forEach(([k, v]) => merged.set(k, v));
    onChange([...merged].map(([key, value]) => ({ key, value })));
    setText("");
    setPasting(false);
  }

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Variable ${i + 1} name`}
            placeholder="KEY"
            value={r.key}
            onChange={(e) => update(i, "key", e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            className="font-mono text-[13px] sm:w-2/5"
          />
          <Input
            aria-label={`Variable ${i + 1} value`}
            placeholder="value"
            value={r.value}
            onChange={(e) => update(i, "value", e.target.value)}
            className="font-mono text-[13px]"
          />
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove variable"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {pasting ? (
        <div className="space-y-2">
          <textarea
            aria-label="Paste .env contents"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=abc123"}
            className="w-full rounded-md border border-line bg-surface-2 p-3 font-mono text-[13px] placeholder:text-faint focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/10"
          />
          {errors.map((e) => (
            <p key={e} className="text-[13px] text-red-400">{e}</p>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={applyPaste}>Add variables</Button>
            <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onChange([...rows, { key: "", value: "" }])}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add variable
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
            Paste .env
          </Button>
        </div>
      )}
    </div>
  );
}
