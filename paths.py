import os
import sys


def get_base_path():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE_PATH = get_base_path()


def get_resource_path():
    """Where bundled read-only resources (gui/) live.

    PyInstaller onedir keeps them in the ``_internal`` directory (sys._MEIPASS);
    the writable data folder stays next to the executable via BASE_PATH.
    """
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        return meipass
    return BASE_PATH


RESOURCE_PATH = get_resource_path()