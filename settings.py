import json
import os

from loguru import logger

from paths import BASE_PATH

DEFAULTS_PATH = os.path.join(BASE_PATH, "data", "backup", "settings-defaults.json")

# Fallback defaults used to (re)generate data/backup/settings-defaults.json.
BUILTIN_DEFAULTS = {
    "_comment_general": "------GENERAL SETTINGS-------",
    "default_voice": "",
    "_comment_server": "------SERVER SETTINGS-------",
    "host": "127.0.0.1",
    "port": 8078,
    "_comment_tts": "------TTS SETTINGS-------",
    "tts_service": "omnivoice",
    "model_id": "k2-fsa/OmniVoice",
    "_comment_tts_decoding": "------DECODING-------",
    "num_step": 32,
    "denoise": True,
    "guidance_scale": 2.0,
    "t_shift": 0.1,
    "_comment_tts_sampling": "------SAMPLING-------",
    "position_temperature": 5.0,
    "class_temperature": 0.0,
    "layer_penalty_factor": 5.0,
    "_comment_tts_duration": "------DURATION & SPEED-------",
    "duration": None,
    "speed": 1.0,
    "_comment_tts_processing": "------PRE/POST PROCESSING-------",
    "preprocess_prompt": True,
    "postprocess_output": True,
    "pad_duration": 0.1,
    "fade_duration": 0.1,
    "_comment_tts_longform": "------LONG-FORM GENERATION-------",
    "audio_chunk_duration": 15.0,
    "audio_chunk_threshold": 30.0,
    "_comment_tts_playback": "------PLAYBACK-------",
    "gain": 1.0,
    "_comment_tts_export": "------EXPORT SETTINGS-------",
    "sample_rate": 24000,
    "audio_format": "wav",
    "_comment_logs": "------LOGS SETTINGS-------",
    "logs": True,
    "log_level": "INFO",
    "log_rotation": "10 MB",
    "log_retention": "30 days",
    "_comment_gui": "------GUI SETTINGS-------",
    "window_width": 900,
    "window_height": 720,
}


def _filter_values(raw: dict) -> dict:
    """Drop ``_comment_*`` keys and null values, keeping only usable settings."""
    return {k: v for k, v in raw.items() if not k.startswith("_") and v is not None}


class Settings:
    """Loads settings.json merged over defaults from data/backup/settings-defaults.json.

    The defaults file is the source of truth for factory values and enables a
    future "reset to defaults" button (see :meth:`reset`).
    """

    def __init__(self, path: str = None):
        self.path = path or os.path.join(BASE_PATH, "settings.json")
        self._raw_defaults = self._load_or_generate_defaults()
        self.data = _filter_values(self._raw_defaults)
        self._load_user_settings()

    def _load_or_generate_defaults(self) -> dict:
        if os.path.exists(DEFAULTS_PATH):
            try:
                with open(DEFAULTS_PATH, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                logger.info(f"Defaults loaded from {DEFAULTS_PATH}")
                return loaded
            except Exception as e:
                logger.error(f"Failed to load defaults backup: {e}")
        logger.warning(f"Defaults backup missing at {DEFAULTS_PATH}; generating from built-ins.")
        return self._generate_defaults_file()

    def _generate_defaults_file(self) -> dict:
        os.makedirs(os.path.dirname(DEFAULTS_PATH), exist_ok=True)
        with open(DEFAULTS_PATH, "w", encoding="utf-8") as f:
            json.dump(BUILTIN_DEFAULTS, f, indent=2, ensure_ascii=False)
        logger.success(f"Defaults backup written to {DEFAULTS_PATH}")
        return dict(BUILTIN_DEFAULTS)

    def _load_user_settings(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                for key, value in loaded.items():
                    if not key.startswith("_") and key in self.data and value is not None:
                        self.data[key] = value
                logger.info(f"Settings loaded from {self.path}")
            except Exception as e:
                logger.error(f"Failed to load settings.json: {e}")
        else:
            logger.warning(f"settings.json not found at {self.path}; writing defaults.")
            self.save()

    def get(self, key: str, default=None):
        return self.data.get(key, default)

    def save(self):
        raw = dict(self._raw_defaults)
        for key, value in self.data.items():
            if not key.startswith("_"):
                raw[key] = value
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(raw, f, indent=2, ensure_ascii=False)
        logger.info(f"Settings saved to {self.path}")

    def reset(self) -> dict:
        """Restore settings.json to the values in the defaults backup file."""
        self.data = _filter_values(self._raw_defaults)
        self.save()
        logger.success(f"Settings reset to defaults (from {DEFAULTS_PATH}).")
        return dict(self.data)

    @property
    def defaults_path(self) -> str:
        return DEFAULTS_PATH