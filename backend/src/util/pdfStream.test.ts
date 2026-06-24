import { describe, expect, it } from "vitest";
import { createWriteStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { finishWriteStream } from "./pdfStream.ts";

function tmpFile() {
  return join(tmpdir(), `pdfstream-test-${randomUUID()}.bin`);
}

describe("finishWriteStream", () => {
  it("rezolva pe 'finish' normal", async () => {
    const path = tmpFile();
    const stream = createWriteStream(path);
    stream.write("hello");
    stream.end();
    await expect(finishWriteStream(stream, path)).resolves.toBeUndefined();
    await unlink(path).catch(() => {});
  });

  it("rejecteaza si sterge tmp file daca stream-ul emite 'error'", async () => {
    const path = tmpFile();
    const stream = createWriteStream(path);
    // Asteptam ca stream-ul sa fie deschis inainte sa fortam un error.
    await new Promise<void>((resolve) => stream.once("open", () => resolve()));
    // Forteaza error emission — simuleaza disk-full / permission denied.
    const fakeError = new Error("simulated disk full");
    queueMicrotask(() => stream.emit("error", fakeError));

    await expect(finishWriteStream(stream, path)).rejects.toThrow(/simulated disk full/);
    // Cleanup invocat de helper indiferent ca fisierul exista sau nu.
    expect(existsSync(path)).toBe(false);
  });
});
