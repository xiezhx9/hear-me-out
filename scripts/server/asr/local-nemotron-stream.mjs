import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

export const LOCAL_NEMOTRON_STREAM_PROVIDER = "local-nemotron-ja-stream";
export const LOCAL_NEMOTRON_STREAM_DEFAULT_ENDPOINT = "local://sherpa-onnx";
export const LOCAL_NEMOTRON_STREAM_DEFAULT_MODEL = "nemotron-ja-560ms-int8";

const SAMPLE_RATE = 16_000;
const REQUIRED_MODEL_FILES = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];

let recognizerCache = null;
let recognizerCacheKey = "";

export class LocalNemotronStreamSession {
  constructor(config = {}, callbacks = {}) {
    this.modelDir = resolveModelDir(config.modelDir || config.model);
    this.provider = String(config.provider || process.env.SHERPA_ONNX_PROVIDER || "cpu").trim().toLowerCase();
    this.numThreads = positiveInteger(config.numThreads ?? process.env.SHERPA_ONNX_NUM_THREADS, 2);
    this.language = config.language || process.env.ASR_LANGUAGE || "ja";
    this.sampleRate = config.sampleRate ?? SAMPLE_RATE;
    this.onTranscript = callbacks.onTranscript ?? (() => {});
    this.onError = callbacks.onError ?? (() => {});
    this.onMetrics = callbacks.onMetrics ?? (() => {});
    this.closed = false;
    this.started = false;
    this.stream = null;
    this.lastText = "";
    this.audioMs = 0;
  }

  async start() {
    if (this.closed) throw new Error("Local Nemotron stream session is closed.");
    if (this.started) return;
    const recognizer = getRecognizer(this.modelDir, this.provider, this.numThreads);
    this.stream = recognizer.createStream();
    this.stream.setOption("language", this.language);
    this.started = true;
    this.onMetrics({ type: "asr_started", engine: "sherpa-onnx-nemotron", language: this.language, provider: this.provider });
  }

  pushPcm(chunk) {
    if (this.closed || !this.started || !this.stream) return;
    const pcm = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const evenLength = pcm.length - (pcm.length % 2);
    if (evenLength === 0) return;
    const samples = new Float32Array(evenLength / 2);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = pcm.readInt16LE(index * 2) / 32768;
    }
    this.audioMs += (samples.length * 1000) / this.sampleRate;
    try {
      const recognizer = getRecognizer(this.modelDir, this.provider, this.numThreads);
      this.stream.acceptWaveform({ samples, sampleRate: this.sampleRate });
      this.decodeReady(recognizer);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async stop({ waitForFinal = false } = {}) {
    if (this.closed || !this.started || !this.stream) return;
    try {
      const recognizer = getRecognizer(this.modelDir, this.provider, this.numThreads);
      if (waitForFinal) {
        this.stream.acceptWaveform({
          samples: new Float32Array(Math.floor(this.sampleRate * 0.4)),
          sampleRate: this.sampleRate,
        });
        this.stream.inputFinished();
        this.decodeReady(recognizer, true);
      }
      if (this.stream) recognizer.reset(this.stream);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.stream) getRecognizer(this.modelDir, this.provider, this.numThreads).reset(this.stream);
    } catch {
      // The native stream is process-scoped and will be released with the backend.
    }
    this.stream = null;
    this.started = false;
  }

  decodeReady(recognizer, forceFinal = false) {
    if (!this.stream) return;
    const startedAt = Date.now();
    while (recognizer.isReady(this.stream)) recognizer.decode(this.stream);
    const result = recognizer.getResult(this.stream);
    const text = String(result?.text ?? "").trim();
    const endpoint = forceFinal || recognizer.isEndpoint(this.stream);
    if (text && (text !== this.lastText || endpoint)) {
      this.lastText = text;
      this.onTranscript(text, {
        isFinal: endpoint,
        mode: endpoint ? "endpoint" : "partial",
        receivedAt: Date.now(),
      });
    }
    this.onMetrics({
      type: "asr_decode",
      elapsedMs: Date.now() - startedAt,
      audioMilliseconds: Math.round(this.audioMs),
      textLength: text.length,
      isFinal: endpoint,
    });
    if (endpoint) {
      recognizer.reset(this.stream);
      this.lastText = "";
      this.audioMs = 0;
    }
  }
}

function getRecognizer(modelDir, provider, numThreads) {
  const cacheKey = `${modelDir}|${provider}|${numThreads}`;
  if (recognizerCache && recognizerCacheKey === cacheKey) return recognizerCache;
  validateModelDir(modelDir);
  const sherpa = require("sherpa-onnx-node");
  recognizerCache = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
    modelConfig: {
      transducer: {
        encoder: path.join(modelDir, "encoder.int8.onnx"),
        decoder: path.join(modelDir, "decoder.int8.onnx"),
        joiner: path.join(modelDir, "joiner.int8.onnx"),
      },
      tokens: path.join(modelDir, "tokens.txt"),
      numThreads,
      provider,
      debug: false,
    },
    decodingMethod: "greedy_search",
    enableEndpoint: true,
    rule1MinTrailingSilence: 0.7,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  });
  recognizerCacheKey = cacheKey;
  return recognizerCache;
}

function resolveModelDir(value) {
  const configured = String(value || process.env.ASR_MODEL_DIR || "").trim();
  return configured ? path.resolve(configured) : "";
}

function validateModelDir(modelDir) {
  if (!modelDir) {
    throw new Error("未配置 Nemotron 模型目录，请设置 ASR_MODEL_DIR。");
  }
  const missing = REQUIRED_MODEL_FILES.filter((file) => !existsSync(path.join(modelDir, file)));
  if (missing.length > 0) {
    throw new Error(`Nemotron 模型目录不完整：${modelDir}，缺少 ${missing.join(", ")}`);
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
