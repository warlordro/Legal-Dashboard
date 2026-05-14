import type { Dosar } from "@/types";
import { api } from "./api";
import { triggerBlobDownload } from "./download-helpers";

export async function exportDosareExcel(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportXlsxBlob(dosare);
  triggerBlobDownload(blob, filename);
}

export async function exportDosarePDF(dosare: Dosar[]): Promise<void> {
  const { blob, filename } = await api.dosare.exportPdfBlob(dosare);
  triggerBlobDownload(blob, filename);
}
