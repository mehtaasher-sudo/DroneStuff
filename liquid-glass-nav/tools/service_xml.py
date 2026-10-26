#!/usr/bin/env python3
"""Writes the compiled (binary AXML) accessibility-service config into the APK.

The Debian aapt only knows the API 23 framework attributes, but the service needs
android:canTakeScreenshot (API 30) to copy each app's menu icons. So aapt compiles a
placeholder and this script replaces it with a hand-encoded binary XML.

usage: service_xml.py <apk> <entry-path> <description-string-res-id-hex>
"""
import struct
import sys
import zipfile
import os

ANDROID_NS = "http://schemas.android.com/apk/res/android"

TYPE_REFERENCE = 0x01
TYPE_INT_DEC = 0x10
TYPE_INT_HEX = 0x11
TYPE_INT_BOOLEAN = 0x12


def attributes(desc_id):
    # (name, framework attr id, value type, data) -- framework ids from android.R.attr
    return [
        ("description", 0x01010020, TYPE_REFERENCE, desc_id),
        # typeViewClicked | typeWindowStateChanged | typeWindowContentChanged | typeViewScrolled | typeWindowsChanged
        ("accessibilityEventTypes", 0x01010380, TYPE_INT_HEX, 0x1 | 0x20 | 0x800 | 0x1000 | 0x400000),
        ("accessibilityFeedbackType", 0x01010382, TYPE_INT_HEX, 0x10),  # feedbackGeneric
        ("notificationTimeout", 0x01010383, TYPE_INT_DEC, 100),
        # flagIncludeNotImportantViews | flagRetrieveInteractiveWindows
        ("accessibilityFlags", 0x01010384, TYPE_INT_HEX, 0x2 | 0x40),
        ("canRetrieveWindowContent", 0x01010385, TYPE_INT_BOOLEAN, 0xFFFFFFFF),
        ("canTakeScreenshot", 0x0101060F, TYPE_INT_BOOLEAN, 0xFFFFFFFF),
    ]


def string_pool(strings):
    offsets, data = [], b""
    for s in strings:
        offsets.append(len(data))
        enc = s.encode("utf-16-le")
        data += struct.pack("<H", len(s)) + enc + b"\x00\x00"
    while len(data) % 4:
        data += b"\x00"
    header_size = 28
    strings_start = header_size + 4 * len(strings)
    size = strings_start + len(data)
    return (struct.pack("<HHIIIIII", 0x0001, header_size, size, len(strings), 0, 0, strings_start, 0)
            + b"".join(struct.pack("<I", o) for o in offsets) + data)


def encode(desc_id):
    attrs = sorted(attributes(desc_id), key=lambda a: a[1])  # parser expects res-id order
    names = [a[0] for a in attrs]
    strings = names + ["android", ANDROID_NS, "accessibility-service"]
    idx = {s: i for i, s in enumerate(strings)}
    NONE = 0xFFFFFFFF

    pool = string_pool(strings)
    resmap = struct.pack("<HHI", 0x0180, 8, 8 + 4 * len(attrs)) + b"".join(struct.pack("<I", a[1]) for a in attrs)
    start_ns = struct.pack("<HHIIIII", 0x0100, 16, 24, 1, NONE, idx["android"], idx[ANDROID_NS])
    attr_bytes = b"".join(
        struct.pack("<IIIHBBI", idx[ANDROID_NS], idx[n], NONE, 8, 0, t, d) for n, _, t, d in attrs)
    start_el = struct.pack("<HHIII", 0x0102, 16, 36 + len(attr_bytes), 1, NONE) + struct.pack(
        "<IIHHHHHH", NONE, idx["accessibility-service"], 20, 20, len(attrs), 0, 0, 0) + attr_bytes
    end_el = struct.pack("<HHIIIII", 0x0103, 16, 24, 1, NONE, NONE, idx["accessibility-service"])
    end_ns = struct.pack("<HHIIIII", 0x0101, 16, 24, 1, NONE, idx["android"], idx[ANDROID_NS])
    body = pool + resmap + start_ns + start_el + end_el + end_ns
    return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body


def main():
    apk, entry, desc_hex = sys.argv[1], sys.argv[2], sys.argv[3]
    blob = encode(int(desc_hex, 16))
    tmp = apk + ".tmp"
    with zipfile.ZipFile(apk) as src, zipfile.ZipFile(tmp, "w") as dst:
        for info in src.infolist():
            data = blob if info.filename == entry else src.read(info.filename)
            dst.writestr(info, data)
    os.replace(tmp, apk)


if __name__ == "__main__":
    main()
