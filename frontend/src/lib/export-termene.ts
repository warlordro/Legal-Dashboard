import type { Termen } from "@/types";
import { api } from "./api";
import { triggerBlobDownload } from "./download-helpers";

export async function exportTermeneExcel(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportXlsxBlob(termene);
  triggerBlobDownload(blob, filename);
}

export async function exportTermenePDF(termene: Termen[]): Promise<void> {
  const { blob, filename } = await api.termene.exportPdfBlob(termene);
  triggerBlobDownload(blob, filename);
}
