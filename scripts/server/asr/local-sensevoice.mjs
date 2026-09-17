import { PcmWindowBuffer } from "../audio/pcm-window-buffer.mjs";
import { pcm16ToWav } from "../audio/wav.mjs";
import { TranscriptMerger } from "../transcript/merger.mjs";

export const LOCAL_SENSEVOICE_PROVIDER = "local-sensevoice-http";
export const LOCAL_SENSEVOICE_DEFAULT_ENDPOINT = "http://127.0.0.1:8000/v1/audio/transcriptions";
export const LOCAL_SENSEVOICE_DEFAULT_MODEL = "sensevoice";

export class LocalSenseVoiceSession {
  constructor(config, callbacks = {}) {
    this.endpoint = config.endpoint || LOCAL_SENSEVOICE_DEFAULT_ENDPOINT;
    this.model = config.model || LOCAL_SENSEVOICE_DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.buffer = new PcmWindowBuffer({
      sampleRate: config.sampleRate ?? 16_000,
      windowMs: config.windowMs ?? 1_200,
      overlapMs: config.overlapMs ?? 200,
      maxPendingMs: config.maxPendingMs ?? 8_000,
    });
    this.merger = new TranscriptMerger();
    this.onTranscript = callbacks.onTranscript ?? (() => {});
    this.onError = callbacks.onError ?? (() => {});
    this.onMetrics = callbacks.onMetrics ?? (() => {});
    this.closed = false;
    this.running = false;
    this.pumpPromise = null;
    this.abortController = null;
  }

  async start() {
    if (this.closed) throw new Error("Local SenseVoice session is closed.");
  }

  pushPcm(chunk) {
    if (this.closed) return;
    const droppedBytes = this.buffer.push(chunk);
    if (droppedBytes > 0) {
      this.onMetrics({ type: "audio_dropped", milliseconds: Math.round(droppedBytes / this.buffer.bytesPerMs) });
    }
    void this.pump(false);
  }

  async stop() {
    if (this.closed) return;
    await this.pump(false);
    if (!this.closed) {
      const tail = this.buffer.takeTail();
      if (tail) await this.transcribe(tail);
    }
  }

  async close() {
    this.closed = true;
    this.buffer.clear();
    this.abortController?.abort();
    await this.pumpPromise?.catch(() => undefined);
  }

  async pump(includeTail) {
    if (this.running) {
      await this.pumpPromise;
      if (includeTail && !this.closed) await this.pump(true);
      return;
    }

    this.running = true;
    this.pumpPromise = (async () => {
      try {
        while (!this.closed) {
          const pcm = this.buffer.takeReadyWindow();
          if (!pcm) break;
          await this.transcribe(pcm);
        }
        if (includeTail && !this.closed) {
          const tail = this.buffer.takeTail();
          if (tail) await this.transcribe(tail);
        }
      } finally {
        this.running = false;
        this.pumpPromise = null;
        if (!this.closed && this.buffer.byteLength >= this.buffer.windowBytes) void this.pump(false);
      }
    })();

    await this.pumpPromise;
  }

  async transcribe(pcm) {
    const startedAt = Date.now();
    this.abortController = new AbortController();
    const timeout = setTimeout(() => this.abortController?.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      form.append("file", new Blob([pcm16ToWav(pcm)], { type: "audio/wav" }), "segment.wav");
      form.append("model", this.model);
      form.append("response_format", "json");
      form.append("keep_tags", "false");

      const response = await fetch(this.endpoint, {
        method: "POST",
        body: form,
        signal: this.abortController.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`本地 SenseVoice 返回 HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
      }

      const result = await response.json();
      const text = this.merger.push(result?.text ?? "");
      this.onMetrics({ type: "asr_inference", milliseconds: Date.now() - startedAt, audioBytes: pcm.length });
      if (text) this.onTranscript(text, { isFinal: true });
    } catch (error) {
      if (!this.closed) this.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearTimeout(timeout);
      this.abortController = null;
    }
  }
}
