import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollText, Download } from "lucide-react";
import { versions } from "@/data/changelog-entries";
import { exportChangelogPdf } from "@/lib/changelog-pdf";

export default function Changelog() {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportChangelogPdf();
    } catch (e) {
      console.error("[changelog] export pdf failed:", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Changelog</h1>
            <p className="text-sm text-foreground">
              Istoricul complet al modificarilor si imbunatatirilor aduse aplicatiei
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-2">
          <Download className="h-4 w-4" />
          {exporting ? "Se genereaza..." : "Export PDF"}
        </Button>
      </div>

      {/* Version Cards */}
      <div className="space-y-6">
        {versions.map((v, idx) => (
          <Card key={`${v.version}-${v.date}-${idx}`} className={`border-l-4 ${v.borderColor}`}>
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={v.badgeClass}>
                  {v.icon}
                  <span className="ml-1.5 text-sm font-bold">{v.version}</span>
                </Badge>
                <span className="text-sm text-foreground">{v.date}</span>
                {v.subtitle && (
                  <Badge variant="outline" className="font-medium">
                    {v.subtitle}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {v.sections.map((section, idx) => (
                <div key={idx}>
                  <h3 className="mb-1.5 text-base font-semibold text-foreground">{section.title}</h3>
                  {section.content && <p className="text-sm leading-relaxed text-foreground">{section.content}</p>}
                  {section.bullets && (
                    <ul className="mt-2 space-y-1 pl-4">
                      {section.bullets.map((bullet, bIdx) => (
                        <li
                          key={bIdx}
                          className="list-disc text-sm leading-relaxed text-foreground marker:text-foreground/50"
                        >
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
