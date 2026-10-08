import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from loguru import logger

from logging_setup import setup_logging
from paths import BASE_PATH
from settings import Settings

HOST = "127.0.0.1"

# Directory the browser uses as its profile. Keeping it under data/ (rather
# than a temp dir) means Chromium remembers the window size between launches.
PROFILE_DIRNAME = "browser-profile"


def get_free_port(preferred: int) -> int:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind((HOST, preferred))
            return preferred
    except OSError:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def wait_for_server(host: str, port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.25)
    return False


# ── Browser discovery ──────────────────────────────────────────────────────────
# Ordered by preference. Chromium-based browsers get real app mode (no tabs,
# no address bar); Firefox has no equivalent and gets a plain window instead.
BROWSERS = [
    # (display name, is_chromium, Windows candidates, POSIX candidates)
    (
        "Microsoft Edge",
        True,
        [
            r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
            r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        ],
        ["microsoft-edge", "microsoft-edge-stable"],
    ),
    (
        "Google Chrome",
        True,
        [
            r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe",
        ],
        ["google-chrome-stable", "google-chrome", "chrome"],
    ),
    (
        "Chromium",
        True,
        [r"%LOCALAPPDATA%\Chromium\Application\chrome.exe"],
        ["chromium", "chromium-browser"],
    ),
    (
        "Brave",
        True,
        [
            r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%ProgramFiles(x86)%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe",
        ],
        ["brave-browser", "brave"],
    ),
    (
        "Firefox",
        False,
        [
            r"%ProgramFiles%\Mozilla Firefox\firefox.exe",
            r"%ProgramFiles(x86%)\Mozilla Firefox\firefox.exe",
        ],
        ["firefox"],
    ),
    (
        "LibreWolf",
        False,
        [r"%LOCALAPPDATA%\LibreWolf\librewolf.exe"],
        ["librewolf"],
    ),
]


def _expand_win_path(raw: str) -> str:
    return os.path.expandvars(os.path.expanduser(raw))


def find_browser():
    """Return ``(display_name, is_chromium, executable_path)`` or ``None``.

    Checks each browser's well-known install paths before falling back to PATH,
    because Chromium installs are not always on PATH on Windows.
    """
    if sys.platform == "win32":
        for name, is_chromium, win_paths, _posix in BROWSERS:
            for raw in win_paths:
                path = _expand_win_path(raw)
                if path and os.path.isfile(path):
                    return name, is_chromium, path
        for name, is_chromium, _, posix in BROWSERS:
            found = shutil.which(posix[0]) or shutil.which(posix[-1])
            if found:
                return name, is_chromium, found
    else:
        for name, is_chromium, _, posix in BROWSERS:
            for binary in posix:
                found = shutil.which(binary)
                if found:
                    return name, is_chromium, found
        # Common Linux locations that are not on PATH (snap/flatpak/manual).
        for name, is_chromium, _, posix in BROWSERS:
            for base in posix:
                for extra in (
                    f"/opt/{base}/bin/{base}",
                    f"/usr/lib/{base}/{base}",
                    f"/snap/bin/{base}",
                    f"/var/lib/flatpak/exports/bin/{base}",
                    f"/usr/bin/{base}",
                ):
                    if os.path.isfile(extra) and os.access(extra, os.X_OK):
                        return name, is_chromium, extra
    return None


def launch_browser(url: str, width: int, height: int, log=None):
    """Open ``url`` in the best available browser and return the Popen, or None.

    Falls back to the system default browser as a plain tab when none of the
    preferred browsers are installed.
    """
    log = log or logger
    found = find_browser()

    if found is None:
        import webbrowser

        log.warning("No supported browser found; opening the system default browser.")
        try:
            webbrowser.open(url, new=2)
        except Exception as exc:
            log.exception(f"Could not open a browser: {exc}")
            return None
        return None

    name, is_chromium, exe = found
    log.info(f"Opening {url} in {name} (app mode).")

    if is_chromium:
        profile = Path(BASE_PATH) / "data" / PROFILE_DIRNAME
        profile.mkdir(parents=True, exist_ok=True)
        # A dedicated --user-data-dir is required: without it, launching
        # Chromium while it is already running just opens a tab in the existing
        # instance and silently ignores --app.
        args = [
            exe,
            f"--app={url}",
            f"--user-data-dir={profile}",
            f"--window-size={width},{height}",
            # Suppress the first-run wizard a fresh profile would otherwise show.
            "--no-first-run",
            "--no-default-browser-check",
        ]
    else:
        # Firefox has no --app mode; a dedicated window is the closest equivalent.
        args = [exe, "--new-window", url]

    try:
        return subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        log.exception(f"Failed to launch {name}: {exc}")
        return None


def start_backend(host: str, port: int):
    import uvicorn
    from server import app

    try:
        config = uvicorn.Config(
            app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
            log_config=None,  # loguru owns all logging
        )
        uvicorn.Server(config).run()
        logger.info(f"Backend server stopped (http://{host}:{port}).")
    except Exception as e:
        logger.exception(f"Backend server failed (host={host}, port={port}): {e}")
        raise


def main():
    proc = None
    try:
        settings = Settings()
        setup_logging(
            level=settings.get("log_level", "INFO"),
            rotation=settings.get("log_rotation", "10 MB"),
            retention=settings.get("log_retention", "30 days"),
            file_enabled=settings.get("logs", True),
        )

        preferred_port = settings.get("port", 8078)
        port = get_free_port(int(preferred_port))
        if port != preferred_port:
            logger.warning(f"Port {preferred_port} busy; using {port} instead.")
        url = f"http://{HOST}:{port}"
        logger.info(f"Starting Voice Technitos backend at {url}")

        server_thread = threading.Thread(
            target=start_backend, args=(HOST, port), daemon=True, name="uvicorn-backend"
        )
        server_thread.start()

        if not wait_for_server(HOST, port):
            logger.error("Backend did not become reachable in time. Aborting.")
            return

        proc = launch_browser(
            url,
            int(settings.get("window_width", 900)),
            int(settings.get("window_height", 720)),
        )

        # There is no window object to block on any more, so hold the process
        # open until either the GUI posts /api/shutdown (which calls os._exit
        # itself) or the user closes the browser window.
        if proc is not None:
            logger.info("Waiting for the browser window to close...")
            while proc.poll() is None:
                time.sleep(0.5)
            logger.info("Browser closed; shutting down.")
            os._exit(0)
        else:
            # Default-browser fallback: nothing to watch, so just stay alive
            # and let /api/shutdown end the process.
            while True:
                time.sleep(1.0)
    except KeyboardInterrupt:
        logger.info("Interrupted; shutting down.")
    except Exception as e:
        logger.exception(f"Application failed to start: {e}")
        raise


if __name__ == "__main__":
    main()