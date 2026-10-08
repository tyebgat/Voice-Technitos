import os
import sys

from loguru import logger

from paths import BASE_PATH


def setup_logging(
    level: str = "INFO",
    rotation: str = "10 MB",
    retention: str = "30 days",
    file_enabled: bool = True,
):
    """Configure loguru: colored console output + rotating file under data/logs."""
    try:
        logger.remove()

        LOG_FORMAT = (
            "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
            "<level>{level: <8}</level> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
            "<level>{message}</level>"
        )

        if sys.stderr is not None:
            logger.add(sys.stderr, format=LOG_FORMAT, level=level, colorize=True, enqueue=True)
        else:
            logger.add(lambda message: None, format="{message}", level=level, enqueue=True)

        if not file_enabled:
            logger.info("File logging disabled (settings: logs=false).")
            return

        log_dir = os.path.join(BASE_PATH, "data", "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "app.log")

        logger.add(
            log_path,
            format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} | {message}",
            level=level,
            rotation=rotation,
            retention=retention,
            compression="zip",
            encoding="utf-8",
            enqueue=True,
        )

        logger.info(f"Logging initialized. Log file: {log_path}")
    except Exception as e:
        try:
            logger.exception(f"Failed to configure logging: {e}")
        except Exception:
            # Last resort. In a windowed (console=False) build sys.stdout and
            # sys.stderr are both None, so printing would raise and mask the
            # real failure.
            stream = sys.stderr or sys.stdout
            if stream is not None:
                try:
                    stream.write(f"FATAL: failed to configure logging: {e}\n")
                except Exception:
                    pass
        raise