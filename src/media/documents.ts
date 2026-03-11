import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { downloadToFile } from "./download.js";

export interface DocumentAttachment {
  url: string;
  name?: string;
}

/**
 * Download a document from a URL (e.g. Discord CDN) and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadDocument(attachment: DocumentAttachment, projectPath: string): Promise<string> {
  const mediaDir = join(projectPath, ".disclaw", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  const baseName = (attachment.name ?? "file").replace(/[/\\]/g, "_");
  const filename = `${Date.now()}_${baseName}`;
  const localPath = join(mediaDir, filename);

  await downloadToFile(attachment.url, localPath);

  return localPath;
}
