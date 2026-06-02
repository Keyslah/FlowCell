#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import copy
import ctypes
import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from ctypes import wintypes


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

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

ERROR_SUCCESS = 0
ERROR_INSUFFICIENT_BUFFER = 122
ERROR_ALREADY_EXISTS = 183

WM_HOTKEY = 0x0312
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
MOD_SHIFT = 0x0004
MOD_CONTROL = 0x0002
VK_F2 = 0x71
VK_CONTROL = 0x11
VK_SHIFT = 0x10
HOTKEY_ID = 1
CCHDEVICENAME = 32
CCHFORMNAME = 32
CCHDEVICESTRING = 128
DEFAULT_TARGET_DISPLAY = "AOC28E850.HDR"

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

    def acquire(self) -> bool:
        self.handle = kernel32.CreateMutexW(None, False, self.name)
        if not self.handle:
            raise_win32(ctypes.get_last_error(), "CreateMutexW")
        return ctypes.get_last_error() != ERROR_ALREADY_EXISTS

    def release(self) -> None:
        if self.handle:
            kernel32.ReleaseMutex(self.handle)
            kernel32.CloseHandle(self.handle)
            self.handle = None


LowLevelKeyboardProc = ctypes.WINFUNCTYPE(wintypes.LPARAM, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
EnumWindowsProc = ctypes.WINFUNCTYPE(BOOL, wintypes.HWND, wintypes.LPARAM)

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
ACTIVE_PROFILE_FILENAME = "active_profile.txt"
PROFILE_METADATA_FILENAME = "profile.json"


def raise_win32(code: int, context: str) -> None:
    raise DisplayConfigError(f"{context} failed with {code}: {ctypes.FormatError(code)}")


def awareness_query_flags(base_flag: int) -> int:
    return base_flag


def awareness_set_flags(base_flag: int) -> int:
    return base_flag


def config_root() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "DummyMonitorToggle"
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
        "no_dummy": base_dir / f"{stem_prefix}_no_dummy.json",
        "no_dummy_no_wireless": base_dir / f"{stem_prefix}_no_dummy_no_wireless.json",
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
    logger = logging.getLogger("dummy-monitor-toggle")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

    file_handler = logging.FileHandler(config_root() / "dummy_monitor_toggle.log", encoding="utf-8")
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
        path_blob = ctypes.string_at(ctypes.addressof(path_array), ctypes.sizeof(path_array))
        mode_blob = ctypes.string_at(ctypes.addressof(mode_array), ctypes.sizeof(mode_array))
        return cls(path_count=path_count, mode_count=mode_count, path_blob=path_blob, mode_blob=mode_blob)

    def path_array(self):
        array_type = DISPLAYCONFIG_PATH_INFO * max(self.path_count, 1)
        array = array_type()
        if self.path_count:
            ctypes.memmove(ctypes.addressof(array), self.path_blob, len(self.path_blob))
        return array

    def mode_array(self):
        array_type = DISPLAYCONFIG_MODE_INFO * max(self.mode_count, 1)
        array = array_type()
        if self.mode_count:
            ctypes.memmove(ctypes.addressof(array), self.mode_blob, len(self.mode_blob))
        return array

    def to_json(self) -> str:
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
        return cls(
            path_count=int(data["path_count"]),
            mode_count=int(data["mode_count"]),
            path_blob=base64.b64decode(data["path_blob_b64"]),
            mode_blob=base64.b64decode(data["mode_blob_b64"]),
        )


@dataclass
class GdiDisplayDevice:
    name: str
    description: str
    state_flags: int
    devmode: DEVMODEW


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
        result = user32.QueryDisplayConfig(flags, ctypes.byref(path_count_u), path_array, ctypes.byref(mode_count_u), mode_array, None)
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
    idx = path.sourceInfo.sourceModeInfoIdx if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE else path.sourceInfo.modeInfoIdx
    return None if idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID else modes[idx]


def target_mode_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[DISPLAYCONFIG_MODE_INFO]:
    idx = path.targetInfo.targetModeInfoIdx if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE else path.targetInfo.modeInfoIdx
    return None if idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID else modes[idx]


def desktop_mode_for_path(path: DISPLAYCONFIG_PATH_INFO, modes) -> Optional[DISPLAYCONFIG_MODE_INFO]:
    if not (path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE):
        return None
    idx = path.targetInfo.desktopModeInfoIdx
    return None if idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID else modes[idx]


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
    destination.write_text(snapshot.to_json(), encoding="utf-8")


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
        "no_dummy": build_filtered_snapshot_or_fallback(
            path_array,
            mode_array,
            snapshot.path_count,
            lambda path: resolved_target_source is None or get_source_name(path).upper() != resolved_target_source,
            snapshot,
        ),
        "no_dummy_no_wireless": build_filtered_snapshot_or_fallback(
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


def save_snapshot_bundle(paths: dict[str, Path], bundle: dict[str, DisplayConfigSnapshot]) -> None:
    save_snapshot(bundle["normal"], paths["normal"])
    save_snapshot(bundle["no_wireless"], paths["no_wireless"])
    save_snapshot(bundle["no_dummy"], paths["no_dummy"])
    save_snapshot(bundle["no_dummy_no_wireless"], paths["no_dummy_no_wireless"])


def load_snapshot_bundle(paths: dict[str, Path]) -> dict[str, DisplayConfigSnapshot]:
    return {
        "normal": load_snapshot(paths["normal"]),
        "no_wireless": load_snapshot(paths["no_wireless"]),
        "no_dummy": load_snapshot(paths["no_dummy"]),
        "no_dummy_no_wireless": load_snapshot(paths["no_dummy_no_wireless"]),
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
        synthesized_path.targetInfo.desktopModeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
        synthesized_path.targetInfo.targetModeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
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

    def append_mode(old_idx: int) -> int:
        if old_idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID:
            return old_idx
        if old_idx not in remap:
            remap[old_idx] = len(mode_items)
            mode_items.append(duplicate_mode(original_modes[old_idx]))
        return remap[old_idx]

    if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
        path.sourceInfo.sourceModeInfoIdx = append_mode(path.sourceInfo.sourceModeInfoIdx)
        path.targetInfo.desktopModeInfoIdx = append_mode(path.targetInfo.desktopModeInfoIdx)
        path.targetInfo.targetModeInfoIdx = append_mode(path.targetInfo.targetModeInfoIdx)
    else:
        path.sourceInfo.modeInfoIdx = append_mode(path.sourceInfo.modeInfoIdx)
        path.targetInfo.modeInfoIdx = append_mode(path.targetInfo.modeInfoIdx)

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

    def append_mode(old_idx: int) -> int:
        if old_idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID:
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
            kept.sourceInfo.sourceModeInfoIdx = append_mode(kept.sourceInfo.sourceModeInfoIdx)
            kept.targetInfo.desktopModeInfoIdx = append_mode(kept.targetInfo.desktopModeInfoIdx)
            kept.targetInfo.targetModeInfoIdx = append_mode(kept.targetInfo.targetModeInfoIdx)
        else:
            kept.sourceInfo.modeInfoIdx = append_mode(kept.sourceInfo.modeInfoIdx)
            kept.targetInfo.modeInfoIdx = append_mode(kept.targetInfo.modeInfoIdx)
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


def invalidate_topology_indexes(path: DISPLAYCONFIG_PATH_INFO) -> DISPLAYCONFIG_PATH_INFO:
    path = duplicate_path(path)
    path.flags |= DISPLAYCONFIG_PATH_ACTIVE
    if path.flags & DISPLAYCONFIG_PATH_SUPPORT_VIRTUAL_MODE:
        path.sourceInfo.sourceModeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
        path.targetInfo.desktopModeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
        path.targetInfo.targetModeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID
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
    logger.info("Pruning active CCD paths to keep dummy plus wireless targets only")
    apply_snapshot(filtered, save_to_database=False)


class DummyMonitorToggle:
    def __init__(self, logger: logging.Logger, target_display: str) -> None:
        self.logger = logger
        self.target_display = target_display.upper()
        self.session_paths = snapshot_bundle_paths(config_root(), "session_layout")
        self.legacy_paths = snapshot_bundle_paths(config_root(), "normal_layout")
        self.snapshot_path = self.session_paths["normal"]
        self.snapshot_no_wireless_path = self.session_paths["no_wireless"]
        self.snapshot_no_dummy_path = self.session_paths["no_dummy"]
        self.snapshot_no_dummy_no_wireless_path = self.session_paths["no_dummy_no_wireless"]
        self.normal_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_wireless_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_dummy_snapshot: Optional[DisplayConfigSnapshot] = None
        self.normal_no_dummy_no_wireless_snapshot: Optional[DisplayConfigSnapshot] = None
        self.current_state = "unknown"
        self.hotkey_hook = None
        self.hotkey_proc = None
        self.last_toggle_monotonic = 0.0

    def apply_loaded_bundle(self, bundle: dict[str, DisplayConfigSnapshot]) -> None:
        self.normal_snapshot = bundle["normal"]
        self.normal_no_wireless_snapshot = bundle["no_wireless"]
        self.normal_no_dummy_snapshot = bundle["no_dummy"]
        self.normal_no_dummy_no_wireless_snapshot = bundle["no_dummy_no_wireless"]

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

    def move_windows_off_dummy_before_restore(self, restore_snapshot: DisplayConfigSnapshot) -> None:
        try:
            dummy_source_name = self.current_target_source_name()
            if dummy_source_name is None:
                self.logger.info("No active dummy source found before restore; skipping pre-restore window move")
                return
            dummy_rect = self.current_source_rect(dummy_source_name)
            if dummy_rect is None:
                self.logger.info("No active dummy rect found before restore; skipping pre-restore window move")
                return

            destination_rect = preferred_destination_rect(restore_snapshot, exclude_source=dummy_source_name)
            if destination_rect is None:
                self.logger.info("No destination rect available for pre-restore window move")
                return

            move_windows_from_rect(dummy_rect, destination_rect, self.logger, "dummy disconnect")
        except Exception as error:
            self.logger.warning("Pre-restore dummy window move failed: %s", error)

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
        self.logger.info("Saved no-dummy restore snapshot to %s", self.snapshot_no_dummy_path)
        self.logger.info("Saved no-dummy/no-wireless fallback snapshot to %s", self.snapshot_no_dummy_no_wireless_path)
        for line in list_display_lines(path_array[: snapshot.path_count], mode_array):
            self.logger.info("  %s", line)

    def enter_dummy_only(self) -> None:
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
            self.current_state = "dummy"
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
        self.current_state = "dummy"

    def restore_normal(self) -> None:
        self.logger.info("Restoring saved multi-monitor layout")
        if self.normal_snapshot is None:
            loaded = self.load_session_or_legacy_bundle()
            if not loaded:
                self.load_active_profile_bundle()
        if self.normal_snapshot is None and self.normal_no_dummy_snapshot is None:
            raise DisplayConfigError("No saved normal layout is available to restore.")

        preferred_restore = self.normal_no_dummy_snapshot or self.normal_snapshot
        preferred_no_wireless_restore = self.normal_no_dummy_no_wireless_snapshot or self.normal_no_wireless_snapshot
        try:
            self.move_windows_off_dummy_before_restore(preferred_restore)
        except Exception as error:
            self.logger.warning("Pre-restore dummy window move failed: %s", error)
        try:
            apply_snapshot(preferred_restore, save_to_database=True)
        except DisplayConfigError as first_error:
            self.logger.warning("In-memory restore failed: %s", first_error)
            disk_restore_error = None
            if self.snapshot_no_dummy_path.exists():
                try:
                    self.normal_no_dummy_snapshot = load_snapshot(self.snapshot_no_dummy_path)
                    apply_snapshot(self.normal_no_dummy_snapshot, save_to_database=True)
                    self.recover_windows_after_restore(self.normal_no_dummy_snapshot)
                    self.current_state = "normal"
                    return
                except DisplayConfigError as error:
                    disk_restore_error = error
                    self.logger.warning("On-disk no-dummy restore failed: %s", error)

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

            if self.snapshot_no_dummy_no_wireless_path.exists():
                self.logger.info("Trying on-disk no-dummy/no-wireless fallback restore")
                self.normal_no_dummy_no_wireless_snapshot = load_snapshot(self.snapshot_no_dummy_no_wireless_path)
                apply_snapshot(self.normal_no_dummy_no_wireless_snapshot, save_to_database=True)
                self.recover_windows_after_restore(self.normal_no_dummy_no_wireless_snapshot)
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
        self.enter_dummy_only()
        if has_active_wireless_target():
            self.launch_wireless_drop_watcher()
        self.log_current_displays("Display state after one-shot dummy-only switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

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
        if self.current_state == "dummy":
            self.restore_normal()
            self.log_current_displays("Display state after restore", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
            return
        self.enter_dummy_only()
        self.log_current_displays("Display state after dummy-only switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))

    def run(self) -> None:
        self.logger.info("Dummy monitor toggle starting")
        self.logger.info("Target monitor selector: %s", self.target_display)
        self.startup_capture()
        self.log_current_displays("Detected active displays before switch", awareness_query_flags(QDC_ONLY_ACTIVE_PATHS))
        try:
            self.enter_dummy_only()
        except Exception as error:
            self.logger.exception("Startup switch to dummy-only failed: %s", error)
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Toggle between the configured dummy-monitor-only state and the saved monitor layout.")
    parser.add_argument("--list-only", action="store_true", help="Log all active and available display paths, then exit.")
    parser.add_argument("--save-layout", metavar="NAME", help="Save the current active layout under a friendly name and make it the active saved profile.")
    parser.add_argument("--set-active-layout", metavar="NAME", help="Mark an existing saved layout name as the active profile for future restores.")
    parser.add_argument("--apply-layout", metavar="NAME", help="Apply a saved layout now and also mark it as the active profile.")
    parser.add_argument("--list-layouts-json", action="store_true", help="Print saved layout profile metadata as JSON.")
    parser.add_argument("--toggle-once", action="store_true", help="Toggle once and exit instead of running the background hotkey service.")
    parser.add_argument("--watch-wireless-drop", action="store_true", help="Watch the reduced state and restore the saved layout if the wireless display disappears.")
    parser.add_argument(
        "--target-display",
        default=DEFAULT_TARGET_DISPLAY,
        help="Target GDI display name or monitor identity, default: AOC28E850.HDR",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logger = setup_logging()
    logger.info("Process started with arguments: %s", " ".join(sys.argv[1:]) or "<none>")

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

    if args.toggle_once:
        DummyMonitorToggle(logger, args.target_display).toggle_once()
        return 0

    if args.watch_wireless_drop:
        instance = SingleInstance("Local\\DummyMonitorToggleWirelessWatch")
        if not instance.acquire():
            logger.info("Wireless-drop watcher is already running; exiting")
            return 0
        try:
            DummyMonitorToggle(logger, args.target_display).watch_wireless_drop_and_restore()
            return 0
        finally:
            instance.release()

    instance = SingleInstance("Local\\DummyMonitorToggleHotkey")
    if not instance.acquire():
        logger.info("Another Dummy Monitor Toggle instance is already running; exiting")
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

        DummyMonitorToggle(logger, args.target_display).run()
        return 0
    finally:
        instance.release()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DisplayConfigError as error:
        logging.getLogger("dummy-monitor-toggle").exception("Fatal error: %s", error)
        raise SystemExit(1)
