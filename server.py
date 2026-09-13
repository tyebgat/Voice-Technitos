import os
import re
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
from TTSHandler import SERVICES, TTSHandler

settings = Settings()

GUI_DIR = os.path.join(BASE_PATH, "gui")
DATA_DIR = os.path.join(BASE_PATH, "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")
VOICES_DIR = os.path.join(DATA_DIR, "voice-library")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)

# The TTS service is created lazily (on the first /api/initialize call) so that
# the bootstrap/loading screen shown by the GUI can drive the initialization
# instead of the model downloading silently at server startup.
_tts = None
_tts_lock = threading.Lock()


def _resolve_service(service: str) -> str:
    if service not in SERVICES:
        logger.warning(f"Unknown tts_service '{service}'; falling back to 'omnivoice'.")
        return "omnivoice"
    return service


def _create_tts(service: str) -> TTSHandler:
    return TTSHandler(
        service=service,
        config=settings.section(SERVICES[service]["config_section"]),
        general=settings.section("general"),
        voices_dir=VOICES_DIR,
        output_dir=OUTPUT_DIR,
    )


def get_tts() -> Optional[TTSHandler]:
    return _tts


def initialize_service(service: Optional[str] = None) -> TTSHandler:
    global _tts
    with _tts_lock:
        svc = _resolve_service(service or settings.tts_service)
        cur = _tts
        if cur is None or cur.service != svc or cur.model_state in ("error", "unloaded"):
            cur = _create_tts(svc)
            _tts = cur
        if cur.model_state not in ("loading", "ready"):
            threading.Thread(target=cur.load_model, daemon=True, name="tts-load").start()
        return cur


def _require_tts() -> TTSHandler:
    t = get_tts()
    if t is None:
        raise HTTPException(503, "TTS service has not been initialized yet.")
    return t


def _cuda_available() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except Exception:
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Backend starting; waiting for the GUI to request initialization...")
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
    params: Optional[dict] = None  # generation params for the active service


class InitializeRequest(BaseModel):
    service: Optional[str] = None


class SettingsUpdate(BaseModel):
    tts_service: Optional[str] = None
    skip_setup: Optional[bool] = None
    default_voice: Optional[str] = None
    gain: Optional[float] = None
    sample_rate: Optional[int] = None
    audio_format: Optional[str] = None
    speed: Optional[float] = None


def _services_info() -> dict:
    return {
        name: {"display": spec["display"], "param_keys": list(spec["param_keys"])}
        for name, spec in SERVICES.items()
    }


def _ensure_model_ready():
    tts = _require_tts()
    if tts.model_state == "loading":
        raise HTTPException(503, detail="Model is still loading, please wait.")
    if tts.model_state == "error":
        raise HTTPException(500, detail=f"Model failed to load: {tts.model_error}")
    if tts.model is None:
        raise HTTPException(503, detail="Model is not loaded.")


# Web UI
@app.get("/")
def index():
    path = os.path.join(GUI_DIR, "index.html")
    if not os.path.exists(path):
        raise HTTPException(404, detail="GUI not built yet. Add gui/index.html.")
    return FileResponse(path)


# API: status
@app.get("/api/status")
def get_status():
    t = get_tts()
    if t is None:
        svc = _resolve_service(settings.tts_service)
        return {
            "service": svc,
            "service_display": SERVICES[svc]["display"],
            "model_state": "unloaded",
            "model_error": None,
            "download_state": "none",
            "download_progress": 0.0,
            "device": "cuda",
            "model_id": "",
            "source_sample_rate": 24000,
            "default_voice": settings.section("general").get("default_voice", ""),
            "gain": settings.get("gain", 1.0),
            "sample_rate": settings.get("sample_rate", 24000),
            "audio_format": settings.get("audio_format", "wav"),
            "tts_settings": {},
            "param_keys": list(SERVICES[svc]["param_keys"]),
            "available_services": _services_info(),
            "voices_dir": VOICES_DIR,
            "cuda_available": _cuda_available(),
        }
    return t.status()


# API: initialize the TTS service (drives the bootstrap loading screen)
@app.post("/api/initialize")
def api_initialize(request: InitializeRequest):
    if request.service is not None and request.service not in SERVICES:
        raise HTTPException(400, detail=f"Unknown service '{request.service}'.")
    t = initialize_service(request.service)
    return t.status()


# API: settings
@app.get("/api/settings")
def api_get_settings():
    return {
        "settings": {
            "tts_service": settings.tts_service,
            "skip_setup": bool(settings.get("skip_setup", False)),
            "default_voice": settings.section("general").get("default_voice", "") or "",
            "gain": settings.get("gain", 1.0),
            "sample_rate": settings.get("sample_rate", 24000),
            "audio_format": settings.get("audio_format", "wav"),
        }
    }


