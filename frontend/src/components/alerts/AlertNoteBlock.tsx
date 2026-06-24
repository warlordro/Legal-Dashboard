export interface AlertNoteBlockProps {
  note: string | null | undefined;
}

export function AlertNoteBlock({ note }: AlertNoteBlockProps) {
  if (!note || note.trim() === "") return null;

  return (
    <div className="mt-2 border-l-2 border-amber-400 bg-amber-50 px-3 py-1.5 text-xs italic text-foreground/80 dark:bg-amber-950/30">
      <span className="mr-1 font-semibold not-italic">Notita:</span>
      {note}
    </div>
  );
}
