import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Document download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, buffer);

  return localPath;
}
