import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Clean up media files older than 24 hours in a project's media directory.
 */
export function cleanupMedia(projectPath: string): number {
  const mediaDir = join(projectPath, ".claude-control", "media");
  if (!existsSync(mediaDir)) return 0;

  const now = Date.now();
  let cleaned = 0;

  for (const file of readdirSync(mediaDir)) {
    const filePath = join(mediaDir, file);
    const stat = statSync(filePath);
    if (now - stat.mtimeMs > TWENTY_FOUR_HOURS && stat.isFile()) {
      unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}
