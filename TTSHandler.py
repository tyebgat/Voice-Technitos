import numpy as np
import os
import re
import shutil
import threading
import time

from loguru import logger

from paths import BASE_PATH

# Model source sample rates (Hz). OmniVoice and Pocket TTS both generate 24 kHz.
POCKET_SAMPLE_RATE = 24000
OMNIVOICE_SAMPLE_RATE = 24000

# Allowed export formats (soundfile). First entry is the default.
SUPPORTED_AUDIO_FORMATS = ["wav", "flac", "ogg", "mp3"]

# Voice library icon files (an optional image stored next to reference.wav).
ICON_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
ICON_FILES = [
    "icon.png",
    "icon.jpg",
    "icon.jpeg",
    "icon.webp",
    "icon.gif",
]

# Pocket TTS generate() parameters. ``frames_after_eos`` is the only one exposed.
POCKET_PARAMS = [
    "frames_after_eos",
]

# Default cloning reference for Pocket TTS when no library voice is selected.
POCKET_DEFAULT_VOICE = "hf://kyutai/tts-voices/alba-mackenna/casual.wav"

# OmniVoice generate() parameters (docs/generation-parameters.md).
OMNIVOICE_PARAMS = [
    # decoding
    "num_step",
    "denoise",
    "guidance_scale",
    "t_shift",
    # sampling
    "position_temperature",
    "class_temperature",
    "layer_penalty_factor",
    # duration & speed
    "duration",
    "speed",
    # pre/post processing
    "preprocess_prompt",
    "postprocess_output",
    "pad_duration",
    "fade_duration",
    # long-form generation
    "audio_chunk_duration",
    "audio_chunk_threshold",
]

# Available TTS services. ``config_section`` selects which settings file feeds
# the service; ``model_config_key`` picks the model id out of that section.
SERVICES = {
    "omnivoice": {
        "display": "OmniVoice",
        "config_section": "omnivoice",
        "model_config_key": "model_id",
        "default_model_id": "k2-fsa/OmniVoice",
        "param_keys": OMNIVOICE_PARAMS,
    },
    "pocket-tts": {
        "display": "Pocket TTS",
        "config_section": "pocket-tts",
        "model_config_key": "language",
        "default_model_id": "english",
        "param_keys": POCKET_PARAMS,
    },
}


