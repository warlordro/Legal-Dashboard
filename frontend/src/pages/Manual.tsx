import { BookOpen, Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ManualChapters } from "./manual-content";

interface ManualProps {
  onDownloadPdf?: () => void;
  isDownloading?: boolean;
}

export default function Manual({ onDownloadPdf, isDownloading }: ManualProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Manual de Utilizare</h1>
            <p className="text-sm text-foreground">
              Ghid complet pentru toate functiile aplicatiei Legal Dashboard
            </p>
          </div>
        </div>
        {onDownloadPdf && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={onDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? "Se genereaza..." : "Descarca PDF"}
          </Button>
        )}
      </div>

      {/* Table of Contents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm uppercase tracking-wider text-foreground">Cuprins</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1 sm:grid-cols-2 text-sm">
            {[
              { label: "1. Prezentare Generala", id: "prezentare" },
              { label: "2. Pagina Dashboard", id: "dashboard" },
              { label: "3. Cautare Dosare", id: "dosare" },
              { label: "4. Termene & Calendar", id: "termene" },
              { label: "5. Modul RNPM (Publicitate Mobiliara)", id: "rnpm" },
              { label: "6. Incarca Mai Multe (Load More)", id: "loadmore" },
              { label: "7. Export Excel si PDF", id: "export" },
              { label: "8. Analiza AI", id: "ai" },
              { label: "9. Analiza AI Avansata (Multi-Agent)", id: "ai-multi" },
              { label: "10. Configurare Chei API", id: "chei-api" },
              { label: "11. Sidebar si Navigare", id: "sidebar" },
              { label: "12. Personalizare (Tema & Font)", id: "personalizare" },
              { label: "13. Securitate si Confidentialitate", id: "securitate" },
              { label: "14. Monitorizare automata", id: "monitorizare" },
              { label: "15. Inbox Alerte", id: "alerte" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className="text-left text-foreground py-0.5 hover:text-primary hover:underline transition-colors cursor-pointer"
                onClick={() => {
                  const el = document.getElementById(item.id);
                  if (!el) return;
                  let parent = el.parentElement;
                  while (parent) {
                    const style = getComputedStyle(parent);
                    if ((style.overflowY === "auto" || style.overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
                      const elRect = el.getBoundingClientRect();
                      const parentRect = parent.getBoundingClientRect();
                      parent.scrollTo({ top: parent.scrollTop + (elRect.top - parentRect.top) - 16, behavior: "smooth" });
                      return;
                    }
                    parent = parent.parentElement;
                  }
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <ManualChapters />

      {/* Footer with second download button */}
      <div className="text-center text-xs text-foreground pt-4 pb-8 border-t border-border space-y-3">
        {onDownloadPdf && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onDownloadPdf}
            disabled={isDownloading}
          >
            {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isDownloading ? "Se genereaza..." : "Descarca Manual PDF"}
          </Button>
        )}
        <p>Legal Dashboard — Manual de Utilizare v{__APP_VERSION__}</p>
        <p>Datele sunt furnizate de API-ul public al Ministerului Justitiei (portalquery.just.ro) si Registrul National de Publicitate Mobiliara (mj.rnpm.ro)</p>
      </div>
    </div>
  );
}
