import asyncio
import json
import os
import re
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel

from paths import BASE_PATH, RESOURCE_PATH
from settings import Settings
from TTSHandler import SERVICES, TTSHandler

settings = Settings()

GUI_DIR = os.path.join(RESOURCE_PATH, "gui")
DATA_DIR = os.path.join(BASE_PATH, "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "output")
VOICES_DIR = os.path.join(DATA_DIR, "voice-library")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)

# In-memory log ring buffer exposed to the GUI terminal window so the server
# output is visible even when file logging is disabled.
TERMINAL_MAX_LINES = 4000
_terminal_lines: deque = deque(maxlen=TERMINAL_MAX_LINES)


def _terminal_sink(message):
    _terminal_lines.append(message)


logger.add(
    _terminal_sink,
    format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message}",
    level=settings.get("log_level", "INFO"),
    enqueue=False,
)

# The TTS service is created lazily (on the first /api/initialize call) so that
# the bootstrap/loading screen shown by the GUI can drive the initialization
# instead of the model downloading silently at server startup.
_tts = None
_tts_lock = threading.Lock()


def _resolve_service(service: str) -> str:
    try:
        if service not in SERVICES:
            logger.warning(f"Unknown tts_service '{service}'; falling back to 'omnivoice'.")
            return "omnivoice"
        return service
    except Exception as e:
        logger.exception(f"Failed to resolve tts_service '{service}': {e}")
        raise


def _create_tts(service: str) -> TTSHandler:
    try:
        logger.info(f"Creating TTSHandler for service '{service}'...")
        tts = TTSHandler(
            service=service,
            config=settings.section(SERVICES[service]["config_section"]),
            general=settings.section("general"),
            voices_dir=VOICES_DIR,
            output_dir=OUTPUT_DIR,
        )
        logger.info(f"TTSHandler created for service '{service}'.")
        return tts
    except Exception as e:
        logger.exception(f"Failed to create TTSHandler for service '{service}': {e}")
        raise


def get_tts() -> Optional[TTSHandler]:
    return _tts


def initialize_service(service: Optional[str] = None) -> TTSHandler:
    global _tts
    try:
        with _tts_lock:
            svc = _resolve_service(service or settings.tts_service)
            cur = _tts
            if cur is None or cur.service != svc or cur.model_state in ("error", "unloaded"):
                cur = _create_tts(svc)
                _tts = cur
            if cur.model_state not in ("loading", "ready"):
                threading.Thread(target=cur.load_model, daemon=True, name="tts-load").start()
                logger.info(f"Started background model load for service '{svc}'.")
            return cur
    except Exception as e:
        logger.exception(f"Failed to initialize service '{service}': {e}")
        raise


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
    config: Optional[dict] = None  # {"section": {key: value, ...}} arbitrary settings


class SettingsReset(BaseModel):
    section: Optional[str] = None  # reset one section, or all when omitted


class LogEvent(BaseModel):
    area: Optional[str] = "app"
    event: Optional[str] = "event"
    detail: Optional[str] = ""


def _services_info() -> dict:
    return {
        name: {"display": spec["display"], "param_keys": list(spec["param_keys"])}
        for name, spec in SERVICES.items()
    }


def _sync_tts_gen_defaults(section: str = None):
    """Push the latest settings into the running handler without a reload.

    The TTSHandler caches its generation defaults when the service is created;
    any settings saved afterwards are pushed into it here so the next
    generate() call uses the saved values. Only the active service is updated.
    """
    try:
        t = get_tts()
        if t is None:
            return
        active = SERVICES[t.service]["config_section"]
        if section is None or section == active:
            t.refresh_generation_defaults(settings.section(active))
        else:
            # Setting changes for the inactive service can be ignored; the
            # handler reads them when that service is created/re-initialized.
            pass
    except Exception as e:
        logger.exception(f"Failed to sync TTS generation defaults: {e}")


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
    try:
        path = os.path.join(GUI_DIR, "index.html")
        if not os.path.exists(path):
            raise HTTPException(404, detail="GUI not built yet. Add gui/index.html.")
        return FileResponse(path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"GET / failed: {e}")
        raise HTTPException(500, detail=str(e))


# Web UI: standalone terminal page showing the live server log
@app.get("/terminal")
def terminal_page():
    try:
        path = os.path.join(GUI_DIR, "terminal.html")
        if not os.path.exists(path):
            raise HTTPException(404, detail="Terminal page not found.")
        return FileResponse(path)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"GET /terminal failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.get("/api/terminal/stream")
async def terminal_stream(request: Request):
    """Stream the server log to the terminal page over Server-Sent Events."""

    async def event_gen():
        index = 0
        try:
            while True:
                if await request.is_disconnected():
                    break
                lines = _terminal_lines
                while index < len(lines):
                    payload = json.dumps({"line": lines[index]}, ensure_ascii=False)
                    yield f"data: {payload}\n\n"
                    index += 1
                await asyncio.sleep(0.4)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# API: status
