#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import binascii
import copy
import ctypes
import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from ctypes import wintypes


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
wtsapi32 = ctypes.WinDLL("wtsapi32", use_last_error=True)

UINT16 = ctypes.c_uint16
UINT32 = ctypes.c_uint32
UINT64 = ctypes.c_uint64
INT32 = ctypes.c_int32
SHORT = ctypes.c_short
LONG = ctypes.c_long
BOOL = wintypes.BOOL
WCHAR = ctypes.c_wchar

QDC_ALL_PATHS = 0x00000001
QDC_ONLY_ACTIVE_PATHS = 0x00000002
QDC_DATABASE_CURRENT = 0x00000004
QDC_VIRTUAL_MODE_AWARE = 0x00000010
QDC_VIRTUAL_REFRESH_RATE_AWARE = 0x00000040

SDC_TOPOLOGY_SUPPLIED = 0x00000010
SDC_USE_SUPPLIED_DISPLAY_CONFIG = 0x00000020
SDC_VALIDATE = 0x00000040
SDC_APPLY = 0x00000080
SDC_NO_OPTIMIZATION = 0x00000100
SDC_SAVE_TO_DATABASE = 0x00000200
SDC_ALLOW_CHANGES = 0x00000400
SDC_ALLOW_PATH_ORDER_CHANGES = 0x00002000
SDC_VIRTUAL_MODE_AWARE = 0x00008000
SDC_VIRTUAL_REFRESH_RATE_AWARE = 0x00020000
SDC_USE_DATABASE_CURRENT = 0x0000000F

CDS_UPDATEREGISTRY = 0x00000001
CDS_TEST = 0x00000002
CDS_SET_PRIMARY = 0x00000010
CDS_NORESET = 0x10000000

DISP_CHANGE_SUCCESSFUL = 0
DISP_CHANGE_RESTART = 1

DM_POSITION = 0x00000020
DM_PELSWIDTH = 0x00080000
DM_PELSHEIGHT = 0x00100000

ENUM_CURRENT_SETTINGS = 0xFFFFFFFF

DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x00000001
DISPLAY_DEVICE_PRIMARY_DEVICE = 0x00000004
DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST = 15

DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME = 1
DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME = 2

DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE = 1
DISPLAYCONFIG_MODE_INFO_TYPE_TARGET = 2
DISPLAYCONFIG_MODE_INFO_TYPE_DESKTOP_IMAGE = 3

DISPLAYCONFIG_PATH_ACTIVE = 0x00000001
DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE = 0x00000008
DISPLAYCONFIG_PATH_MODE_IDX_INVALID = 0xFFFFFFFF
DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID = 0xFFFF
DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID = 0xFFFF
DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID = 0xFFFF
DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID = 0xFFFF

ERROR_SUCCESS = 0
ERROR_INSUFFICIENT_BUFFER = 122
ERROR_ALREADY_EXISTS = 183

WM_HOTKEY = 0x0312
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
WM_DESTROY = 0x0002
WM_POWERBROADCAST = 0x0218
WM_WTSSESSION_CHANGE = 0x02B1
PBT_APMRESUMEAUTOMATIC = 0x0012
WTS_SESSION_LOCK = 0x7
WTS_SESSION_UNLOCK = 0x8
NOTIFY_FOR_THIS_SESSION = 0
MOD_SHIFT = 0x0004
MOD_CONTROL = 0x0002
VK_F2 = 0x71
VK_CONTROL = 0x11
VK_SHIFT = 0x10
HOTKEY_ID = 1
CCHDEVICENAME = 32
CCHFORMNAME = 32
CCHDEVICESTRING = 128
# No hardcoded monitor. The launcher prompts for which monitor to toggle to and
# always passes it via --target-display; this empty default is only a safety net.
DEFAULT_TARGET_DISPLAY = ""

WH_KEYBOARD_LL = 13
HC_ACTION = 0
GW_OWNER = 4


class LUID(ctypes.Structure):
    _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]


class POINTL(ctypes.Structure):
    _fields_ = [("x", LONG), ("y", LONG)]


class RECTL(ctypes.Structure):
    _fields_ = [("left", LONG), ("top", LONG), ("right", LONG), ("bottom", LONG)]


class DISPLAYCONFIG_RATIONAL(ctypes.Structure):
    _fields_ = [("Numerator", UINT32), ("Denominator", UINT32)]


class DISPLAYCONFIG_2DREGION(ctypes.Structure):
    _fields_ = [("cx", UINT32), ("cy", UINT32)]


class DISPLAYCONFIG_VIDEO_SIGNAL_INFO_ADDITIONAL(ctypes.Structure):
    _fields_ = [("videoStandard", UINT32, 16), ("vSyncFreqDivider", UINT32, 6), ("reserved", UINT32, 10)]


class DISPLAYCONFIG_VIDEO_SIGNAL_INFO_UNION(ctypes.Union):
    _fields_ = [("AdditionalSignalInfo", DISPLAYCONFIG_VIDEO_SIGNAL_INFO_ADDITIONAL), ("videoStandard", UINT32)]


class DISPLAYCONFIG_VIDEO_SIGNAL_INFO(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [
        ("pixelRate", UINT64),
        ("hSyncFreq", DISPLAYCONFIG_RATIONAL),
        ("vSyncFreq", DISPLAYCONFIG_RATIONAL),
        ("activeSize", DISPLAYCONFIG_2DREGION),
        ("totalSize", DISPLAYCONFIG_2DREGION),
        ("u", DISPLAYCONFIG_VIDEO_SIGNAL_INFO_UNION),
        ("scanLineOrdering", INT32),
    ]


class DISPLAYCONFIG_TARGET_MODE(ctypes.Structure):
    _fields_ = [("targetVideoSignalInfo", DISPLAYCONFIG_VIDEO_SIGNAL_INFO)]


class DISPLAYCONFIG_SOURCE_MODE(ctypes.Structure):
    _fields_ = [("width", UINT32), ("height", UINT32), ("pixelFormat", UINT32), ("position", POINTL)]


class DISPLAYCONFIG_DESKTOP_IMAGE_INFO(ctypes.Structure):
    _fields_ = [("PathSourceSize", POINTL), ("DesktopImageRegion", RECTL), ("DesktopImageClip", RECTL)]


class DISPLAYCONFIG_MODE_INFO_UNION(ctypes.Union):
    _fields_ = [
        ("targetMode", DISPLAYCONFIG_TARGET_MODE),
        ("sourceMode", DISPLAYCONFIG_SOURCE_MODE),
        ("desktopImageInfo", DISPLAYCONFIG_DESKTOP_IMAGE_INFO),
    ]


class DISPLAYCONFIG_MODE_INFO(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("infoType", UINT32), ("id", UINT32), ("adapterId", LUID), ("u", DISPLAYCONFIG_MODE_INFO_UNION)]


class DISPLAYCONFIG_PATH_SOURCE_INFO_STRUCT(ctypes.Structure):
    _fields_ = [("cloneGroupId", UINT32, 16), ("sourceModeInfoIdx", UINT32, 16)]


class DISPLAYCONFIG_PATH_SOURCE_INFO_UNION(ctypes.Union):
    _anonymous_ = ("details",)
    _fields_ = [("modeInfoIdx", UINT32), ("details", DISPLAYCONFIG_PATH_SOURCE_INFO_STRUCT)]


class DISPLAYCONFIG_PATH_SOURCE_INFO(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("adapterId", LUID), ("id", UINT32), ("u", DISPLAYCONFIG_PATH_SOURCE_INFO_UNION), ("statusFlags", UINT32)]


class DISPLAYCONFIG_PATH_TARGET_INFO_STRUCT(ctypes.Structure):
    _fields_ = [("desktopModeInfoIdx", UINT32, 16), ("targetModeInfoIdx", UINT32, 16)]


class DISPLAYCONFIG_PATH_TARGET_INFO_UNION(ctypes.Union):
    _anonymous_ = ("details",)
    _fields_ = [("modeInfoIdx", UINT32), ("details", DISPLAYCONFIG_PATH_TARGET_INFO_STRUCT)]


class DISPLAYCONFIG_PATH_TARGET_INFO(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [
        ("adapterId", LUID),
        ("id", UINT32),
        ("u", DISPLAYCONFIG_PATH_TARGET_INFO_UNION),
        ("outputTechnology", UINT32),
        ("rotation", UINT32),
        ("scaling", UINT32),
        ("refreshRate", DISPLAYCONFIG_RATIONAL),
        ("scanLineOrdering", UINT32),
        ("targetAvailable", BOOL),
        ("statusFlags", UINT32),
    ]


class DISPLAYCONFIG_PATH_INFO(ctypes.Structure):
    _fields_ = [("sourceInfo", DISPLAYCONFIG_PATH_SOURCE_INFO), ("targetInfo", DISPLAYCONFIG_PATH_TARGET_INFO), ("flags", UINT32)]


class DISPLAYCONFIG_DEVICE_INFO_HEADER(ctypes.Structure):
    _fields_ = [("type", UINT32), ("size", UINT32), ("adapterId", LUID), ("id", UINT32)]


class DISPLAYCONFIG_SOURCE_DEVICE_NAME(ctypes.Structure):
    _fields_ = [("header", DISPLAYCONFIG_DEVICE_INFO_HEADER), ("viewGdiDeviceName", WCHAR * CCHDEVICENAME)]


class DISPLAYCONFIG_TARGET_DEVICE_NAME_FLAGS(ctypes.Structure):
    _fields_ = [("value", UINT32)]


class DISPLAYCONFIG_TARGET_DEVICE_NAME(ctypes.Structure):
    _fields_ = [
        ("header", DISPLAYCONFIG_DEVICE_INFO_HEADER),
        ("flags", DISPLAYCONFIG_TARGET_DEVICE_NAME_FLAGS),
        ("outputTechnology", UINT32),
        ("edidManufactureId", UINT16),
        ("edidProductCodeId", UINT16),
        ("connectorInstance", UINT32),
        ("monitorFriendlyDeviceName", WCHAR * 64),
        ("monitorDevicePath", WCHAR * 128),
    ]


class DISPLAY_DEVICEW(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("DeviceName", WCHAR * CCHDEVICENAME),
        ("DeviceString", WCHAR * CCHDEVICESTRING),
        ("StateFlags", wintypes.DWORD),
        ("DeviceID", WCHAR * 128),
        ("DeviceKey", WCHAR * 128),
    ]


class DUMMYSTRUCTNAME(ctypes.Structure):
    _fields_ = [
        ("dmOrientation", SHORT),
        ("dmPaperSize", SHORT),
        ("dmPaperLength", SHORT),
        ("dmPaperWidth", SHORT),
        ("dmScale", SHORT),
        ("dmCopies", SHORT),
        ("dmDefaultSource", SHORT),
        ("dmPrintQuality", SHORT),
    ]


class DUMMYSTRUCTNAME2(ctypes.Structure):
    _fields_ = [
        ("dmPosition", POINTL),
        ("dmDisplayOrientation", wintypes.DWORD),
        ("dmDisplayFixedOutput", wintypes.DWORD),
    ]


class DUMMYUNIONNAME(ctypes.Union):
    _fields_ = [("printer", DUMMYSTRUCTNAME), ("display", DUMMYSTRUCTNAME2)]


class DUMMYUNIONNAME2(ctypes.Union):
    _fields_ = [("dmDisplayFlags", wintypes.DWORD), ("dmNup", wintypes.DWORD)]


class DEVMODEW(ctypes.Structure):
    _anonymous_ = ("u1", "u2")
    _fields_ = [
        ("dmDeviceName", WCHAR * CCHDEVICENAME),
        ("dmSpecVersion", wintypes.WORD),
        ("dmDriverVersion", wintypes.WORD),
        ("dmSize", wintypes.WORD),
        ("dmDriverExtra", wintypes.WORD),
        ("dmFields", wintypes.DWORD),
        ("u1", DUMMYUNIONNAME),
        ("dmColor", SHORT),
        ("dmDuplex", SHORT),
        ("dmYResolution", SHORT),
        ("dmTTOption", SHORT),
        ("dmCollate", SHORT),
        ("dmFormName", WCHAR * CCHFORMNAME),
        ("dmLogPixels", wintypes.WORD),
        ("dmBitsPerPel", wintypes.DWORD),
        ("dmPelsWidth", wintypes.DWORD),
        ("dmPelsHeight", wintypes.DWORD),
        ("u2", DUMMYUNIONNAME2),
        ("dmDisplayFrequency", wintypes.DWORD),
        ("dmICMMethod", wintypes.DWORD),
        ("dmICMIntent", wintypes.DWORD),
        ("dmMediaType", wintypes.DWORD),
        ("dmDitherType", wintypes.DWORD),
        ("dmReserved1", wintypes.DWORD),
        ("dmReserved2", wintypes.DWORD),
        ("dmPanningWidth", wintypes.DWORD),
        ("dmPanningHeight", wintypes.DWORD),
    ]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_void_p),
    ]


LRESULT = ctypes.c_ssize_t
WindowProc = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, UINT32, wintypes.WPARAM, wintypes.LPARAM)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [
        ("style", UINT32),
        ("lpfnWndProc", WindowProc),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HANDLE),
        ("hIcon", wintypes.HANDLE),
        ("hCursor", wintypes.HANDLE),
        ("hbrBackground", wintypes.HANDLE),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
    ]


