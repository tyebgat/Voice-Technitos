import json
import os

from loguru import logger

from paths import BASE_PATH

DATA_DIR = os.path.join(BASE_PATH, "data")
BACKUP_DIR = os.path.join(DATA_DIR, "backup")

# Order matters: later sections override earlier ones on key conflicts.
SECTION_ORDER = ["general", "pocket-tts", "omnivoice"]

# Live settings files (inside the data folder, one per TTS service + general).
SECTION_FILES = {
    "general": "settings.json",
    "pocket-tts": "pocket-tts-settings.json",
    "omnivoice": "omnivoice-settings.json",
}

# Defaults backups used to (re)generate the live files via reset().
BACKUP_FILES = {
    "general": "settings-defaults.json",
    "pocket-tts": "pocket-tts-settings-defaults.json",
    "omnivoice": "omnivoice-settings-defaults.json",
}

# Fallback defaults used to (re)generate the backup files if they are missing.
BUILTIN_DEFAULTS = {
    "general": {
        "_comment_general": "------GENERAL SETTINGS-------",
        "tts_service": "omnivoice",
        "default_voice": "",
        "_comment_server": "------SERVER SETTINGS-------",
        "host": "127.0.0.1",
        "port": 8078,
        "_comment_tts_export": "------EXPORT SETTINGS (applied to every service)-------",
        "gain": 1.0,
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
        "skip_setup": False,
    },
    "pocket-tts": {
        "_comment_model": "------POCKET TTS MODEL-------",
        "language": "english",
        "config": "",
        "temp": None,
        "sampler_decode_steps": 1,
        "noise_clamp": None,
        "eos_threshold": -4.0,
        "quantize": False,
        "_comment_voice": "------VOICE CLONING-------",
        "default_voice": "hf://kyutai/tts-voices/alba-mackenna/casual.wav",
        "truncate_voice": False,
        "_comment_gen": "------GENERATION PARAMETERS-------",
        "frames_after_eos": None,
    },
    "omnivoice": {
        "_comment_model": "------OMNIVOICE MODEL-------",
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
    },
}


def _filter_values(raw: dict) -> dict:
    """Drop ``_comment_*`` keys and null values, keeping only usable settings."""
    return {k: v for k, v in raw.items() if not k.startswith("_") and v is not None}


class Settings:
    """Per-service settings: ``general`` + ``pocket-tts`` + ``omnivoice``.

    Each section lives in its own JSON file inside ``data/`` and is merged over
    its defaults backup in ``data/backup/``. The backups are the source of truth
    for factory values and enable a future "reset to defaults" button.
    """

    def __init__(self, data_dir: str = None, backup_dir: str = None):
        self.data_dir = data_dir or DATA_DIR
        self.backup_dir = backup_dir or BACKUP_DIR
        self._raw_defaults = {}
        self._sections = {}
        for section in SECTION_ORDER:
            self._raw_defaults[section] = self._load_or_generate_defaults(section)
            self._sections[section] = _filter_values(self._raw_defaults[section])
            self._load_user_settings(section)
        self._merged = self._build_merged()

    # ── paths ────────────────────────────────────────────────────────────────
    def _file_path(self, section: str) -> str:
        return os.path.join(self.data_dir, SECTION_FILES[section])

    def _defaults_path(self, section: str) -> str:
        return os.path.join(self.backup_dir, BACKUP_FILES[section])

    def defaults_path(self, section: str = "general") -> str:
        return self._defaults_path(section)

    # ── loading ──────────────────────────────────────────────────────────────
    def _load_or_generate_defaults(self, section: str) -> dict:
        path = self._defaults_path(section)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                logger.info(f"[{section}] Defaults loaded from {path}")
                return loaded
            except Exception as e:
                logger.error(f"Failed to load defaults backup ({section}): {e}")
        logger.warning(f"Defaults backup missing at {path}; generating from built-ins.")
        return self._generate_defaults_file(section)

    def _generate_defaults_file(self, section: str) -> dict:
        os.makedirs(self.backup_dir, exist_ok=True)
        with open(self._defaults_path(section), "w", encoding="utf-8") as f:
            json.dump(BUILTIN_DEFAULTS[section], f, indent=2, ensure_ascii=False)
        logger.success(f"Defaults backup written to {self._defaults_path(section)}")
        return dict(BUILTIN_DEFAULTS[section])

    def _load_user_settings(self, section: str):
        path = self._file_path(section)
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                for key, value in loaded.items():
                    if not key.startswith("_") and key in self._sections[section] and value is not None:
                        self._sections[section][key] = value
                logger.info(f"[{section}] Settings loaded from {path}")
            except Exception as e:
                logger.error(f"Failed to load {SECTION_FILES[section]}: {e}")
        else:
            logger.warning(f"{SECTION_FILES[section]} not found at {path}; writing defaults.")
            self._save_section(section)

    # ── accessors ────────────────────────────────────────────────────────────
    def _build_merged(self) -> dict:
        merged = {}
        for section in SECTION_ORDER:
            merged.update({k: v for k, v in self._sections[section].items() if not k.startswith("_")})
        return merged

    def get(self, key: str, default=None):
        return self._merged.get(key, default)

    def section(self, name: str) -> dict:
        """Return a full section dict (general or omnivoice)."""
        return dict(self._sections.get(name, {}))

    def all_settings(self) -> dict:
        return dict(self._merged)

    @property
    def tts_service(self) -> str:
        return self.get("tts_service", "omnivoice")

    # ── saving / reset ───────────────────────────────────────────────────────
    def set(self, section: str, key: str, value):
        """Update a single key inside a section (persisted on the next save())."""
        if section in self._sections and not key.startswith("_"):
            self._sections[section][key] = value
            self._merged = self._build_merged()

    def _save_section(self, section: str):
        raw = dict(self._raw_defaults[section])
        for key, value in self._sections[section].items():
            if not key.startswith("_"):
                raw[key] = value
        os.makedirs(self.data_dir, exist_ok=True)
        with open(self._file_path(section), "w", encoding="utf-8") as f:
            json.dump(raw, f, indent=2, ensure_ascii=False)
        logger.info(f"[{section}] Settings saved to {self._file_path(section)}")

    def save(self):
        for section in SECTION_ORDER:
            self._save_section(section)
        logger.success("All settings saved.")

    def reset(self) -> dict:
        """Restore all section files to their defaults backup values."""
        for section in SECTION_ORDER:
            self._sections[section] = _filter_values(self._raw_defaults[section])
        self.save()
        logger.success("Settings reset to defaults.")
        return self.all_settings()