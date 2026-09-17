import assert from "node:assert/strict";
import test from "node:test";
import { TranscriptMerger } from "../../scripts/server/transcript/merger.mjs";

test("removes duplicate text at an overlapping Japanese segment boundary", () => {
  const merger = new TranscriptMerger();
  assert.equal(merger.push("こんにちは、今日は"), "こんにちは、今日は");
  assert.equal(merger.push("今日はいい天気です。"), "いい天気です。");
});

test("drops an unchanged retranscription", () => {
  const merger = new TranscriptMerger();
  merger.push("hello world");
  assert.equal(merger.push("hello world"), "");
});
