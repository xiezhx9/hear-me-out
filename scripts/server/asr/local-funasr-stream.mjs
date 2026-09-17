import { WebSocket } from "ws";

export const LOCAL_FUNASR_STREAM_PROVIDER = "local-funasr-stream";
export const LOCAL_FUNASR_STREAM_DEFAULT_ENDPOINT = "ws://127.0.0.1:10095";
export const LOCAL_FUNASR_STREAM_DEFAULT_MODEL = "funasr-2pass";

export class LocalFunasrStreamSession {
  constructor(config, callbacks = {}) {
    this.endpoint = config.endpoint || LOCAL_FUNASR_STREAM_DEFAULT_ENDPOINT;
    this.chunkSize = config.chunkSize ?? [5, 10, 5];
    this.chunkInterval = config.chunkInterval ?? 10;
    this.sampleRate = config.sampleRate ?? 16_000;
    this.strideMs = (60 * this.chunkSize[1]) / this.chunkInterval;
    this.strideBytes = Math.floor((this.strideMs * this.sampleRate * 2) / 1_000);
    this.maxPendingBytes = Math.floor(((config.maxPendingMs ?? 2_400) * this.sampleRate * 2) / 1_000);
    this.wavName = config.wavName ?? `tab-${Date.now()}`;
    this.onTranscript = callbacks.onTranscript ?? (() => {});
    this.onError = callbacks.onError ?? (() => {});
    this.onMetrics = callbacks.onMetrics ?? (() => {});
    this.WebSocketImpl = config.WebSocketImpl ?? WebSocket;
    this.socket = null;
    this.audioBuffer = Buffer.alloc(0);
    this.started = false;
    this.closed = false;
    this.connectedAt = 0;
    this.finalization = null;
    this.resolveFinalization = null;
  }

  async start() {
    if (this.closed) throw new Error("Local FunASR stream session is closed.");
    if (this.socket) return;

    await new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(this.endpoint, "binary");
      this.socket = socket;
      const connectTimeout = setTimeout(() => {
        socket.close();
        reject(new Error("本地 FunASR 流式服务连接超时。"));
      }, 3_000);

      socket.once("open", () => {
        clearTimeout(connectTimeout);
        this.connectedAt = Date.now();
        this.started = true;
        socket.send(
          JSON.stringify({
            mode: "2pass",
            chunk_size: this.chunkSize,
            chunk_interval: this.chunkInterval,
            encoder_chunk_look_back: 4,
            decoder_chunk_look_back: 1,
            audio_fs: this.sampleRate,
            wav_name: this.wavName,
            is_speaking: true,
            itn: true,
          }),
        );
        this.flush();
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(connectTimeout);
        if (!this.started) reject(error);
      });
      socket.on("message", (data) => this.handleMessage(data));
      socket.on("error", (error) => {
        if (!this.closed) this.onError(error instanceof Error ? error : new Error(String(error)));
      });
      socket.on("close", () => {
        this.started = false;
        if (!this.closed) this.onError(new Error("本地 FunASR 流式服务连接已关闭。"));
      });
    });
  }

  pushPcm(chunk) {
    if (this.closed) return;
    const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.audioBuffer = Buffer.concat([this.audioBuffer, pcm.length % 2 === 0 ? pcm : pcm.subarray(0, pcm.length - 1)]);
    if (this.audioBuffer.length > this.maxPendingBytes) {
      const dropped = this.audioBuffer.length - this.maxPendingBytes;
      this.audioBuffer = this.audioBuffer.subarray(dropped - (dropped % 2));
      this.onMetrics({ type: "audio_dropped", milliseconds: Math.round((dropped * 1_000) / (this.sampleRate * 2)) });
    }
    this.flush();
  }

  async stop({ waitForFinal = false, timeoutMs = 10_000 } = {}) {
    if (this.closed) return;
    if (!this.finalization) {
      this.finalization = new Promise((resolve) => {
        this.resolveFinalization = resolve;
      });
    }
    if (this.socket?.readyState === this.WebSocketImpl.OPEN) {
      if (this.audioBuffer.length > 0) {
        this.socket.send(this.audioBuffer);
        this.audioBuffer = Buffer.alloc(0);
      }
      this.socket.send(JSON.stringify({ is_speaking: false, is_end: true }));
    }
    if (!waitForFinal) return;

    let timer;
    try {
      await Promise.race([
        this.finalization,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("本地 FunASR 流式服务未在限定时间内完成最终识别。")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close() {
    this.closed = true;
    this.audioBuffer = Buffer.alloc(0);
    this.resolveFinalization?.();
    if (this.socket && this.socket.readyState !== this.WebSocketImpl.CLOSED) this.socket.close();
  }

  flush() {
    if (!this.started || this.socket?.readyState !== this.WebSocketImpl.OPEN) return;
    while (this.audioBuffer.length >= this.strideBytes) {
      const chunk = this.audioBuffer.subarray(0, this.strideBytes);
      this.audioBuffer = this.audioBuffer.subarray(this.strideBytes);
      this.socket.send(chunk);
      this.onMetrics({ type: "asr_audio_sent", milliseconds: Math.round((chunk.length * 1_000) / (this.sampleRate * 2)) });
    }
  }

  handleMessage(data) {
    let event;
    try {
      event = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch {
      return;
    }
    if (event?.error) {
      this.onError(new Error(String(event.error)));
      return;
    }
    if (event?.is_end) this.resolveFinalization?.();
    const text = String(event?.text ?? "").trim();
    if (!text) return;
    const mode = String(event?.mode ?? "");
    const isFinal = Boolean(event?.is_final) || mode === "2pass-offline" || mode === "offline";
    this.onTranscript(text, { isFinal, mode, receivedAt: Date.now() });
  }
}
