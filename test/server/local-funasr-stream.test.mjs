import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { LocalFunasrStreamSession } from "../../scripts/server/asr/local-funasr-stream.mjs";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(endpoint, protocol) {
    super();
    this.endpoint = endpoint;
    this.protocol = protocol;
    this.readyState = 0;
    this.sent = [];
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    });
  }

  send(message) {
    this.sent.push(message);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

test("uses FunASR 2pass configuration and sends 60ms PCM strides", async () => {
  const metrics = [];
  const session = new LocalFunasrStreamSession(
    { endpoint: "ws://localhost:10095", WebSocketImpl: FakeWebSocket },
    { onMetrics: (metric) => metrics.push(metric) },
  );

  await session.start();
  session.pushPcm(Buffer.alloc(1_920));

  assert.equal(session.socket.endpoint, "ws://localhost:10095");
  assert.equal(session.socket.protocol, "binary");
  assert.deepEqual(JSON.parse(session.socket.sent[0]), {
    mode: "2pass",
    chunk_size: [5, 10, 5],
    chunk_interval: 10,
    encoder_chunk_look_back: 4,
    decoder_chunk_look_back: 1,
    audio_fs: 16_000,
    wav_name: session.wavName,
    is_speaking: true,
    itn: true,
  });
  assert.equal(session.socket.sent[1].length, 1_920);
  assert.deepEqual(metrics, [{ type: "asr_audio_sent", milliseconds: 60 }]);
});

test("waits for FunASR's end acknowledgement before closing a stream", async () => {
  const session = new LocalFunasrStreamSession(
    { endpoint: "ws://localhost:10095", WebSocketImpl: FakeWebSocket },
  );
  await session.start();

  const stopPromise = session.stop({ waitForFinal: true, timeoutMs: 100 });
  assert.deepEqual(JSON.parse(session.socket.sent.at(-1)), { is_speaking: false, is_end: true });
  session.socket.emit("message", Buffer.from(JSON.stringify({ is_end: true })));
  await stopPromise;
});
