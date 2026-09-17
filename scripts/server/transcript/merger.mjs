function normalize(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function findSharedBoundary(previous, current) {
  const maxLength = Math.min(previous.length, current.length);
  for (let length = maxLength; length >= 2; length -= 1) {
    if (previous.slice(-length) === current.slice(0, length)) return length;
  }
  return 0;
}

export class TranscriptMerger {
  constructor() {
    this.previous = "";
  }

  push(text) {
    const current = normalize(text);
    if (!current) return "";
    if (current === this.previous) return "";

    const boundary = findSharedBoundary(this.previous, current);
    this.previous = current;
    return current.slice(boundary).trim();
  }

  reset() {
    this.previous = "";
  }
}
