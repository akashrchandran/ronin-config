"""
ble-probe.py — what does the Ronin keyboard expose over Bluetooth?

The vendor configurator is a web app and talks to the keyboard over WebHID,
which is USB only, so it can never reach a Bluetooth connection. This script
answers what the firmware actually offers over BLE.

Windows exposes the Bluetooth GATT stack through WinRT, so the script uses
the `winrt` projections directly (no bleak needed):

    pip install winrt-Windows.Devices.Bluetooth winrt-Windows.Storage.Streams

    python tools/ble-probe.py --address D1:00:D1:12:A4:FD

The address of a paired keyboard is in the device properties:

    Get-PnpDevice | Where-Object FriendlyName -like '*Ronin*' |
      Get-PnpDeviceProperty -KeyName DEVPKEY_Bluetooth_DeviceAddress
"""

import argparse
import asyncio
import sys

VENDOR_SERVICE = "00010203-0405-0607-0809-0a0b0c0d1912"
VENDOR_WRITE = "00010203-0405-0607-0809-0a0b0c0d2b12"
VENDOR_READ = "6971656b-676e-6179-6971-656b676e6179"
REPORT_MAP = "00002a4b-0000-1000-8000-00805f9b34fb"
HID_SERVICE = "00001812-0000-1000-8000-00805f9b34fb"


def build_frame(cmd, length, args, head=0):
    """The same 63 byte frame the USB transport sends."""
    frame = bytearray(63)
    frame[0] = head
    frame[2] = cmd
    frame[3] = length
    for index, value in enumerate(args):
        frame[4 + index] = value & 0xFF
    return bytes(frame)


def to_buffer(data):
    from winrt.windows.storage.streams import Buffer

    buffer = Buffer(len(data))
    buffer.length = buffer.capacity
    with memoryview(buffer) as view:
        view[:] = data
    return buffer


async def read_value(characteristic):
    from winrt.windows.devices.bluetooth import BluetoothCacheMode

    try:
        result = await characteristic.read_value_async(BluetoothCacheMode.UNCACHED)
    except TypeError:
        result = await characteristic.read_value_async()
    if hasattr(result, "value"):
        result = result.value
    return bytes(result)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--address", required=True, help="Bluetooth address, AA:BB:CC:DD:EE:FF")
    parser.add_argument("--write", action="store_true", help="try writing a config frame to the vendor characteristic")
    args = parser.parse_args()

    from winrt.windows.devices.bluetooth import BluetoothLEDevice

    # Windows wants the address as one big endian integer.
    value = int.from_bytes(bytes.fromhex(args.address.replace(":", "")), "big")
    device = await BluetoothLEDevice.from_bluetooth_address_async(value)
    if device is None:
        print(f"{args.address} not found")
        return 1
    print(f"device: {device.name} ({args.address})")

    services = (await device.get_gatt_services_async()).services
    for service in services:
        uuid = str(service.uuid).lower()
        result = await service.get_characteristics_async()
        characteristics = getattr(result, "characteristics", [])
        print(f"\nservice {service.uuid}  ({len(characteristics)} characteristics, status {getattr(result, 'status', '?')})")
        for characteristic in characteristics:
            props = getattr(characteristic, "characteristic_properties", None)
            print(f"  {characteristic.uuid}  {[p.name for p in props] if props else ''}")
            try:
                data = await read_value(characteristic)
            except Exception as error:
                print(f"    read failed: {error}")
                continue
            if not data:
                continue
            if characteristic.uuid == REPORT_MAP:
                print("    HID report descriptor:", data.hex())
                print("    contains the vendor collection 0xFF1C:",
                      bytes([0x0C, 0xFF, 0x00, 0x00]) in data)
            else:
                print("    value:", data.hex(), f"({len(data)} bytes)")

    if args.write:
        vendor = next((s for s in services if VENDOR_SERVICE.lower() in str(s.uuid).lower()), None)
        if vendor is None:
            print("\nno vendor service on this device")
            return 1
        chars = (await vendor.get_characteristics_async()).characteristics
        target = next((c for c in chars if str(c.uuid).lower() == VENDOR_WRITE), None)
        if target is None:
            print("\nno writable vendor characteristic")
            return 1
        frame = bytes([4]) + build_frame(0x03, 34, [])
        for label, payload in (("64 byte config frame", frame), ("1 byte", b"\x00")):
            try:
                status = await target.write_value_async(to_buffer(payload))
                print(f"write {label}: status {status}")
            except Exception as error:
                print(f"write {label}: rejected ({error})")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
