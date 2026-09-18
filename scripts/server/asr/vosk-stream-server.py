#!/usr/bin/env python3
"""Low-latency local WebSocket ASR server backed by a Vosk model.

The protocol intentionally stays small: clients send 16 kHz mono PCM16 binary
messages. The server returns JSON partial/final transcript events. A client may
send {"type":"finish"} to flush the recognizer and close the session.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from vosk import KaldiRecognizer, Model, SetLogLevel
from websockets.asyncio.server import ServerConnection, serve


SAMPLE_RATE = 16_000


def transcript_event(result: dict[str, Any], *, final: bool, end: bool = False) -> str:
    return json.dumps(
        {
            "text": str(result.get("text", "")).strip(),
            "isFinal": final,
            "isEnd": end,
        },
        ensure_ascii=False,
    )


async def handle_connection(websocket: ServerConnection, model: Model) -> None:
    recognizer = KaldiRecognizer(model, SAMPLE_RATE)
    recognizer.SetWords(False)
    last_partial = ""

    async for message in websocket:
        if isinstance(message, bytes):
            if not message:
                continue
            if recognizer.AcceptWaveform(message):
                result = json.loads(recognizer.Result())
                last_partial = ""
                await websocket.send(transcript_event(result, final=True))
                continue

            result = json.loads(recognizer.PartialResult())
            partial = str(result.get("partial", "")).strip()
            if partial and partial != last_partial:
                last_partial = partial
                await websocket.send(json.dumps({"text": partial, "isFinal": False, "isEnd": False}, ensure_ascii=False))
            continue

        try:
            command = json.loads(message)
        except json.JSONDecodeError:
            await websocket.send(json.dumps({"error": "Expected PCM16 bytes or a JSON control message."}))
            continue

        if command.get("type") != "finish":
            continue

        result = json.loads(recognizer.FinalResult())
        await websocket.send(transcript_event(result, final=True, end=True))
        return


async def run_server(host: str, port: int, model_dir: Path) -> None:
    if not model_dir.is_dir():
        raise FileNotFoundError(f"Vosk model directory does not exist: {model_dir}")

    SetLogLevel(-1)
    model = Model(str(model_dir))
    logging.info("Loaded Vosk model: %s", model_dir)
    async with serve(lambda ws: handle_connection(ws, model), host, port, max_size=None, compression=None):
        logging.info("Vosk streaming ASR listening at ws://%s:%s", host, port)
        await asyncio.Future()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local Vosk streaming ASR WebSocket service.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=10097)
    parser.add_argument("--model-dir", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    asyncio.run(run_server(args.host, args.port, Path(args.model_dir).resolve()))
