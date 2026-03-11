import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
export const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Download a URL to a local file with size limits and timeout.
 * Streams to disk instead of buffering the entire response in memory.
 */
export async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File too large: ${contentLength} bytes (max ${MAX_DOWNLOAD_BYTES})`);
  }

  if (!response.body) throw new Error("Response has no body");

  let bytesReceived = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_DOWNLOAD_BYTES) {
        callback(new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes limit`));
      } else {
        callback(null, chunk);
      }
    },
  });

  const readable = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  const writable = createWriteStream(destPath);

  await pipeline(readable, limiter, writable);
}
