import { lazy, Suspense, type Ref } from "react";
import { ScrollText, BookOpen, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Lazy: both modals mount only after user click; the Manual pulls in jspdf + xlsx.
const Changelog = lazy(() => import("@/pages/Changelog"));
const Manual = lazy(() => import("@/pages/Manual"));

const modalFallback = (
  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
    Se incarca...
  </div>
);

export function ChangelogDialog({
  dialogRef,
  appVersion,
  onClose,
}: {
  dialogRef: Ref<HTMLDivElement>;
  appVersion: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        tabIndex={-1}
        className="relative mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-violet-500" />
            <h2 id="changelog-title" className="text-lg font-bold">
              Noutati
            </h2>
            <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400 text-xs font-bold">
              {appVersion}
            </Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Inchide noutati">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto scrollbar-thin px-2 py-4">
          <Suspense fallback={modalFallback}>
            <Changelog />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export function ManualDialog({
  dialogRef,
  appVersion,
  onClose,
  onDownloadPdf,
  isDownloading,
}: {
  dialogRef: Ref<HTMLDivElement>;
  appVersion: string;
  onClose: () => void;
  onDownloadPdf: () => void;
  isDownloading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-title"
        tabIndex={-1}
        className="relative mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-background shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 id="manual-title" className="text-lg font-bold">
              Manual de Utilizare
            </h2>
            <Badge className="bg-primary/10 text-primary text-xs font-bold">{appVersion}</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Inchide manual">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto scrollbar-thin px-2 py-4">
          <Suspense fallback={modalFallback}>
            <Manual onDownloadPdf={onDownloadPdf} isDownloading={isDownloading} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
