import assert from "node:assert/strict";
import test from "node:test";
import { LocalSenseVoiceSession } from "../../scripts/server/asr/local-sensevoice.mjs";

test("serializes a local SenseVoice HTTP window and emits its transcript", async () => {
  const originalFetch = globalThis.fetch;
  const transcripts = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ text: "hello world" }) };
  };

  try {
    const session = new LocalSenseVoiceSession(
      { endpoint: "http://127.0.0.1:8000/v1/audio/transcriptions", sampleRate: 1_000, windowMs: 100, overlapMs: 0 },
      { onTranscript: (text) => transcripts.push(text) },
    );
    await session.start();
    session.pushPcm(Buffer.alloc(200));
    await session.pump(false);

    assert.equal(calls, 1);
    assert.deepEqual(transcripts, ["hello world"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
