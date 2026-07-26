import fsPromises from "node:fs/promises";
import { withMaintenanceRead } from "./backup.ts";
import { getRnpmDbPath, passiveCheckpointRnpmWal } from "./rnpmDb.ts";
import { getOverride } from "./userQuotaRepository.ts";

const DEFAULT_RNPM_STORAGE_MB = 750;
const BYTES_PER_MIB = 1024 * 1024;
const RNPM_STORAGE_FEATURE = "rnpm.storage";

let warnedInvalidDefaultRnpmStorage = false;

export function readDefaultRnpmStorageMb(): number | null {
  const raw = process.env.LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB;
  if (raw === undefined || raw === "") return DEFAULT_RNPM_STORAGE_MB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    if (!warnedInvalidDefaultRnpmStorage) {
      warnedInvalidDefaultRnpmStorage = true;
      console.warn(
        `[rnpmStorageLimit] LEGAL_DASHBOARD_DEFAULT_RNPM_STORAGE_MB invalid ("${raw}") — folosesc default ${DEFAULT_RNPM_STORAGE_MB} MB.`
      );
    }
    return DEFAULT_RNPM_STORAGE_MB;
  }
  if (parsed <= 0) return null;
  return parsed;
}

export function getRnpmStorageLimitBytes(ownerId: string): number | null {
  const override = getOverride(ownerId, RNPM_STORAGE_FEATURE);
  if (override) {
    return override.limit_usd_milli === null ? null : override.limit_usd_milli * BYTES_PER_MIB;
  }
  const defaultMb = readDefaultRnpmStorageMb();
  return defaultMb === null ? null : defaultMb * BYTES_PER_MIB;
}

async function sizeOrZero(filePath: string): Promise<number> {
  try {
    return (await fsPromises.stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    throw error;
  }
}

async function measureFiles(dbPath: string): Promise<number> {
  const [main, wal, shm] = await Promise.all([
    sizeOrZero(dbPath),
    sizeOrZero(`${dbPath}-wal`),
    sizeOrZero(`${dbPath}-shm`),
  ]);
  return main + wal + shm;
}

export interface RnpmStorageMeasurement {
  usedBytes: number;
  exists: boolean;
}

// Varianta FARA lock, pentru apelanti care tin deja maintenance read-ul.
// RWLock-ul e writer-preference si NEREENTRANT (util/rwlock.ts): un al doilea read
// cerut din interiorul primului se aseaza dupa orice writer intrat la coada intre
// timp, iar writer-ul asteapta read-ul exterior — deadlock permanent, fara timeout si
// fara log. Nu apela asta fara sa detii deja lock-ul.
export function measureRnpmStorageUnlocked(ownerId: string): Promise<RnpmStorageMeasurement> {
  return measureRnpmStorageInner(ownerId);
}

export function measureRnpmStorage(ownerId: string): Promise<RnpmStorageMeasurement> {
  return withMaintenanceRead(() => measureRnpmStorageInner(ownerId));
}

function measureRnpmStorageInner(ownerId: string): Promise<RnpmStorageMeasurement> {
  return (async () => {
    const dbPath = getRnpmDbPath(ownerId);
    let mainBytes: number;
    try {
      mainBytes = (await fsPromises.stat(dbPath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { usedBytes: 0, exists: false };
      throw error;
    }

    const rawUsedBytes = mainBytes + (await sizeOrZero(`${dbPath}-wal`)) + (await sizeOrZero(`${dbPath}-shm`));
    const limitBytes = getRnpmStorageLimitBytes(ownerId);
    if (limitBytes !== null && rawUsedBytes >= limitBytes) {
      // A doua sansa best-effort: publica paginile WAL deja comise in main
      // inainte de decizia de admission. PASSIVE nu blocheaza writerii activi.
      try {
        passiveCheckpointRnpmWal(ownerId);
      } catch (error) {
        console.warn(
          "[rnpmStorageLimit] wal_checkpoint(PASSIVE) failed:",
          error instanceof Error ? error.message : error
        );
      }
      return { usedBytes: await measureFiles(dbPath), exists: true };
    }
    return { usedBytes: rawUsedBytes, exists: true };
  })();
}

export class RnpmStorageLimitError extends Error {
  readonly name = "RnpmStorageLimitError";
  readonly code = "RNPM_STORAGE_LIMIT";

  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number
  ) {
    const usedMb = (usedBytes / BYTES_PER_MIB).toFixed(1);
    const limitMb = (limitBytes / BYTES_PER_MIB).toFixed(1);
    super(
      `Spatiul RNPM alocat este plin (${usedMb} MB din ${limitMb} MB). Sterge avize (stergerea pe selectie elibereaza automat spatiul) sau compacteaza din zona RNPM.`
    );
  }
}

export async function assertRnpmStorageWithinLimit(ownerId: string): Promise<void> {
  const limitBytes = getRnpmStorageLimitBytes(ownerId);
  if (limitBytes === null) return;
  const { usedBytes } = await measureRnpmStorage(ownerId);
  if (usedBytes >= limitBytes) throw new RnpmStorageLimitError(usedBytes, limitBytes);
}
