import assert from "node:assert/strict";
import test from "node:test";
import { PcmWindowBuffer } from "../../scripts/server/audio/pcm-window-buffer.mjs";

test("emits fixed PCM windows while retaining the configured overlap", () => {
  const buffer = new PcmWindowBuffer({ sampleRate: 1_000, windowMs: 1_200, overlapMs: 200, maxPendingMs: 4_000 });
  buffer.push(Buffer.alloc(2_400));
  const first = buffer.takeReadyWindow();

  assert.equal(first.length, 2_400);
  assert.equal(buffer.byteLength, 400);

  buffer.push(Buffer.alloc(2_000));
  const second = buffer.takeReadyWindow();
  assert.equal(second.length, 2_400);
  assert.equal(buffer.byteLength, 400);
});

test("bounds pending audio and reports discarded PCM", () => {
  const buffer = new PcmWindowBuffer({ sampleRate: 1_000, windowMs: 1_000, overlapMs: 0, maxPendingMs: 1_500 });
  const dropped = buffer.push(Buffer.alloc(4_000));

  assert.equal(dropped, 1_000);
  assert.equal(buffer.byteLength, 3_000);
});
