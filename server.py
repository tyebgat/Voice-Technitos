import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel

from paths import BASE_PATH
from settings import Settings
from TTSHandler import GEN_PARAM_KEYS, TTSHandler

settings = Settings()

GUI_DIR = os.path.join(BASE_PATH, "gui")
DATA_DIR = os.path.join(BASE_PATH, "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")
VOICES_DIR = os.path.join(DATA_DIR, "voices-library")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)

tts = TTSHandler(
    device="cuda",
    model_id=settings.get("model_id", "k2-fsa/OmniVoice"),
    default_voice=settings.get("default_voice", ""),
    gain=settings.get("gain", 1.0),
    sample_rate=settings.get("sample_rate", 24000),
    audio_format=settings.get("audio_format", "wav"),
    gen_defaults={key: settings.get(key) for key in GEN_PARAM_KEYS},
    voices_dir=VOICES_DIR,
    output_dir=OUTPUT_DIR,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Backend starting; loading OmniVoice in the background (auto-download)...")
    threading.Thread(target=tts.load_model, daemon=True).start()
    yield
    logger.info("Backend shutting down.")


app = FastAPI(title="Voice Technitos", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    gain: Optional[float] = None
    sample_rate: Optional[int] = None
    audio_format: Optional[str] = None
    num_step: Optional[int] = None
    denoise: Optional[bool] = None
    guidance_scale: Optional[float] = None
    t_shift: Optional[float] = None
    position_temperature: Optional[float] = None
    class_temperature: Optional[float] = None
    layer_penalty_factor: Optional[float] = None
    duration: Optional[float] = None
    speed: Optional[float] = None
    preprocess_prompt: Optional[bool] = None
    postprocess_output: Optional[bool] = None
    pad_duration: Optional[float] = None
    fade_duration: Optional[float] = None
    audio_chunk_duration: Optional[float] = None
    audio_chunk_threshold: Optional[float] = None


def _ensure_model_ready():
    if tts.model_state == "loading":
        raise HTTPException(503, detail="Model is still loading, please wait.")
    if tts.model_state == "error":
        raise HTTPException(500, detail=f"Model failed to load: {tts.model_error}")
    if tts.model is None:
        raise HTTPException(503, detail="Model is not loaded.")


# Web UI
@app.get("/")
def index():
    return FileResponse(os.path.join(GUI_DIR, "index.html"))


# API: status
@app.get("/api/status")
def get_status():
    return tts.status()


# API: voice library
@app.get("/api/voices")
def list_voices():
    return {"voices": tts.list_voices()}


@app.post("/api/voices")
async def add_voice(
    name: str = Form(...),
    transcription: str = Form(""),
    reference: UploadFile = File(...),
):
    data = await reference.read()
    if not data:
        raise HTTPException(400, detail="Reference audio is empty.")
    voice_name = tts.save_voice(name=name, transcription=transcription, wav_bytes=data)
    return {"voice": voice_name}


# API: TTS generation
@app.post("/api/tts")
def generate_tts(request: TTSRequest):
    _ensure_model_ready()

    if not request.text.strip():
        raise HTTPException(400, detail="Text cannot be empty.")

    audio_format = (request.audio_format or tts.audio_format).lower().lstrip(".")
    filename = f"output_{int(time.time() * 1000)}.{audio_format}"
    out_path = os.path.join(OUTPUT_DIR, filename)

    payload = request.model_dump(exclude={"text", "voice"})

    try:
        tts.generate(
            text=request.text,
            voice=request.voice,
            out_path=out_path,
            **payload,
        )
    except RuntimeError as e:
        raise HTTPException(500, detail=str(e))

    return {
        "audio_url": f"/data/output/{filename}",
        "voice": request.voice or "auto",
        "sample_rate": request.sample_rate or tts.sample_rate,
        "audio_format": audio_format,
    }


# Static mounts
app.mount("/gui", StaticFiles(directory=GUI_DIR), name="gui")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")