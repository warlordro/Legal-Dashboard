import { useState } from "react";
import { Button } from "@/components/ui/button";
import { monitoring } from "@/lib/monitoringApi";

export interface NoteEditorProps {
  jobId: number;
  initialNote: string | null;
  onSaved: (next: string | null) => void;
}

export function NoteEditor({ jobId, initialNote, onSaved }: NoteEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return initialNote ? (
      <button
        type="button"
        onClick={() => {
          setValue(initialNote);
          setError(null);
          setEditing(true);
        }}
        className="mt-1 block w-full max-w-[12rem] cursor-pointer whitespace-normal break-words text-left font-sans text-xs italic leading-relaxed text-muted-foreground hover:text-foreground"
        title={initialNote}
      >
        {initialNote}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => {
          setValue("");
          setError(null);
          setEditing(true);
        }}
        className="mt-1 font-sans text-xs italic text-muted-foreground hover:text-foreground"
      >
        + Adauga notita
      </button>
    );
  }

  const isLegacyOverflow = (initialNote?.length ?? 0) > 200;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = value.trim() === "" ? null : value;
      await monitoring.patch(jobId, { notes: next });
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare salvare");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 space-y-1 font-sans">
      <textarea
        aria-label="Notita"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={200}
        rows={2}
        className="w-full max-w-[12.4rem] rounded border border-border bg-background px-2 py-1 text-xs"
        disabled={saving}
      />
      {isLegacyOverflow && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          Notita veche depaseste 200 caractere - scurteaza inainte de Salveaza.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">{value.length}/200</span>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          Salveaza
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
          Anuleaza
        </Button>
        {error && <span className="text-red-500">{error}</span>}
      </div>
    </div>
  );
}
