import os
import socket
import tempfile
import threading
import time

from loguru import logger

from logging_setup import setup_logging
from settings import Settings

HOST = "127.0.0.1"


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


APP_DIR = os.path.dirname(os.path.abspath(__file__))


def build_window_icon() -> str:
    """Convert icon.png to an .ico WinForms can load; returns the ico path ('' on failure)."""
    source = os.path.join(APP_DIR, "icon.png")
    if not os.path.isfile(source):
        return ""
    try:
        from PIL import Image

        target = os.path.join(tempfile.gettempdir(), "voice-technitos-icon.ico")
        with Image.open(source) as img:
            img.save(target, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
        return target
    except Exception as exc:
        logger.warning(f"Could not build window icon from {source}: {exc}")
        return ""


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


class Bridge:
    """JS bridge exposed to the GUI (via pywebview js_api)."""

    port = None  # injected at startup so the bridge knows the server URL

    def close_application(self):
        import webview

        try:
            if webview.windows:
                webview.windows[0].destroy()
                logger.info("Application window closed from the GUI.")
        except Exception as exc:
            logger.error(f"Failed to close the window: {exc}")

    def open_external(self, url: str):
        import webbrowser

        try:
            webbrowser.open(url, new=2)
        except Exception as exc:
            logger.error(f"Failed to open {url}: {exc}")

    def open_terminal_window(self):
        import threading

        import webview

        def _create():
            try:
                win = getattr(self, "_terminal_window", None)
                if win is not None and not win.events.closed.is_set():
                    try:
                        win.restore()
                        win.focus()
                    except Exception:
                        pass
                    return
                url = f"http://{HOST}:{getattr(self, 'port', 8078)}/terminal"
                win = webview.create_window(
                    "Voice Technitos - Terminal",
                    url=url,
                    width=780,
                    height=560,
                    min_size=(480, 320),
                )
                win.events.closed += lambda: setattr(self, "_terminal_window", None)
                self._terminal_window = win
                logger.info(f"Opened terminal window ({url}).")
            except Exception as exc:
                logger.error(f"Failed to open the terminal window: {exc}")

        threading.Thread(target=_create, name="terminal-window", daemon=True).start()


def main():
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
        logger.info(f"Starting Voice Technitos backend at http://{HOST}:{port}")

        server_thread = threading.Thread(
            target=start_backend, args=(HOST, port), daemon=True, name="uvicorn-backend"
        )
        server_thread.start()

        if not wait_for_server(HOST, port):
            logger.error("Backend did not become reachable in time. Aborting.")
            return

        import webview

        logger.info("Opening desktop window (pywebview)...")
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        bridge = Bridge()
        bridge.port = port
        webview.create_window(
            "Voice Technitos",
            url=f"http://{HOST}:{port}",
            width=int(settings.get("window_width", 900)),
            height=int(settings.get("window_height", 720)),
            min_size=(640, 480),
            js_api=bridge,
        )
        webview.start(gui="edgechromium", icon=build_window_icon() or None)

        logger.info("Window closed; shutting down.")
    except Exception as e:
        logger.exception(f"Application failed to start: {e}")
        raise


if __name__ == "__main__":
    main()