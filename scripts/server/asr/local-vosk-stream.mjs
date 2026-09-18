import { WebSocket } from "ws";

export const LOCAL_VOSK_STREAM_PROVIDER = "local-vosk-ja-stream";
export const LOCAL_VOSK_STREAM_DEFAULT_ENDPOINT = "ws://127.0.0.1:10097";
export const LOCAL_VOSK_STREAM_DEFAULT_MODEL = "vosk-model-small-ja-0.22";

export class LocalVoskStreamSession {
  constructor(config = {}, callbacks = {}) {
    this.endpoint = config.endpoint || LOCAL_VOSK_STREAM_DEFAULT_ENDPOINT;
    this.sampleRate = config.sampleRate ?? 16_000;
    this.maxBufferedBytes = config.maxBufferedBytes ?? 256 * 1024;
    this.onTranscript = callbacks.onTranscript ?? (() => {});
    this.onError = callbacks.onError ?? (() => {});
    this.onMetrics = callbacks.onMetrics ?? (() => {});
    this.WebSocketImpl = config.WebSocketImpl ?? WebSocket;
    this.socket = null;
    this.started = false;
    this.closed = false;
    this.finalization = null;
    this.resolveFinalization = null;
  }

  async start() {
    if (this.closed) throw new Error("Local Vosk stream session is closed.");
    if (this.started) return;

    await new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(this.endpoint, { perMessageDeflate: false });
      this.socket = socket;
      const onOpen = () => {
        cleanup();
        this.started = true;
        this.onMetrics({ type: "asr_started", engine: "vosk", language: "ja", provider: LOCAL_VOSK_STREAM_PROVIDER });
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const cleanup = () => {
        socket.off("open", onOpen);
        socket.off("error", onError);
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
      socket.on("message", (message) => this.handleMessage(message));
      socket.on("error", (error) => {
        if (!this.closed) this.onError(error instanceof Error ? error : new Error(String(error)));
      });
      socket.on("close", () => this.resolveFinalization?.());
    });
  }

  pushPcm(chunk) {
    if (this.closed || !this.started || this.socket?.readyState !== this.WebSocketImpl.OPEN) return;
    const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (pcm.length === 0) return;
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.onMetrics({ type: "audio_dropped", bytes: pcm.length, reason: "vosk_socket_backpressure" });
      return;
    }
    this.socket.send(pcm, { binary: true });
  }

  async stop({ waitForFinal = false, timeoutMs = 2_000 } = {}) {
    if (this.closed) return;
    if (!waitForFinal || this.socket?.readyState !== this.WebSocketImpl.OPEN) {
      await this.close();
      return;
    }
    if (!this.finalization) {
      this.finalization = new Promise((resolve) => {
        this.resolveFinalization = resolve;
      });
    }
    this.socket.send(JSON.stringify({ type: "finish", sampleRate: this.sampleRate }));
    let timer = null;
    try {
      await Promise.race([
        this.finalization,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("本地 Vosk 流式服务未在限定时间内完成最终识别。")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      await this.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.resolveFinalization?.();
    if (this.socket && this.socket.readyState !== this.WebSocketImpl.CLOSED) this.socket.close();
    this.socket = null;
    this.started = false;
  }

  handleMessage(message) {
    try {
      const event = JSON.parse(Buffer.isBuffer(message) ? message.toString("utf8") : String(message));
      if (event?.error) throw new Error(String(event.error));
      const text = String(event?.text ?? "").trim();
      if (text) {
        this.onTranscript(text, {
          isFinal: Boolean(event?.isFinal),
          mode: event?.isFinal ? "final" : "partial",
          receivedAt: Date.now(),
        });
      }
      if (event?.isEnd) this.resolveFinalization?.();
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
