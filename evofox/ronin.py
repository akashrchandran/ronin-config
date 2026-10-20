"""
evofox-ronin — dependency-free Python client for the EvoFox Ronin configuration
protocol (USB VID 0x320F / PID 0x5055, HID collection usage page 0xFF1C usage 0x0092).

Talks to the keyboard through Windows' HID stack (setupapi.dll + hid.dll) with
ctypes only — no third-party packages required. The framing is documented in
README.md.

    from ronin import Ronin
    with Ronin() as kb:
        kb.start_comm()
        print(kb.get_device_base_info())
        print(kb.get_keymap(0)["keys"][:3])
        kb.stop_comm()
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import threading
import time

# --- constants -------------------------------------------------------------

VID, PID = 0x320F, 0x5055
USAGE_PAGE, USAGE = 0xFF1C, 0x0092
REPORT_ID = 4
DATA_LEN = 63

CMD = {
    "START_COMM": 0x01,
    "STOP_COMM": 0x02,
    "GET_DEVICE_BASE_INFO": 0x03,
    "GET_FUNC_INFO": 0x05,
    "SET_FUNC_INFO": 0x06,
    "GET_DEFAULT_KEYMAP": 0x07,
    "GET_KEYMAP": 0x08,
    "SET_KEYMAP": 0x09,
    "GET_USER_KEY_COLORS": 0x0A,
    "SET_USER_KEY_COLORS": 0x0B,
    "RESTORE_FACTORY_SETTINGS": 0x0D,
    "SET_MACRO_V2": 0x15,
    "GET_LIGHT_MATRIX": 0x1B,
}

STATUS_ACK, STATUS_NAK = 0x00, 0xFF

# Lighting limits on the VS11K09A controller.
MAX_BRIGHTNESS = 4
MAX_SPEED = 4          # the firmware stores 4 - speed
RGB_MAX = 247          # firmware clamps colour channels to 0xF7
MODE_CUSTOM = 20       # per-key RGB mode
MODE_OFF = 21
PROFILE_COUNT = 3
PROFILE_OFFSETS = (0x00, 0x40, 0x80)   # three lighting profiles in flash

# --- win32 bindings --------------------------------------------------------


class GUID(ctypes.Structure):
    _fields_ = [
        ("Data1", wt.DWORD),
        ("Data2", wt.WORD),
        ("Data3", wt.WORD),
        ("Data4", ctypes.c_ubyte * 8),
    ]

    @classmethod
    def from_string(cls, text: str) -> "GUID":
        u = ctypes.c_ulonglong()
        rest = text.split("-")
        u.value = int(rest[0], 16) | (int(rest[1], 16) << 32)
        g = cls()
        g.Data1 = u.value & 0xFFFFFFFF
        g.Data2 = (u.value >> 32) & 0xFFFF
        g.Data3 = (u.value >> 48) & 0xFFFF
        for i, byte in enumerate(bytes.fromhex(rest[2] + rest[3])):
            g.Data4[i] = byte
        return g


class SP_DEVICE_INTERFACE_DATA(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.DWORD),
        ("InterfaceClassGuid", GUID),
        ("dwFlags", wt.DWORD),
        ("Reserved", ctypes.POINTER(ctypes.c_ulong)),
    ]


class HIDD_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ("Size", wt.ULONG),
        ("VendorID", wt.USHORT),
        ("ProductID", wt.USHORT),
        ("VersionNumber", wt.USHORT),
    ]


class HIDP_CAPS(ctypes.Structure):
    _fields_ = [
        ("Usage", wt.USHORT),
        ("UsagePage", wt.USHORT),
        ("InputReportSize", wt.USHORT),
        ("OutputReportSize", wt.USHORT),
        ("FeatureReportSize", wt.USHORT),
        ("Reserved", wt.USHORT * 17),
        ("NumberLinkCollectionNodes", wt.USHORT),
        ("NumberInputButtonCaps", wt.USHORT),
        ("NumberInputValueCaps", wt.USHORT),
        ("NumberInputDataIndices", wt.USHORT),
        ("NumberOutputButtonCaps", wt.USHORT),
        ("NumberOutputValueCaps", wt.USHORT),
        ("NumberOutputDataIndices", wt.USHORT),
        ("NumberFeatureButtonCaps", wt.USHORT),
        ("NumberFeatureValueCaps", wt.USHORT),
        ("NumberFeatureDataIndices", wt.USHORT),
    ]


setupapi = ctypes.WinDLL("setupapi")
hid_dll = ctypes.WinDLL("hid.dll")
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# Explicit 64-bit-safe signatures (HANDLE is pointer sized).
setupapi.SetupDiGetClassDevsW.argtypes = [ctypes.c_void_p, wt.LPCWSTR, wt.HWND, wt.DWORD]
setupapi.SetupDiGetClassDevsW.restype = wt.HANDLE
setupapi.SetupDiEnumDeviceInterfaces.argtypes = [
    wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.c_void_p
]
setupapi.SetupDiEnumDeviceInterfaces.restype = wt.BOOL
setupapi.SetupDiGetDeviceInterfaceDetailW.argtypes = [
    wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p
]
setupapi.SetupDiGetDeviceInterfaceDetailW.restype = wt.BOOL
setupapi.SetupDiDestroyDeviceInfoList.argtypes = [wt.HANDLE]
setupapi.SetupDiDestroyDeviceInfoList.restype = wt.BOOL
kernel32.CreateFileW.argtypes = [
    wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD, wt.HANDLE
]
kernel32.CreateFileW.restype = wt.HANDLE
kernel32.ReadFile.argtypes = [
    wt.HANDLE, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p
]
kernel32.ReadFile.restype = wt.BOOL
kernel32.WriteFile.argtypes = [
    wt.HANDLE, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD), ctypes.c_void_p
]
kernel32.WriteFile.restype = wt.BOOL
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.CloseHandle.restype = wt.BOOL
hid_dll.HidD_GetAttributes.argtypes = [wt.HANDLE, ctypes.c_void_p]
hid_dll.HidD_GetPreparsedData.argtypes = [wt.HANDLE, ctypes.POINTER(ctypes.c_void_p)]
hid_dll.HidD_FreePreparsedData.argtypes = [ctypes.c_void_p]
hid_dll.HidP_GetCaps.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
hid_dll.HidD_GetHidGuid.argtypes = [ctypes.c_void_p]

GENERIC_READ, GENERIC_WRITE = 0x80000000, 0x40000000
FILE_SHARE_READ, FILE_SHARE_WRITE = 0x1, 0x2
OPEN_EXISTING = 3
INVALID_HANDLE_VALUE = wt.HANDLE(-1).value
DIGCF_PRESENT, DIGCF_DEVICEINTERFACE = 0x02, 0x10


def _enumerate_hid_paths():
    """Yield (path, vid, pid, usage_page, usage) for every present HID device."""
    guid = GUID.from_string("4D1E55B2-F16F-11CF-88CB-001111000030")
    hid_dll.HidD_GetHidGuid(ctypes.byref(guid))
    setupapi.SetupDiGetClassDevsW.argtypes = [ctypes.c_void_p, wt.LPCWSTR, wt.HWND, wt.DWORD]
    setupapi.SetupDiGetClassDevsW.restype = wt.HANDLE
    devinfo = setupapi.SetupDiGetClassDevsW(
        ctypes.byref(guid), None, None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE
    )
    if devinfo == INVALID_HANDLE_VALUE:
        return
    try:
        index = 0
        while True:
            ifdata = SP_DEVICE_INTERFACE_DATA()
            ifdata.cbSize = ctypes.sizeof(ifdata)
            if not setupapi.SetupDiEnumDeviceInterfaces(
                devinfo, None, ctypes.byref(guid), index, ctypes.byref(ifdata)
            ):
                break
            index += 1
            required = wt.DWORD()
            setupapi.SetupDiGetDeviceInterfaceDetailW(
                devinfo, ctypes.byref(ifdata), None, 0, ctypes.byref(required), None
            )
            buf = ctypes.create_string_buffer(required.value)
            # cbSize = 8 (Unicode) on Windows Vista and later
            ctypes.cast(buf, ctypes.POINTER(ctypes.c_ulong))[0] = 8
            if not setupapi.SetupDiGetDeviceInterfaceDetailW(
                devinfo, ctypes.byref(ifdata), buf, required.value, None, None
            ):
                continue
            path = ctypes.wstring_at(ctypes.addressof(buf) + 4)
            attrs = HIDD_ATTRIBUTES()
            attrs.Size = ctypes.sizeof(attrs)
            handle = kernel32.CreateFileW(
                path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None
            )
            if handle == INVALID_HANDLE_VALUE:
                continue
            try:
                if not hid_dll.HidD_GetAttributes(handle, ctypes.byref(attrs)):
                    continue
                preparsed = ctypes.c_void_p()
                if not hid_dll.HidD_GetPreparsedData(handle, ctypes.byref(preparsed)):
                    continue
                caps = HIDP_CAPS()
                hid_dll.HidP_GetCaps(preparsed, ctypes.byref(caps))
                hid_dll.HidD_FreePreparsedData(preparsed)
                yield path, attrs.VendorID, attrs.ProductID, caps.UsagePage, caps.Usage
            finally:
                kernel32.CloseHandle(handle)
    finally:
        setupapi.SetupDiDestroyDeviceInfoList(devinfo)


class OVERLAPPED(ctypes.Structure):
    _fields_ = [
        ("Internal", ctypes.c_size_t),
        ("InternalHigh", ctypes.c_size_t),
        ("Offset", wt.DWORD),
        ("OffsetHigh", wt.DWORD),
        ("hEvent", wt.HANDLE),
    ]


kernel32.CreateEventW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.BOOL, wt.LPCWSTR]
kernel32.CreateEventW.restype = wt.HANDLE
kernel32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
kernel32.WaitForSingleObject.restype = wt.DWORD
kernel32.GetOverlappedResult.argtypes = [
    wt.HANDLE, ctypes.POINTER(OVERLAPPED), ctypes.POINTER(wt.DWORD), wt.BOOL
]
kernel32.GetOverlappedResult.restype = wt.BOOL
kernel32.ResetEvent.argtypes = [wt.HANDLE]
kernel32.ResetEvent.restype = wt.BOOL

FILE_FLAG_OVERLAPPED = 0x40000000
ERROR_IO_PENDING = 997
WAIT_OBJECT_0 = 0
WAIT_TIMEOUT = 258
INVALID_HANDLE_VALUE = wt.HANDLE(-1).value


class RoninError(RuntimeError):
    pass


class Ronin:
    """Config client for one connected EvoFox Ronin."""

    def __init__(self, path: str | None = None):
        self.path = path
        self.handle = None
        self._reader = None
        self._inbox = []
        self._lock = threading.Lock()

    # -- device plumbing ----------------------------------------------------

    @staticmethod
    def list_devices():
        out = []
        for path, vid, pid, page, usage in _enumerate_hid_paths():
            out.append({"path": path, "vid": vid, "pid": pid, "usage_page": page, "usage": usage})
        return out

    @staticmethod
    def find_path():
        for dev in Ronin.list_devices():
            if dev["vid"] == VID and dev["pid"] == PID and dev["usage_page"] == USAGE_PAGE:
                return dev["path"]
        raise RoninError("EvoFox Ronin (0x320F:0x5055, usage page 0xFF1C) not found")

    def open(self) -> "Ronin":
        if self.handle:
            return self
        self.path = self.path or self.find_path()
        self.handle = kernel32.CreateFileW(
            self.path,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            None,
        )
        if self.handle == INVALID_HANDLE_VALUE:
            raise RoninError(f"cannot open HID device: {self.path}")
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        return self

    def close(self):
        if self.handle:
            kernel32.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self.open()

    def __exit__(self, *exc):
        self.close()

    def _read_loop(self):
        """Blocking overlapped read; one request in flight at a time."""
        ov = OVERLAPPED()
        ov.hEvent = kernel32.CreateEventW(None, True, False, None)
        buf = ctypes.create_string_buffer(64)
        while self.handle:
            n = wt.DWORD()
            ok = kernel32.ReadFile(self.handle, buf, 64, ctypes.byref(n), ctypes.byref(ov))
            if not ok and ctypes.get_last_error() != ERROR_IO_PENDING:
                break
            while True:
                res = kernel32.WaitForSingleObject(ov.hEvent, 200)
                if res == WAIT_OBJECT_0:
                    break
                if res != WAIT_TIMEOUT or not self.handle:
                    return
            done = wt.DWORD()
            if kernel32.GetOverlappedResult(self.handle, ctypes.byref(ov), ctypes.byref(done), False):
                if done.value:
                    with self._lock:
                        self._inbox.append(bytes(buf.raw[: done.value]))
            kernel32.ResetEvent(ov.hEvent)

    # -- framing ------------------------------------------------------------

    @staticmethod
    def frame(arg0: int, cmd: int, length: int, args=(), head: int = 0) -> bytearray:
        b = bytearray(DATA_LEN)
        b[0] = head & 0xFF
        b[1] = arg0 & 0xFF
        b[2] = cmd & 0xFF
        b[3] = length & 0xFF
        for i, v in enumerate(args):
            if 4 + i < DATA_LEN:
                b[4 + i] = v & 0xFF
        return b

    def request(self, arg0: int, cmd: int, length: int, args=(), head: int = 0, timeout: float = 2.0):
        """Send one frame and return the reply payload (bytes after the header)."""
        if not self.handle:
            self.open()
        with self._lock:
            self._inbox.clear()
        out = bytearray(64)
        out[0] = REPORT_ID
        out[1:] = self.frame(arg0, cmd, length, args, head)
        self._write(bytes(out), timeout)
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                msg = self._inbox.pop(0) if self._inbox else None
            if msg is None:
                time.sleep(0.005)
                continue
            data = msg[1:]  # strip the HID report id
            if len(data) < 7 or data[2] != (cmd & 0xFF):
                continue
            if data[6] == STATUS_NAK:
                raise RoninError(f"device NAK for command 0x{cmd:02X}")
            if data[6] != STATUS_ACK:
                raise RoninError(f"unexpected status 0x{data[6]:02X} for command 0x{cmd:02X}")
            return bytes(data[7:])
        raise RoninError(f"timeout waiting for reply to command 0x{cmd:02X}")

    def _write(self, data: bytes, timeout: float = 2.0):
        ov = OVERLAPPED()
        ov.hEvent = kernel32.CreateEventW(None, True, False, None)
        written = wt.DWORD()
        ok = kernel32.WriteFile(self.handle, data, len(data), ctypes.byref(written), ctypes.byref(ov))
        if not ok and ctypes.get_last_error() != ERROR_IO_PENDING:
            raise RoninError(f"write failed: {ctypes.WinError(ctypes.get_last_error())}")
        res = kernel32.WaitForSingleObject(ov.hEvent, int(timeout * 1000))
        if res != WAIT_OBJECT_0:
            raise RoninError("write timed out")
        done = wt.DWORD()
        if not kernel32.GetOverlappedResult(self.handle, ctypes.byref(ov), ctypes.byref(done), False):
            raise RoninError("write failed")
        kernel32.CloseHandle(ov.hEvent)

    # -- protocol ------------------------------------------------------------

    def start_comm(self):
        self.request(0, CMD["START_COMM"], 0, head=1)

    def stop_comm(self):
        self.request(0, CMD["STOP_COMM"], 0, head=2)

    def get_device_base_info(self) -> dict:
        p = self.request(0, CMD["GET_DEVICE_BASE_INFO"], 34)
        return {
            "raw": p,
            "magic": (p[0], p[1]),
            "vendor_id": p[21] | (p[22] << 8),
            "product_id": p[23] | (p[24] << 8),
            "firmware_ver": p[25] | (p[26] << 8),
            "profile": p[27],
            "keyboard_id": p[29],
            "keyboard_type": p[30],
            "protocol_ver": p[31],
        }

    def get_func_info(self, profile: int = 0) -> dict:
        """Read the lighting config of one of the three onboard profiles."""
        offset = PROFILE_OFFSETS[profile] if 0 <= profile < len(PROFILE_OFFSETS) else 0
        p = self.request(0, CMD["GET_FUNC_INFO"], 56,
                         [offset & 0xFF, (offset >> 8) & 0xFF, 0])
        return {
            "raw": p,
            "profile": p[0],
            "light_mode": p[1],
            "light_brightness": p[2],
            "hw_speed": p[3],
            "light_speed": max(0, MAX_SPEED - p[3]),
            "light_direction": p[4],
            "mix_color": p[5],
            "light_rgb": (p[6], p[7], p[8]),
            "custom_base_rgb": (p[10], p[11], p[12]),
            "light_group": p[18],
            "key_wasd": p[19],
            "six_key_no_conflict": p[20],
            "lock_win": p[21],
            "report_rate": p[22],
            "hit_rate": p[23],
            "hit_delay": p[24],
            "light_color": (p[34], p[33], p[32]),
        }

    def set_func_info(self, values: dict, profile: int = 0) -> None:
        """Write the lighting config of one of the three onboard profiles."""
        offset = PROFILE_OFFSETS[profile] if 0 <= profile < len(PROFILE_OFFSETS) else 0
        current = self.get_func_info(profile)
        block = bytearray(current["raw"][:56])
        block.extend(b"\x00" * (56 - len(block)))
        index = {
            "profile": 0, "light_mode": 1, "light_brightness": 2, "light_direction": 4,
            "mix_color": 5, "light_r": 6, "light_g": 7, "light_b": 8,
            "light_group": 18, "key_wasd": 19, "lock_win": 21, "report_rate": 22,
        }
        for key, at in index.items():
            if key in values:
                block[at] = max(0, min(0xFF, values[key])) & 0xFF
        if "light_speed" in values:
            block[3] = (MAX_SPEED - max(0, min(MAX_SPEED, values["light_speed"]))) & 0xFF
        self.start_comm()
        self.request(0, CMD["SET_FUNC_INFO"], 56,
                     [offset & 0xFF, (offset >> 8) & 0xFF, 0, *block])
        self.stop_comm()

    def get_keymap(self, layer: int = 0, default: bool = False) -> dict:
        cmd = CMD["GET_DEFAULT_KEYMAP"] if default else CMD["GET_KEYMAP"]
        buf = bytearray()
        for off in range(0, 512, 56):
            length = min(56, 512 - off)
            buf += self.request(layer, cmd, length, [off & 0xFF, (off >> 8) & 0xFF, 0])
        data = bytes(buf[:384])
        keys = [
            {"index": i, "type": data[3 * i], "code1": data[3 * i + 1], "code2": data[3 * i + 2]}
            for i in range(128)
        ]
        return {"bytes": data, "keys": keys}

    def get_user_key_colors(self) -> dict:
        # No priming read: the firmware advances its read pointer by the length
        # of every request, and a throwaway read in front of the chunks shifts
        # the whole table.
        buf = bytearray()
        for off in range(0, 384, 56):
            length = min(56, 384 - off)
            buf += self.request(0, CMD["GET_USER_KEY_COLORS"], length, [off & 0xFF, (off >> 8) & 0xFF, 0])
        colors = [
            {"r": buf[3 * i], "g": buf[3 * i + 1], "b": buf[3 * i + 2]} for i in range(128)
        ]
        return {"bytes": bytes(buf), "colors": colors}

    def get_light_matrix(self) -> list:
        buf = bytearray()
        for off in range(0, 128, 56):
            length = min(56, 128 - off)
            buf += self.request(0, CMD["GET_LIGHT_MATRIX"], length, [off & 0xFF, (off >> 8) & 0xFF, 0])
        return list(buf[:128])


if __name__ == "__main__":
    with Ronin() as kb:
        print("path:", kb.path)
        kb.start_comm()
        info = kb.get_device_base_info()
        print("device : 0x%04X 0x%04X" % (info["vendor_id"], info["product_id"]))
        print("firmware: %X" % info["firmware_ver"])
        print("func   :", kb.get_func_info())
        km = kb.get_keymap(0)
        print("keys   :", km["keys"][:4])
        kb.stop_comm()
