import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "grammy";

/**
 * Download a document from Telegram and save it to the project's media directory.
 * Returns the local file path.
 */
export async function downloadDocument(ctx: Context, projectPath: string): Promise<string> {
  const doc = ctx.message?.document;
  if (!doc) {
    throw new Error("No document in message");
  }

  const file = await ctx.api.getFile(doc.file_id);
  if (!file.file_path) {
    throw new Error("Could not get file path from Telegram");
  }

  const mediaDir = join(projectPath, ".claude-control", "media");
  if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });

  const baseName = (doc.file_name ?? "file").replace(/[/\\]/g, "_");
  const filename = `${Date.now()}_${baseName}`;
  const localPath = join(mediaDir, filename);

  const url = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
  let buffer: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw new Error(`Telegram file download failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  writeFileSync(localPath, buffer);

  return localPath;
}
