import { describe, expect, it } from "vitest";

import { readResponseTextWithCap, ResponseTooLargeSignal } from "./streamCap.ts";

function chunkedResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    })
  );
}

describe("streamCap", () => {
  it("reads streamed text while counting UTF-8 bytes", async () => {
    const text = await readResponseTextWithCap(chunkedResponse(["abc", "de"]), 5);

    expect(text).toBe("abcde");
  });

  it("fails before reading when Content-Length exceeds the cap", async () => {
    const response = new Response("abc", { headers: { "content-length": "10" } });

    await expect(readResponseTextWithCap(response, 5)).rejects.toBeInstanceOf(ResponseTooLargeSignal);
  });

  it("cancels the abandoned body when Content-Length exceeds the cap", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abc"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, { headers: { "content-length": "10" } });

    await expect(readResponseTextWithCap(response, 5)).rejects.toBeInstanceOf(ResponseTooLargeSignal);
    expect(cancelled).toBe(true);
  });

  it("fails while streaming when the byte cap is exceeded", async () => {
    await expect(readResponseTextWithCap(chunkedResponse(["abc", "def"]), 5)).rejects.toMatchObject({
      name: "ResponseTooLargeSignal",
      bytes: 6,
    });
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readResponseTextWithCap(chunkedResponse(["abc"]), 5, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("returns empty string for a 204 response with no body", async () => {
    const text = await readResponseTextWithCap(new Response(null, { status: 204 }), 5);

    expect(text).toBe("");
  });

  it("returns empty string for a null body without throwing on a tiny cap", async () => {
    await expect(readResponseTextWithCap(new Response(null), 1)).resolves.toBe("");
  });
});
