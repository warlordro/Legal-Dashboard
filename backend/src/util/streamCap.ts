export async function readResponseTextWithCap(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be positive");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ResponseTooLargeSignal(contentLength);
  }
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) throw new ResponseTooLargeSignal(bytes);
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  const abort = async () => {
    try {
      await reader.cancel();
    } catch {
      // best-effort cancel
    }
  };
  try {
    while (true) {
      if (signal?.aborted) {
        await abort();
        throw new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await abort();
        throw new ResponseTooLargeSignal(total);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export class ResponseTooLargeSignal extends Error {
  constructor(readonly bytes: number) {
    super("response too large");
    this.name = "ResponseTooLargeSignal";
  }
}
