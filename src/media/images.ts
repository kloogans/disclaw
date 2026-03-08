import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "grammy";

/**
 * Download an image from Telegram and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadImage(ctx: Context, projectPath: string): Promise<string> {
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    throw new Error("No photo in message");
  }

  // Get highest resolution
  const photo = photos[photos.length - 1];
  const file = await ctx.api.getFile(photo.file_id);

  if (!file.file_path) {
    throw new Error("Could not get file path from Telegram");
  }

  const mediaDir = join(projectPath, ".claude-control", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  const ext = file.file_path.split(".").pop() ?? "jpg";
  const filename = `img_${Date.now()}.${ext}`;
  const localPath = join(mediaDir, filename);

  // Download the file
  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(localPath, buffer);

  return localPath;
}
