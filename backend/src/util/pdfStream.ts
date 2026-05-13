import { once } from "node:events";
import { unlink } from "node:fs/promises";
import type { WriteStream } from "node:fs";

// Raceaza "finish" vs "error" pe un WriteStream. Daca stream-ul emite "error"
// inainte de "finish" (disk full, permisiuni, antivirus quarantine), promise-ul
// rejecteaza in loc sa atarne pana la timeout HTTP. Cleanup-ul fisierului temp
// e responsabilitatea apelantului — ii pasam path-ul ca sa stearga la fail.
export async function finishWriteStream(stream: WriteStream, tmpPath: string): Promise<void> {
  try {
    await Promise.race([
      once(stream, "finish"),
      once(stream, "error").then(([err]) => {
        throw err instanceof Error ? err : new Error(String(err));
      }),
    ]);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}
