import type { TextChannel, AnyThreadChannel } from "discord.js";
import type pino from "pino";

type SendableChannel = TextChannel | AnyThreadChannel;

const MAX_STREAM_BUFFER = 100_000;
const DISCORD_PREVIEW_LIMIT = 1900;
const DISCORD_PREVIEW_SLICE = 1800;
const STREAM_UPDATE_INTERVAL_MS = 4000;
const TYPING_INTERVAL_MS = 9000;

export class StreamManager {
  private logger: pino.Logger;
  private typingInterval: ReturnType<typeof setInterval> | null = null;
  private streamUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private streamBuffer = "";
  private thinkingBuffer = "";
  private isShowingThinking = false;
  private isFlushingStream = false;

  constructor(logger: pino.Logger) {
    this.logger = logger;
  }

  startTyping(channel: SendableChannel): void {
    this.stopTyping();
    // Send immediately, then every 9 seconds (Discord typing lasts 10s)
    channel.sendTyping().catch((e) => this.logger.debug(e, "sendTyping failed"));
    this.typingInterval = setInterval(() => {
      channel.sendTyping().catch((e) => this.logger.debug(e, "sendTyping failed"));
    }, TYPING_INTERVAL_MS);
  }

  stopTyping(): void {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
  }

  startStreaming(): void {
    this.streamBuffer = "";
    this.stopStreaming();
    this.streamUpdateInterval = setInterval(() => {
      // Flushing is triggered by the handler passing channel + statusMessageId
    }, STREAM_UPDATE_INTERVAL_MS);
  }

  /**
   * Start streaming with automatic flush callback.
   */
  startStreamingWithFlush(flushFn: () => void): void {
    this.streamBuffer = "";
    this.stopStreaming();
    this.streamUpdateInterval = setInterval(flushFn, STREAM_UPDATE_INTERVAL_MS);
  }

  stopStreaming(): void {
    if (this.streamUpdateInterval) {
      clearInterval(this.streamUpdateInterval);
      this.streamUpdateInterval = null;
    }
  }

  async flush(channel: SendableChannel, statusMessageId: string): Promise<void> {
    if (this.isFlushingStream) return;
    this.isFlushingStream = true;

    let icon: string;
    let preview: string;

    if (this.isShowingThinking && this.thinkingBuffer) {
      icon = "\uD83E\uDDE0";
      preview = this.thinkingBuffer;
    } else if (this.streamBuffer) {
      icon = "\u270D\uFE0F";
      preview = this.streamBuffer;
    } else {
      this.isFlushingStream = false;
      return;
    }

    // Discord limit is 2000 chars, leave room for icon
    if (preview.length > DISCORD_PREVIEW_LIMIT) {
      preview = "..." + preview.slice(-DISCORD_PREVIEW_SLICE);
    }

    try {
      const msg = await channel.messages.fetch(statusMessageId);
      await msg.edit(`${icon}\n\n${preview}`);
    } catch {
      // Edit might fail if message was deleted
    } finally {
      this.isFlushingStream = false;
    }
  }

  handleStreamDelta(text: string): void {
    this.isShowingThinking = false;
    this.streamBuffer += text;
    if (this.streamBuffer.length > MAX_STREAM_BUFFER) {
      this.streamBuffer = this.streamBuffer.slice(-MAX_STREAM_BUFFER);
    }
  }

  handleThinkingDelta(text: string): void {
    this.isShowingThinking = true;
    this.thinkingBuffer += text;
    if (this.thinkingBuffer.length > MAX_STREAM_BUFFER) {
      this.thinkingBuffer = this.thinkingBuffer.slice(-MAX_STREAM_BUFFER);
    }
  }

  /** Clear buffers on tool use (new output replaces old preview). */
  onToolUse(): void {
    this.streamBuffer = "";
    this.thinkingBuffer = "";
    this.isShowingThinking = false;
  }

  reset(): void {
    this.streamBuffer = "";
    this.thinkingBuffer = "";
    this.isShowingThinking = false;
  }
}
