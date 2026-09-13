import numpy as np
import os
import re
import threading
import time

from loguru import logger

from paths import BASE_PATH

# OmniVoice (k2-fsa/OmniVoice) generates at 24 kHz
OMNIVOICE_SAMPLE_RATE = 24000

# Allowed export formats (soundfile). First entry is the default.
SUPPORTED_AUDIO_FORMATS = ["wav", "flac", "ogg", "mp3"]

# OmniVoice generate() parameters (docs/generation-parameters.md).
# All of these can be overridden per-request via the API.
GEN_PARAM_KEYS = [
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


class TTSHandler:
    """Local TTS engine: auto-downloads OmniVoice, manages the cloned-voice library.

    A voice library preset is a folder inside ``data/voices-library/<VoiceName>/``
    containing:
        - ``reference.wav``        -> the reference audio used for voice cloning
        - ``transcription.txt``    -> the exact text spoken in that reference.wav
    """

    def __init__(
        self,
        device: str = "cuda",
        model_id: str = "k2-fsa/OmniVoice",
        default_voice: str = "",
        gain: float = 1.0,
        sample_rate: int = OMNIVOICE_SAMPLE_RATE,
        audio_format: str = "wav",
        gen_defaults: dict = None,
        voices_dir: str = None,
        output_dir: str = None,
    ):
        self.device = device
        self.model_id = model_id
        self.default_voice = default_voice
        self.gain = gain
        self.sample_rate = sample_rate
        self.audio_format = self._normalize_format(audio_format)
        self.gen_defaults = {}
        if gen_defaults:
            for key in GEN_PARAM_KEYS:
                if key in gen_defaults and gen_defaults[key] is not None:
                    self.gen_defaults[key] = gen_defaults[key]
        self.voices_dir = voices_dir or os.path.join(BASE_PATH, "data", "voices-library")
        self.output_dir = output_dir or os.path.join(BASE_PATH, "data", "output")

        os.makedirs(self.voices_dir, exist_ok=True)
        os.makedirs(self.output_dir, exist_ok=True)

        self.model = None
        self.model_state = "unloaded"  # unloaded | loading | ready | error
        self.model_error = None
        self._model_lock = threading.Lock()
        self._generate_lock = threading.Lock()

    # Model loading (auto download from HuggingFace)
    def load_model(self):
        """Load OmniVoice from HuggingFace; downloads the weights automatically."""
        with self._model_lock:
            if self.model is not None or self.model_state == "loading":
                return
            self.model_state = "loading"
            self.model_error = None

        try:
            import torch
            from omnivoice import OmniVoice

            if self.device == "cuda" and not torch.cuda.is_available():
                raise RuntimeError(
                    "CUDA was requested but is not available. "
                    "OmniVoice requires an NVIDIA GPU (see requirements.txt)."
                )

            if torch.cuda.is_available():
                logger.info(
                    f"CUDA available: {torch.cuda.is_available()} "
                    f"| device: {torch.cuda.get_device_name(0)}"
                )

            dtype = torch.float16 if self.device == "cuda" else torch.float32
            device_map = f"{self.device}:0" if self.device == "cuda" else self.device

            logger.info(f"Loading OmniVoice (device_map={device_map}, dtype={dtype})...")
            self.model = OmniVoice.from_pretrained(
                self.model_id,
                device_map=device_map,
                dtype=dtype,
            )
            self.model_state = "ready"
            logger.success("OmniVoice model loaded and ready.")
        except Exception as e:
            self.model_state = "error"
            self.model_error = str(e)
            logger.exception(f"Failed to load OmniVoice: {e}")

    def unload_model(self):
        with self._model_lock:
            self.model = None
            self.model_state = "unloaded"
        logger.info("OmniVoice model unloaded.")

    def status(self) -> dict:
        return {
            "model_state": self.model_state,
            "model_error": self.model_error,
            "device": self.device,
            "model_id": self.model_id,
            "default_voice": self.default_voice,
            "gain": self.gain,
            "sample_rate": self.sample_rate,
            "audio_format": self.audio_format,
            "tts_settings": dict(self.gen_defaults),
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

    # Voice library
    @staticmethod
    def _resolve_reference_path(path: str):
        if not path:
            return None
        if os.path.isabs(path):
            return os.path.abspath(path)
        return os.path.abspath(os.path.join(BASE_PATH, path))

    def list_voices(self) -> list:
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

            voices.append({
                "name": entry,
                "reference_wav": wav if os.path.exists(wav) else None,
                "has_audio": os.path.exists(wav),
                "transcription": transcription,
            })
        return voices

    def resolve_voice(self, name: str):
        """Return the voice preset folder path, or None if invalid/missing."""
        if not name:
            return None
        vdir = os.path.abspath(os.path.join(self.voices_dir, name))
        base = os.path.abspath(self.voices_dir)
        if vdir != base and os.path.commonpath([vdir, base]) == base and os.path.isdir(vdir):
            return vdir
        return None

    def save_voice(self, name: str, transcription: str, wav_bytes: bytes) -> str:
        """Create or overwrite a voice preset from uploaded reference audio."""
        safe = re.sub(r'[^a-zA-Z0-9 _-]', '', name).strip().rstrip('.')
        if not safe:
            safe = "voice"
        vdir = os.path.join(self.voices_dir, safe)
        os.makedirs(vdir, exist_ok=True)

        with open(os.path.join(vdir, "reference.wav"), "wb") as f:
            f.write(wav_bytes)
        with open(os.path.join(vdir, "transcription.txt"), "w", encoding="utf-8") as f:
            f.write(transcription.strip())

        logger.success(f"Saved voice preset '{safe}' -> {vdir}")
        return safe

    #Generation
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
        ``audio_format`` control the export (resampled from the 24 kHz OmniVoice
        output when needed). Any OmniVoice generation parameter (see
        ``GEN_PARAM_KEYS``) can be overridden through ``overrides``.

        Returns the path to the generated audio file.
        """
        if self.model is None:
            raise RuntimeError(f"Model is not loaded (state: {self.model_state})")

        gain = self.gain if gain is None else gain
        sample_rate = self.sample_rate if sample_rate is None else sample_rate
        audio_format = self._normalize_format(audio_format or self.audio_format)

        params = dict(self.gen_defaults)
        for key, value in overrides.items():
            if key in GEN_PARAM_KEYS and value is not None:
                params[key] = value

        with self._generate_lock:
            generate_kwargs = {"text": text}
            for key, value in params.items():
                generate_kwargs[key] = value

            if voice:
                vdir = self.resolve_voice(voice)
                if vdir:
                    ref_audio = os.path.join(vdir, "reference.wav")
                    ref_text = os.path.join(vdir, "transcription.txt")
                    if os.path.exists(ref_audio) and os.path.exists(ref_text):
                        with open(ref_text, "r", encoding="utf-8") as f:
                            generate_kwargs["ref_audio"] = ref_audio
                            generate_kwargs["ref_text"] = f.read().strip()
                        logger.info(f"Using cloned voice '{voice}' (ref: {ref_audio})")
                    else:
                        logger.warning(
                            f"Voice '{voice}' is missing reference.wav or transcription.txt; "
                            "falling back to auto voice."
                        )
                else:
                    logger.warning(f"Voice '{voice}' not found in the library; using auto voice.")
            else:
                logger.info("Using OmniVoice auto voice (no cloning).")

            logger.info(
                f"Generating TTS (chars={len(text)}, voice={voice or 'auto'}, gain={gain}, "
                f"params={params})..."
            )
            audio = self.model.generate(**generate_kwargs)

            samples = audio[0]
            if gain != 1.0:
                samples = np.clip(samples * gain, -1.0, 1.0)

            if sample_rate and sample_rate != OMNIVOICE_SAMPLE_RATE:
                from math import gcd
                import scipy.signal as sps

                factor = gcd(OMNIVOICE_SAMPLE_RATE, sample_rate)
                up, down = sample_rate // factor, OMNIVOICE_SAMPLE_RATE // factor
                logger.info(f"Resampling {OMNIVOICE_SAMPLE_RATE}Hz -> {sample_rate}Hz ({up}/{down}).")
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
            duration = len(samples) / (sample_rate or OMNIVOICE_SAMPLE_RATE)
            logger.success(f"Generated audio -> {out_path} ({duration:.2f}s, {sample_rate}Hz)")
            return out_path