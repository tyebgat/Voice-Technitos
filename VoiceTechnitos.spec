# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for Voice Technitos.

Build (run from the project root, i.e. the folder that contains
"Voice Technitos/"):

    pyinstaller --noconfirm VoiceTechnitos.spec

Produces a one-folder (onedir) build in dist/VoiceTechnitos/.

Why onedir and not onefile:
    torch + the CUDA 12.8 runtime is roughly 4 GB. A onefile build unpacks
    all of that into %TEMP% on *every* launch, which takes minutes before the
    window appears. Onedir keeps it as plain files next to the exe, which also
    matches paths.py: BASE_PATH is dirname(sys.executable), so data/ ends up
    beside the exe and the folder stays portable.

IMPORTANT: this must be built ON Windows. PyInstaller cannot cross-compile. Run
pyinstaller --noconfirm VoiceTechnitos.spec from a Windows Python, and the
output will land in dist/VoiceTechnitos/ (or the folder named by --distpath).
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
# SPECPATH is the directory containing this .spec file (the project root).
ROOT = Path(SPECPATH).resolve()
APP = ROOT / "Voice Technitos"

if not (APP / "MainGUI.py").is_file():
    raise SystemExit(f"Cannot find {APP / 'MainGUI.py'} - run PyInstaller from the project root.")

# Missing frontend files are the #1 cause of a blank window at runtime, so fail
# loudly here instead.
for required in ("icon.png", "gui/index.html", "gui/terminal.html"):
    if not (APP / required).exists():
        raise SystemExit(f"Missing required frontend file: {APP / required}")

# icon.ico is only consumed on Windows (it is baked into the exe as the
# application icon), so only insist on it there -- a Linux build does not need it.
if sys.platform == "win32" and not (APP / "icon.ico").is_file():
    raise SystemExit(
        f"Missing {APP / 'icon.ico'} -- the Windows exe would ship with PyInstaller's "
        "default icon. Generate it from icon.png (any Pillow/PNG-to-ICO tool will do)."
    )


# --------------------------------------------------------------------------
# Data files
# --------------------------------------------------------------------------
datas = [
    # Frontend. server.py builds GUI_DIR = RESOURCE_PATH/gui, and RESOURCE_PATH
    # is sys._MEIPASS for onefile / _internal for onedir. If gui/ is not bundled
    # the server serves nothing and the window comes up blank with no error.
    (str(APP / "gui"), "gui"),
    # The GUI is a browser window, so the browser owns the tab/taskbar icon;
    # icon.png is kept in the bundle anyway because it is the project's
    # canonical application image. The exe's own Windows icon is NOT this file:
    # EXE(icon=...) below points at icon.ico, which is baked into the resource
    # section and is never read at run time.
    (str(APP / "icon.png"), "."),
]

# Pocket TTS resolves its voice/language configs by path at runtime:
#   TTSHandler.py -> os.path.join(CONFIGS_DIR, f"{language}.yaml")
# so pocket_tts/config/*.yaml must exist as real files or every language other
# than the built-in default fails to load.
datas += collect_data_files("pocket_tts", subdir="config")
datas += collect_data_files("pocket_tts", subdir="static")


# --------------------------------------------------------------------------
# Hidden imports
# --------------------------------------------------------------------------
# No GUI backend modules: the app no longer embeds a browser. It launches the
# user's own browser in --app mode, so there is nothing dynamic to discover.
hiddenimports = [
    # Imported lazily inside functions by TTSHandler.
    "omnivoice",
    "omnivoice.models.omnivoice",
    "pocket_tts",
    "pocket_tts.models.tts_model",
    # transformers resolves model classes dynamically by repo name.
    "transformers.models",
    ]


# --------------------------------------------------------------------------
# Excludes
# --------------------------------------------------------------------------
excludes = [
    # gradio is only used by omnivoice's optional demo CLI
    # (omnivoice/cli/demo.py); nothing on the runtime path imports it.
    # Excluding it pulls a very large dependency tree out of the build.
    "gradio",
    "gradio_client",
    # Subpackages of omnivoice that this GUI never touches.
    "omnivoice.cli",
    "omnivoice.eval",
    "omnivoice.training",
    "omnivoice.scripts",
    # Training/eval-only dependencies of omnivoice.
    "tensorboardX",
    "webdataset",
    "jiwer",
    "funasr",
    "s3prl",
    # Dev / notebook tooling.
    "IPython",
    "jupyter",
    "notebook",
    "pytest",
    "matplotlib",
    "tkinter",
    "sphinx",
    "setuptools._distutils",
]

if sys.platform == "win32":
    # No GUI toolkit is imported any more, so keep the big WebView bindings out
    # of the bundle entirely.
    excludes += [
        "PyQt5",
        "PyQt5.QtCore",
        "PyQt5.QtGui",
        "PyQt5.QtWidgets",
        "PyQt5.QtWebEngineWidgets",
        "PyQt5.QtWebEngineCore",
        "PyQtWebEngine",
        "PyQtWebEngine.QtWebEngineWidgets",
        "qtpy",
        "gi",
        "webview",
    ]


# --------------------------------------------------------------------------
# Analysis
# --------------------------------------------------------------------------
a = Analysis(
    [str(APP / "MainGUI.py")],
    pathex=[str(APP)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

# On Windows a console window would be the only window this process owns, and it
# is redundant: the GUI already has a server console (the terminal button opens
# /terminal, which streams the log over SSE). So build windowed and keep no
# cmd.exe on screen. Console output is still available elsewhere -- loguru
# writes data/logs/app.log (logging_setup skips the stderr sink when there is
# no stderr) and /terminal streams it live.
#
# Kept as a console on other platforms so a Linux/macOS build still logs to the
# terminal it was started from; --windowed is ignored on *NIX anyway.
console = sys.platform != "win32"

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VoiceTechnitos",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX corrupts the CUDA DLLs; also pointless at this size
    console=console,
    # icon.ico carries 16/24/32/48/64/128/256 px entries, so Explorer, the
    # taskbar and a shortcut all get a sharp image. None elsewhere: passing a
    # path would make PyInstaller call Pillow to translate it, and Pillow is
    # not a declared dependency of this project.
    icon=str(APP / "icon.ico") if sys.platform == "win32" else None,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="VoiceTechnitos",
)