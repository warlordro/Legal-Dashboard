// RNPM pagineaza instabil sub sarcina: acelasi rand poate reveni pe pagini
// succesive (observat live 2026-07-13: 175 de randuri livrate pentru un total
// real de 144). Lista din UI acumuleaza batch-uri — fara dedup, contorul
// depaseste totalul ("150 din 144") si randurile apar dublate. Cheia de
// unicitate e identificator.v — aceeasi pe care o foloseste si DB-ul la
// salvare, deci datele persistate au fost mereu curate; problema era doar
// afisajul. avizIds e array paralel cu documents (acelasi index) si trebuie
// filtrat pereche.
import type { RnpmDocument } from "@/types/rnpm";

export interface RnpmDocBatch {
  documents: RnpmDocument[];
  avizIds: (number | null)[];
}

export function appendUniqueDocuments(prev: RnpmDocBatch, next: RnpmDocBatch): RnpmDocBatch {
  const seen = new Set(prev.documents.map((d) => d.identificator.v));
  const documents = [...prev.documents];
  const avizIds = [...prev.avizIds];
  next.documents.forEach((docItem, i) => {
    if (seen.has(docItem.identificator.v)) return;
    seen.add(docItem.identificator.v);
    documents.push(docItem);
    avizIds.push(next.avizIds[i] ?? null);
  });
  return { documents, avizIds };
}
