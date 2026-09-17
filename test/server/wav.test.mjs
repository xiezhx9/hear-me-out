import assert from "node:assert/strict";
import test from "node:test";
import { pcm16ToWav } from "../../scripts/server/audio/wav.mjs";

test("encodes PCM16 into a mono WAV container", () => {
  const pcm = Buffer.alloc(320);
  const wav = pcm16ToWav(pcm, { sampleRate: 16_000, channels: 1 });

  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, pcm.length + 44);
});
