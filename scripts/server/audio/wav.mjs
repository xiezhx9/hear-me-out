export function pcm16ToWav(pcm, { sampleRate = 16_000, channels = 1 } = {}) {
  if (!Buffer.isBuffer(pcm)) pcm = Buffer.from(pcm);
  if (pcm.length % 2 !== 0) throw new Error("PCM16 input must contain whole samples.");
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error("sampleRate must be a positive integer.");
  if (!Number.isInteger(channels) || channels <= 0) throw new Error("channels must be a positive integer.");

  const bytesPerSample = 2;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