@app.post("/api/settings")
def api_save_settings(update: SettingsUpdate):
    if update.tts_service is not None:
        if update.tts_service not in SERVICES:
            raise HTTPException(400, detail=f"Unknown service '{update.tts_service}'.")
        settings.set("general", "tts_service", update.tts_service)
    if update.skip_setup is not None:
        settings.set("general", "skip_setup", bool(update.skip_setup))
    if update.default_voice is not None:
        settings.set("general", "default_voice", update.default_voice)
        t = get_tts()
        if t is not None:
            t.default_voice = update.default_voice
    if update.gain is not None:
        settings.set("general", "gain", update.gain)
    if update.sample_rate is not None:
        settings.set("general", "sample_rate", update.sample_rate)
    if update.audio_format is not None:
        settings.set("general", "audio_format", update.audio_format)
    if update.speed is not None:
        section = SERVICES[settings.tts_service]["config_section"]
        if "speed" in settings.section(section):
            settings.set(section, "speed", update.speed)
    settings.save()
    return {"ok": True}


@app.post("/api/shutdown")
def api_shutdown():
    logger.info("Shutdown requested from the GUI; closing application.")
    threading.Timer(0.15, lambda: os._exit(0), daemon=True).start()
    return {"ok": True}


# API: voice library
@app.get("/api/voices")
def list_voices():
    tts = _require_tts()
    voices = tts.list_voices()
    for v in voices:
        v["reference_url"] = f"/data/voice-library/{v['name']}/reference.wav" if v.get("reference_wav") else None
        icon = v.get("icon")
        v["icon_url"] = f"/data/voice-library/{v['name']}/{os.path.basename(icon)}" if icon else None
    return {"voices": voices}


@app.post("/api/voices")
async def add_voice(
    name: str = Form(...),
    transcription: str = Form(""),
    description: str = Form(""),
    reference: UploadFile = File(...),
    icon: UploadFile | None = File(None),
):
    tts = _require_tts()
    wav_data = await reference.read()
    if not wav_data:
        raise HTTPException(400, detail="Reference audio is empty.")
    icon_data = None
    icon_mime = ""
    if icon is not None:
        icon_data = await icon.read()
        if not icon_data:
            raise HTTPException(400, detail="Icon file is empty.")
        icon_mime = icon.content_type or ""

    try:
        voice_name = tts.save_voice(
            name=name,
            transcription=transcription,
            description=description,
            wav_bytes=wav_data,
            icon_bytes=icon_data,
            icon_mime=icon_mime,
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return {"voice": voice_name, "icon": icon_mime}


@app.patch("/api/voices/{voice_name}")
async def edit_voice(
    voice_name: str,
    name: str = Form(None),
    transcription: str = Form(None),
    description: str = Form(None),
    reference: UploadFile | None = File(None),
    icon: UploadFile | None = File(None),
):
    tts = _require_tts()
    wav_data = None
    if reference is not None and reference.filename:
        wav_data = await reference.read()
        if not wav_data:
            raise HTTPException(400, detail="Reference audio is empty.")
    icon_data = None
    icon_mime = ""
    if icon is not None and icon.filename:
        icon_data = await icon.read()
        if not icon_data:
            raise HTTPException(400, detail="Icon file is empty.")
        icon_mime = icon.content_type or ""
    try:
        final = tts.update_voice(
            name=voice_name,
            transcription=transcription,
            description=description,
            wav_bytes=wav_data,
            icon_bytes=icon_data,
            icon_mime=icon_mime,
            new_name=name,
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    if final != voice_name:
        if settings.section("general").get("default_voice", "") == voice_name:
            settings.set("general", "default_voice", final)
            tts.default_voice = final
            settings.save()
    return {"voice": final}


@app.delete("/api/voices/{voice_name}")
def delete_voice(voice_name: str):
    tts = _require_tts()
    if not tts.delete_voice(voice_name):
        raise HTTPException(404, detail=f"Voice '{voice_name}' not found.")
    if settings.section("general").get("default_voice", "") == voice_name:
        settings.set("general", "default_voice", "")
        tts.default_voice = ""
        settings.save()
    return {"deleted": voice_name}


# API: TTS generation
@app.post("/api/tts")
def generate_tts(request: TTSRequest):
    _ensure_model_ready()
    tts = get_tts()

    if not request.text.strip():
        raise HTTPException(400, detail="Text cannot be empty.")

    audio_format = (request.audio_format or tts.audio_format).lower().lstrip(".")
    sample_rate = request.sample_rate or tts.sample_rate
    voice_part = re.sub(r"[^a-zA-Z0-9 _-]", "", request.voice or "auto") or "auto"
    stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"output {voice_part} {stamp} {sample_rate}.{audio_format}"
    out_path = os.path.join(OUTPUT_DIR, filename)

    payload = {}
    if request.gain is not None:
        payload["gain"] = request.gain
    if request.sample_rate is not None:
        payload["sample_rate"] = request.sample_rate
    if request.audio_format is not None:
        payload["audio_format"] = request.audio_format

    # Unknown/extra params are ignored by the handler (validated there).
    if request.params:
        for key, value in request.params.items():
            payload[key] = value

    try:
        tts.generate(
            text=request.text,
            voice=request.voice,
            out_path=out_path,
            **payload,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(500, detail=str(e))

    return {
        "audio_url": f"/data/output/{filename}",
        "voice": request.voice or "auto",
        "service": tts.service,
        "sample_rate": request.sample_rate or tts.sample_rate,
        "audio_format": audio_format,
    }


# Static mounts
app.mount("/gui", StaticFiles(directory=GUI_DIR), name="gui")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")