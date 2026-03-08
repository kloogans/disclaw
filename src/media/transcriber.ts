import { Whisper } from "smart-whisper";
// @ts-ignore — node-wav has no type definitions
import { decode } from "node-wav";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/store.js";
import type { WhisperConfig } from "../config/types.js";
import type pino from "pino";

let whisperInstance: Whisper | null = null;
let modelLoading = false;

const MODELS_DIR = join(getConfigDir(), "models");

/**
 * Get or initialize the shared Whisper instance.
 * Downloads the model on first use.
 */
async function getWhisper(config: WhisperConfig, logger: pino.Logger): Promise<Whisper> {
  if (whisperInstance) return whisperInstance;
  if (modelLoading) {
    // Wait for another caller to finish loading
    while (modelLoading) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (whisperInstance) return whisperInstance;
  }

  modelLoading = true;
  try {
    if (!existsSync(MODELS_DIR)) {
      mkdirSync(MODELS_DIR, { recursive: true });
    }

    let modelPath = join(MODELS_DIR, `ggml-${config.model}.bin`);

    if (!existsSync(modelPath)) {
      // Try smart-whisper's built-in manager
      try {
        const { manager } = await import("smart-whisper");
        if (!manager.check(config.model)) {
          logger.info({ model: config.model }, "Downloading whisper model (first time)...");
          await manager.download(config.model);
          logger.info({ model: config.model }, "Whisper model downloaded");
        }
        modelPath = manager.resolve(config.model);
      } catch (err) {
        throw new Error(`Whisper model not found at ${modelPath} and auto-download failed: ${err}`);
      }
    }

    logger.info({ model: config.model, path: modelPath }, "Loading whisper model");
    whisperInstance = new Whisper(modelPath, { gpu: config.gpu });
    logger.info("Whisper model loaded");

    return whisperInstance;
  } finally {
    modelLoading = false;
  }
}

/**
 * Transcribe an audio buffer (OGG/Opus from Telegram) to text.
 * Converts to WAV 16kHz mono first, then runs whisper.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  config: WhisperConfig,
  logger: pino.Logger,
): Promise<string> {
  const whisper = await getWhisper(config, logger);

  // Save as temp file and convert — smart-whisper needs WAV PCM
  const tempDir = join(getConfigDir(), "temp");
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  const ts = Date.now();
  const tempOgg = join(tempDir, `voice_${ts}.ogg`);
  const tempWav = join(tempDir, `voice_${ts}.wav`);

  try {
    writeFileSync(tempOgg, audioBuffer);

    // Use ffmpeg to convert OGG to WAV 16kHz mono
    const { execSync } = await import("node:child_process");
    execSync(`ffmpeg -i "${tempOgg}" -ar 16000 -ac 1 -f wav "${tempWav}" -y -loglevel quiet`);

    // Read WAV and decode to PCM
    const wavBuffer = readFileSync(tempWav);
    const { channelData, sampleRate } = decode(wavBuffer) as {
      channelData: Float32Array[];
      sampleRate: number;
    };

    if (sampleRate !== 16000) {
      throw new Error(`Unexpected sample rate: ${sampleRate}`);
    }

    const pcm = channelData[0];
    const task = await whisper.transcribe(pcm, { language: config.language });
    const result = await task.result;

    // Extract text from result
    const text = Array.isArray(result)
      ? result.map((seg: { text?: string }) => seg.text ?? String(seg)).join(" ")
      : String(result);

    return text.trim();
  } finally {
    // Clean up temp files
    if (existsSync(tempOgg)) unlinkSync(tempOgg);
    if (existsSync(tempWav)) unlinkSync(tempWav);
  }
}

export async function freeWhisper(): Promise<void> {
  if (whisperInstance) {
    await whisperInstance.free();
    whisperInstance = null;
  }
}