@app.get("/api/status")
def get_status():
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"GET /api/status failed: {e}")
        raise HTTPException(500, detail=str(e))


# API: initialize the TTS service (drives the bootstrap loading screen)
@app.post("/api/initialize")
def api_initialize(request: InitializeRequest):
    try:
        if request.service is not None and request.service not in SERVICES:
            raise HTTPException(400, detail=f"Unknown service '{request.service}'.")
        t = initialize_service(request.service)
        logger.info(f"Service initialized (service={t.service}).")
        return t.status()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/initialize failed: {e}")
        raise HTTPException(500, detail=str(e))


# API: settings
@app.get("/api/settings")
def api_get_settings():
    try:
        return {
            "settings": {
                "tts_service": settings.tts_service,
                "skip_setup": bool(settings.get("skip_setup", False)),
                "default_voice": settings.section("general").get("default_voice", "") or "",
                "gain": settings.get("gain", 1.0),
                "sample_rate": settings.get("sample_rate", 24000),
                "audio_format": settings.get("audio_format", "wav"),
            },
            "sections": settings.raw_sections(),
            "defaults": settings.raw_defaults(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"GET /api/settings failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.post("/api/settings")
def api_save_settings(update: SettingsUpdate):
    try:
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
        if update.config is not None:
            sections = settings.raw_sections()
            for section, kv in update.config.items():
                if section not in sections:
                    raise HTTPException(400, detail=f"Unknown settings section '{section}'.")
                if not isinstance(kv, dict):
                    raise HTTPException(400, detail=f"Settings update for '{section}' must be an object.")
                for key, value in kv.items():
                    if key.startswith("_") or key not in sections[section]:
                        continue
                    settings.set(section, key, value)
        settings.save()
        _sync_tts_gen_defaults()
        logger.info("Settings saved via POST /api/settings.")
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/settings failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.post("/api/settings/reset")
def api_reset_settings(request: SettingsReset):
    try:
        if request.section is not None:
            if request.section not in settings.raw_sections():
                raise HTTPException(400, detail=f"Unknown settings section '{request.section}'.")
            settings.reset_section(request.section)
        else:
            settings.reset()
        _sync_tts_gen_defaults(request.section)
        logger.info("Settings restored to defaults via POST /api/settings/reset.")
        return {
            "ok": True,
            "sections": settings.raw_sections(),
            "defaults": settings.raw_defaults(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/settings/reset failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.post("/api/shutdown")
def api_shutdown():
    try:
        logger.info("Shutdown requested from the GUI; closing application.")
        threading.Timer(0.15, lambda: os._exit(0), daemon=True).start()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/shutdown failed: {e}")
        raise HTTPException(500, detail=str(e))


# API: frontend event logging (used by the GUI to report UI events)
@app.post("/api/log")
def api_log(request: LogEvent):
    try:
        area = (request.area or "app").strip() or "app"
        event = (request.event or "event").strip() or "event"
        detail = (request.detail or "").strip()
        message = f"[gui:{area}] {event}" + (f" | {detail}" if detail else "")
        logger.info(message)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/log failed: {e}")
        raise HTTPException(500, detail=str(e))


# API: voice library
@app.get("/api/voices")
def list_voices():
    try:
        tts = _require_tts()
        voices = tts.list_voices()
        for v in voices:
            v["reference_url"] = f"/data/voice-library/{v['name']}/reference.wav" if v.get("reference_wav") else None
            icon = v.get("icon")
            v["icon_url"] = f"/data/voice-library/{v['name']}/{os.path.basename(icon)}" if icon else None
        logger.info(f"Listed {len(voices)} voice(s).")
        return {"voices": voices}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"GET /api/voices failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.post("/api/voices")
async def add_voice(
    name: str = Form(...),
    transcription: str = Form(""),
    description: str = Form(""),
    reference: UploadFile = File(...),
    icon: UploadFile | None = File(None),
):
    try:
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
            logger.warning(f"POST /api/voices rejected: {e}")
            raise HTTPException(400, detail=str(e))
        logger.success(f"Voice '{voice_name}' added via POST /api/voices.")
        return {"voice": voice_name, "icon": icon_mime}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/voices failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.patch("/api/voices/{voice_name}")
async def edit_voice(
    voice_name: str,
    name: str = Form(None),
    transcription: str = Form(None),
    description: str = Form(None),
    reference: UploadFile | None = File(None),
    icon: UploadFile | None = File(None),
):
    try:
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
            logger.warning(f"PATCH /api/voices/{voice_name} rejected: {e}")
            raise HTTPException(400, detail=str(e))
        if final != voice_name:
            if settings.section("general").get("default_voice", "") == voice_name:
                settings.set("general", "default_voice", final)
                tts.default_voice = final
                settings.save()
        logger.success(f"Voice '{voice_name}' updated via PATCH /api/voices -> '{final}'.")
        return {"voice": final}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"PATCH /api/voices/{voice_name} failed: {e}")
        raise HTTPException(500, detail=str(e))


@app.delete("/api/voices/{voice_name}")
def delete_voice(voice_name: str):
    try:
        tts = _require_tts()
        if not tts.delete_voice(voice_name):
            raise HTTPException(404, detail=f"Voice '{voice_name}' not found.")
        if settings.section("general").get("default_voice", "") == voice_name:
            settings.set("general", "default_voice", "")
            tts.default_voice = ""
            settings.save()
        logger.success(f"Voice '{voice_name}' deleted via DELETE /api/voices.")
        return {"deleted": voice_name}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"DELETE /api/voices/{voice_name} failed: {e}")
        raise HTTPException(500, detail=str(e))


# API: history (previous generations in the output folder)
# Filenames follow the pattern "output <VOICE NAME> <YYYY-MM-DD_HH-MM-SS> <SAMPLE RATE>.<FORMAT>".
OUTPUT_NAME_RE = re.compile(
    r"^output (.+) (\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}) (\d+)\.([A-Za-z0-9]+)$"
)


def _find_voice_dir(voice_name: str):
    try:
        target = voice_name.casefold()
        for entry in os.listdir(VOICES_DIR):
            vdir = os.path.join(VOICES_DIR, entry)
            if os.path.isdir(vdir) and entry.casefold() == target:
                return vdir
        return None
    except Exception:
        return None


def _history_items() -> list:
    try:
        files = [
            name
            for name in os.listdir(OUTPUT_DIR)
            if os.path.isfile(os.path.join(OUTPUT_DIR, name))
        ]
        files.sort(
            key=lambda name: os.path.getmtime(os.path.join(OUTPUT_DIR, name)),
            reverse=True,
        )

        items = []
        for name in files:
            m = OUTPUT_NAME_RE.match(name)
            if m:
                voice_name = m.group(1).rstrip()
                timestamp = m.group(2)
                sample_rate = int(m.group(3))
                fmt = m.group(4).lower()
            else:
                base, ext = os.path.splitext(name)
                voice_name = base
                timestamp = ""
                sample_rate = None
                fmt = (ext or "").lstrip(".").lower()

            icon_url = None
            vdir = _find_voice_dir(voice_name) if voice_name else None
            if vdir:
                icon = TTSHandler._voice_icon(vdir)
                if icon:
                    icon_url = (
                        f"/data/voice-library/{os.path.basename(vdir)}/"
                        f"{os.path.basename(icon)}"
                    )

            items.append({
                "filename": name,
                "url": f"/data/output/{quote(name)}",
                "voice_name": voice_name,
                "icon_url": icon_url,
                "time": timestamp,
                "sample_rate": sample_rate,
                "format": fmt,
            })
        return items
    except Exception as e:
        logger.exception(f"Failed to list history: {e}")
        raise


@app.get("/api/history")
def api_list_history():
    try:
        return {"items": _history_items()}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("GET /api/history failed")
        raise HTTPException(500, detail=str(e))


@app.delete("/api/history")
def api_delete_history():
    try:
        removed = 0
        for name in os.listdir(OUTPUT_DIR):
            path = os.path.join(OUTPUT_DIR, name)
            if os.path.isfile(path):
                try:
                    os.remove(path)
                    removed += 1
                except OSError as e:
                    logger.warning(f"Could not remove {path}: {e}")
        logger.success(f"Deleted {removed} history file(s).")
        return {"deleted": removed}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("DELETE /api/history failed")
        raise HTTPException(500, detail=str(e))


@app.delete("/api/history/{filename}")
def api_delete_history_file(filename: str):
    try:
        name = os.path.basename(filename)
        abs_dir = os.path.abspath(OUTPUT_DIR)
        abs_path = os.path.abspath(os.path.join(OUTPUT_DIR, name))
        if os.path.commonpath([abs_path, abs_dir]) != abs_dir:
            raise HTTPException(400, detail="Invalid filename.")
        if not os.path.isfile(abs_path):
            raise HTTPException(404, detail=f"File '{name}' not found.")
        os.remove(abs_path)
        logger.success(f"Deleted history file '{name}'.")
        return {"deleted": name}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"DELETE /api/history/{filename} failed")
        raise HTTPException(500, detail=str(e))


# API: TTS generation
@app.post("/api/tts")
def generate_tts(request: TTSRequest):
    try:
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

        tts.generate(
            text=request.text,
            voice=request.voice,
            out_path=out_path,
            **payload,
        )
        logger.success(f"TTS generation succeeded: {filename}")
        return {
            "audio_url": f"/data/output/{filename}",
            "voice": request.voice or "auto",
            "service": tts.service,
            "sample_rate": request.sample_rate or tts.sample_rate,
            "audio_format": audio_format,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"POST /api/tts failed: {e}")
        raise HTTPException(500, detail=str(e))


# Static mounts
app.mount("/gui", StaticFiles(directory=GUI_DIR), name="gui")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")