class TTSHandler:
    """Local TTS engine (OmniVoice | Pocket TTS) with a cloned-voice library.

    Auto-downloads models from HuggingFace and manages the cloned-voice library.
    A voice library preset is a folder inside ``data/voice-library/<VoiceName>/``
    containing:
        - ``reference.wav``        -> the reference audio used for voice cloning
        - ``transcription.txt``    -> the exact text spoken in that reference.wav
        - ``icon.png/jpg/webp/gif``-> optional avatar shown in the voice library

    ``OmniVoice`` requires an NVIDIA GPU and the reference transcription;
    ``Pocket TTS`` runs on CPU and clones from the reference audio alone.
    """

    def __init__(
        self,
        service: str = "omnivoice",
        config: dict = None,
        general: dict = None,
        voices_dir: str = None,
        output_dir: str = None,
    ):
        if service not in SERVICES:
            raise ValueError(f"Unknown tts_service '{service}'. Choose from {list(SERVICES)}")
        self.service = service
        self.spec = SERVICES[service]
        self.config = dict(config or {})
        general = dict(general or {})

        try:
            self.model_id = self.config.get(self.spec["model_config_key"]) or self.spec["default_model_id"]
            self.device = "cuda"
            self.default_voice = self.config.get("default_voice") or general.get("default_voice", "")
            self.gain = float(general.get("gain", 1.0))
            self.sample_rate = int(general.get("sample_rate"))
            self.audio_format = self._normalize_format(general.get("audio_format", "wav"))
            if self.sample_rate <= 0:
                self.sample_rate = OMNIVOICE_SAMPLE_RATE
            self.source_sample_rate = OMNIVOICE_SAMPLE_RATE

            # Pocket TTS model options (empty strings/None fall back to defaults).
            self.pocket_options = {}
            for key in ("temp", "sampler_decode_steps", "noise_clamp", "eos_threshold", "quantize"):
                value = self.config.get(key)
                if value is not None:
                    self.pocket_options[key] = value
            self.pocket_truncate_voice = bool(self.config.get("truncate_voice", False))

            # Generation defaults (None values and unknown keys skipped).
            self.gen_defaults = {}
            for key in self.spec["param_keys"]:
                if key in self.config and self.config[key] is not None:
                    self.gen_defaults[key] = self.config[key]

            self.voices_dir = voices_dir or os.path.join(BASE_PATH, "data", "voice-library")
            self.output_dir = output_dir or os.path.join(BASE_PATH, "data", "output")

            os.makedirs(self.voices_dir, exist_ok=True)
            os.makedirs(self.output_dir, exist_ok=True)

            self.model = None
            self.model_state = "unloaded"  # unloaded | loading | ready | error
            self.model_error = None
            self.download_state = "none"  # none | downloading | done
            self.download_progress = 0.0  # 0.0 .. 100.0
            self._model_lock = threading.Lock()
            self._generate_lock = threading.Lock()

            # Small LRU cache of extracted Pocket TTS voice states (path -> state).
            self._voice_cache = {}
            self._voice_cache_order = []
            self._voice_cache_max = 8

            logger.info(
                f"TTSHandler initialized (service={self.service}, model_id={self.model_id}, "
                f"device={self.device}, sample_rate={self.sample_rate})."
            )
        except Exception as e:
            logger.exception(f"Failed to initialize TTSHandler: {e}")
            raise

    # model loading (auto download from HuggingFace)
    def _check_cuda(self):
        try:
            import torch

            if self.device == "cuda" and not torch.cuda.is_available():
                raise RuntimeError(
                    "CUDA was requested but is not available. "
                    "OmniVoice runs on an NVIDIA GPU (see requirements.txt)."
                )
            if torch.cuda.is_available():
                logger.info(
                    f"CUDA available: {torch.cuda.is_available()} "
                    f"| device: {torch.cuda.get_device_name(0)}"
                )
        except Exception as e:
            logger.exception(f"CUDA check failed: {e}")
            raise

    def _load_omnivoice(self):
        try:
            import torch
            from omnivoice import OmniVoice

            self._check_cuda()
            dtype = torch.float16 if self.device == "cuda" else torch.float32
            device_map = f"{self.device}:0" if self.device == "cuda" else self.device

            logger.info(f"Loading OmniVoice (device_map={device_map}, dtype={dtype})...")
            model = OmniVoice.from_pretrained(self.model_id, device_map=device_map, dtype=dtype)
            self.source_sample_rate = OMNIVOICE_SAMPLE_RATE
            logger.info("OmniVoice model loaded.")
            return model
        except Exception as e:
            logger.exception(f"Failed to load OmniVoice: {e}")
            raise

    def _load_pocket_tts(self):
        try:
            from pocket_tts import TTSModel

            language = self.config.get("language") or None
            config = self.config.get("config") or None
            if language and config:
                raise ValueError("Pocket TTS: 'language' and 'config' are mutually exclusive.")
            if not language and not config:
                language = self.spec["default_model_id"]

            kwargs = dict(self.pocket_options)
            if language:
                kwargs["language"] = language
                logger.info(f"Loading Pocket TTS (language={language}, options={kwargs})...")
            else:
                kwargs["config"] = config
                logger.info(f"Loading Pocket TTS (config={config}, options={kwargs})...")

            model = TTSModel.load_model(**kwargs)
            self.source_sample_rate = int(getattr(model, "sample_rate", POCKET_SAMPLE_RATE))
            logger.info(f"Pocket TTS ready (sample_rate={self.source_sample_rate}Hz).")
            return model
        except Exception as e:
            logger.exception(f"Failed to load Pocket TTS: {e}")
            raise

    def load_model(self):
        with self._model_lock:
            if self.model is not None or self.model_state == "loading":
                return
            self.model_state = "loading"
            self.model_error = None

        try:
            self._download_assets()
            if self.service == "pocket-tts":
                self.model = self._load_pocket_tts()
            else:
                self.model = self._load_omnivoice()
            self.model_state = "ready"
            logger.success(f"{self.service} model loaded and ready.")
        except Exception as e:
            self.model_state = "error"
            self.model_error = str(e)
            logger.exception(f"Failed to load {self.service}: {e}")

    # asset download (with progress reporting for the bootstrap screen)
    def _hub_progress(self, total_files: int = None):
        """Return a tqdm class that mirrors HuggingFace Hub download progress
        into ``self.download_progress`` (0.0 .. 100.0). ``total_files`` weights
        each individual file download when several files must be fetched."""
        from tqdm import tqdm as _tqdm

        state = {"index": -1}

        def _report(pct):
            if pct is None:
                return
            self.download_progress = max(self.download_progress, float(pct))

        class _HubProgress(_tqdm):
            def __init__(self, *args, **kwargs):
                self._vt_report = _report
                super().__init__(*args, **kwargs)
                state["index"] += 1
                self._vt_index = state["index"]
                self._vt_baseline = 0.0
                if total_files and getattr(self, "unit", "") == "B":
                    self._vt_baseline = self._vt_index * (100.0 / total_files)
                self._vt_report(self._vt_baseline)

            def update(self, n=1):
                result = super().update(n)
                total = getattr(self, "total", None) or 0
                done = getattr(self, "n", 0) or 0
                if total > 0 and done > 0:
                    if getattr(self, "unit", "") == "B" and total_files:
                        pct = self._vt_baseline + (done / total) * (100.0 / total_files)
                    else:
                        pct = (done / total) * 100.0
                    self._vt_report(max(0.0, min(100.0, pct)))
                return result

        return _HubProgress

    def _download_assets(self):
        try:
            self.download_state = "downloading"
            self.download_progress = 0.0
            if self.service == "pocket-tts":
                self._download_pocket_tts_assets()
            else:
                self._download_omnivoice_assets()
            self.download_state = "done"
            self.download_progress = 100.0
            logger.info("Asset download complete.")
        except Exception as e:
            self.download_state = "none"
            logger.exception(f"Failed to download {self.service} assets: {e}")
            raise

    def _download_omnivoice_assets(self):
        try:
            from huggingface_hub import snapshot_download

            logger.info(f"Ensuring OmniVoice model is downloaded ({self.model_id})...")
            snapshot_download(repo_id=self.model_id, tqdm_class=self._hub_progress())
            logger.info("OmniVoice model download verified.")
        except Exception as e:
            logger.exception(f"Failed to download OmniVoice assets: {e}")
            raise

    def _download_pocket_tts_assets(self):
        try:
            import yaml as _yaml

            from huggingface_hub import hf_hub_download
            from pocket_tts.utils.config import CONFIGS_DIR
            from pocket_tts.utils.utils import download_if_necessary

            language = self.config.get("language") or None
            config = self.config.get("config") or None
            if language and config:
                raise ValueError("Pocket TTS: 'language' and 'config' are mutually exclusive.")
            if not language and not config:
                language = self.spec["default_model_id"]

            yaml_path = str(config) if config else os.path.join(CONFIGS_DIR, f"{language}.yaml")
            resolved_yaml = download_if_necessary(yaml_path)

            with open(resolved_yaml, "r", encoding="utf-8") as f:
                data = _yaml.safe_load(f)

            urls = []

            def _collect(node):
                if isinstance(node, dict):
                    for v in node.values():
                        _collect(v)
                elif isinstance(node, list):
                    for v in node:
                        _collect(v)
                elif isinstance(node, str) and node.startswith("hf://"):
                    urls.append(node)

            _collect(data)
            urls = list(dict.fromkeys(urls))
            logger.info(f"Pocket TTS: ensuring {len(urls)} asset(s) are downloaded...")

            progress_cls = self._hub_progress(total_files=len(urls))
            for i, url in enumerate(urls):
                path = url.removeprefix("hf://")
                parts = path.split("/")
                repo_id = "/".join(parts[:2])
                filename = "/".join(parts[2:])
                revision = None
                if "@" in filename:
                    filename, revision = filename.split("@", 1)
                logger.info(f"Ensuring Pocket TTS asset is downloaded ({repo_id}/{filename})...")
                hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    tqdm_class=progress_cls,
                )
                self.download_progress = max(
                    self.download_progress, (i + 1.0) / len(urls) * 100.0
                )
            logger.info("Pocket TTS asset download verified.")
        except Exception as e:
            logger.exception(f"Failed to download Pocket TTS assets: {e}")
            raise

    def unload_model(self):
        try:
            with self._model_lock:
                self.model = None
                self.model_state = "unloaded"
            self._voice_cache.clear()
            self._voice_cache_order.clear()
            logger.info(f"{self.service} model unloaded.")
        except Exception as e:
            logger.exception(f"Failed to unload {self.service} model: {e}")
            raise

    # status 
    def status(self) -> dict:
        return {
            "service": self.service,
            "service_display": self.spec["display"],
            "model_state": self.model_state,
            "model_error": self.model_error,
            "download_state": self.download_state,
            "download_progress": self.download_progress,
            "device": self.device,
            "model_id": self.model_id,
            "source_sample_rate": self.source_sample_rate,
            "default_voice": self.default_voice,
            "gain": self.gain,
            "sample_rate": self.sample_rate,
            "audio_format": self.audio_format,
            "tts_settings": dict(self.gen_defaults),
            "param_keys": list(self.spec["param_keys"]),
            "available_services": {
                name: {"display": spec["display"], "param_keys": list(spec["param_keys"])}
                for name, spec in SERVICES.items()
            },
            "voices_dir": self.voices_dir,
            "cuda_available": self._cuda_available(),
        }

    @staticmethod
    def _normalize_format(fmt: str) -> str:
        fmt = (fmt or "wav").lower().lstrip(".")
        if fmt not in SUPPORTED_AUDIO_FORMATS:
            logger.warning(f"Unsupported audio format '{fmt}', falling back to 'wav'.")
            return "wav"
        return fmt

    def _cuda_available(self) -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except Exception:
            return False

    # voice library
    @staticmethod
    def _resolve_reference_path(path: str):
        if not path:
            return None
        if os.path.isabs(path):
            return os.path.abspath(path)
        return os.path.abspath(os.path.join(BASE_PATH, path))

    @staticmethod
    def _voice_icon(vdir: str):
        """Return the icon file path inside ``vdir`` (an ICON_FILES match), or None."""
        for icon in ICON_FILES:
            candidate = os.path.join(vdir, icon)
            if os.path.exists(candidate):
                return candidate
        return None

    def list_voices(self) -> list:
        try:
            voices = []
            for entry in sorted(os.listdir(self.voices_dir)):
                vdir = os.path.join(self.voices_dir, entry)
                if not os.path.isdir(vdir):
                    continue

                wav = os.path.join(vdir, "reference.wav")
                txt = os.path.join(vdir, "transcription.txt")
                transcription = ""
                if os.path.exists(txt):
                    try:
                        with open(txt, "r", encoding="utf-8") as f:
                            transcription = f.read().strip()
                    except Exception as e:
                        logger.warning(f"Could not read {txt}: {e}")

                desc_txt = os.path.join(vdir, "description.txt")
                description = ""
                if os.path.exists(desc_txt):
                    try:
                        with open(desc_txt, "r", encoding="utf-8") as f:
                            description = f.read().strip()
                    except Exception as e:
                        logger.warning(f"Could not read {desc_txt}: {e}")

                voices.append({
                    "name": entry,
                    "reference_wav": wav if os.path.exists(wav) else None,
                    "has_audio": os.path.exists(wav),
                    "transcription": transcription,
                    "description": description,
                    "icon": self._voice_icon(vdir),
                })
            return voices
        except Exception as e:
            logger.exception(f"Failed to list voices from {self.voices_dir}: {e}")
            raise

    def resolve_voice(self, name: str):
        """Return the voice preset folder path, or None if invalid/missing."""
        try:
            if not name:
                return None
            vdir = os.path.abspath(os.path.join(self.voices_dir, name))
            base = os.path.abspath(self.voices_dir)
            if vdir != base and os.path.commonpath([vdir, base]) == base and os.path.isdir(vdir):
                return vdir
            return None
        except Exception as e:
            logger.exception(f"Failed to resolve voice '{name}': {e}")
            raise

    def save_voice(
        self,
        name: str,
        transcription: str,
        description: str = "",
        wav_bytes: bytes = None,
        icon_bytes: bytes = None,
        icon_mime: str = "",
    ) -> str:
        """Create or overwrite a voice preset from uploaded reference audio.

        ``icon_bytes``/``icon_mime`` optionally store an avatar image next to the
        reference. Any previously stored icon is replaced; unknown MIME types are
        rejected with a warning (audio is saved regardless).
        """
        safe = re.sub(r'[^a-zA-Z0-9 _-]', '', name).strip().rstrip('.')
        if not safe:
            safe = "voice"
        try:
            existing = {
                e.casefold(): e
                for e in os.listdir(self.voices_dir)
                if os.path.isdir(os.path.join(self.voices_dir, e))
            }
            if safe.casefold() in existing:
                raise ValueError("The name need to be unique")
            vdir = os.path.join(self.voices_dir, safe)
            os.makedirs(vdir, exist_ok=True)

            with open(os.path.join(vdir, "reference.wav"), "wb") as f:
                f.write(wav_bytes)
            with open(os.path.join(vdir, "transcription.txt"), "w", encoding="utf-8") as f:
                f.write(transcription.strip())
            with open(os.path.join(vdir, "description.txt"), "w", encoding="utf-8") as f:
                f.write((description or "").strip())

            if icon_bytes:
                self._store_icon(vdir, icon_bytes, icon_mime)

            logger.success(f"Saved voice preset '{safe}' -> {vdir}")
            return safe
        except ValueError as e:
            logger.warning(f"Could not save voice preset '{safe}': {e}")
            raise
        except Exception as e:
            logger.exception(f"Failed to save voice preset '{safe}': {e}")
            raise

    def _store_icon(self, vdir: str, icon_bytes: bytes, icon_mime: str = ""):
        """Store (or replace) the avatar image for a voice preset folder."""
        try:
            ext = ICON_EXTENSIONS.get((icon_mime or "").lower())
            if ext is None:
                logger.warning(
                    f"Voice '{os.path.basename(vdir)}': unsupported icon MIME '{icon_mime}', skipping icon."
                )
                return
            for old in ICON_FILES:
                old_path = os.path.join(vdir, old)
                if old != f"icon.{ext}" and os.path.exists(old_path):
                    os.remove(old_path)
            with open(os.path.join(vdir, f"icon.{ext}"), "wb") as f:
                f.write(icon_bytes)
            logger.info(f"Voice '{os.path.basename(vdir)}': stored icon (icon.{ext}).")
        except Exception as e:
            logger.exception(f"Failed to store icon for voice '{os.path.basename(vdir)}': {e}")
            raise

    def update_voice(
        self,
        name: str,
        transcription: str = None,
        description: str = None,
        wav_bytes: bytes = None,
        icon_bytes: bytes = None,
        icon_mime: str = "",
        new_name: str = "",
    ) -> str:
        """Edit a voice preset: optional rename plus refresh of its stored files.

        ``None`` means "leave unchanged"; an empty string clears the field.
        """
        vdir = self.resolve_voice(name)
        if vdir is None:
            raise ValueError(f"Voice '{name}' not found.")

        try:
            final_name = name
            rename_to = (new_name or "").strip()
            if rename_to and rename_to != name:
                safe = re.sub(r'[^a-zA-Z0-9 _-]', '', rename_to).strip().rstrip('.')
                if not safe:
                    raise ValueError("Invalid voice name.")
                existing = {
                    e.casefold(): e
                    for e in os.listdir(self.voices_dir)
                    if os.path.isdir(os.path.join(self.voices_dir, e))
                }
                prev = existing.get(safe.casefold())
                if prev is not None and prev != name:
                    raise ValueError("The name need to be unique")
                newdir = os.path.join(self.voices_dir, safe)
                if prev is None or prev != safe:
                    os.rename(vdir, newdir)
                    vdir = newdir
                final_name = safe

            if transcription is not None:
                with open(os.path.join(vdir, "transcription.txt"), "w", encoding="utf-8") as f:
                    f.write(transcription.strip())
            if description is not None:
                with open(os.path.join(vdir, "description.txt"), "w", encoding="utf-8") as f:
                    f.write(description.strip())
            if wav_bytes:
                with open(os.path.join(vdir, "reference.wav"), "wb") as f:
                    f.write(wav_bytes)
            if icon_bytes:
                self._store_icon(vdir, icon_bytes, icon_mime)

            logger.success(f"Updated voice preset '{name}' -> '{final_name}' ({vdir})")
            return final_name
        except ValueError as e:
            logger.warning(f"Could not update voice preset '{name}': {e}")
            raise
        except Exception as e:
            logger.exception(f"Failed to update voice preset '{name}': {e}")
            raise

    def delete_voice(self, name: str) -> bool:
        """Delete a voice preset folder. Returns False if it does not exist."""
        try:
            vdir = self.resolve_voice(name)
            if vdir is None:
                return False
            shutil.rmtree(vdir)
            logger.success(f"Deleted voice preset '{name}'.")
            return True
        except Exception as e:
            logger.exception(f"Failed to delete voice preset '{name}': {e}")
            raise

    # Pocket TTS: extract + cache voice states (audio -> voice_state embeddings).
    def _pocket_voice_state(self, ref: str):
        try:
            key = ref
            if key in self._voice_cache:
                self._voice_cache_order.remove(key)
                self._voice_cache_order.append(key)
                return self._voice_cache[key]

            voice_state = self.model.get_state_for_audio_prompt(
                ref, truncate=self.pocket_truncate_voice
            )
            self._voice_cache[key] = voice_state
            self._voice_cache_order.append(key)
            while len(self._voice_cache_order) > self._voice_cache_max:
                oldest = self._voice_cache_order.pop(0)
                self._voice_cache.pop(oldest, None)
            return voice_state
        except Exception as e:
            logger.exception(f"Failed to extract Pocket TTS voice state (ref={ref}): {e}")
            raise

    # generation
    def refresh_generation_defaults(self, config: dict = None):
        """Refresh the cached generation defaults from the service config section.

        Called after settings are saved so that generation picks up the new
        values without reloading the model. ``None``/missing keys are reset to
        the model's own defaults.
        """
        try:
            config = dict(config or {})
            refreshed = 0
            for key in self.spec["param_keys"]:
                if key in config and config[key] is not None:
                    if self.gen_defaults.get(key) != config[key]:
                        self.gen_defaults[key] = config[key]
                        refreshed += 1
                else:
                    if key in self.gen_defaults:
                        del self.gen_defaults[key]
                        refreshed += 1
            if refreshed:
                logger.info(f"{self.service}: generation defaults refreshed ({refreshed} param(s) updated).")
        except Exception as e:
            logger.exception(f"Failed to refresh generation defaults: {e}")
            raise

    def _collect_generation_kwargs(self, overrides: dict) -> dict:
        try:
            params = dict(self.gen_defaults)
            for key, value in overrides.items():
                if key in self.spec["param_keys"] and value is not None:
                    params[key] = value
            return {k: v for k, v in params.items() if k in self.spec["param_keys"]}
        except Exception as e:
            logger.exception(f"Failed to collect generation kwargs: {e}")
            raise

    def generate(
        self,
        text: str,
        voice: str = None,
        out_path: str = None,
        gain: float = None,
        sample_rate: int = None,
        audio_format: str = None,
        **overrides,
    ) -> str:
        """Generate speech for ``text`` with the given voice preset (or auto voice).

        ``gain`` amplifies the raw audio before saving. ``sample_rate`` and
        ``audio_format`` control the export (resampled from the model's native
        24 kHz output when needed). Any OmniVoice generation parameter (see
        ``status()["param_keys"]``) can be overridden through ``overrides``.

        Returns the path to the generated audio file.
        """
        if self.model is None:
            raise RuntimeError(f"Model is not loaded (state: {self.model_state})")

        try:
            gain = self.gain if gain is None else gain
            sample_rate = self.sample_rate if sample_rate is None else sample_rate
            audio_format = self._normalize_format(audio_format or self.audio_format)
            if sample_rate <= 0:
                sample_rate = self.source_sample_rate

            params = self._collect_generation_kwargs(overrides)

            # Resolve the cloning reference. OmniVoice needs reference.wav AND
            # transcription.txt; Pocket TTS clones from the reference audio alone
            # (it can also use a direct path / https: / hf:// reference).
            ref_audio = None
            ref_text = None
            if voice:
                vdir = self.resolve_voice(voice)
                if vdir:
                    candidate = os.path.join(vdir, "reference.wav")
                    ref_txt = os.path.join(vdir, "transcription.txt")
                    if not os.path.exists(candidate):
                        logger.warning(
                            f"Voice '{voice}' is missing reference.wav; using auto voice."
                        )
                    else:
                        ref_audio = candidate
                        if os.path.exists(ref_txt):
                            ref_text = ref_txt
                        if self.service == "pocket-tts":
                            logger.info(f"Using cloned voice '{voice}' (ref: {ref_audio})")
                        elif ref_text:
                            logger.info(f"Using cloned voice '{voice}' (ref: {ref_audio})")
                        else:
                            logger.warning(
                                f"Voice '{voice}' is missing transcription.txt; using auto voice."
                            )
                            ref_audio = None
                else:
                    logger.warning(f"Voice '{voice}' not found in the library; using auto voice.")
            elif self.service == "pocket-tts":
                ref_audio = self.default_voice or None

            with self._generate_lock:
                logger.info(
                    f"Generating TTS [service={self.service}] "
                    f"(chars={len(text)}, voice={voice or 'auto'}, gain={gain}, params={params})..."
                )

                if self.service == "pocket-tts":
                    ref_audio = ref_audio or POCKET_DEFAULT_VOICE
                    voice_state = self._pocket_voice_state(ref_audio)
                    audio = self.model.generate_audio(
                        voice_state,
                        text,
                        frames_after_eos=params.get("frames_after_eos"),
                        copy_state=True,
                    )
                else:
                    generate_kwargs = {"text": text}
                    generate_kwargs.update(params)
                    if ref_audio:
                        ref_text_content = ""
                        if ref_text:
                            with open(ref_text, "r", encoding="utf-8") as f:
                                ref_text_content = f.read().strip()
                        generate_kwargs["ref_audio"] = ref_audio
                        generate_kwargs["ref_text"] = ref_text_content

                    audio = self.model.generate(**generate_kwargs)

                if hasattr(audio, "detach"):  # torch.Tensor (Pocket TTS)
                    samples = audio.detach().to("cpu").numpy().reshape(-1)
                else:
                    try:
                        samples = np.asarray(audio[0]).reshape(-1)  # OmniVoice batch
                    except Exception:
                        samples = np.asarray(audio).reshape(-1)

                if gain != 1.0:
                    samples = np.clip(samples * gain, -1.0, 1.0)

                if sample_rate and sample_rate != self.source_sample_rate:
                    from math import gcd
                    import scipy.signal as sps

                    factor = gcd(self.source_sample_rate, sample_rate)
                    up, down = sample_rate // factor, self.source_sample_rate // factor
                    logger.info(f"Resampling {self.source_sample_rate}Hz -> {sample_rate}Hz ({up}/{down}).")
                    samples = sps.resample_poly(samples, up, down)

                if out_path is None:
                    out_path = os.path.join(
                        self.output_dir,
                        f"output_{int(time.time() * 1000)}.{audio_format}",
                    )
                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                import soundfile as sf
                sf.write(out_path, samples, sample_rate, format=audio_format.upper())

                self.model_state = "ready"
                duration = len(samples) / (sample_rate or self.source_sample_rate)
                logger.success(f"Generated audio -> {out_path} ({duration:.2f}s, {sample_rate}Hz)")
                return out_path
        except RuntimeError as e:
            logger.error(f"TTS generation failed (model state={self.model_state}): {e}")
            raise
        except Exception as e:
            logger.exception(f"TTS generation failed [service={self.service}]: {e}")
            raise