user32.GetDisplayConfigBufferSizes.argtypes = [UINT32, ctypes.POINTER(UINT32), ctypes.POINTER(UINT32)]
user32.GetDisplayConfigBufferSizes.restype = LONG
user32.QueryDisplayConfig.argtypes = [
    UINT32,
    ctypes.POINTER(UINT32),
    ctypes.POINTER(DISPLAYCONFIG_PATH_INFO),
    ctypes.POINTER(UINT32),
    ctypes.POINTER(DISPLAYCONFIG_MODE_INFO),
    ctypes.c_void_p,
]
user32.QueryDisplayConfig.restype = LONG
user32.SetDisplayConfig.argtypes = [
    UINT32,
    ctypes.POINTER(DISPLAYCONFIG_PATH_INFO),
    UINT32,
    ctypes.POINTER(DISPLAYCONFIG_MODE_INFO),
    UINT32,
]
user32.SetDisplayConfig.restype = LONG
user32.DisplayConfigGetDeviceInfo.argtypes = [ctypes.POINTER(DISPLAYCONFIG_DEVICE_INFO_HEADER)]
user32.DisplayConfigGetDeviceInfo.restype = LONG
user32.RegisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int, UINT32, UINT32]
user32.RegisterHotKey.restype = BOOL
user32.UnregisterHotKey.argtypes = [wintypes.HWND, ctypes.c_int]
user32.UnregisterHotKey.restype = BOOL
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, UINT32, UINT32]
user32.GetMessageW.restype = BOOL
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.TranslateMessage.restype = BOOL
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = wintypes.LPARAM
user32.EnumDisplayDevicesW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(DISPLAY_DEVICEW), wintypes.DWORD]
user32.EnumDisplayDevicesW.restype = BOOL
user32.EnumDisplaySettingsExW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(DEVMODEW), wintypes.DWORD]
user32.EnumDisplaySettingsExW.restype = BOOL
user32.ChangeDisplaySettingsExW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(DEVMODEW), wintypes.HWND, wintypes.DWORD, ctypes.c_void_p]
user32.ChangeDisplaySettingsExW.restype = LONG
user32.EnumWindows.argtypes = [ctypes.c_void_p, wintypes.LPARAM]
user32.EnumWindows.restype = BOOL
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = BOOL
user32.IsIconic.argtypes = [wintypes.HWND]
user32.IsIconic.restype = BOOL
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECTL)]
user32.GetWindowRect.restype = BOOL
user32.GetWindow.argtypes = [wintypes.HWND, ctypes.c_uint]
user32.GetWindow.restype = wintypes.HWND
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.restype = ctypes.c_int
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.MoveWindow.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, BOOL]
user32.MoveWindow.restype = BOOL
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HANDLE
user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = wintypes.LPARAM
user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
user32.UnhookWindowsHookEx.restype = BOOL
user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
user32.GetAsyncKeyState.restype = ctypes.c_short
kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, BOOL, wintypes.LPCWSTR]
kernel32.CreateMutexW.restype = wintypes.HANDLE
kernel32.ReleaseMutex.argtypes = [wintypes.HANDLE]
kernel32.ReleaseMutex.restype = BOOL
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = BOOL
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HANDLE
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wintypes.ATOM
user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE]
user32.UnregisterClassW.restype = BOOL
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.DWORD,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.HWND,
    wintypes.HANDLE,
    wintypes.HANDLE,
    ctypes.c_void_p,
]
user32.CreateWindowExW.restype = wintypes.HWND
user32.DefWindowProcW.argtypes = [wintypes.HWND, UINT32, wintypes.WPARAM, wintypes.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.DestroyWindow.argtypes = [wintypes.HWND]
user32.DestroyWindow.restype = BOOL
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.PostQuitMessage.restype = None
wtsapi32.WTSRegisterSessionNotification.argtypes = [wintypes.HWND, wintypes.DWORD]
wtsapi32.WTSRegisterSessionNotification.restype = BOOL
wtsapi32.WTSUnRegisterSessionNotification.argtypes = [wintypes.HWND]
wtsapi32.WTSUnRegisterSessionNotification.restype = BOOL


class DisplayConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rect:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return max(0, self.right - self.left)

    @property
    def height(self) -> int:
        return max(0, self.bottom - self.top)

    @property
    def center(self) -> tuple[int, int]:
        return (self.left + self.width // 2, self.top + self.height // 2)

    def intersects(self, other: "Rect") -> bool:
        return self.left < other.right and self.right > other.left and self.top < other.bottom and self.bottom > other.top

    def contains_point(self, x: int, y: int) -> bool:
        return self.left <= x < self.right and self.top <= y < self.bottom


@dataclass(frozen=True)
class TopLevelWindow:
    hwnd: int
    rect: Rect
    class_name: str
    title: str


class SingleInstance:
    def __init__(self, name: str) -> None:
        self.name = name
        self.handle = None
        self.owns_mutex = False

    def acquire(self) -> bool:
        ctypes.set_last_error(ERROR_SUCCESS)
        self.handle = kernel32.CreateMutexW(None, True, self.name)
        if not self.handle:
            raise_win32(ctypes.get_last_error(), "CreateMutexW")
        if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
            kernel32.CloseHandle(self.handle)
            self.handle = None
            return False
        self.owns_mutex = True
        return True

    def release(self) -> None:
        if self.handle:
            if self.owns_mutex:
                kernel32.ReleaseMutex(self.handle)
            kernel32.CloseHandle(self.handle)
            self.handle = None
            self.owns_mutex = False


LowLevelKeyboardProc = ctypes.WINFUNCTYPE(wintypes.LPARAM, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
EnumWindowsProc = ctypes.WINFUNCTYPE(BOOL, wintypes.HWND, wintypes.LPARAM)

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
ACTIVE_PROFILE_FILENAME = "active_profile.txt"
PROFILE_METADATA_FILENAME = "profile.json"
BUTTON_STATE_FILENAME = "toggle-monitors-state.json"
ACTIVE_OWNER_FILENAME = "active-owner.json"
TARGET_TOKEN_PREFIX = "tm1."
BUTTON_CONFIG_SCHEMA = 3
PICKER_FILENAME = "Toggle Monitors Picker.ps1"
CONFIGURATION_CANCELLED_EXIT_CODE = 3
GLOBAL_TOPOLOGY_MUTEX = "Local\\ToggleMonitorsTopologyMutation"
STARTUP_SAFETY_MUTEX = "Local\\ToggleMonitorsStartupSafetyGuardian"


def raise_win32(code: int, context: str) -> None:
    raise DisplayConfigError(f"{context} failed with {code}: {ctypes.FormatError(code)}")


def awareness_query_flags(base_flag: int) -> int:
    return base_flag


def awareness_set_flags(base_flag: int) -> int:
    return base_flag


def config_root() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "ToggleMonitors"
    legacy = root.parent / "DummyMonitorToggle"
    if legacy.exists() and not root.exists():
        try:
            legacy.rename(root)
        except OSError:
            root.mkdir(parents=True, exist_ok=True)
    else:
        root.mkdir(parents=True, exist_ok=True)
    return root


def profiles_root() -> Path:
    root = config_root() / "profiles"
    root.mkdir(parents=True, exist_ok=True)
    return root


def active_profile_file() -> Path:
    return config_root() / ACTIVE_PROFILE_FILENAME


def snapshot_bundle_paths(base_dir: Path, stem_prefix: str) -> dict[str, Path]:
    return {
        "normal": base_dir / f"{stem_prefix}.json",
        "no_wireless": base_dir / f"{stem_prefix}_no_wireless.json",
        "no_target": base_dir / f"{stem_prefix}_no_target.json",
        "no_target_no_wireless": base_dir / f"{stem_prefix}_no_target_no_wireless.json",
    }


def normalize_layout_name(layout_name: str) -> str:
    return " ".join(layout_name.split()).strip()


def layout_name_to_slug(layout_name: str) -> str:
    cleaned = normalize_layout_name(layout_name)
    slug = []
    previous_dash = False
    for char in cleaned.lower():
        if char.isalnum():
            slug.append(char)
            previous_dash = False
            continue
        if not previous_dash:
            slug.append("-")
            previous_dash = True
    normalized = "".join(slug).strip("-")
    return normalized[:80] or f"layout-{int(time.time())}"


def profile_dir_from_slug(slug: str) -> Path:
    path = profiles_root() / slug
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_active_profile_slug() -> Optional[str]:
    path = active_profile_file()
    if not path.exists():
        return None
    value = path.read_text(encoding="utf-8").strip()
    return value or None


def write_active_profile_slug(slug: str) -> None:
    active_profile_file().write_text(slug, encoding="utf-8")


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("toggle-monitors")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(config_root() / "toggle_monitors.log", encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    if sys.stdout and sys.stdout.isatty():
        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

    return logger


@dataclass
class DisplayConfigSnapshot:
    path_count: int
    mode_count: int
    path_blob: bytes
    mode_blob: bytes

    @classmethod
    def from_arrays(cls, path_array, mode_array, path_count: int, mode_count: int) -> "DisplayConfigSnapshot":
        if path_count < 0 or mode_count < 0:
            raise DisplayConfigError("Display snapshot counts cannot be negative.")
        path_blob_size = path_count * ctypes.sizeof(DISPLAYCONFIG_PATH_INFO)
        mode_blob_size = mode_count * ctypes.sizeof(DISPLAYCONFIG_MODE_INFO)
        path_blob = ctypes.string_at(ctypes.addressof(path_array), path_blob_size)
        mode_blob = ctypes.string_at(ctypes.addressof(mode_array), mode_blob_size)
        return cls(path_count=path_count, mode_count=mode_count, path_blob=path_blob, mode_blob=mode_blob)

    def validate(self) -> None:
        expected_path_bytes = self.path_count * ctypes.sizeof(DISPLAYCONFIG_PATH_INFO)
        expected_mode_bytes = self.mode_count * ctypes.sizeof(DISPLAYCONFIG_MODE_INFO)
        if self.path_count < 0 or self.mode_count < 0:
            raise DisplayConfigError("Display snapshot counts cannot be negative.")
        if len(self.path_blob) != expected_path_bytes:
            raise DisplayConfigError(
                f"Display snapshot path blob has {len(self.path_blob)} bytes; expected {expected_path_bytes}."
            )
        if len(self.mode_blob) != expected_mode_bytes:
            raise DisplayConfigError(
                f"Display snapshot mode blob has {len(self.mode_blob)} bytes; expected {expected_mode_bytes}."
            )

    def path_array(self):
        self.validate()
        array_type = DISPLAYCONFIG_PATH_INFO * max(self.path_count, 1)
        array = array_type()
        if self.path_count:
            ctypes.memmove(ctypes.addressof(array), self.path_blob, len(self.path_blob))
        return array

    def mode_array(self):
        self.validate()
        array_type = DISPLAYCONFIG_MODE_INFO * max(self.mode_count, 1)
        array = array_type()
        if self.mode_count:
            ctypes.memmove(ctypes.addressof(array), self.mode_blob, len(self.mode_blob))
        return array

    def to_json(self) -> str:
        self.validate()
        return json.dumps(
            {
                "path_count": self.path_count,
                "mode_count": self.mode_count,
                "path_blob_b64": base64.b64encode(self.path_blob).decode("ascii"),
                "mode_blob_b64": base64.b64encode(self.mode_blob).decode("ascii"),
            },
            indent=2,
        )

    @classmethod
    def from_json(cls, payload: str) -> "DisplayConfigSnapshot":
        data = json.loads(payload)
        snapshot = cls(
            path_count=int(data["path_count"]),
            mode_count=int(data["mode_count"]),
            path_blob=base64.b64decode(data["path_blob_b64"]),
            mode_blob=base64.b64decode(data["mode_blob_b64"]),
        )
        snapshot.validate()
        return snapshot


@dataclass
class GdiDisplayDevice:
    name: str
    description: str
    state_flags: int
    devmode: DEVMODEW


@dataclass(frozen=True)
class TargetDescriptor:
    """A monitor identity that survives GDI source-name reassignment.

    ``monitorDevicePath`` is the durable identity when Windows exposes it.  The
    adapter/target tuple, friendly name, and source name are retained only as
    progressively weaker fallbacks for drivers that omit that path.
    """

    device_path: str = ""
    adapter_high: int = 0
    adapter_low: int = 0
    target_id: int = -1
    friendly: str = ""
    source: str = ""

    def identity_key(self) -> str:
        if self.device_path.strip():
            return f"path:{self.device_path.strip().casefold()}"
        if self.target_id >= 0:
            return f"target:{self.adapter_high}:{self.adapter_low}:{self.target_id}"
        if self.source.strip():
            return f"source:{self.source.strip().casefold()}"
        if self.friendly.strip():
            return f"friendly:{self.friendly.strip().casefold()}"
        raise DisplayConfigError("Monitor descriptor has no usable identity.")

    def payload(self) -> dict[str, object]:
        return {
            "v": 1,
            "p": self.device_path.strip(),
            "ah": int(self.adapter_high),
            "al": int(self.adapter_low),
            "t": int(self.target_id),
            "f": self.friendly.strip(),
            "s": self.source.strip(),
        }


@dataclass(frozen=True)
class MonitorChoice:
    label: str
    token: str
    descriptor: TargetDescriptor
    active: bool
    main: bool


def encode_target_descriptor(descriptor: TargetDescriptor) -> str:
    descriptor.identity_key()
    payload = json.dumps(descriptor.payload(), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return TARGET_TOKEN_PREFIX + encoded


def decode_target_descriptor(token: str) -> TargetDescriptor:
    value = token.strip()
    if not value.startswith(TARGET_TOKEN_PREFIX):
        raise DisplayConfigError("Monitor selector is not a Toggle Monitors target token.")
    encoded = value[len(TARGET_TOKEN_PREFIX) :]
    if not encoded:
        raise DisplayConfigError("Monitor target token is empty.")
    try:
        padding = "=" * (-len(encoded) % 4)
        data = json.loads(base64.urlsafe_b64decode(encoded + padding).decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("target descriptor payload must be an object")
        if int(data.get("v", 0)) != 1:
            raise ValueError("unsupported token version")
        descriptor = TargetDescriptor(
            device_path=str(data.get("p", "")),
            adapter_high=int(data.get("ah", 0)),
            adapter_low=int(data.get("al", 0)),
            target_id=int(data.get("t", -1)),
            friendly=str(data.get("f", "")),
            source=str(data.get("s", "")),
        )
        descriptor.identity_key()
        return descriptor
    except (AttributeError, binascii.Error, KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DisplayConfigError(f"Invalid monitor target token: {error}") from error


def read_button_config(path: Path) -> dict[str, str]:
    if not path.exists():
        raise DisplayConfigError(f"Button monitor configuration was not found: {path}")
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip().upper()] = value.strip()
    return values


def selectors_from_button_config(path: Path) -> list[str]:
    values = read_button_config(path)
    target_value = values.get("TARGETS", "")
    if target_value:
        selectors = [item.strip() for item in target_value.split(",") if item.strip()]
    else:
        legacy = values.get("DISPLAY", "").strip()
        selectors = [legacy] if legacy else []
    if not selectors:
        raise DisplayConfigError("Choose at least one monitor for this Toggle Monitors Button.")
    return selectors


def split_selector_value(value: str) -> list[str]:
    selectors: list[str] = []
    seen: set[str] = set()
    for item in value.split(","):
        selector = item.strip()
        if not selector or selector in seen:
            continue
        selectors.append(selector)
        seen.add(selector)
    return selectors


def validate_selector_groups(
    group_1: Iterable[str],
    group_2: Iterable[str],
    allowed_tokens: Optional[set[str]] = None,
) -> tuple[list[str], list[str]]:
    first = split_selector_value(",".join(map(str, group_1)))
    second = split_selector_value(",".join(map(str, group_2)))
    if not first or not second:
        raise DisplayConfigError("Choose at least one monitor in both Group 1 and Group 2.")
    if set(first) == set(second):
        raise DisplayConfigError("Group 1 and Group 2 must be different monitor combinations.")
    for selector in [*first, *second]:
        if not selector.startswith(TARGET_TOKEN_PREFIX):
            raise DisplayConfigError("Monitor groups must contain opaque Toggle Monitors target tokens.")
        decode_target_descriptor(selector)
        if allowed_tokens is not None and selector not in allowed_tokens:
            raise DisplayConfigError("The picker returned a monitor that is not in its current monitor list.")
    return first, second


def selector_groups_from_button_config(path: Path) -> tuple[list[str], list[str]]:
    values = read_button_config(path)
    if values.get("SCHEMA", "") != str(BUTTON_CONFIG_SCHEMA):
        raise DisplayConfigError("This Toggle Monitors Button needs its two monitor groups configured.")
    return validate_selector_groups(
        split_selector_value(values.get("GROUP_1", "")),
        split_selector_value(values.get("GROUP_2", "")),
    )


def write_button_group_config(
    path: Path,
    pythonw_path: str,
    group_1: Iterable[str],
    group_2: Iterable[str],
) -> None:
    first, second = validate_selector_groups(group_1, group_2)
    normalized_python = str(pythonw_path).strip().replace("\r", "").replace("\n", "")
    if not normalized_python:
        raise DisplayConfigError("Toggle Monitors could not preserve its Python launcher path.")
    content = (
        "# Toggle Monitors - this Button owner's saved monitor groups.\n"
        "# Each GROUP value contains opaque monitor identities supplied by the owned Python engine.\n"
        f"SCHEMA={BUTTON_CONFIG_SCHEMA}\n"
        f"PYTHONW={normalized_python}\n"
        f"GROUP_1={','.join(first)}\n"
        f"GROUP_2={','.join(second)}\n"
    )
    write_text_atomic(path, content)


def get_display_config_buffers(base_flag: int) -> tuple[int, int]:
    path_count = UINT32()
    mode_count = UINT32()
    result = user32.GetDisplayConfigBufferSizes(base_flag, ctypes.byref(path_count), ctypes.byref(mode_count))
    if result != ERROR_SUCCESS:
        raise_win32(result, "GetDisplayConfigBufferSizes")
    return path_count.value, mode_count.value


def query_display_config(flags: int):
    base_flag = flags & (QDC_ALL_PATHS | QDC_ONLY_ACTIVE_PATHS | QDC_DATABASE_CURRENT)
    while True:
        path_count, mode_count = get_display_config_buffers(base_flag)
        path_array_type = DISPLAYCONFIG_PATH_INFO * max(path_count, 1)
        mode_array_type = DISPLAYCONFIG_MODE_INFO * max(mode_count, 1)
        path_array = path_array_type()
        mode_array = mode_array_type()
        path_count_u = UINT32(path_count)
        mode_count_u = UINT32(mode_count)
        topology_id = UINT32()
        topology_id_pointer = ctypes.byref(topology_id) if base_flag == QDC_DATABASE_CURRENT else None
        result = user32.QueryDisplayConfig(
            flags,
            ctypes.byref(path_count_u),
            path_array,
            ctypes.byref(mode_count_u),
            mode_array,
            topology_id_pointer,
        )
        if result == ERROR_INSUFFICIENT_BUFFER:
            continue
        if result != ERROR_SUCCESS:
            raise_win32(result, "QueryDisplayConfig")
        snapshot = DisplayConfigSnapshot.from_arrays(path_array, mode_array, path_count_u.value, mode_count_u.value)
        return snapshot, path_array, mode_array


def enum_display_devices() -> list[GdiDisplayDevice]:
    devices: list[GdiDisplayDevice] = []
    index = 0
    while True:
        display = DISPLAY_DEVICEW()
        display.cb = ctypes.sizeof(DISPLAY_DEVICEW)
        if not user32.EnumDisplayDevicesW(None, index, ctypes.byref(display), 0):
            break
        if display.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP:
            devmode = DEVMODEW()
            devmode.dmSize = ctypes.sizeof(DEVMODEW)
            if not user32.EnumDisplaySettingsExW(display.DeviceName, ENUM_CURRENT_SETTINGS, ctypes.byref(devmode), 0):
                raise DisplayConfigError(f"EnumDisplaySettingsExW failed for {display.DeviceName}")
            devices.append(
                GdiDisplayDevice(
                    name=display.DeviceName,
                    description=display.DeviceString,
                    state_flags=display.StateFlags,
                    devmode=devmode,
                )
            )
        index += 1
    return devices


def change_display_settings(device_name: Optional[str], devmode: Optional[DEVMODEW], flags: int) -> int:
    devmode_ptr = ctypes.byref(devmode) if devmode is not None else None
    return user32.ChangeDisplaySettingsExW(device_name, devmode_ptr, None, flags, None)


def get_active_keep_display_names(target_display: str, logger: logging.Logger) -> list[str]:
    keep_names: list[str] = [target_display.upper()]
    snap, paths, _ = query_display_config(QDC_ONLY_ACTIVE_PATHS)
    for path in paths[: snap.path_count]:
        source_name = get_source_name(path).upper()
        target_name = get_target_name(path)
        if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
            if source_name not in keep_names:
                keep_names.append(source_name)
            logger.info("Keeping wireless display source active: %s (target=%s)", source_name, target_name)
    return keep_names


def has_active_wireless_target() -> bool:
    snapshot, path_array, _ = query_display_config(QDC_ONLY_ACTIVE_PATHS)
    for path in path_array[: snapshot.path_count]:
        if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
            return True
    return False


def get_source_name(path: DISPLAYCONFIG_PATH_INFO) -> str:
    packet = DISPLAYCONFIG_SOURCE_DEVICE_NAME()
    packet.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME
    packet.header.size = ctypes.sizeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME)
    packet.header.adapterId = path.sourceInfo.adapterId
    packet.header.id = path.sourceInfo.id
    result = user32.DisplayConfigGetDeviceInfo(ctypes.byref(packet.header))
    if result != ERROR_SUCCESS:
        raise_win32(result, "DisplayConfigGetDeviceInfo(GET_SOURCE_NAME)")
    return packet.viewGdiDeviceName


def get_target_identity_details(path: DISPLAYCONFIG_PATH_INFO) -> tuple[str, str]:
    packet = DISPLAYCONFIG_TARGET_DEVICE_NAME()
    packet.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
    packet.header.size = ctypes.sizeof(DISPLAYCONFIG_TARGET_DEVICE_NAME)
    packet.header.adapterId = path.targetInfo.adapterId
    packet.header.id = path.targetInfo.id
    result = user32.DisplayConfigGetDeviceInfo(ctypes.byref(packet.header))
    if result != ERROR_SUCCESS:
        raise_win32(result, "DisplayConfigGetDeviceInfo(GET_TARGET_NAME)")
    friendly = packet.monitorFriendlyDeviceName.strip("\x00").strip()
    device_path = packet.monitorDevicePath.strip("\x00").strip()
    return friendly, device_path


def target_descriptor_from_path(path: DISPLAYCONFIG_PATH_INFO) -> TargetDescriptor:
    friendly, device_path = get_target_identity_details(path)
    return TargetDescriptor(
        device_path=device_path,
        adapter_high=int(path.targetInfo.adapterId.HighPart),
        adapter_low=int(path.targetInfo.adapterId.LowPart),
        target_id=int(path.targetInfo.id),
        friendly=friendly,
        source=get_source_name(path),
    )


def target_identity_key(path: DISPLAYCONFIG_PATH_INFO) -> str:
    return target_descriptor_from_path(path).identity_key()


def source_identity_key(path: DISPLAYCONFIG_PATH_INFO) -> tuple[int, int, int]:
    return (
        int(path.sourceInfo.adapterId.HighPart),
        int(path.sourceInfo.adapterId.LowPart),
        int(path.sourceInfo.id),
    )


def descriptor_matches(configured: TargetDescriptor, candidate: TargetDescriptor) -> bool:
    configured_path = configured.device_path.strip()
    candidate_path = candidate.device_path.strip()
    if configured_path and candidate_path:
        return configured_path.casefold() == candidate_path.casefold()
    if configured.target_id >= 0 and candidate.target_id >= 0:
        return (
            configured.adapter_high == candidate.adapter_high
            and configured.adapter_low == candidate.adapter_low
            and configured.target_id == candidate.target_id
        )
    if configured.source.strip() and candidate.source.strip():
        return configured.source.strip().casefold() == candidate.source.strip().casefold()
    if configured.friendly.strip() and candidate.friendly.strip():
        return configured.friendly.strip().casefold() == candidate.friendly.strip().casefold()
    return False


def configured_selector_label(selector: str) -> str:
    if selector.startswith(TARGET_TOKEN_PREFIX):
        configured = decode_target_descriptor(selector)
        return (
            configured.friendly.strip()
            or configured.source.strip()
            or configured.device_path.strip()
            or f"Monitor target {configured.target_id}"
        )
    return selector


def resolve_available_target_descriptors(
    selectors: Iterable[str],
    path_array,
    path_count: int,
) -> tuple[list[TargetDescriptor], list[str]]:
    physical_candidates: dict[str, tuple[TargetDescriptor, bool]] = {}
    for path in path_array[:path_count]:
        if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
            continue
        descriptor = target_descriptor_from_path(path)
        key = descriptor.identity_key()
        existing = physical_candidates.get(key)
        available = bool(path.targetInfo.targetAvailable)
        if existing is None or (available and not existing[1]):
            physical_candidates[key] = (descriptor, available)

    resolved: list[TargetDescriptor] = []
    resolved_keys: set[str] = set()
    unavailable_labels: list[str] = []
    for raw_selector in selectors:
        selector = raw_selector.strip()
        if not selector:
            continue
        if selector.startswith(TARGET_TOKEN_PREFIX):
            configured = decode_target_descriptor(selector)
            matches = [
                candidate
                for candidate in physical_candidates.values()
                if descriptor_matches(configured, candidate[0])
            ]
        else:
            wanted = selector.casefold()
            matches = [
                candidate
                for candidate in physical_candidates.values()
                if wanted
                in {
                    candidate[0].device_path.strip().casefold(),
                    candidate[0].friendly.strip().casefold(),
                    candidate[0].source.strip().casefold(),
                }
            ]

        unique_matches = {match[0].identity_key(): match for match in matches}
        if not unique_matches:
            label = configured_selector_label(selector)
            if label not in unavailable_labels:
                unavailable_labels.append(label)
            continue
        if len(unique_matches) > 1:
            raise DisplayConfigError(
                f"Configured monitor name is ambiguous: {selector}. Reconfigure this Button to store target tokens."
            )
        match, available = next(iter(unique_matches.values()))
        if not available:
            label = configured_selector_label(selector)
            if label not in unavailable_labels:
                unavailable_labels.append(label)
            continue
        key = match.identity_key()
        if key not in resolved_keys:
            resolved.append(match)
            resolved_keys.add(key)

    return resolved, unavailable_labels


def resolve_target_descriptors(
    selectors: Iterable[str],
    path_array,
    path_count: int,
) -> list[TargetDescriptor]:
    resolved, unavailable_labels = resolve_available_target_descriptors(selectors, path_array, path_count)
    if unavailable_labels:
        raise DisplayConfigError(f"Configured monitor is not currently available: {unavailable_labels[0]}")

    if not resolved:
        raise DisplayConfigError("Choose at least one physical monitor for this Toggle Monitors Button.")
    return resolved


def get_target_name(path: DISPLAYCONFIG_PATH_INFO) -> str:
    friendly, device_path = get_target_identity_details(path)
    return friendly or device_path or "<unnamed target>"


def get_target_match_keys(path: DISPLAYCONFIG_PATH_INFO) -> set[str]:
    keys: set[str] = set()
    source_name = get_source_name(path).strip()
    if source_name:
        keys.add(source_name.upper())
    friendly, device_path = get_target_identity_details(path)
    for candidate in (friendly, device_path):
        if candidate:
            keys.add(candidate.upper())
    return keys


def source_mode_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[DISPLAYCONFIG_MODE_INFO]:
    virtual = bool(path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE)
    idx = path.sourceInfo.sourceModeInfoIdx if virtual else path.sourceInfo.modeInfoIdx
    invalid = DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID if virtual else DISPLAYCONFIG_PATH_MODE_IDX_INVALID
    return None if idx == invalid or idx >= len(modes) else modes[idx]


def target_mode_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[DISPLAYCONFIG_MODE_INFO]:
    virtual = bool(path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE)
    idx = path.targetInfo.targetModeInfoIdx if virtual else path.targetInfo.modeInfoIdx
    invalid = DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID if virtual else DISPLAYCONFIG_PATH_MODE_IDX_INVALID
    return None if idx == invalid or idx >= len(modes) else modes[idx]


def desktop_mode_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[DISPLAYCONFIG_MODE_INFO]:
    if not (path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE):
        return None
    idx = path.targetInfo.desktopModeInfoIdx
    return None if idx == DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID or idx >= len(modes) else modes[idx]


def list_display_lines(path_array: Iterable[DISPLAYCONFIG_PATH_INFO], mode_array) -> list[str]:
    lines: list[str] = []
    for path in path_array:
        bits = ["active" if path.flags & DISPLAYCONFIG_PATH_ACTIVE else "inactive", get_source_name(path), f"target={get_target_name(path)}"]
        source_mode = source_mode_for_path(path, mode_array)
        target_mode = target_mode_for_path(path, mode_array)
        desktop_mode = desktop_mode_for_path(path, mode_array)
        if source_mode is not None and source_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
            pos = source_mode.sourceMode.position
            bits.append(f"desktop={source_mode.sourceMode.width}x{source_mode.sourceMode.height}@({pos.x},{pos.y})")
            if pos.x == 0 and pos.y == 0:
                bits.append("primary-source")
        if target_mode is not None and target_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_TARGET:
            active_size = target_mode.targetMode.targetVideoSignalInfo.activeSize
            bits.append(f"signal={active_size.cx}x{active_size.cy}")
        if desktop_mode is not None and desktop_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_DESKTOP_IMAGE:
            clip = desktop_mode.desktopImageInfo.DesktopImageClip
            bits.append(f"desktop-clip={clip.right - clip.left}x{clip.bottom - clip.top}")
        lines.append(" | ".join(bits))
    return lines


def rect_from_rectl(rect: RECTL) -> Rect:
    return Rect(int(rect.left), int(rect.top), int(rect.right), int(rect.bottom))


def source_rect_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[Rect]:
    source_mode = source_mode_for_path(path, modes)
    if source_mode is None or source_mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
        return None
    position = source_mode.sourceMode.position
    return Rect(
        int(position.x),
        int(position.y),
        int(position.x + source_mode.sourceMode.width),
        int(position.y + source_mode.sourceMode.height),
    )


def snapshot_source_rects(snapshot: DisplayConfigSnapshot) -> dict[str, Rect]:
    rects: dict[str, Rect] = {}
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    for path in path_array[: snapshot.path_count]:
        rect = source_rect_for_path(path, mode_array)
        if rect is not None:
            rects[get_source_name(path).upper()] = rect
    return rects


def preferred_destination_rect(snapshot: DisplayConfigSnapshot, exclude_source: Optional[str] = None) -> Optional[Rect]:
    primary_rect: Optional[Rect] = None
    fallback_rect: Optional[Rect] = None
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    exclude = exclude_source.upper() if exclude_source else None

    for path in path_array[: snapshot.path_count]:
        source_name = get_source_name(path).upper()
        if exclude and source_name == exclude:
            continue
        rect = source_rect_for_path(path, mode_array)
        if rect is None:
            continue
        if fallback_rect is None:
            fallback_rect = rect
        if rect.left == 0 and rect.top == 0:
            primary_rect = rect
            break

    return primary_rect or fallback_rect


def enumerate_top_level_windows() -> list[TopLevelWindow]:
    windows: list[TopLevelWindow] = []
    ignored_classes = {"Shell_TrayWnd", "Progman", "WorkerW", "NotifyIconOverflowWindow"}

    @EnumWindowsProc
    def callback(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        if user32.IsIconic(hwnd):
            return True
        if user32.GetWindow(hwnd, GW_OWNER):
            return True

        rect = RECTL()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return True
        window_rect = rect_from_rectl(rect)
        if window_rect.width < 80 or window_rect.height < 40:
            return True

        class_buffer = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, class_buffer, len(class_buffer))
        class_name = class_buffer.value
        if class_name in ignored_classes:
            return True

        title_length = user32.GetWindowTextLengthW(hwnd)
        title_buffer = ctypes.create_unicode_buffer(max(title_length + 1, 1))
        user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))
        windows.append(TopLevelWindow(int(hwnd), window_rect, class_name, title_buffer.value.strip()))
        return True

    if not user32.EnumWindows(callback, 0):
        raise_win32(ctypes.get_last_error(), "EnumWindows")
    return windows


def relocate_window(hwnd: int, source_rect: Rect, destination_rect: Rect, ordinal: int) -> None:
    rect = RECTL()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise_win32(ctypes.get_last_error(), f"GetWindowRect(hwnd={hwnd})")

    current_rect = rect_from_rectl(rect)
    width = min(current_rect.width, max(destination_rect.width - 40, 160))
    height = min(current_rect.height, max(destination_rect.height - 40, 120))

    source_offset_x = max(0, current_rect.left - source_rect.left)
    source_offset_y = max(0, current_rect.top - source_rect.top)
    cascade = min(ordinal * 24, 120)

    max_left = max(destination_rect.left + 20, destination_rect.right - width - 20)
    max_top = max(destination_rect.top + 20, destination_rect.bottom - height - 20)
    new_left = min(destination_rect.left + source_offset_x + cascade, max_left)
    new_top = min(destination_rect.top + source_offset_y + cascade, max_top)
    new_left = max(destination_rect.left + 20, new_left)
    new_top = max(destination_rect.top + 20, new_top)

    if not user32.MoveWindow(hwnd, int(new_left), int(new_top), int(width), int(height), True):
        raise_win32(ctypes.get_last_error(), f"MoveWindow(hwnd={hwnd})")


def move_windows_from_rect(source_rect: Rect, destination_rect: Rect, logger: logging.Logger, reason: str) -> int:
    moved = 0
    for window in enumerate_top_level_windows():
        if not window.rect.intersects(source_rect):
            continue
        relocate_window(window.hwnd, source_rect, destination_rect, moved)
        moved += 1
        logger.info(
            "Moved window for %s: hwnd=%s class=%s title=%s",
            reason,
            window.hwnd,
            window.class_name,
            window.title or "<untitled>",
        )
    logger.info("Moved %d windows for %s", moved, reason)
    return moved


def move_offscreen_windows(active_rects: Iterable[Rect], destination_rect: Rect, logger: logging.Logger) -> int:
    rect_list = list(active_rects)
    if not rect_list:
        return 0

    moved = 0
    for window in enumerate_top_level_windows():
        center_x, center_y = window.rect.center
        if any(rect.contains_point(center_x, center_y) or window.rect.intersects(rect) for rect in rect_list):
            continue
        relocate_window(window.hwnd, window.rect, destination_rect, moved)
        moved += 1
        logger.info(
            "Recovered off-screen window: hwnd=%s class=%s title=%s",
            window.hwnd,
            window.class_name,
            window.title or "<untitled>",
        )
    logger.info("Recovered %d off-screen windows after restore", moved)
    return moved


def activate_single_path(path: DISPLAYCONFIG_PATH_INFO, mode_array, logger: logging.Logger) -> None:
    source_mode = source_mode_for_path(path, mode_array)
    if source_mode is not None:
        logger.info("Trying to activate target display via remapped single-path snapshot")
        try:
            single_snapshot = remap_single_path_snapshot(path, mode_array)
            apply_snapshot(single_snapshot, save_to_database=False)
            return
        except DisplayConfigError as error:
            logger.warning("Remapped single-path activation failed: %s", error)

    logger.info("Trying to activate target display via synthesized source-only snapshot")
    single_snapshot = synthesize_source_only_snapshot(path, logger)
    apply_snapshot(single_snapshot, save_to_database=False)


def save_snapshot(snapshot: DisplayConfigSnapshot, destination: Path) -> None:
    write_text_atomic(destination, snapshot.to_json())


def load_snapshot(path: Path) -> DisplayConfigSnapshot:
    return DisplayConfigSnapshot.from_json(path.read_text(encoding="utf-8"))


def build_filtered_snapshot_or_fallback(path_array, mode_array, path_count: int, keep_predicate, fallback: DisplayConfigSnapshot) -> DisplayConfigSnapshot:
    try:
        return build_filtered_snapshot(path_array, mode_array, path_count, keep_predicate)
    except DisplayConfigError:
        return fallback


def capture_layout_bundle(target_display: str):
    snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
    resolved_target_source = resolve_target_source_name(path_array, snapshot.path_count, target_display)
    bundle = {
        "normal": snapshot,
        "no_wireless": build_filtered_snapshot_or_fallback(
            path_array,
            mode_array,
            snapshot.path_count,
            lambda path: path.targetInfo.outputTechnology != DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
            snapshot,
        ),
        "no_target": build_filtered_snapshot_or_fallback(
            path_array,
            mode_array,
            snapshot.path_count,
            lambda path: resolved_target_source is None or get_source_name(path).upper() != resolved_target_source,
            snapshot,
        ),
        "no_target_no_wireless": build_filtered_snapshot_or_fallback(
            path_array,
            mode_array,
            snapshot.path_count,
            lambda path: (resolved_target_source is None or get_source_name(path).upper() != resolved_target_source)
            and path.targetInfo.outputTechnology != DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
            snapshot,
        ),
    }
    return snapshot, path_array, mode_array, bundle


def active_target_name_set() -> set[str]:
    snapshot, path_array, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
    names: set[str] = set()
    for path in path_array[: snapshot.path_count]:
        target_name = get_target_name(path).strip()
        if target_name and target_name != "<unnamed target>":
            names.add(target_name)
    return names


def active_source_name_set() -> set[str]:
    snapshot, path_array, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
    names: set[str] = set()
    for path in path_array[: snapshot.path_count]:
        source_name = get_source_name(path).strip()
        if source_name:
            names.add(source_name.upper())
    return names


def select_preferred_source_path(
    path_array,
    path_count: int,
    target_display: str,
    logger: Optional[logging.Logger] = None,
) -> Optional[DISPLAYCONFIG_PATH_INFO]:
    selector = target_display.strip().upper()
    if not selector:
        return None

    active_targets = active_target_name_set()
    active_sources = active_source_name_set()
    active_match = None
    preferred_detached_source = None
    preferred_unclaimed = None
    preferred_named = None
    fallback_path = None

    for path in path_array[:path_count]:
        if selector not in get_target_match_keys(path):
            continue
        candidate = duplicate_path(path)
        source_name = get_source_name(path).strip().upper()
        target_name = get_target_name(path).strip()
        is_active = bool(path.flags & DISPLAYCONFIG_PATH_ACTIVE)
        is_named = bool(target_name and target_name != "<unnamed target>")
        if is_active and active_match is None:
            active_match = candidate
        if (not is_active) and is_named and source_name and source_name not in active_sources and preferred_detached_source is None:
            preferred_detached_source = candidate
        if (not is_active) and is_named and target_name not in active_targets and preferred_unclaimed is None:
            preferred_unclaimed = candidate
        if is_named and preferred_named is None:
            preferred_named = candidate
        if fallback_path is None:
            fallback_path = candidate

    if active_match is not None:
        if logger is not None:
            logger.info(
                "Resolved active target for %s: source=%s target=%s",
                target_display,
                get_source_name(active_match).strip(),
                get_target_name(active_match).strip(),
            )
        return active_match
    if preferred_detached_source is not None:
        if logger is not None:
            logger.info(
                "Selected inactive detached-source target for %s: source=%s target=%s",
                target_display,
                get_source_name(preferred_detached_source).strip(),
                get_target_name(preferred_detached_source).strip(),
            )
        return preferred_detached_source
    if preferred_unclaimed is not None:
        if logger is not None:
            logger.info(
                "Selected inactive named target for %s: source=%s target=%s",
                target_display,
                get_source_name(preferred_unclaimed).strip(),
                get_target_name(preferred_unclaimed).strip(),
            )
        return preferred_unclaimed
    if preferred_named is not None:
        if logger is not None:
            logger.info(
                "Falling back to named target for %s: source=%s target=%s",
                target_display,
                get_source_name(preferred_named).strip(),
                get_target_name(preferred_named).strip(),
            )
        return preferred_named
    return fallback_path


def resolve_target_source_name(path_array, path_count: int, target_display: str) -> Optional[str]:
    match = select_preferred_source_path(path_array, path_count, target_display)
    if match is None:
        return None
    return get_source_name(match).upper()


def list_available_monitor_choices() -> list[MonitorChoice]:
    """Return every distinct physical monitor Windows can currently identify.

    Each token is an opaque, base64url target descriptor suitable for a
    Button's Group 1 or Group 2 setting. Inactive physical monitors are included so a
    currently disabled target can still be selected without relying on its
    mutable GDI source name.
    """
    snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
    records: dict[str, dict[str, object]] = {}
    for path in path_array[: snapshot.path_count]:
        if (
            path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST
            or not path.targetInfo.targetAvailable
        ):
            continue
        descriptor = target_descriptor_from_path(path)
        key = descriptor.identity_key()
        active = bool(path.flags & DISPLAYCONFIG_PATH_ACTIVE)
        source_mode = source_mode_for_path(path, mode_array)
        main = bool(
            active
            and source_mode is not None
            and source_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
            and source_mode.sourceMode.position.x == 0
            and source_mode.sourceMode.position.y == 0
        )
        existing = records.get(key)
        if existing is None or (active and not bool(existing["active"])):
            records[key] = {
                "descriptor": descriptor,
                "active": active,
                "main": main,
            }
        elif active:
            existing["main"] = bool(existing["main"]) or main

    base_counts: dict[str, int] = {}
    for record in records.values():
        descriptor = record["descriptor"]
        assert isinstance(descriptor, TargetDescriptor)
        base = descriptor.friendly or descriptor.device_path or descriptor.source or f"Monitor {descriptor.target_id}"
        base_counts[base.casefold()] = base_counts.get(base.casefold(), 0) + 1

    items: list[tuple[tuple[int, str], MonitorChoice]] = []
    for record in records.values():
        descriptor = record["descriptor"]
        assert isinstance(descriptor, TargetDescriptor)
        active = bool(record["active"])
        main = bool(record["main"])
        base = descriptor.friendly or descriptor.device_path or descriptor.source or f"Monitor {descriptor.target_id}"
        if base_counts.get(base.casefold(), 0) > 1:
            adapter_high = descriptor.adapter_high & 0xFFFFFFFF
            adapter_low = descriptor.adapter_low & 0xFFFFFFFF
            stable_discriminator = f"adapter {adapter_high:08X}:{adapter_low:08X} target {descriptor.target_id}"
            base = f"{base} - {stable_discriminator}"
        status = "main, active" if main else ("active" if active else "inactive")
        label = f"{base} [{status}]"
        tier = 0 if main else (1 if active else 2)
        items.append(
            (
                (tier, base.casefold()),
                MonitorChoice(
                    label=label,
                    token=encode_target_descriptor(descriptor),
                    descriptor=descriptor,
                    active=active,
                    main=main,
                ),
            )
        )
    items.sort(key=lambda item: item[0])
    return [choice for _, choice in items]


def list_available_displays() -> list[tuple[str, str]]:
    """Compatibility view used by the text-list CLI and existing callers."""

    return [(choice.label, choice.token) for choice in list_available_monitor_choices()]


def write_display_list(out_path: Optional[str]) -> str:
    """Render the monitor list as one ``label<TAB>selector`` line per monitor.

    Written to ``out_path`` when given (UTF-8) so the launcher can read it
    without relying on stdout, which is unavailable under pythonw.exe.
    """
    displays = list_available_displays()
    text = "\n".join(f"{label}\t{selector}" for label, selector in displays)
    if out_path:
        Path(out_path).write_text(text + ("\n" if text else ""), encoding="utf-8")
    elif sys.stdout is not None:
        print(text)
    return text


def selector_keys_from_choices(selectors: Iterable[str], choices: list[MonitorChoice]) -> set[str]:
    resolved: set[str] = set()
    for raw_selector in selectors:
        selector = str(raw_selector).strip()
        if not selector:
            continue
        if selector.startswith(TARGET_TOKEN_PREFIX):
            configured = decode_target_descriptor(selector)
            matches = [choice for choice in choices if descriptor_matches(configured, choice.descriptor)]
        else:
            normalized = selector.casefold()
            matches = [
                choice
                for choice in choices
                if normalized
                in {
                    choice.descriptor.identity_key().casefold(),
                    choice.descriptor.device_path.strip().casefold(),
                    choice.descriptor.friendly.strip().casefold(),
                    choice.descriptor.source.strip().casefold(),
                }
            ]
        if len(matches) > 1:
            raise DisplayConfigError(f"Configured monitor name is ambiguous: {selector}.")
        if matches:
            resolved.add(matches[0].descriptor.identity_key())
    return resolved


def picker_default_group_keys(
    config_path: Path,
    choices: list[MonitorChoice],
    logger: logging.Logger,
) -> tuple[set[str], set[str]]:
    available_keys = {choice.descriptor.identity_key() for choice in choices}
    active_keys = {choice.descriptor.identity_key() for choice in choices if choice.active}
    main_keys = {choice.descriptor.identity_key() for choice in choices if choice.main}
    values = read_button_config(config_path) if config_path.exists() else {}
    state_paths = button_state_paths(config_path.parent)
    metadata = read_json_object(state_paths["metadata"])

    group_1: set[str] = set()
    group_2: set[str] = set()

    if values.get("SCHEMA", "") == str(BUTTON_CONFIG_SCHEMA):
        try:
            group_1 = selector_keys_from_choices(split_selector_value(values.get("GROUP_1", "")), choices)
            group_2 = selector_keys_from_choices(split_selector_value(values.get("GROUP_2", "")), choices)
        except DisplayConfigError as error:
            logger.warning("Could not reuse existing group defaults: %s", error)
    else:
        saved_full = metadata.get("full_physical_keys", [])
        if isinstance(saved_full, list):
            group_1 = set(map(str, saved_full)) & available_keys

        try:
            legacy_selectors = selectors_from_button_config(config_path) if config_path.exists() else []
            group_2 = selector_keys_from_choices(legacy_selectors, choices)
        except DisplayConfigError as error:
            logger.warning("Could not map the previous monitor choice into Group 2: %s", error)

        if not group_2:
            saved_reduced = metadata.get("reduced_physical_keys", metadata.get("selected_keys", []))
            if isinstance(saved_reduced, list):
                group_2 = set(map(str, saved_reduced)) & available_keys

    if not group_1:
        group_1 = active_keys or main_keys or {choices[0].descriptor.identity_key()}
    if not group_2:
        group_2 = main_keys or {choices[0].descriptor.identity_key()}
    return group_1, group_2


def picker_choices_with_saved_unavailable(
    config_path: Path,
    choices: list[MonitorChoice],
) -> list[MonitorChoice]:
    """Keep configured-but-disconnected members visible during reconfiguration."""
    if not config_path.exists():
        return list(choices)
    values = read_button_config(config_path)
    if values.get("SCHEMA", "") != str(BUTTON_CONFIG_SCHEMA):
        return list(choices)

    configured_selectors = split_selector_value(values.get("GROUP_1", "")) + split_selector_value(
        values.get("GROUP_2", "")
    )
    augmented = list(choices)
    preserved_tokens = {choice.token for choice in augmented}
    for selector in configured_selectors:
        if not selector.startswith(TARGET_TOKEN_PREFIX) or selector in preserved_tokens:
            continue
        configured = decode_target_descriptor(selector)
        if any(descriptor_matches(configured, choice.descriptor) for choice in augmented):
            continue
        base = (
            configured.friendly.strip()
            or configured.source.strip()
            or configured.device_path.strip()
            or f"Monitor target {configured.target_id}"
        )
        augmented.append(
            MonitorChoice(
                label=f"{base} [not connected; saved target {configured.target_id}]",
                token=selector,
                descriptor=configured,
                active=False,
                main=False,
            )
        )
        preserved_tokens.add(selector)
    return augmented


def build_picker_model(
    config_path: Path,
    choices: list[MonitorChoice],
    logger: logging.Logger,
) -> dict[str, object]:
    group_1, group_2 = picker_default_group_keys(config_path, choices, logger)
    return {
        "schemaVersion": 1,
        "monitors": [
            {
                "label": choice.label,
                "token": choice.token,
                "group1": choice.descriptor.identity_key() in group_1,
                "group2": choice.descriptor.identity_key() in group_2,
            }
            for choice in choices
        ],
    }


def configure_button_groups(
    config_path: Path,
    pythonw_path: str,
    logger: logging.Logger,
) -> bool:
    choices = picker_choices_with_saved_unavailable(config_path, list_available_monitor_choices())
    if not choices:
        raise DisplayConfigError("Windows did not report any physical monitors to configure.")

    picker_path = Path(__file__).resolve().with_name(PICKER_FILENAME)
    if not picker_path.exists():
        raise DisplayConfigError(f"Toggle Monitors is missing {PICKER_FILENAME}. Update this Button package.")

    powershell_path = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if not powershell_path.exists():
        raise DisplayConfigError("Toggle Monitors could not find Windows PowerShell for its monitor-group picker.")

    model = build_picker_model(config_path, choices, logger)
    with tempfile.TemporaryDirectory(prefix="ToggleMonitorsPicker-") as temporary:
        temporary_root = Path(temporary)
        model_path = temporary_root / "model.json"
        result_path = temporary_root / "result.json"
        write_json_object(model_path, model)
        completed = subprocess.run(
            [
                str(powershell_path),
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-Sta",
                "-File",
                str(picker_path),
                "-ModelPath",
                str(model_path),
                "-ResultPath",
                str(result_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=0x08000000,
        )
        if completed.returncode != 0:
            raise DisplayConfigError("The Toggle Monitors group picker failed. No monitor settings were changed.")
        result = read_json_object(result_path)
        if int(result.get("schemaVersion", 0)) != 1:
            raise DisplayConfigError("The Toggle Monitors picker returned an unsupported result schema.")
        if bool(result.get("cancelled", True)):
            logger.info("Monitor-group setup was cancelled")
            return False
        raw_group_1 = result.get("group1", [])
        raw_group_2 = result.get("group2", [])
        if not isinstance(raw_group_1, list) or not isinstance(raw_group_2, list):
            raise DisplayConfigError("The Toggle Monitors picker returned malformed monitor groups.")
        allowed_tokens = {choice.token for choice in choices}
        group_1, group_2 = validate_selector_groups(raw_group_1, raw_group_2, allowed_tokens)
        previous_config = config_path.read_text(encoding="utf-8") if config_path.exists() else None
        write_button_group_config(config_path, pythonw_path, group_1, group_2)
        try:
            invalidate_active_owner_after_configuration(config_path, group_1, group_2)
        except Exception as marker_error:
            try:
                if previous_config is not None:
                    write_text_atomic(config_path, previous_config)
                else:
                    write_text_atomic(
                        config_path,
                        "# Toggle Monitors configuration save did not complete.\nSCHEMA=0\n",
                    )
            except Exception as rollback_error:
                raise DisplayConfigError(
                    "Could not finish saving the monitor groups, and restoring the previous Button config also failed."
                ) from rollback_error
            raise DisplayConfigError(
                "Could not finish saving the monitor groups. The Button config was restored to a safe state."
            ) from marker_error
        logger.info("Saved two monitor groups for this Button owner")
        return True


def save_snapshot_bundle(paths: dict[str, Path], bundle: dict[str, DisplayConfigSnapshot]) -> None:
    save_snapshot(bundle["normal"], paths["normal"])
    save_snapshot(bundle["no_wireless"], paths["no_wireless"])
    save_snapshot(bundle["no_target"], paths["no_target"])
    save_snapshot(bundle["no_target_no_wireless"], paths["no_target_no_wireless"])


def load_snapshot_bundle(paths: dict[str, Path]) -> dict[str, DisplayConfigSnapshot]:
    return {
        "normal": load_snapshot(paths["normal"]),
        "no_wireless": load_snapshot(paths["no_wireless"]),
        "no_target": load_snapshot(paths["no_target"]),
        "no_target_no_wireless": load_snapshot(paths["no_target_no_wireless"]),
    }


def write_profile_metadata(profile_dir: Path, layout_name: str, slug: str, target_display: str, path_count: int) -> None:
    payload = {
        "name": layout_name,
        "slug": slug,
        "target_display": target_display,
        "path_count": path_count,
        "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (profile_dir / PROFILE_METADATA_FILENAME).write_text(json.dumps(payload, indent=2), encoding="utf-8")


def list_layout_profiles() -> list[dict[str, object]]:
    active_slug = read_active_profile_slug()
    items: list[dict[str, object]] = []
    for candidate in sorted(profiles_root().iterdir()):
        if not candidate.is_dir():
            continue
        metadata_path = candidate / PROFILE_METADATA_FILENAME
        if not metadata_path.exists():
            continue
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        payload["is_active"] = candidate.name == active_slug
        items.append(payload)
    items.sort(key=lambda item: str(item.get("saved_at", "")), reverse=True)
    return items


def save_named_layout_profile(layout_name: str, target_display: str, logger: logging.Logger) -> dict[str, object]:
    normalized_name = normalize_layout_name(layout_name)
    if not normalized_name:
        raise DisplayConfigError("Layout name cannot be empty.")

    snapshot, path_array, mode_array, bundle = capture_layout_bundle(target_display)
    slug = layout_name_to_slug(normalized_name)
    profile_dir = profile_dir_from_slug(slug)
    paths = snapshot_bundle_paths(profile_dir, "layout")
    save_snapshot_bundle(paths, bundle)
    write_profile_metadata(profile_dir, normalized_name, slug, target_display, snapshot.path_count)
    write_active_profile_slug(slug)
    logger.info("Saved named layout profile '%s' to %s", normalized_name, profile_dir)
    for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
        logger.info("  %s", line)
    return {"name": normalized_name, "slug": slug, "path_count": snapshot.path_count, "directory": str(profile_dir)}


def set_active_layout_profile(layout_name_or_slug: str) -> dict[str, object]:
    requested = normalize_layout_name(layout_name_or_slug)
    if not requested:
        raise DisplayConfigError("Layout name cannot be empty.")

    requested_slug = layout_name_to_slug(requested)
    matches = []
    for profile in list_layout_profiles():
        if str(profile.get("slug", "")) == requested_slug or str(profile.get("name", "")).casefold() == requested.casefold():
            matches.append(profile)

    if not matches:
        raise DisplayConfigError(f"Saved layout '{requested}' was not found.")

    chosen = matches[0]
    write_active_profile_slug(str(chosen["slug"]))
    return chosen


def apply_layout_profile(layout_name_or_slug: str, target_display: str, logger: logging.Logger) -> dict[str, object]:
    chosen = set_active_layout_profile(layout_name_or_slug)
    slug = str(chosen["slug"])
    paths = snapshot_bundle_paths(profile_dir_from_slug(slug), "layout")
    bundle = load_snapshot_bundle(paths)
    logger.info("Applying saved layout profile: %s", slug)
    apply_snapshot(bundle["normal"], save_to_database=True)
    return chosen


def duplicate_path(path: DISPLAYCONFIG_PATH_INFO) -> DISPLAYCONFIG_PATH_INFO:
    return copy.deepcopy(path)


def duplicate_mode(mode: DISPLAYCONFIG_MODE_INFO) -> DISPLAYCONFIG_MODE_INFO:
    return copy.deepcopy(mode)


def same_adapter_id(left: LUID, right: LUID) -> bool:
    return left.LowPart == right.LowPart and left.HighPart == right.HighPart


def enumerate_display_settings(device_name: str) -> list[DEVMODEW]:
    modes: list[DEVMODEW] = []
    index = 0
    while True:
        devmode = DEVMODEW()
        devmode.dmSize = ctypes.sizeof(DEVMODEW)
        if not user32.EnumDisplaySettingsExW(device_name, index, ctypes.byref(devmode), 0):
            break
        modes.append(copy.deepcopy(devmode))
        index += 1
    return modes


def preferred_attach_resolution(device_name: str) -> tuple[int, int]:
    modes = enumerate_display_settings(device_name)
    if not modes:
        raise DisplayConfigError(f"No supported display modes were enumerated for {device_name}.")

    def score(devmode: DEVMODEW) -> tuple[int, int, int, int]:
        width = int(devmode.dmPelsWidth)
        height = int(devmode.dmPelsHeight)
        frequency = int(getattr(devmode, "dmDisplayFrequency", 0))
        return (
            1 if (width, height) == (1920, 1080) else 0,
            1 if frequency in (59, 60) else 0,
            width * height,
            -abs(frequency - 60),
        )

    best = max(modes, key=score)
    return int(best.dmPelsWidth), int(best.dmPelsHeight)


def synthesize_source_only_snapshot(path: DISPLAYCONFIG_PATH_INFO, logger: logging.Logger) -> DisplayConfigSnapshot:
    source_name = get_source_name(path)
    width, height = preferred_attach_resolution(source_name)
    logger.info(
        "Synthesizing source mode for %s using %sx%s from enumerated GDI modes",
        source_name,
        width,
        height,
    )

    active_snapshot, active_paths, active_modes = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
    template_mode: Optional[DISPLAYCONFIG_MODE_INFO] = None
    fallback_mode: Optional[DISPLAYCONFIG_MODE_INFO] = None

    for active_path in active_paths[: active_snapshot.path_count]:
        source_mode = source_mode_for_path(active_path, active_modes)
        if source_mode is None or source_mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
            continue
        if not same_adapter_id(source_mode.adapterId, path.sourceInfo.adapterId):
            continue
        if fallback_mode is None:
            fallback_mode = duplicate_mode(source_mode)
        if source_mode.sourceMode.width == width and source_mode.sourceMode.height == height:
            template_mode = duplicate_mode(source_mode)
            break

    template_mode = template_mode or fallback_mode
    if template_mode is None:
        raise DisplayConfigError(f"Could not find an active source-mode template on the adapter for {source_name}.")

    template_mode.infoType = DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
    template_mode.adapterId = path.sourceInfo.adapterId
    template_mode.id = path.sourceInfo.id
    template_mode.sourceMode.width = width
    template_mode.sourceMode.height = height
    template_mode.sourceMode.position.x = 0
    template_mode.sourceMode.position.y = 0

    synthesized_path = duplicate_path(path)
    synthesized_path.flags |= DISPLAYCONFIG_PATH_ACTIVE
    if synthesized_path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
        synthesized_path.sourceInfo.sourceModeInfoIdx = 0
        synthesized_path.targetInfo.desktopModeInfoIdx = DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID
        synthesized_path.targetInfo.targetModeInfoIdx = DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID
    else:
        synthesized_path.sourceInfo.modeInfoIdx = 0
        synthesized_path.targetInfo.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID

    path_array = (DISPLAYCONFIG_PATH_INFO * 1)(synthesized_path)
    mode_array = (DISPLAYCONFIG_MODE_INFO * 1)(template_mode)
    return DisplayConfigSnapshot.from_arrays(path_array, mode_array, 1, 1)


def remap_single_path_snapshot(original_path: DISPLAYCONFIG_PATH_INFO, original_modes) -> DisplayConfigSnapshot:
    path = duplicate_path(original_path)
    mode_items: list[DISPLAYCONFIG_MODE_INFO] = []
    remap: dict[int, int] = {}

    def append_mode(old_idx: int, invalid_idx: int) -> int:
        if old_idx == invalid_idx:
            return old_idx
        if old_idx not in remap:
            remap[old_idx] = len(mode_items)
            mode_items.append(duplicate_mode(original_modes[old_idx]))
        return remap[old_idx]

    if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
        path.sourceInfo.sourceModeInfoIdx = append_mode(
            path.sourceInfo.sourceModeInfoIdx, DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID
        )
        path.targetInfo.desktopModeInfoIdx = append_mode(
            path.targetInfo.desktopModeInfoIdx, DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID
        )
        path.targetInfo.targetModeInfoIdx = append_mode(
            path.targetInfo.targetModeInfoIdx, DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID
        )
    else:
        path.sourceInfo.modeInfoIdx = append_mode(path.sourceInfo.modeInfoIdx, DISPLAYCONFIG_PATH_MODE_IDX_INVALID)
        path.targetInfo.modeInfoIdx = append_mode(path.targetInfo.modeInfoIdx, DISPLAYCONFIG_PATH_MODE_IDX_INVALID)

    path.flags |= DISPLAYCONFIG_PATH_ACTIVE
    path_array = (DISPLAYCONFIG_PATH_INFO * 1)(path)
    mode_array = (DISPLAYCONFIG_MODE_INFO * max(len(mode_items), 1))()
    for idx, item in enumerate(mode_items):
        mode_array[idx] = item
    return DisplayConfigSnapshot.from_arrays(path_array, mode_array, 1, len(mode_items))


def build_filtered_snapshot(path_array, mode_array, path_count: int, keep_predicate) -> DisplayConfigSnapshot:
    kept_paths: list[DISPLAYCONFIG_PATH_INFO] = []
    mode_items: list[DISPLAYCONFIG_MODE_INFO] = []
    remap: dict[int, int] = {}

    def append_mode(old_idx: int, invalid_idx: int) -> int:
        if old_idx == invalid_idx:
            return old_idx
        if old_idx not in remap:
            remap[old_idx] = len(mode_items)
            mode_items.append(duplicate_mode(mode_array[old_idx]))
        return remap[old_idx]

    for path in path_array[:path_count]:
        if not keep_predicate(path):
            continue
        kept = duplicate_path(path)
        kept.flags |= DISPLAYCONFIG_PATH_ACTIVE
        if kept.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
            kept.sourceInfo.sourceModeInfoIdx = append_mode(
                kept.sourceInfo.sourceModeInfoIdx, DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID
            )
            kept.targetInfo.desktopModeInfoIdx = append_mode(
                kept.targetInfo.desktopModeInfoIdx, DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID
            )
            kept.targetInfo.targetModeInfoIdx = append_mode(
                kept.targetInfo.targetModeInfoIdx, DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID
            )
        else:
            kept.sourceInfo.modeInfoIdx = append_mode(kept.sourceInfo.modeInfoIdx, DISPLAYCONFIG_PATH_MODE_IDX_INVALID)
            kept.targetInfo.modeInfoIdx = append_mode(kept.targetInfo.modeInfoIdx, DISPLAYCONFIG_PATH_MODE_IDX_INVALID)
        kept_paths.append(kept)

    if not kept_paths:
        raise DisplayConfigError("Filtered snapshot would keep zero display paths.")

    path_array_out = (DISPLAYCONFIG_PATH_INFO * len(kept_paths))()
    for idx, item in enumerate(kept_paths):
        path_array_out[idx] = item

    mode_array_out = (DISPLAYCONFIG_MODE_INFO * max(len(mode_items), 1))()
    for idx, item in enumerate(mode_items):
        mode_array_out[idx] = item

    return DisplayConfigSnapshot.from_arrays(path_array_out, mode_array_out, len(kept_paths), len(mode_items))


def rebase_snapshot_to_target(snapshot: DisplayConfigSnapshot, anchor_target_key: str) -> DisplayConfigSnapshot:
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    anchor_position: Optional[tuple[int, int]] = None
    for path in path_array[: snapshot.path_count]:
        if target_identity_key(path) != anchor_target_key:
            continue
        source_mode = source_mode_for_path(path, mode_array)
        if source_mode is None or source_mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
            continue
        anchor_position = (int(source_mode.sourceMode.position.x), int(source_mode.sourceMode.position.y))
        break
    if anchor_position is None or anchor_position == (0, 0):
        return snapshot

    translated_indexes: set[int] = set()
    for path in path_array[: snapshot.path_count]:
        virtual = bool(path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE)
        index = path.sourceInfo.sourceModeInfoIdx if virtual else path.sourceInfo.modeInfoIdx
        invalid = DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID if virtual else DISPLAYCONFIG_PATH_MODE_IDX_INVALID
        if index == invalid or index >= len(mode_array) or index in translated_indexes:
            continue
        mode = mode_array[index]
        if mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
            continue
        mode.sourceMode.position.x -= anchor_position[0]
        mode.sourceMode.position.y -= anchor_position[1]
        translated_indexes.add(index)
    return DisplayConfigSnapshot.from_arrays(path_array, mode_array, snapshot.path_count, snapshot.mode_count)


def build_selected_snapshot(
    snapshot: DisplayConfigSnapshot,
    selected_target_keys: list[str],
    preserve_wireless: bool = True,
) -> DisplayConfigSnapshot:
    selected_set = set(selected_target_keys)
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()

    filtered = build_filtered_snapshot(
        path_array,
        mode_array,
        snapshot.path_count,
        lambda path: target_identity_key(path) in selected_set
        or (preserve_wireless and path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST),
    )

    anchor_key = None
    filtered_paths = filtered.path_array()
    filtered_modes = filtered.mode_array()
    for path in filtered_paths[: filtered.path_count]:
        key = target_identity_key(path)
        if key not in selected_set:
            continue
        source_mode = source_mode_for_path(path, filtered_modes)
        if (
            source_mode is not None
            and source_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE
            and source_mode.sourceMode.position.x == 0
            and source_mode.sourceMode.position.y == 0
        ):
            anchor_key = key
            break
    if anchor_key is None:
        anchor_key = selected_target_keys[0]
    return rebase_snapshot_to_target(filtered, anchor_key)


def build_no_wireless_snapshot(snapshot: DisplayConfigSnapshot) -> DisplayConfigSnapshot:
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    try:
        return build_filtered_snapshot(
            path_array,
            mode_array,
            snapshot.path_count,
            lambda path: path.targetInfo.outputTechnology != DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
        )
    except DisplayConfigError:
        return snapshot


def validate_snapshot_exact(snapshot: DisplayConfigSnapshot) -> None:
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    flags = awareness_set_flags(SDC_VALIDATE | SDC_USE_SUPPLIED_DISPLAY_CONFIG)
    result = user32.SetDisplayConfig(snapshot.path_count, path_array, snapshot.mode_count, mode_array, flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(validate supplied snapshot)")


def apply_snapshot_exact(snapshot: DisplayConfigSnapshot, save_to_database: bool) -> None:
    validate_snapshot_exact(snapshot)
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    flags = awareness_set_flags(
        SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | (SDC_SAVE_TO_DATABASE if save_to_database else 0)
    )
    result = user32.SetDisplayConfig(snapshot.path_count, path_array, snapshot.mode_count, mode_array, flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(apply exact supplied snapshot)")


def choose_distinct_target_paths(
    descriptors: list[TargetDescriptor],
    path_array,
    path_count: int,
    *,
    include_wireless: bool = False,
) -> list[DISPLAYCONFIG_PATH_INFO]:
    candidate_groups: list[list[DISPLAYCONFIG_PATH_INFO]] = []
    for descriptor in descriptors:
        by_connection: dict[tuple[tuple[int, int, int], str], DISPLAYCONFIG_PATH_INFO] = {}
        for path in path_array[:path_count]:
            if (
                (not include_wireless and path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST)
                or not path.targetInfo.targetAvailable
            ):
                continue
            candidate = target_descriptor_from_path(path)
            if not descriptor_matches(descriptor, candidate):
                continue
            connection_key = (source_identity_key(path), candidate.identity_key())
            existing = by_connection.get(connection_key)
            if existing is None or (path.flags & DISPLAYCONFIG_PATH_ACTIVE and not existing.flags & DISPLAYCONFIG_PATH_ACTIVE):
                by_connection[connection_key] = duplicate_path(path)
        candidates = sorted(
            by_connection.values(),
            key=lambda path: (0 if path.flags & DISPLAYCONFIG_PATH_ACTIVE else 1, source_identity_key(path)),
        )
        if not candidates:
            raise DisplayConfigError(f"No display path is available for {descriptor.friendly or descriptor.identity_key()}.")
        candidate_groups.append(candidates)

    chosen: list[DISPLAYCONFIG_PATH_INFO] = []
    used_sources: set[tuple[int, int, int]] = set()

    def select(index: int) -> bool:
        if index == len(candidate_groups):
            return True
        for path in candidate_groups[index]:
            source_key = source_identity_key(path)
            if source_key in used_sources:
                continue
            used_sources.add(source_key)
            chosen.append(path)
            if select(index + 1):
                return True
            chosen.pop()
            used_sources.remove(source_key)
        return False

    if not select(0):
        raise DisplayConfigError("Windows has no conflict-free source path for the selected monitor set.")
    return chosen


def validate_and_apply_topology(paths: list[DISPLAYCONFIG_PATH_INFO]) -> None:
    """Activate paths temporarily, letting Windows generate missing modes.

    SDC_TOPOLOGY_SUPPLIED selects a persisted topology; omitting SAVE_TO_DATABASE
    does not make that operation the documented temporary-mode operation. Always
    use USE_SUPPLIED_DISPLAY_CONFIG here, including the first switch after boot
    when cached snapshots contain stale adapter IDs. Only startup safety may
    deliberately persist its verified normal layout via apply_snapshot_exact.
    """
    if not paths:
        raise DisplayConfigError("A display topology cannot contain zero paths.")
    path_array = (DISPLAYCONFIG_PATH_INFO * len(paths))()
    for index, path in enumerate(paths):
        path_array[index] = invalidate_topology_indexes(path)
    temporary_flags = SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES
    validate_flags = awareness_set_flags(SDC_VALIDATE | temporary_flags)
    result = user32.SetDisplayConfig(len(paths), path_array, 0, None, validate_flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(validate temporary topology)")
    apply_flags = awareness_set_flags(SDC_APPLY | temporary_flags)
    result = user32.SetDisplayConfig(len(paths), path_array, 0, None, apply_flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(apply temporary topology)")


def invalidate_topology_indexes(path: DISPLAYCONFIG_PATH_INFO) -> DISPLAYCONFIG_PATH_INFO:
    path = duplicate_path(path)
    path.flags |= DISPLAYCONFIG_PATH_ACTIVE
    if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
        path.sourceInfo.cloneGroupId = DISPLAYCONFIG_PATH_CLONE_GROUP_INVALID
        path.sourceInfo.sourceModeInfoIdx = DISPLAYCONFIG_PATH_SOURCE_MODE_IDX_INVALID
        path.targetInfo.desktopModeInfoIdx = DISPLAYCONFIG_PATH_DESKTOP_IMAGE_IDX_INVALID
        path.targetInfo.targetModeInfoIdx = DISPLAYCONFIG_PATH_TARGET_MODE_IDX_INVALID
    else:
        path.sourceInfo.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
        path.targetInfo.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
    return path


def apply_snapshot(snapshot: DisplayConfigSnapshot, save_to_database: bool) -> None:
    path_array = snapshot.path_array()
    mode_array = snapshot.mode_array()
    flags = awareness_set_flags(
        SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | (SDC_SAVE_TO_DATABASE if save_to_database else 0)
    )
    result = user32.SetDisplayConfig(snapshot.path_count, path_array, snapshot.mode_count, mode_array, flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(use supplied snapshot)")


def apply_topology_path(path: DISPLAYCONFIG_PATH_INFO) -> None:
    path_array = (DISPLAYCONFIG_PATH_INFO * 1)(invalidate_topology_indexes(path))
    flags = awareness_set_flags(SDC_APPLY | SDC_TOPOLOGY_SUPPLIED | SDC_ALLOW_PATH_ORDER_CHANGES)
    result = user32.SetDisplayConfig(1, path_array, 0, None, flags)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(topology supplied)")


def restore_database_current() -> None:
    result = user32.SetDisplayConfig(0, None, 0, None, SDC_APPLY | SDC_USE_DATABASE_CURRENT)
    if result != ERROR_SUCCESS:
        raise_win32(result, "SetDisplayConfig(use database current)")


def switch_to_single_gdi_display(keep_display_names: list[str], logger: logging.Logger) -> None:
    devices = enum_display_devices()
    keep_set = {name.upper() for name in keep_display_names}
    logger.info("GDI attached displays:")
    for device in devices:
        bits = [device.name, device.description or "<unnamed>"]
        if device.state_flags & DISPLAY_DEVICE_PRIMARY_DEVICE:
            bits.append("primary")
        bits.append(
            f"{device.devmode.dmPelsWidth}x{device.devmode.dmPelsHeight}@({device.devmode.display.dmPosition.x},{device.devmode.display.dmPosition.y})"
        )
        logger.info("  %s", " | ".join(bits))

    if not keep_set:
        raise DisplayConfigError("No displays were selected to remain active.")

    target_name = keep_display_names[0].upper()
    target = next((device for device in devices if device.name.upper() == target_name), None)
    if target is None:
        raise DisplayConfigError(f"GDI display {target_name} is not attached to the desktop.")

    target_mode = copy.deepcopy(target.devmode)
    target_mode.display.dmPosition.x = 0
    target_mode.display.dmPosition.y = 0
    target_mode.dmFields |= DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT

    result = change_display_settings(target.name, target_mode, CDS_SET_PRIMARY | CDS_UPDATEREGISTRY | CDS_NORESET)
    if result not in (DISP_CHANGE_SUCCESSFUL, DISP_CHANGE_RESTART):
        raise DisplayConfigError(f"Promoting {target.name} to sole primary display failed with DISP_CHANGE={result}")

    for device in devices:
        if device.name.upper() in keep_set:
            continue
        disable_mode = copy.deepcopy(device.devmode)
        disable_mode.display.dmPosition.x = 0
        disable_mode.display.dmPosition.y = 0
        disable_mode.dmPelsWidth = 0
        disable_mode.dmPelsHeight = 0
        disable_mode.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT
        result = change_display_settings(device.name, disable_mode, CDS_UPDATEREGISTRY | CDS_NORESET)
        if result not in (DISP_CHANGE_SUCCESSFUL, DISP_CHANGE_RESTART):
            raise DisplayConfigError(f"Disabling {device.name} failed with DISP_CHANGE={result}")

    result = change_display_settings(None, None, 0)
    if result not in (DISP_CHANGE_SUCCESSFUL, DISP_CHANGE_RESTART):
        raise DisplayConfigError(f"Applying GDI display changes failed with DISP_CHANGE={result}")


def prune_active_paths_to_keep_set(target_display: str, logger: logging.Logger) -> None:
    snapshot, path_array, mode_array = query_display_config(QDC_ONLY_ACTIVE_PATHS)

    def keep_predicate(path: DISPLAYCONFIG_PATH_INFO) -> bool:
        source_name = get_source_name(path).upper()
        return source_name == target_display.upper() or path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST

    filtered = build_filtered_snapshot(path_array, mode_array, snapshot.path_count, keep_predicate)
    logger.info("Pruning active CCD paths to keep the single monitor plus wireless targets only")
    apply_snapshot(filtered, save_to_database=False)


class MonitorToggle:
    def __init__(self, logger: logging.Logger, target_display: str) -> None:
        self.logger = logger
        self.target_display = target_display.upper()
        self.session_paths = snapshot_bundle_paths(config_root(), "session_layout")
        self.legacy_paths = snapshot_bundle_paths(config_root(), "normal_layout")
        self.snapshot_path = self.session_paths["normal"]
        self.snapshot_no_wireless_path = self.session_paths["no_wireless"]
        self.snapshot_no_target_path = self.session_paths["no_target"]
        self.snapshot_no_target_no_wireless_path = self.session_paths["no_target_no_wireless"]
        self.normal_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_wireless_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_target_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_target_no_wireless_snapshot: Optional[DisplayConfigSnapshot] = None
        self.current_state = "unknown"
        self.hotkey_hook = None
        self.hotkey_proc = None
        self.last_toggle_monotonic = 0.0

    def apply_loaded_bundle(self, bundle: dict[str, DisplayConfigSnapshot]) -> None:
        self.normal_snapshot = bundle["normal"]
        self.normal_no_wireless_snapshot = bundle["no_wireless"]
        self.normal_no_target_snapshot = bundle["no_target"]
        self.normal_no_target_no_wireless_snapshot = bundle["no_target_no_wireless"]

    def load_active_profile_bundle(self) -> bool:
        active_slug = read_active_profile_slug()
        if not active_slug:
            return False
        paths = snapshot_bundle_paths(profile_dir_from_slug(active_slug), "layout")
        if not all(path.exists() for path in paths.values()):
            self.logger.warning("Active layout profile %s is incomplete; ignoring it", active_slug)
            return False
        self.apply_loaded_bundle(load_snapshot_bundle(paths))
        self.logger.info("Loaded active saved layout profile: %s", active_slug)
        return True

    def load_session_or_legacy_bundle(self) -> bool:
        for label, paths in (("session", self.session_paths), ("legacy", self.legacy_paths)):
            if not all(path.exists() for path in paths.values()):
                continue
            self.apply_loaded_bundle(load_snapshot_bundle(paths))
            self.logger.info("Loaded %s layout snapshot bundle", label)
            return True
        return False

    def _handle_toggle_trigger(self, source: str) -> None:
        now = time.monotonic()
        if now - self.last_toggle_monotonic < 0.75:
            self.logger.info("Ignoring duplicate toggle trigger from %s", source)
            return
        self.last_toggle_monotonic = now
        self.logger.info("Toggle trigger: %s", source)
        self.toggle()

    def install_keyboard_hook(self) -> None:
        @LowLevelKeyboardProc
        def proc(n_code, w_param, l_param):
            if n_code == HC_ACTION and w_param in (WM_KEYDOWN, WM_SYSKEYDOWN):
                key = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
                ctrl_down = bool(user32.GetAsyncKeyState(VK_CONTROL) & 0x8000)
                shift_down = bool(user32.GetAsyncKeyState(VK_SHIFT) & 0x8000)
                if key.vkCode == VK_F2 and ctrl_down and shift_down:
                    try:
                        self._handle_toggle_trigger("keyboard-hook")
                    except Exception as error:
                        self.logger.exception("Keyboard hook toggle failed: %s", error)
                        if self.normal_snapshot is not None:
                            try:
                                self.restore_normal()
                            except Exception:
                                self.logger.exception("Emergency restore after hook failure also failed")
            return user32.CallNextHookEx(self.hotkey_hook, n_code, w_param, l_param)

        module_handle = kernel32.GetModuleHandleW(None)
        hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, proc, module_handle, 0)
        if not hook:
            raise_win32(ctypes.get_last_error(), "SetWindowsHookExW(WH_KEYBOARD_LL)")
        self.hotkey_proc = proc
        self.hotkey_hook = hook
        self.logger.info("Installed low-level keyboard hook for Ctrl+Shift+F2")

    def uninstall_keyboard_hook(self) -> None:
        if self.hotkey_hook:
            user32.UnhookWindowsHookEx(self.hotkey_hook)
            self.hotkey_hook = None
            self.hotkey_proc = None
            self.logger.info("Keyboard hook uninstalled")

    def log_current_displays(self, title: str, flags: int) -> None:
        snapshot, path_array, mode_array = query_display_config(flags)
        self.logger.info("%s", title)
        for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
            self.logger.info("  %s", line)

    def active_display_count(self) -> int:
        snapshot, _, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        return snapshot.path_count

    def current_source_rect(self, source_name: str) -> Optional[Rect]:
        snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        wanted = source_name.upper()
        for path in path_array[: snapshot.path_count]:
            if get_source_name(path).upper() != wanted:
                continue
            return source_rect_for_path(path, mode_array)
        return None

    def current_target_source_name(self, include_inactive: bool = False) -> Optional[str]:
        query_flag = QDC_ALL_PATHS if include_inactive else QDC_ONLY_ACTIVE_PATHS
        snapshot, path_array, _ = query_display_config(awareness_query_flags(query_flag))
        return resolve_target_source_name(path_array, snapshot.path_count, self.target_display)

    def is_target_attached_to_desktop(self) -> bool:
        return self.current_target_source_name() is not None

    def ensure_target_attached(self) -> None:
        if self.is_target_attached_to_desktop():
            return

        snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
        target_path = select_preferred_source_path(path_array, snapshot.path_count, self.target_display, self.logger)

        if target_path is None:
            raise DisplayConfigError(
                f"Could not find target monitor {self.target_display} in current Windows display paths."
            )

        activate_single_path(target_path, mode_array, self.logger)
        time.sleep(0.4)
        if not self.is_target_attached_to_desktop():
            raise DisplayConfigError(f"Target monitor {self.target_display} still is not attached after activation attempt.")

    def move_windows_off_single_before_restore(self, restore_snapshot: DisplayConfigSnapshot) -> None:
        try:
            single_source_name = self.current_target_source_name()
            if single_source_name is None:
                self.logger.info("No active single source found before restore; skipping pre-restore window move")
                return
            single_rect = self.current_source_rect(single_source_name)
            if single_rect is None:
                self.logger.info("No active single rect found before restore; skipping pre-restore window move")
                return

            destination_rect = preferred_destination_rect(restore_snapshot, exclude_source=single_source_name)
            if destination_rect is None:
                self.logger.info("No destination rect available for pre-restore window move")
                return

            move_windows_from_rect(single_rect, destination_rect, self.logger, "single-monitor disconnect")
        except Exception as error:
            self.logger.warning("Pre-restore single-monitor window move failed: %s", error)

    def recover_windows_after_restore(self, restore_snapshot: DisplayConfigSnapshot) -> None:
        try:
            active_snapshot, _, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            active_rects = snapshot_source_rects(active_snapshot).values()
            destination_rect = preferred_destination_rect(active_snapshot) or preferred_destination_rect(restore_snapshot)
            if destination_rect is None:
                self.logger.info("No destination rect available for post-restore off-screen recovery")
                return

            move_offscreen_windows(active_rects, destination_rect, self.logger)
        except Exception as error:
            self.logger.warning("Post-restore off-screen window recovery failed: %s", error)

    def find_target_path(self) -> DISPLAYCONFIG_PATH_INFO:
        snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
        self.logger.info("Available display paths:")
        for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
            self.logger.info("  %s", line)
        match = select_preferred_source_path(path_array, snapshot.path_count, self.target_display, self.logger)
        if match is None:
            raise DisplayConfigError(
                f"Could not find target monitor {self.target_display}. Run with --list-only to verify the current display mapping."
            )
        return match

    def startup_capture(self) -> None:
        self.logger.info("Capturing current active display layout")
        snapshot, path_array, mode_array, bundle = capture_layout_bundle(self.target_display)
        if snapshot.path_count <= 1 and self.snapshot_path.exists():
            self.logger.warning(
                "Refusing to overwrite saved normal layout because only %d active display path is present",
                snapshot.path_count,
            )
            return
        self.apply_loaded_bundle(bundle)
        save_snapshot_bundle(self.session_paths, bundle)
        self.logger.info("Saved current layout snapshot to %s", self.snapshot_path)
        self.logger.info("Saved non-wireless fallback snapshot to %s", self.snapshot_no_wireless_path)
        self.logger.info("Saved no-target restore snapshot to %s", self.snapshot_no_target_path)
        self.logger.info("Saved no-target/no-wireless fallback snapshot to %s", self.snapshot_no_target_no_wireless_path)
        for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
            self.logger.info("  %s", line)

    def enter_single_only(self) -> None:
        self.logger.info("Attempting %s-only mode", self.target_display)
        if not has_active_wireless_target():
            snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
            target_path = select_preferred_source_path(path_array, snapshot.path_count, self.target_display, self.logger)
            if target_path is None:
                raise DisplayConfigError(
                    f"Could not find target monitor {self.target_display} in current Windows display paths."
                )
            self.logger.info("No active wireless target detected; applying direct reduced-state snapshot")
            activate_single_path(target_path, mode_array, self.logger)
            self.current_state = "single"
            return

        self.ensure_target_attached()
        target_source_name = self.current_target_source_name()
        if target_source_name is None:
            raise DisplayConfigError(f"Target monitor {self.target_display} is not attached after activation attempt.")
        self.logger.info("Resolved target monitor %s to active source %s", self.target_display, target_source_name)
        keep_display_names = get_active_keep_display_names(target_source_name, self.logger)
        self.logger.info("Keeping active displays in reduced state: %s", ", ".join(keep_display_names))
        switch_to_single_gdi_display(keep_display_names, self.logger)
        prune_active_paths_to_keep_set(target_source_name, self.logger)
        self.current_state = "single"

    def restore_normal(self) -> None:
        self.logger.info("Restoring saved multi-monitor layout")
        if self.normal_snapshot is None:
            loaded = self.load_session_or_legacy_bundle()
            if not loaded:
                self.load_active_profile_bundle()
        if self.normal_snapshot is None and self.normal_no_target_snapshot is None:
            raise DisplayConfigError("No saved normal layout is available to restore.")

        preferred_restore = self.normal_no_target_snapshot or self.normal_snapshot
        preferred_no_wireless_restore = self.normal_no_target_no_wireless_snapshot or self.normal_no_wireless_snapshot
        try:
            self.move_windows_off_single_before_restore(preferred_restore)
        except Exception as error:
            self.logger.warning("Pre-restore single-monitor window move failed: %s", error)
        try:
            apply_snapshot(preferred_restore, save_to_database=True)
        except DisplayConfigError as first_error:
            self.logger.warning("In-memory restore failed: %s", first_error)
            disk_restore_error = None
            if self.snapshot_no_target_path.exists():
                try:
                    self.normal_no_target_snapshot = load_snapshot(self.snapshot_no_target_path)
                    apply_snapshot(self.normal_no_target_snapshot, save_to_database=True)
                    self.recover_windows_after_restore(self.normal_no_target_snapshot)
                    self.current_state = "normal"
                    return
                except DisplayConfigError as error:
                    disk_restore_error = error
                    self.logger.warning("On-disk no-target restore failed: %s", error)

            if self.snapshot_path.exists():
                try:
                    self.normal_snapshot = load_snapshot(self.snapshot_path)
                    apply_snapshot(self.normal_snapshot, save_to_database=True)
                    self.recover_windows_after_restore(self.normal_snapshot)
                    self.current_state = "normal"
                    return
                except DisplayConfigError as error:
                    disk_restore_error = error
                    self.logger.warning("On-disk full restore failed: %s", error)

            if preferred_no_wireless_restore is not None:
                self.logger.info("Trying no-wireless fallback restore")
                apply_snapshot(preferred_no_wireless_restore, save_to_database=True)
                self.recover_windows_after_restore(preferred_no_wireless_restore)
                self.current_state = "normal"
                return

            if self.snapshot_no_target_no_wireless_path.exists():
                self.logger.info("Trying on-disk no-target/no-wireless fallback restore")
                self.normal_no_target_no_wireless_snapshot = load_snapshot(self.snapshot_no_target_no_wireless_path)
                apply_snapshot(self.normal_no_target_no_wireless_snapshot, save_to_database=True)
                self.recover_windows_after_restore(self.normal_no_target_no_wireless_snapshot)
                self.current_state = "normal"
                return

            if self.snapshot_no_wireless_path.exists():
                self.logger.info("Trying on-disk non-wireless fallback restore")
                self.normal_no_wireless_snapshot = load_snapshot(self.snapshot_no_wireless_path)
                apply_snapshot(self.normal_no_wireless_snapshot, save_to_database=True)
                self.recover_windows_after_restore(self.normal_no_wireless_snapshot)
                self.current_state = "normal"
                return

            if disk_restore_error is not None:
                self.logger.warning("Falling back to database-current restore because snapshot restore paths failed")
            restore_database_current()
        try:
            self.recover_windows_after_restore(preferred_restore)
        except Exception as error:
            self.logger.warning("Post-restore off-screen window recovery failed: %s", error)
        self.current_state = "normal"

    def is_reduced_state_active(self) -> bool:
        snapshot, path_array, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        target_source_name = self.current_target_source_name()
        if target_source_name is None:
            return False
        saw_target = False
        for path in path_array[: snapshot.path_count]:
            source_name = get_source_name(path).upper()
            if source_name == target_source_name:
                saw_target = True
                continue
            if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
                continue
            return False
        return saw_target

    def toggle_once(self) -> None:
        self.logger.info("One-shot toggle requested")
        if self.is_reduced_state_active():
            self.logger.info("Reduced state detected; restoring saved layout")
            self.restore_normal()
            self.log_current_displays("Display state after one-shot restore", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            return
        self.logger.info("Normal layout detected; capturing snapshot then entering reduced state")
        self.startup_capture()
        self.enter_single_only()
        if has_active_wireless_target():
            self.launch_wireless_drop_watcher()
        self.log_current_displays("Display state after one-shot single-monitor switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

    def launch_wireless_drop_watcher(self) -> None:
        python_exe = Path(sys.executable)
        pythonw_candidate = python_exe.with_name("pythonw.exe")
        launcher = pythonw_candidate if pythonw_candidate.exists() else python_exe
        args = [str(launcher), __file__, "--watch-wireless-drop", "--target-display", self.target_display]
        subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        )
        self.logger.info("Launched wireless-drop watcher")

    def watch_wireless_drop_and_restore(self, poll_seconds: float = 1.0, missing_grace_polls: int = 2) -> None:
        self.logger.info("Wireless-drop watcher started")
        missing_count = 0
        saw_wireless = has_active_wireless_target()
        if saw_wireless:
            self.logger.info("Watcher confirmed wireless display is currently active")
        else:
            self.logger.info("Watcher started without an active wireless target")

        while True:
            time.sleep(poll_seconds)
            reduced = self.is_reduced_state_active()
            wireless_active = has_active_wireless_target()

            if not reduced:
                self.logger.info("Watcher exiting because reduced state is no longer active")
                return

            if wireless_active:
                saw_wireless = True
                missing_count = 0
                continue

            if not saw_wireless:
                self.logger.info("Watcher exiting because no wireless target was ever active")
                return

            missing_count += 1
            self.logger.info("Watcher observed missing wireless target (%d/%d)", missing_count, missing_grace_polls)
            if missing_count < missing_grace_polls:
                continue

            self.logger.info("Wireless target dropped while reduced state is active; restoring saved layout")
            self.restore_normal()
            self.log_current_displays("Display state after wireless-drop auto-restore", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            return

    def toggle(self) -> None:
        self.logger.info("Hotkey pressed: Ctrl+Shift+F2")
        if self.current_state == "single":
            self.restore_normal()
            self.log_current_displays("Display state after restore", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            return
        self.enter_single_only()
        self.log_current_displays("Display state after single-monitor switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

    def run(self) -> None:
        self.logger.info("Toggle Monitors starting")
        self.logger.info("Target monitor selector: %s", self.target_display)
        self.startup_capture()
        self.log_current_displays("Detected active displays before switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        try:
            self.enter_single_only()
        except Exception as error:
            self.logger.exception("Startup switch to single-monitor failed: %s", error)
            self.logger.info("Falling back to the saved normal layout")
            try:
                self.restore_normal()
            except Exception:
                self.logger.exception("Fallback restore failed")
            else:
                self.log_current_displays("Display state after fallback restore", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

        if not user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, VK_F2):
            raise_win32(ctypes.get_last_error(), "RegisterHotKey(Ctrl+Shift+F2)")
        self.logger.info("Registered global hotkey Ctrl+Shift+F2")
        self.install_keyboard_hook()

        msg = wintypes.MSG()
        try:
            while True:
                status = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if status == -1:
                    raise_win32(ctypes.get_last_error(), "GetMessageW")
                if status == 0:
                    break
                if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
                    try:
                        self._handle_toggle_trigger("register-hotkey")
                    except Exception as error:
                        self.logger.exception("Hotkey toggle failed: %s", error)
                        if self.normal_snapshot is not None:
                            try:
                                self.restore_normal()
                            except Exception:
                                self.logger.exception("Emergency restore after toggle failure also failed")
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
        finally:
            self.uninstall_keyboard_hook()
            user32.UnregisterHotKey(None, HOTKEY_ID)
            self.logger.info("Hotkey unregistered; exiting")


def button_state_paths(state_root: Path) -> dict[str, Path]:
    state_root.mkdir(parents=True, exist_ok=True)
    return {
        "full": state_root / "toggle-monitors-full.json",
        "full_no_wireless": state_root / "toggle-monitors-full-no-wireless.json",
        "reduced": state_root / "toggle-monitors-reduced.json",
        "reduced_no_wireless": state_root / "toggle-monitors-reduced-no-wireless.json",
        "metadata": state_root / BUTTON_STATE_FILENAME,
    }


def active_owner_path() -> Path:
    return config_root() / ACTIVE_OWNER_FILENAME


def read_json_object(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def write_json_object(path: Path, payload: dict[str, object]) -> None:
    write_text_atomic(path, json.dumps(payload, indent=2, sort_keys=True))


def owner_id_for_path(path: Path) -> str:
    normalized = str(path.resolve()).casefold().encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()[:24]


def configuration_fingerprint_for_groups(group_1: Iterable[str], group_2: Iterable[str]) -> str:
    payload = {
        "group_1": sorted({str(selector).strip() for selector in group_1 if str(selector).strip()}),
        "group_2": sorted({str(selector).strip() for selector in group_2 if str(selector).strip()}),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def invalidate_active_owner_after_configuration(
    config_path: Path,
    group_1: Iterable[str],
    group_2: Iterable[str],
) -> None:
    marker = read_json_object(active_owner_path())
    owner_id = owner_id_for_path(config_path)
    if str(marker.get("owner_id", "")) != owner_id:
        return
    write_json_object(
        active_owner_path(),
        {
            "active": False,
            "phase": "reconfigured",
            "owner_id": owner_id,
            "physical_keys": [],
            "topology_signature": "",
            "configuration_fingerprint": configuration_fingerprint_for_groups(group_1, group_2),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )


def target_key_sets(path_array, path_count: int) -> tuple[set[str], set[str]]:
    physical: set[str] = set()
    wireless: set[str] = set()
    for path in path_array[:path_count]:
        key = target_identity_key(path)
        if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
            wireless.add(key)
        else:
            physical.add(key)
    return physical, wireless


def available_physical_target_keys(path_array, path_count: int) -> set[str]:
    return {
        target_identity_key(path)
        for path in path_array[:path_count]
        if path.targetInfo.outputTechnology != DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST
        and bool(path.targetInfo.targetAvailable)
    }


def topology_fingerprint(path_array, mode_array, path_count: int) -> str:
    records: list[dict[str, object]] = []
    for path in path_array[:path_count]:
        source_mode = source_mode_for_path(path, mode_array)
        source_payload: Optional[dict[str, int]] = None
        if source_mode is not None and source_mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE:
            source_payload = {
                "x": int(source_mode.sourceMode.position.x),
                "y": int(source_mode.sourceMode.position.y),
                "w": int(source_mode.sourceMode.width),
                "h": int(source_mode.sourceMode.height),
            }
        records.append(
            {
                "target": target_identity_key(path),
                "source": source_identity_key(path),
                "wireless": path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
                "mode": source_payload,
            }
        )
    encoded = json.dumps(records, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def clear_active_owner_after_startup_safety(physical_keys: set[str], topology_signature: str) -> None:
    write_json_object(
        active_owner_path(),
        {
            "active": False,
            "phase": "restore_all_available",
            "owner_id": "",
            "physical_keys": sorted(physical_keys),
            "topology_signature": topology_signature,
            "configuration_fingerprint": "",
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )


def startup_safety_target_descriptors(path_array, path_count: int) -> list[TargetDescriptor]:
    """Discover every available display, independent of saved toggle groups."""
    candidates: dict[str, TargetDescriptor] = {}
    for path in path_array[:path_count]:
        if not path.targetInfo.targetAvailable:
            continue
        descriptor = target_descriptor_from_path(path)
        candidates.setdefault(descriptor.identity_key(), descriptor)
    return list(candidates.values())


def restore_all_available_monitors_once(
    button_config_path: Path,
    logger: logging.Logger,
    *,
    persist_database: bool,
    expected_keys: Optional[frozenset[str]] = None,
) -> tuple[frozenset[str], bool]:
    """Restore every available target, independently of Button groups.

    button_config_path is retained for compatibility with existing task callers;
    neither that file nor either toggle group determines the safety monitor set.
    """
    topology_lock = SingleInstance(GLOBAL_TOPOLOGY_MUTEX)
    if not topology_lock.acquire():
        raise DisplayConfigError("Another monitor layout change is already in progress. Try again in a moment.")

    active_snapshot: Optional[DisplayConfigSnapshot] = None
    database_snapshot: Optional[DisplayConfigSnapshot] = None
    topology_may_have_changed = False
    database_was_changed = False
    try:
        active_snapshot, active_paths, _ = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        all_snapshot, all_paths, _ = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
        descriptors = startup_safety_target_descriptors(all_paths, all_snapshot.path_count)
        if not descriptors:
            raise DisplayConfigError("No monitor is currently available; leaving the display topology unchanged.")

        desired_keys = {descriptor.identity_key() for descriptor in descriptors}
        desired_frozen = frozenset(desired_keys)
        persist_this_pass = persist_database and (expected_keys is None or desired_frozen == expected_keys)
        current_physical, current_wireless = target_key_sets(active_paths, active_snapshot.path_count)

        if persist_this_pass:
            database_snapshot, _, _ = query_display_config(awareness_query_flags(QDC_DATABASE_CURRENT))

        if current_physical | current_wireless != desired_keys:
            chosen = choose_distinct_target_paths(descriptors, all_paths, all_snapshot.path_count, include_wireless=True)
            topology_may_have_changed = True
            validate_and_apply_topology(chosen)
        else:
            logger.info("Startup safety found every available monitor already active")

        verified_snapshot, verified_paths, verified_modes = query_display_config(
            awareness_query_flags(QDC_ONLY_ACTIVE_PATHS)
        )
        verified_physical, verified_wireless = target_key_sets(verified_paths, verified_snapshot.path_count)
        verified_keys = verified_physical | verified_wireless
        if verified_keys != desired_keys:
            raise DisplayConfigError("Windows did not activate exactly the available monitor set.")

        if not persist_this_pass:
            logger.info(
                "Startup safety temporarily restored %d monitor(s) while enumeration stabilizes",
                len(verified_keys),
            )
            return frozenset(verified_keys), False

        # Group toggles are session-only. This verified normal layout is the one
        # topology deliberately persisted for the next cold-boot sign-in screen.
        topology_may_have_changed = True
        apply_snapshot_exact(verified_snapshot, save_to_database=True)
        database_was_changed = True
        final_snapshot, final_paths, final_modes = query_display_config(
            awareness_query_flags(QDC_ONLY_ACTIVE_PATHS)
        )
        final_physical, final_wireless = target_key_sets(final_paths, final_snapshot.path_count)
        final_keys = final_physical | final_wireless
        if final_keys != desired_keys:
            raise DisplayConfigError("The persisted startup-safe topology did not retain the available monitor set.")

        signature = topology_fingerprint(final_paths, final_modes, final_snapshot.path_count)
        clear_active_owner_after_startup_safety(final_physical, signature)
        logger.info(
            "Startup safety restored and persisted %d available monitor(s)",
            len(final_keys),
        )
        return frozenset(final_keys), True
    except Exception:
        if database_was_changed and database_snapshot is not None:
            try:
                apply_snapshot_exact(database_snapshot, save_to_database=True)
            except Exception:
                logger.exception("Persistent-database rollback after startup-safety failure also failed")
        if topology_may_have_changed and active_snapshot is not None:
            try:
                apply_snapshot_exact(active_snapshot, save_to_database=False)
            except Exception:
                logger.exception("Emergency rollback after startup-safety failure also failed")
        raise
    finally:
        topology_lock.release()


def restore_all_available_monitors(
    button_config_path: Path,
    logger: logging.Logger,
    attempts: int = 6,
    retry_seconds: float = 2.0,
) -> frozenset[str]:
    """Retry until the connected normal-monitor set is stable across two passes."""
    attempt_count = max(1, int(attempts))
    last_keys: Optional[frozenset[str]] = None
    last_error: Optional[Exception] = None

    for attempt in range(1, attempt_count + 1):
        try:
            keys, persisted = restore_all_available_monitors_once(
                button_config_path,
                logger,
                persist_database=attempt_count == 1 or last_keys is not None,
                expected_keys=last_keys,
            )
            last_error = None
            if persisted:
                return keys
            last_keys = keys
        except Exception as error:
            last_error = error
            logger.warning("Startup-safety restore attempt %d/%d failed: %s", attempt, attempt_count, error)
        if attempt < attempt_count:
            time.sleep(max(0.0, retry_seconds))

    if last_error is not None:
        raise last_error
    raise DisplayConfigError("Startup safety could not observe a stable available topology.")


def startup_safety_trigger_reason(message: int, wparam: int) -> Optional[str]:
    if message == WM_POWERBROADCAST and wparam == PBT_APMRESUMEAUTOMATIC:
        return "automatic-resume"
    if message == WM_WTSSESSION_CHANGE and wparam == WTS_SESSION_LOCK:
        return "session-lock"
    if message == WM_WTSSESSION_CHANGE and wparam == WTS_SESSION_UNLOCK:
        return "session-unlock"
    return None


class StartupSafetyGuardian:
    """Hidden interactive-session listener for sleep/resume and lock transitions."""

    def __init__(self, logger: logging.Logger, button_config_path: Path) -> None:
        self.logger = logger
        self.button_config_path = button_config_path
        self.request_event = threading.Event()
        self.stop_event = threading.Event()
        self.request_lock = threading.Lock()
        self.pending_reason = "guardian-start"
        self.window_proc = WindowProc(self._window_proc)
        self.worker = threading.Thread(target=self._worker_loop, name="ToggleMonitorsStartupSafety", daemon=True)

    def request_restore(self, reason: str) -> None:
        with self.request_lock:
            self.pending_reason = reason
        self.request_event.set()

    def _worker_loop(self) -> None:
        while not self.stop_event.is_set():
            if not self.request_event.wait(1.0):
                continue
            self.request_event.clear()
            with self.request_lock:
                reason = self.pending_reason
            attempts = 1 if reason == "session-lock" else 8
            self.logger.info("Startup-safety guardian handling %s", reason)
            try:
                restore_all_available_monitors(
                    self.button_config_path,
                    self.logger,
                    attempts=attempts,
                    retry_seconds=2.0,
                )
            except Exception:
                self.logger.exception("Startup-safety guardian could not restore monitors after %s", reason)

    def _window_proc(self, hwnd, message, wparam, lparam):
        reason = startup_safety_trigger_reason(int(message), int(wparam))
        if reason is not None:
            self.request_restore(reason)
            return 0
        if message == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, message, wparam, lparam)

    def run(self) -> None:
        instance_handle = kernel32.GetModuleHandleW(None)
        class_name = f"FlowCellToggleMonitorsStartupSafety-{os.getpid()}"
        window_class = WNDCLASSW()
        window_class.lpfnWndProc = self.window_proc
        window_class.hInstance = instance_handle
        window_class.lpszClassName = class_name
        if not user32.RegisterClassW(ctypes.byref(window_class)):
            raise_win32(ctypes.get_last_error(), "RegisterClassW(startup safety)")

        hwnd = user32.CreateWindowExW(
            0,
            class_name,
            "FlowCell Toggle Monitors Startup Safety",
            0,
            0,
            0,
            0,
            0,
            None,
            None,
            instance_handle,
            None,
        )
        if not hwnd:
            user32.UnregisterClassW(class_name, instance_handle)
            raise_win32(ctypes.get_last_error(), "CreateWindowExW(startup safety)")

        registered_for_session = bool(
            wtsapi32.WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)
        )
        if not registered_for_session:
            self.logger.warning(
                "WTS session notifications are unavailable: %s",
                ctypes.FormatError(ctypes.get_last_error()),
            )

        self.worker.start()
        self.request_restore("guardian-start")
        self.logger.info("Startup-safety guardian is listening for resume, lock, and unlock")
        try:
            message = wintypes.MSG()
            while True:
                result = int(user32.GetMessageW(ctypes.byref(message), None, 0, 0))
                if result == -1:
                    raise_win32(ctypes.get_last_error(), "GetMessageW(startup safety)")
                if result == 0:
                    break
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
        finally:
            self.stop_event.set()
            self.request_event.set()
            if registered_for_session:
                wtsapi32.WTSUnRegisterSessionNotification(hwnd)
            user32.DestroyWindow(hwnd)
            user32.UnregisterClassW(class_name, instance_handle)


def run_startup_safety_guardian(button_config_path: Path, logger: logging.Logger) -> None:
    instance = SingleInstance(STARTUP_SAFETY_MUTEX)
    if not instance.acquire():
        logger.info("Startup-safety guardian is already running; exiting")
        return
    try:
        StartupSafetyGuardian(logger, button_config_path).run()
    finally:
        instance.release()


class ButtonMonitorToggle:
    """One-shot toggle between two explicit, package-owned monitor groups."""

    def __init__(
        self,
        logger: logging.Logger,
        group_1_selectors: list[str],
        group_2_selectors: list[str],
        state_root: Path,
        button_config_path: Optional[Path] = None,
    ) -> None:
        if not group_1_selectors or not group_2_selectors:
            raise DisplayConfigError("Choose at least one monitor in both Group 1 and Group 2.")
        self.logger = logger
        self.group_selectors = {1: list(group_1_selectors), 2: list(group_2_selectors)}
        self.group_descriptors: dict[int, list[TargetDescriptor]] = {1: [], 2: []}
        self.group_keys: dict[int, list[str]] = {1: [], 2: []}
        self.group_unavailable_labels: dict[int, list[str]] = {1: [], 2: []}
        self.state_root = state_root
        self.button_config_path = button_config_path
        self.paths = button_state_paths(state_root)
        self.owner_id = owner_id_for_path(button_config_path or state_root)

    def configuration_fingerprint(self) -> str:
        return configuration_fingerprint_for_groups(self.group_selectors[1], self.group_selectors[2])

    def marker_matches_configuration(self, marker: dict[str, object]) -> bool:
        return str(marker.get("configuration_fingerprint", "")) == self.configuration_fingerprint()

    def resolve_groups(self) -> None:
        snapshot, path_array, _ = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
        for side in (1, 2):
            descriptors, unavailable_labels = resolve_available_target_descriptors(
                self.group_selectors[side],
                path_array,
                snapshot.path_count,
            )
            self.group_descriptors[side] = descriptors
            self.group_keys[side] = [descriptor.identity_key() for descriptor in descriptors]
            self.group_unavailable_labels[side] = unavailable_labels

        unavailable_lines = [
            f"Group {side}: {', '.join(self.group_unavailable_labels[side])}"
            for side in (1, 2)
            if self.group_unavailable_labels[side]
        ]
        blocking_reason = ""
        empty_sides = [str(side) for side in (1, 2) if not self.group_keys[side]]
        if empty_sides:
            blocking_reason = (
                f"Group {' and '.join(empty_sides)} has no connected monitors, so Toggle Monitors cannot continue."
            )
        elif set(self.group_keys[1]) == set(self.group_keys[2]):
            blocking_reason = (
                "The connected monitors make Group 1 and Group 2 identical, so Toggle Monitors cannot continue."
            )

        if unavailable_lines:
            self.logger.info(
                "Ignoring configured monitors that are not connected or currently available: %s",
                " | ".join(unavailable_lines),
            )
        if blocking_reason:
            raise DisplayConfigError(blocking_reason)
        self.logger.info("Group 1 physical targets: %s", ", ".join(self.group_keys[1]))
        self.logger.info("Group 2 physical targets: %s", ", ".join(self.group_keys[2]))

    def query_active(self):
        return query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

    def current_topology_state(self) -> tuple[set[str], set[str], str]:
        snapshot, path_array, mode_array = self.query_active()
        physical, wireless = target_key_sets(path_array, snapshot.path_count)
        return physical, wireless, topology_fingerprint(path_array, mode_array, snapshot.path_count)

    def current_side(self, physical: set[str]) -> Optional[int]:
        if physical == set(self.group_keys[1]):
            return 1
        if physical == set(self.group_keys[2]):
            return 2
        return None

    def read_metadata(self) -> dict[str, object]:
        return read_json_object(self.paths["metadata"])

    def write_metadata(self, **updates: object) -> None:
        metadata = self.read_metadata()
        metadata.update(
            {
                "schema": BUTTON_CONFIG_SCHEMA,
                "owner_id": self.owner_id,
                "group_1_tokens": self.group_selectors[1],
                "group_1_keys": self.group_keys[1],
                "group_2_tokens": self.group_selectors[2],
                "group_2_keys": self.group_keys[2],
                # Retain the schema-2 aliases so an older installed source can
                # still recognize Group 2 without corrupting the saved sides.
                "selected_tokens": self.group_selectors[2],
                "selected_keys": self.group_keys[2],
            }
        )
        metadata.update(updates)
        write_json_object(self.paths["metadata"], metadata)

    def owner_marker(self) -> dict[str, object]:
        return read_json_object(active_owner_path())

    def marker_matches_current(
        self,
        marker: dict[str, object],
        physical: set[str],
        topology_signature: Optional[str] = None,
    ) -> bool:
        marker_keys = marker.get("physical_keys", [])
        if not (bool(marker.get("active")) and isinstance(marker_keys, list) and set(map(str, marker_keys)) == physical):
            return False
        saved_signature = str(marker.get("topology_signature", ""))
        if saved_signature and topology_signature is not None:
            return saved_signature == topology_signature
        return True

    def reject_foreign_group_2_owner(self, physical: set[str]) -> None:
        marker = self.owner_marker()
        if (
            marker.get("owner_id")
            and str(marker.get("owner_id")) != self.owner_id
            and self.marker_matches_current(marker, physical)
        ):
            raise DisplayConfigError(
                "Another Toggle Monitors Button currently owns this Group 2 layout. "
                "Use that Button to return to Group 1 before switching this one."
            )

    def mark_group_2_owner(self, physical: set[str], topology_signature: str) -> None:
        write_json_object(
            active_owner_path(),
            {
                "active": True,
                "phase": "group_2",
                "owner_id": self.owner_id,
                "physical_keys": sorted(physical),
                "topology_signature": topology_signature,
                "configuration_fingerprint": self.configuration_fingerprint(),
                "state_root": str(self.state_root),
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
        )

    def clear_group_2_owner(self) -> None:
        marker = self.owner_marker()
        if str(marker.get("owner_id", "")) != self.owner_id:
            return
        write_json_object(
            active_owner_path(),
            {
                "active": False,
                "phase": "group_1",
                "owner_id": self.owner_id,
                "physical_keys": [],
                "topology_signature": "",
                "configuration_fingerprint": self.configuration_fingerprint(),
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            },
        )

    def side_paths(self, side: int) -> tuple[Path, Path]:
        if side == 1:
            return self.paths["full"], self.paths["full_no_wireless"]
        if side == 2:
            return self.paths["reduced"], self.paths["reduced_no_wireless"]
        raise DisplayConfigError(f"Unknown Toggle Monitors group: {side}")

    def saved_side_matches_configuration(self, side: int) -> bool:
        normal_path, _ = self.side_paths(side)
        if not normal_path.exists():
            return False
        metadata = self.read_metadata()
        key_name = "full_physical_keys" if side == 1 else "reduced_physical_keys"
        saved_keys = metadata.get(key_name, [])
        if not (isinstance(saved_keys, list) and set(map(str, saved_keys)) == set(self.group_keys[side])):
            return False
        try:
            self.load_matching_side_snapshot(side, normal_path)
        except (OSError, KeyError, TypeError, ValueError, binascii.Error, DisplayConfigError) as error:
            self.logger.warning("Ignoring invalid saved Group %d layout: %s", side, error)
            return False
        return True

    def load_matching_side_snapshot(self, side: int, path: Path) -> DisplayConfigSnapshot:
        snapshot = load_snapshot(path)
        physical, _ = target_key_sets(snapshot.path_array(), snapshot.path_count)
        expected = set(self.group_keys[side])
        if physical != expected:
            raise DisplayConfigError(
                f"Saved Group {side} layout targets do not match its configured connected monitors."
            )
        return snapshot

    def capture_side_layout(self, side: int, snapshot: DisplayConfigSnapshot, path_array) -> None:
        physical, wireless = target_key_sets(path_array, snapshot.path_count)
        expected = set(self.group_keys[side])
        if physical != expected:
            raise DisplayConfigError(f"Refusing to capture an unmatched layout as Group {side}.")
        if self.group_unavailable_labels[side]:
            self.logger.info(
                "Skipping Group %d snapshot capture while configured monitors are unavailable",
                side,
            )
            return
        normal_path, no_wireless_path = self.side_paths(side)
        save_snapshot(snapshot, normal_path)
        save_snapshot(build_no_wireless_snapshot(snapshot), no_wireless_path)
        prefix = "full" if side == 1 else "reduced"
        self.write_metadata(
            **{
                f"{prefix}_physical_keys": sorted(physical),
                f"{prefix}_wireless_keys": sorted(wireless),
            }
        )
        self.logger.info("Captured Group %d layout for this Button: %s", side, normal_path)

    def verify_group_state(self, side: int, path_array, path_count: int) -> tuple[set[str], set[str]]:
        physical, wireless = target_key_sets(path_array, path_count)
        if physical != set(self.group_keys[side]):
            raise DisplayConfigError(f"Windows did not activate exactly the configured Group {side} monitor set.")
        return physical, wireless

    def apply_saved_side(self, side: int) -> None:
        normal_path, no_wireless_path = self.side_paths(side)
        snapshot = self.load_matching_side_snapshot(side, normal_path)
        no_wireless_snapshot: Optional[DisplayConfigSnapshot] = None
        if no_wireless_path.exists():
            try:
                no_wireless_snapshot = self.load_matching_side_snapshot(side, no_wireless_path)
            except (OSError, KeyError, TypeError, ValueError, binascii.Error, DisplayConfigError) as error:
                self.logger.warning("Ignoring invalid no-wireless Group %d layout: %s", side, error)
        try:
            apply_snapshot_exact(snapshot, save_to_database=False)
        except DisplayConfigError as exact_error:
            if no_wireless_snapshot is None:
                raise
            self.logger.warning("Exact Group %d restore failed; trying its no-wireless copy: %s", side, exact_error)
            apply_snapshot_exact(no_wireless_snapshot, save_to_database=False)

    def activate_side(
        self,
        side: int,
        current_snapshot: DisplayConfigSnapshot,
        current_paths,
    ):
        target_keys = set(self.group_keys[side])
        current_physical, _ = target_key_sets(current_paths, current_snapshot.path_count)
        if self.saved_side_matches_configuration(side):
            self.apply_saved_side(side)
        elif target_keys.issubset(current_physical):
            selected = build_selected_snapshot(current_snapshot, self.group_keys[side], preserve_wireless=True)
            apply_snapshot_exact(selected, save_to_database=False)
        else:
            all_snapshot, all_paths, _ = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
            chosen = choose_distinct_target_paths(self.group_descriptors[side], all_paths, all_snapshot.path_count)
            for path in current_paths[: current_snapshot.path_count]:
                if path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST:
                    chosen.append(duplicate_path(path))
            validate_and_apply_topology(chosen)

        active_snapshot, active_paths, active_modes = self.query_active()
        physical, wireless = self.verify_group_state(side, active_paths, active_snapshot.path_count)
        self.capture_side_layout(side, active_snapshot, active_paths)
        return active_snapshot, active_paths, active_modes, physical, wireless

    def launch_wireless_drop_watcher(self) -> None:
        if self.button_config_path is None:
            self.logger.warning("Skipping wireless-drop watcher because this toggle has no Button config path")
            return
        python_exe = Path(sys.executable)
        pythonw_candidate = python_exe.with_name("pythonw.exe")
        launcher = pythonw_candidate if pythonw_candidate.exists() else python_exe
        subprocess.Popen(
            [
                str(launcher),
                __file__,
                "--watch-wireless-drop",
                "--button-config",
                str(self.button_config_path),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        )
        self.logger.info("Launched per-Button wireless-drop watcher")

    def switch_to_side(
        self,
        target_side: int,
        active_snapshot: DisplayConfigSnapshot,
        active_paths,
        active_modes,
        source_side: Optional[int],
    ) -> None:
        current_physical, _ = target_key_sets(active_paths, active_snapshot.path_count)
        current_signature = topology_fingerprint(active_paths, active_modes, active_snapshot.path_count)
        if source_side is not None:
            self.capture_side_layout(source_side, active_snapshot, active_paths)
        else:
            self.logger.info("Current layout matches neither configured group; applying Group 1 without capturing it")

        source_label = f"group_{source_side}" if source_side is not None else "unmatched"
        self.write_metadata(transition=f"{source_label}_to_group_{target_side}")
        try:
            target_snapshot, target_paths, target_modes, physical, wireless = self.activate_side(
                target_side,
                active_snapshot,
                active_paths,
            )
            target_signature = topology_fingerprint(target_paths, target_modes, target_snapshot.path_count)
            if target_side == 2:
                self.mark_group_2_owner(physical, target_signature)
                if wireless:
                    self.launch_wireless_drop_watcher()
            else:
                self.clear_group_2_owner()
            self.write_metadata(transition=f"group_{target_side}")
        except Exception:
            try:
                # A failed SetDisplayConfig can retain the same monitor set and
                # desktop geometry while changing rotation, refresh, or target
                # modes. Restore the complete pre-switch snapshot unconditionally.
                apply_snapshot_exact(active_snapshot, save_to_database=False)
                if source_side == 2:
                    self.mark_group_2_owner(current_physical, current_signature)
                elif source_side == 1:
                    self.clear_group_2_owner()
                self.write_metadata(transition=source_label)
            except Exception:
                self.logger.exception("Emergency rollback after monitor-group switch failure also failed")
            raise

    def restore_full(self) -> None:
        if not self.group_keys[1] or not self.group_keys[2]:
            self.resolve_groups()
        active_snapshot, active_paths, active_modes = self.query_active()
        physical, _ = target_key_sets(active_paths, active_snapshot.path_count)
        source_side = self.current_side(physical)
        if source_side == 1:
            self.clear_group_2_owner()
            self.write_metadata(transition="group_1")
            return
        self.switch_to_side(1, active_snapshot, active_paths, active_modes, source_side)

    def toggle_once(self) -> None:
        topology_lock = SingleInstance(GLOBAL_TOPOLOGY_MUTEX)
        if not topology_lock.acquire():
            raise DisplayConfigError("Another monitor layout change is already in progress. Try again in a moment.")
        try:
            self.resolve_groups()
            active_snapshot, active_paths, active_modes = self.query_active()
            current_physical, _ = target_key_sets(active_paths, active_snapshot.path_count)
            self.reject_foreign_group_2_owner(current_physical)
            source_side = self.current_side(current_physical)
            target_side = 2 if source_side == 1 else 1
            self.switch_to_side(target_side, active_snapshot, active_paths, active_modes, source_side)
        finally:
            topology_lock.release()

    def watch_wireless_drop_and_restore(self, poll_seconds: float = 1.0, missing_grace_polls: int = 2) -> None:
        if not self.group_keys[1] or not self.group_keys[2]:
            self.resolve_groups()
        configuration_fingerprint = self.configuration_fingerprint()
        metadata = self.read_metadata()
        expected_wireless = metadata.get("reduced_wireless_keys", [])
        _, initial_wireless, _ = self.current_topology_state()
        saw_wireless = bool(isinstance(expected_wireless, list) and expected_wireless) or bool(initial_wireless)
        missing_count = 0
        while True:
            time.sleep(poll_seconds)
            physical, wireless, _ = self.current_topology_state()
            marker = self.owner_marker()
            if (
                str(marker.get("owner_id", "")) != self.owner_id
                or str(marker.get("configuration_fingerprint", "")) != configuration_fingerprint
                or not self.marker_matches_current(marker, physical)
            ):
                self.logger.info("Watcher exiting because this Button no longer owns the active Group 2 topology")
                return
            if wireless:
                saw_wireless = True
                missing_count = 0
                continue
            if not saw_wireless:
                self.logger.info("Watcher exiting because no wireless target was observed")
                return
            missing_count += 1
            if missing_count < missing_grace_polls:
                continue
            topology_lock = SingleInstance(GLOBAL_TOPOLOGY_MUTEX)
            if not topology_lock.acquire():
                self.logger.info("Watcher exiting because another topology change is in progress")
                return
            try:
                physical, _, _ = self.current_topology_state()
                marker = self.owner_marker()
                if (
                    str(marker.get("owner_id", "")) == self.owner_id
                    and str(marker.get("configuration_fingerprint", "")) == configuration_fingerprint
                    and self.marker_matches_current(marker, physical)
                ):
                    self.restore_full()
            finally:
                topology_lock.release()
            return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Toggle between two explicitly configured physical monitor groups.")
    parser.add_argument("--list-only", action="store_true", help="Log all active and available display paths, then exit.")
    parser.add_argument("--save-layout", metavar="NAME", help="Save the current active layout under a friendly name and make it the active saved profile.")
    parser.add_argument("--set-active-layout", metavar="NAME", help="Mark an existing saved layout name as the active profile for future restores.")
    parser.add_argument("--apply-layout", metavar="NAME", help="Apply a saved layout now and also mark it as the active profile.")
    parser.add_argument("--list-layouts-json", action="store_true", help="Print saved layout profile metadata as JSON.")
    parser.add_argument("--toggle-once", action="store_true", help="Toggle once and exit instead of running the background hotkey service.")
    parser.add_argument("--watch-wireless-drop", action="store_true", help="Watch Group 2 and restore Group 1 if its wireless display disappears.")
    parser.add_argument(
        "--restore-all-available",
        action="store_true",
        help="Restore and persist every available monitor, including dummy targets; independent of toggle groups.",
    )
    parser.add_argument(
        "--startup-safety-guardian",
        action="store_true",
        help="Run the hidden guardian that restores available monitors at logon, resume, lock, and unlock.",
    )
    parser.add_argument("--list-displays", action="store_true", help="Write the available monitors (one 'label<TAB>selector' line each) for the launcher's picker, then exit.")
    parser.add_argument("--configure-button", action="store_true", help="Open the two-group checkbox picker for one Button owner.")
    parser.add_argument("--out", metavar="FILE", help="Write --list-displays output to this file instead of stdout (needed under pythonw.exe).")
    parser.add_argument(
        "--button-config",
        metavar="FILE",
        help="Load this Button owner's Group 1 and Group 2 configuration and keep snapshots beside it.",
    )
    parser.add_argument("--pythonw-path", help="Python launcher path to preserve when --configure-button saves the Button config.")
    parser.add_argument(
        "--target-display",
        default=DEFAULT_TARGET_DISPLAY,
        help="Monitor selector (friendly name, monitor device path, or GDI source) to toggle to. The launcher supplies this; there is no built-in default.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logger = setup_logging()
    logger.info("Process started with arguments: %s", " ".join(sys.argv[1:]) or "<none>")

    if args.startup_safety_guardian:
        if not args.button_config:
            raise DisplayConfigError("--startup-safety-guardian requires --button-config.")
        run_startup_safety_guardian(Path(args.button_config).resolve(), logger)
        return 0

    if args.restore_all_available:
        if not args.button_config:
            raise DisplayConfigError("--restore-all-available requires --button-config.")
        restore_all_available_monitors(Path(args.button_config).resolve(), logger)
        return 0

    if args.configure_button:
        if not args.button_config:
            raise DisplayConfigError("--configure-button requires --button-config.")
        config_path = Path(args.button_config).resolve()
        pythonw_path = str(args.pythonw_path or sys.executable)
        configured = configure_button_groups(config_path, pythonw_path, logger)
        return 0 if configured else CONFIGURATION_CANCELLED_EXIT_CODE

    if args.save_layout:
        result = save_named_layout_profile(args.save_layout, args.target_display, logger)
        if sys.stdout and sys.stdout.isatty():
            print(json.dumps(result, indent=2))
        return 0

    if args.set_active_layout:
        result = set_active_layout_profile(args.set_active_layout)
        logger.info("Set active saved layout profile to %s", result.get("slug"))
        if sys.stdout and sys.stdout.isatty():
            print(json.dumps(result, indent=2))
        return 0

    if args.apply_layout:
        result = apply_layout_profile(args.apply_layout, args.target_display, logger)
        logger.info("Applied saved layout profile %s", result.get("slug"))
        if sys.stdout and sys.stdout.isatty():
            print(json.dumps(result, indent=2))
        return 0

    if args.list_layouts_json:
        payload = list_layout_profiles()
        print(json.dumps(payload, indent=2))
        return 0

    if args.list_displays:
        write_display_list(args.out)
        return 0

    if args.toggle_once:
        if not args.button_config:
            raise DisplayConfigError("--toggle-once requires a two-group --button-config.")
        button_config_path = Path(args.button_config).resolve()
        group_1, group_2 = selector_groups_from_button_config(button_config_path)
        ButtonMonitorToggle(logger, group_1, group_2, button_config_path.parent, button_config_path).toggle_once()
        return 0

    if args.watch_wireless_drop:
        if not args.button_config:
            raise DisplayConfigError("--watch-wireless-drop requires a two-group --button-config.")
        button_config_path = Path(args.button_config).resolve()
        group_1, group_2 = selector_groups_from_button_config(button_config_path)
        toggle = ButtonMonitorToggle(logger, group_1, group_2, button_config_path.parent, button_config_path)
        toggle.resolve_groups()
        fingerprint = toggle.configuration_fingerprint()[:16]
        instance = SingleInstance(f"Local\\ToggleMonitorsWirelessWatch-{toggle.owner_id}-{fingerprint}")
        if not instance.acquire():
            logger.info("This Button's wireless-drop watcher is already running; exiting")
            return 0
        try:
            toggle.watch_wireless_drop_and_restore()
            return 0
        finally:
            instance.release()

    instance = SingleInstance("Local\\ToggleMonitorsHotkey")
    if not instance.acquire():
        logger.info("Another Toggle Monitors instance is already running; exiting")
        return 0

    try:
        if args.list_only:
            logger.info("Listing current display configuration only")
            snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            logger.info("Active display paths:")
            for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
                logger.info("  %s", line)
            snapshot, path_array, mode_array = query_display_config(awareness_query_flags(QDC_ALL_PATHS))
            logger.info("All available display paths:")
            for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
                logger.info("  %s", line)
            return 0

        MonitorToggle(logger, args.target_display).run()
        return 0
    finally:
        instance.release()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DisplayConfigError as error:
        logging.getLogger("toggle-monitors").exception("Fatal error: %s", error)
        raise SystemExit(1)
