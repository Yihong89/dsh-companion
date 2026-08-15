#!/usr/bin/env python3
"""
dsh-sister TTS service — Qwen3-TTS VoiceDesign on Apple Silicon (MPS).

A tiny FastAPI service that turns text into a 萝莉萌妹 (loli/anime-girl) voice
using Qwen3-TTS-12Hz-1.7B-VoiceDesign's natural-language voice design. The
model is loaded ONCE at startup (several GB) and kept warm; each request is a
single `generate_voice_design` call returning WAV audio.

Endpoints:
  GET /health                 -> {"ok": true, "model": ...}
  GET /tts?text=...&instruct=...   -> audio/wav (stereo float -> int16 PCM)

Runs on loopback only (127.0.0.1:3091); the dsh-sister host plugin proxies
/plugins/dsh-sister/tts to it so the browser never talks to this port.

Author: Yihong <zhangyhzju@gmail.com>
"""
import io
import os
import time
import threading

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, Query
from fastapi.responses import Response, JSONResponse

from qwen_tts import Qwen3TTSModel

# ---------------------------------------------------------------------------
# Model loading (single global instance, warm at boot)
# ---------------------------------------------------------------------------

MODEL = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")

_device = None
_tts = None
_lock = threading.Lock()  # the model is not thread-safe for concurrent gen


def resolve_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model():
    global _tts, _device
    if _tts is not None:
        return
    _device = resolve_device()
    print(f"[dsh-sister-tts] device={_device} loading {MODEL} ...", flush=True)
    t0 = time.time()
    _tts = Qwen3TTSModel.from_pretrained(
        MODEL,
        device_map=_device,
        dtype=torch.bfloat16,
        attn_implementation="sdpa",
    )
    print(f"[dsh-sister-tts] model loaded in {time.time() - t0:.1f}s", flush=True)


app = FastAPI(title="dsh-sister-tts")


@app.on_event("startup")
def _startup():
    # Warm the model in a background thread so uvicorn finishes booting fast
    # and the first request still gets a fully loaded model.
    threading.Thread(target=load_model, daemon=True).start()


@app.get("/health")
def health():
    return JSONResponse({
        "ok": _tts is not None,
        "model": MODEL,
        "device": _device or resolve_device(),
        "loading": _tts is None,
    })


@app.get("/tts")
def tts(
    text: str = Query(..., min_length=1, max_length=2000),
    instruct: str = Query(
        default=(
            "体现撒娇稚嫩的萝莉女声，音调偏高且起伏明显，"
            "营造出黏人、做作又刻意卖萌的听觉效果。"
        ),
        max_length=2000,
    ),
):
    if _tts is None:
        return JSONResponse({"ok": False, "error": "model still loading"}, status_code=503)
    t0 = time.time()
    with _lock:
        try:
            wavs, sr = _tts.generate_voice_design(
                text=text,
                language="Chinese",
                instruct=instruct,
                max_new_tokens=2048,
            )
            if _device == "mps":
                torch.mps.synchronize()
        except Exception as exc:  # noqa: BLE001 - surface any model error
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)
    dt = time.time() - t0
    print(f"[dsh-sister-tts] '{text[:30]}...' in {dt:.1f}s", flush=True)

    wav = wavs[0]
    if isinstance(wav, torch.Tensor):
        wav = wav.detach().cpu().float().numpy()
    if wav.ndim > 1:
        wav = wav.mean(axis=0)
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return Response(
        content=buf.getvalue(),
        media_type="audio/wav",
        headers={"X-TTS-Ms": str(int(dt * 1000))},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=3091)
