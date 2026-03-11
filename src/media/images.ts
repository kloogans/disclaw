import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

export interface ImageAttachment {
  url: string;
  name?: string;
  contentType?: string;
}

/**
 * Download an image from a URL (e.g. Discord CDN) and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadImage(attachment: ImageAttachment, projectPath: string): Promise<string> {
  const mediaDir = join(projectPath, ".disclaw", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  let ext = "jpg";
  if (attachment.name) {
    const parsed = extname(attachment.name).slice(1);
    if (parsed) ext = parsed;
  } else if (attachment.contentType) {
    const sub = attachment.contentType.split("/")[1];
    if (sub) ext = sub.split(";")[0];
  }

  const filename = `img_${Date.now()}.${ext}`;
  const localPath = join(mediaDir, filename);

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, buffer);

  return localPath;
}
