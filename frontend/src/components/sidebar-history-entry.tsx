import { Clock, X } from "lucide-react";

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "acum";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}z`;
}

export interface HistoryEntryRowProps {
  icon: React.ReactNode;
  label: string;
  resultCount: number;
  timestamp: number;
  onClick: () => void;
  onRemove: () => void;
}

export function HistoryEntryRow({ icon, label, resultCount, timestamp, onClick, onRemove }: HistoryEntryRowProps) {
  return (
    <div className="group relative flex items-start rounded-md transition-colors hover:bg-accent">
      <button type="button" onClick={onClick} className="flex w-full items-start gap-2 px-2 py-1.5 text-left">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground group-hover:text-primary">{label}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{resultCount} rez.</span>
            <span>·</span>
            <Clock className="h-2.5 w-2.5" />
            <span>{formatTimeAgo(timestamp)}</span>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Sterge"
        className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-red-500 group-hover:block"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
