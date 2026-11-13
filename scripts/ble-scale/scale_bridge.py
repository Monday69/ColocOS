#!/usr/bin/env python3
"""ColocOS — Passerelle BLE pour balance Xiaomi Mi Body Composition Scale 2.

Écoute les trames d'advertising du service GATT 0x181B, décode le poids et
l'impédance, puis pousse la pesée vers l'API ColocOS (et éventuellement vers
Jarvis Runner).

Deux modes :
  • scan      — écoute BLE continue (Raspberry Pi 4 ou tout hôte Linux avec BT)
  • simulate  — injecte une trame synthétique et exécute l'envoi HTTP réel
                (permet de valider toute la chaîne sans balance physique)

Exemples :
    python3 scale_bridge.py --simulate 73.8 475
    python3 scale_bridge.py --scan --once
    python3 scale_bridge.py --scan
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone

try:  # dépendance optionnelle : utile seulement en mode scan
    from bleak import BleakScanner  # type: ignore
except Exception:  # pragma: no cover - le mode simulate doit marcher sans bleak
    BleakScanner = None  # type: ignore

try:  # httpx préféré ; repli sur urllib pour rester exécutable partout
    import httpx  # type: ignore
except Exception:  # pragma: no cover
    httpx = None  # type: ignore

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    def load_dotenv(*_args, **_kwargs):  # type: ignore
        return False


SERVICE_UUID = "0000181b-0000-1000-8000-00805f9b34fb"

# Bits du champ de contrôle (2 octets, little endian)
CTRL_HAS_IMPEDANCE = 1 << 9      # 0x0200
CTRL_IS_STABILIZED = 1 << 13     # 0x2000
CTRL_WEIGHT_REMOVED = 1 << 15    # 0x8000
CTRL_UNIT_LBS = 1 << 0           # 0x0001
CTRL_UNIT_JIN = 1 << 4           # 0x0010

LB_TO_KG = 0.45359237
JIN_TO_KG = 0.5

# Anti-rebond : une même pesée n'est renvoyée qu'une fois par fenêtre
DEBOUNCE_SECONDS = 60


@dataclass
class Measurement:
    weight_kg: float
    impedance_ohm: int | None
    stabilized: bool
    removed: bool
    unit: str

    def key(self) -> tuple[float, int | None]:
        return (round(self.weight_kg, 2), self.impedance_ohm)


def decode_frame(data: bytes) -> Measurement | None:
    """Décode une trame 0x181B (13 octets, little endian)."""
    if len(data) < 13:
        return None

    ctrl = int.from_bytes(data[0:2], "little")
    has_impedance = bool(ctrl & CTRL_HAS_IMPEDANCE)
    is_stabilized = bool(ctrl & CTRL_IS_STABILIZED)
    weight_removed = bool(ctrl & CTRL_WEIGHT_REMOVED)

    raw_weight = int.from_bytes(data[11:13], "little")
    if raw_weight == 0:
        return None

    weight = raw_weight / 200.0
    unit = "kg"

    if ctrl & CTRL_UNIT_LBS:
        weight = weight * LB_TO_KG
        unit = "lbs"
    elif ctrl & CTRL_UNIT_JIN:
        weight = weight * JIN_TO_KG
        unit = "jin"

    impedance = int.from_bytes(data[9:11], "little") if has_impedance else None
    if impedance == 0:
        impedance = None

    return Measurement(
        weight_kg=round(weight, 2),
        impedance_ohm=impedance,
        stabilized=is_stabilized,
        removed=weight_removed,
        unit=unit,
    )


def build_frame(weight_kg: float, impedance_ohm: int | None = None) -> bytes:
    """Construit une trame 0x181B synthétique (utile pour --simulate)."""
    ctrl = CTRL_IS_STABILIZED
    if impedance_ohm:
        ctrl |= CTRL_HAS_IMPEDANCE

    raw_weight = int(round(weight_kg * 200))
    data = bytearray(13)
    data[0:2] = ctrl.to_bytes(2, "little")
    data[2] = 0x1D  # année 29 (offset 2000) — non exploité côté ColocOS
    data[3] = 0x0B
    data[4] = 0x0D
    data[5] = 0x0C
    data[6] = 0x00
    data[7] = 0x00
    data[8] = 0x00
    data[9:11] = (impedance_ohm or 0).to_bytes(2, "little")
    data[11:13] = raw_weight.to_bytes(2, "little")
    return bytes(data)


def http_post_json(url: str, payload: dict, headers: dict[str, str], timeout: float = 8.0):
    """POST JSON — httpx si disponible, sinon urllib (stdlib)."""
    if httpx is not None:
        response = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        return response.status_code, response.text

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


class ColocScaleBridge:
    def __init__(self) -> None:
        load_dotenv()

        self.api_url = os.getenv("COLOCOS_API_URL", "http://localhost/api").rstrip("/")
        self.device_key = os.getenv("COLOCOS_DEVICE_KEY", "colocos_scale_device_key")
        self.jarvis_url = (os.getenv("JARVIS_API_URL") or "").rstrip("/")
        self.jarvis_key = os.getenv("JARVIS_INTEGRATION_KEY", "")
        self.user_id = os.getenv("COLOCOS_USER_ID") or None
        self.scale_mac = (os.getenv("SCALE_MAC_ADDRESS") or "").upper() or None

        self._last_sent: dict[tuple[float, int | None], float] = {}

    # ── Envoi ────────────────────────────────────────────────────────────
    def should_send(self, measurement: Measurement) -> bool:
        if not measurement.stabilized:
            return False
        if measurement.removed:
            return False
        if measurement.weight_kg < 20 or measurement.weight_kg > 400:
            return False

        last = self._last_sent.get(measurement.key())
        now = time.monotonic()
        if last is not None and now - last < DEBOUNCE_SECONDS:
            print(f"⏭  Trame ignorée (doublon dans la fenêtre de {DEBOUNCE_SECONDS}s)")
            return False
        return True

    def send(self, measurement: Measurement) -> bool:
        payload: dict = {"weightKg": measurement.weight_kg}
        if measurement.impedance_ohm:
            payload["impedanceOhm"] = measurement.impedance_ohm
        if self.user_id:
            payload["userId"] = self.user_id

        url = f"{self.api_url}/profile/weigh-in"
        print(f"→ POST {url} {payload}")

        try:
            status, body = http_post_json(
                url, payload, {"X-Device-Key": self.device_key}
            )
        except Exception as error:  # réseau coupé, DNS, timeout…
            print(f"✗ ColocOS injoignable : {error}")
            return False

        if status not in (200, 201):
            print(f"✗ ColocOS a répondu {status} : {body[:200]}")
            return False

        print(f"✓ Pesée enregistrée ({status})")
        try:
            data = json.loads(body).get("data", {})
            if data.get("bodyFatPct") is not None:
                print(
                    f"   BIA : {data['bodyFatPct']} % MG · {data.get('muscleMassKg')} kg muscle"
                )
            if data.get("userId"):
                print(f"   Profil : {data['userId']}")
        except Exception:
            pass

        self._last_sent[measurement.key()] = time.monotonic()
        self.push_to_jarvis(measurement)
        return True

    def push_to_jarvis(self, measurement: Measurement) -> None:
        if not self.jarvis_url:
            return

        payload = {
            "userId": self.user_id,
            "weightKg": measurement.weight_kg,
            "impedanceOhm": measurement.impedance_ohm,
            "measuredAt": datetime.now(timezone.utc).isoformat(),
        }
        headers = {"X-Integration-Key": self.jarvis_key} if self.jarvis_key else {}

        try:
            status, _ = http_post_json(f"{self.jarvis_url}/api/weigh-in", payload, headers)
            print(f"→ Jarvis : {status}")
        except Exception as error:
            print(f"⚠ Jarvis injoignable : {error}")

    # ── Scan BLE ─────────────────────────────────────────────────────────
    async def scan(self, once: bool = False) -> None:
        if BleakScanner is None:
            print("✗ bleak n'est pas installé — `pip install -r requirements.txt`", file=sys.stderr)
            sys.exit(2)

        print(f"🔍 Scan BLE sur {SERVICE_UUID}")
        if self.scale_mac:
            print(f"   filtre MAC : {self.scale_mac}")

        stop = asyncio.Event()

        def on_detection(device, advertisement_data):  # type: ignore[no-untyped-def]
            address = (device.address or "").upper()
            if self.scale_mac and address != self.scale_mac:
                return

            payloads = []
            for uuid, value in (advertisement_data.service_data or {}).items():
                if str(uuid).lower().startswith("0000181b"):
                    payloads.append(value)
            if not payloads:
                return

            measurement = decode_frame(payloads[0])
            if measurement is None:
                return

            print(
                f"📡 {address} — {measurement.weight_kg} kg"
                f"{f' / {measurement.impedance_ohm} Ω' if measurement.impedance_ohm else ''}"
                f" (stable={measurement.stabilized})"
            )

            if self.should_send(measurement) and self.send(measurement) and once:
                stop.set()

        scanner = BleakScanner(detection_callback=on_detection)
        await scanner.start()
        try:
            await stop.wait()
        finally:
            await scanner.stop()
            print("⏹  Scan arrêté")


def main() -> None:
    parser = argparse.ArgumentParser(description="ColocOS — passerelle balance Xiaomi")
    parser.add_argument("--scan", action="store_true", help="écoute BLE continue")
    parser.add_argument("--once", action="store_true", help="s'arrête après la première pesée envoyée")
    parser.add_argument(
        "--simulate",
        nargs="+",
        metavar=("WEIGHT_KG", "IMPEDANCE_OHM"),
        help="injecte une trame synthétique puis envoie la pesée (ex. --simulate 73.8 475)",
    )
    args = parser.parse_args()

    bridge = ColocScaleBridge()

    if args.simulate:
        weight = float(args.simulate[0])
        impedance = int(args.simulate[1]) if len(args.simulate) > 1 else None
        frame = build_frame(weight, impedance)
        print(f"🧪 Trame synthétique : {frame.hex(' ')}")

        measurement = decode_frame(frame)
        if measurement is None:
            print("✗ Trame non décodable", file=sys.stderr)
            sys.exit(1)

        print(
            f"   décodé : {measurement.weight_kg} kg"
            f"{f' / {measurement.impedance_ohm} Ω' if measurement.impedance_ohm else ''}"
            f" (stable={measurement.stabilized}, unité={measurement.unit})"
        )

        if not bridge.should_send(measurement):
            print("✗ Trame rejetée par l'anti-rebond", file=sys.stderr)
            sys.exit(1)

        sys.exit(0 if bridge.send(measurement) else 1)

    if args.scan:
        asyncio.run(bridge.scan(once=args.once))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
