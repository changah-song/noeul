#!/usr/bin/env python3
"""Scripted smoke test of a Noeul release APK on the user's Android phone.

    smoke.py run --apk PATH --label NAME --out DIR [--serial R3KYC01FY8K]
    smoke.py compare BASE.json PR.json        # prints a markdown comparison

`run` installs the APK over the phone's dev build, wipes the app's data, and then:
  1. fresh-install launch, then three normal cold starts (startup time),
  2. visits every tab,
  3. adds a public-domain book and pages through it in the reader,
  4. a cold start in airplane mode (the offline-first promise).

It reads the app's `[noeul-telemetry]` log lines (frontend/services/
appTelemetry.js) to time startup and count UI freezes, and watches the system
log for crashes and "app not responding" dialogs. Results go to
DIR/results.json plus a screenshot per step for a human or Claude to look at.

Standard library only. Talks to the device through adb.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PACKAGE = "com.noeulapp.Noeul"
ACTIVITY = f"{PACKAGE}/.MainActivity"
ADB = os.environ.get("ADB", str(Path.home() / "Library/Android/sdk/platform-tools/adb"))

TELEMETRY_RE = re.compile(
    r"^\s*(?P<ts>\d+\.\d+).*\[noeul-telemetry\] event=(?P<event>\w+) duration_ms=(?P<ms>\d*) screen=(?P<screen>\S*)"
)
FATAL_RE = re.compile(r"FATAL EXCEPTION|Process: " + re.escape(PACKAGE))
ANR_RE = re.compile(r"ANR in " + re.escape(PACKAGE))

# System dialogs that can block the UI during a run, and what to tap.
DISMISS = [
    (re.compile(r"^Don.t show again$", re.I), "16 KB page-size compatibility notice"),
    (re.compile(r"^Don.t allow$", re.I), "permission prompt"),
    (re.compile(r"^Close app$", re.I), "crash dialog"),
]
NOT_RESPONDING_RE = re.compile(r"isn.t responding", re.I)

STARTUP_TIMEOUT_S = 60
DEFAULT_SERIAL = "R3KYC01FY8K"  # the user's Galaxy S25 Ultra
HOME_MARKERS = re.compile(r"^(Collection|My books|Your shelf is empty)$", re.I)


class Device:
    def __init__(self, serial: str):
        self.serial = serial
        self.log_text: list[str] = []

    def adb(self, *args: str, check: bool = True, binary: bool = False, timeout: int = 120):
        result = subprocess.run(
            [ADB, "-s", self.serial, *args],
            capture_output=True,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"adb {' '.join(args)} failed: {result.stderr.decode(errors='replace')}")
        return result.stdout if binary else result.stdout.decode(errors="replace")

    def shell(self, command: str, **kwargs) -> str:
        return self.adb("shell", command, **kwargs)

    def device_time(self) -> float:
        return float(self.shell("date +%s.%N").strip())

    # ── logs ────────────────────────────────────────────────────────────────
    def drain_log(self) -> str:
        """Append the device log to the run's log and clear the device buffer."""
        text = self.adb("logcat", "-d", "-v", "epoch", check=False)
        self.adb("logcat", "-c", check=False)
        self.log_text.append(text)
        return text

    # ── UI ──────────────────────────────────────────────────────────────────
    def ui_nodes(self) -> list[dict]:
        raw = self.adb("exec-out", "uiautomator", "dump", "/dev/tty", check=False)
        start, end = raw.find("<?xml"), raw.rfind("</hierarchy>")
        if start < 0 or end < 0:
            return []
        try:
            root = ET.fromstring(raw[start:end + len("</hierarchy>")])
        except ET.ParseError:
            return []
        nodes = []
        for node in root.iter("node"):
            bounds = re.findall(r"\d+", node.get("bounds", ""))
            if len(bounds) != 4:
                continue
            x1, y1, x2, y2 = map(int, bounds)
            nodes.append({
                "text": (node.get("text") or "").strip(),
                "desc": (node.get("content-desc") or "").strip(),
                "center": ((x1 + x2) // 2, (y1 + y2) // 2),
            })
        return nodes

    def find(self, pattern: re.Pattern, nodes: list[dict] | None = None) -> dict | None:
        for node in nodes if nodes is not None else self.ui_nodes():
            if pattern.search(node["text"]) or pattern.search(node["desc"]):
                return node
        return None

    def tap(self, x: int, y: int) -> None:
        self.shell(f"input tap {x} {y}")

    def tap_text(self, pattern: re.Pattern, timeout_s: float = 10) -> bool:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            node = self.find(pattern)
            if node:
                self.tap(*node["center"])
                return True
            time.sleep(0.5)
        return False

    def wait_for(self, pattern: re.Pattern, timeout_s: float = 15) -> bool:
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.find(pattern):
                return True
            time.sleep(0.5)
        return False

    def dismiss_dialogs(self) -> list[str]:
        dismissed = []
        nodes = self.ui_nodes()
        for pattern, label in DISMISS:
            node = self.find(pattern, nodes)
            if node:
                self.tap(*node["center"])
                dismissed.append(label)
                time.sleep(1)
        return dismissed

    def not_responding_visible(self) -> bool:
        return self.find(NOT_RESPONDING_RE) is not None

    def screenshot(self, path: Path) -> str:
        path.write_bytes(self.adb("exec-out", "screencap", "-p", binary=True))
        return str(path)

    def app_alive(self) -> bool:
        return bool(self.shell(f"pidof {PACKAGE}", check=False).strip())

    def ensure_awake(self) -> None:
        """Wake the screen; refuse to continue on a locked phone."""
        self.shell("input keyevent KEYCODE_WAKEUP", check=False)
        time.sleep(0.5)
        window = self.shell("dumpsys window", check=False)
        if "isKeyguardShowing=true" in window or "mDreamingLockscreen=true" in window:
            raise SystemExit("The phone is locked. Unlock it, keep it on the desk, and run again.")

    def set_airplane(self, on: bool) -> None:
        self.shell(f"cmd connectivity airplane-mode {'enable' if on else 'disable'}")
        time.sleep(3)


def cold_start(dev: Device, out: Path, name: str) -> dict:
    """Launch from a stopped process and time it with the app_start log line."""
    dev.ensure_awake()
    dev.shell(f"am force-stop {PACKAGE}")
    time.sleep(1)
    dev.drain_log()
    t0 = dev.device_time()
    dev.shell(f"am start -n {ACTIVITY}")

    result = {"name": name, "wall_ms": None, "js_ms": None, "home_visible": False}
    deadline = time.time() + STARTUP_TIMEOUT_S
    while time.time() < deadline:
        text = dev.adb("logcat", "-d", "-v", "epoch", check=False)
        match = next(
            (m for m in (TELEMETRY_RE.match(line) for line in text.splitlines()) if m and m["event"] == "app_start"),
            None,
        )
        if match:
            result["wall_ms"] = round((float(match["ts"]) - t0) * 1000)
            result["js_ms"] = int(match["ms"]) if match["ms"] else None
            break
        if dev.find(DISMISS[0][0]):
            dev.dismiss_dialogs()
        time.sleep(0.25)

    time.sleep(2)
    dev.dismiss_dialogs()
    result["home_visible"] = dev.wait_for(HOME_MARKERS, timeout_s=8)
    result["screenshot"] = dev.screenshot(out / f"{name}.png")
    result["alive"] = dev.app_alive()
    if result["wall_ms"] is None:
        result["error"] = f"no app_start log line within {STARTUP_TIMEOUT_S}s (splash may be stuck)"
    dev.drain_log()
    return result


def step(dev: Device, out: Path, name: str, action) -> dict:
    """Run one UI step and record whether the app survived it."""
    dev.ensure_awake()
    detail = ""
    ok = True
    try:
        detail = action() or ""
    except Exception as error:  # a broken step should not abort the whole run
        ok = False
        detail = f"error: {error}"
    time.sleep(1.5)
    if dev.not_responding_visible():
        ok = False
        detail = (detail + "; " if detail else "") + "'not responding' dialog shown"
    alive = dev.app_alive()
    if not alive:
        ok = False
        detail = (detail + "; " if detail else "") + "app process died"
    dev.dismiss_dialogs()
    shot = dev.screenshot(out / f"{name}.png")
    dev.drain_log()
    return {"name": name, "ok": ok, "detail": detail, "screenshot": shot}


def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dev = Device(args.serial)

    dev.ensure_awake()
    dev.set_airplane(False)
    dev.adb("install", "-r", args.apk, timeout=300)
    dev.shell(f"pm clear {PACKAGE}")
    dev.adb("logcat", "-c", check=False)

    startups = [cold_start(dev, out, "start-fresh-install")]
    for i in range(1, 4):
        startups.append(cold_start(dev, out, f"start-cold-{i}"))

    steps = []

    def visit(tab: str):
        def action():
            if not dev.tap_text(re.compile(rf"^{tab}$", re.I)):
                raise RuntimeError(f"tab '{tab}' not found")
            time.sleep(2)
            return f"opened {tab}"
        return action

    for tab in ("Read", "Learn", "Profile", "Home"):
        steps.append(step(dev, out, f"tab-{tab.lower()}", visit(tab)))

    def add_book():
        if not dev.tap_text(re.compile(r"^Public domain$", re.I)):
            raise RuntimeError("'Public domain' tab not found")
        time.sleep(2)
        if not dev.tap_text(re.compile(r"^감자$")):
            raise RuntimeError("book '감자' not found")
        time.sleep(2)
        if not dev.tap_text(re.compile(r"^Add$", re.I)):
            raise RuntimeError("'Add' button not found on the book page")
        time.sleep(2)
        dev.shell("input keyevent KEYCODE_BACK")
        time.sleep(2)
        return "added 감자 from the public domain"

    def open_reader():
        if not dev.tap_text(re.compile(r"^Resume", re.I)):
            raise RuntimeError("'Resume' button not found after adding the book")
        time.sleep(5)
        return "opened the reader"

    def page_through():
        size = dev.shell("wm size").strip().split()[-1]
        width, height = map(int, size.split("x"))
        for _ in range(6):
            dev.shell(f"input swipe {int(width * 0.85)} {height // 2} {int(width * 0.15)} {height // 2} 250")
            time.sleep(1.2)
        return "swiped forward 6 times"

    steps.append(step(dev, out, "book-add", add_book))
    steps.append(step(dev, out, "book-open-reader", open_reader))
    steps.append(step(dev, out, "book-page-through", page_through))

    dev.set_airplane(True)
    try:
        startups.append(cold_start(dev, out, "start-offline"))
    finally:
        dev.set_airplane(False)

    dev.drain_log()
    log = "\n".join(dev.log_text)
    (out / "device.log").write_text(log)

    freezes = []
    crashes = []
    for line in log.splitlines():
        match = TELEMETRY_RE.match(line)
        if match and match["event"] == "js_stall":
            freezes.append({"duration_ms": int(match["ms"] or 0), "screen": match["screen"] or None})
        elif match and match["event"] == "crash":
            crashes.append(line.strip())
        elif FATAL_RE.search(line) and "AndroidRuntime" in line:
            crashes.append(line.strip())
    anrs = [line.strip() for line in log.splitlines() if ANR_RE.search(line)]

    results = {
        "label": args.label,
        "apk": args.apk,
        "startups": startups,
        "steps": steps,
        "freezes": freezes,
        "crashes": crashes,
        "anrs": anrs,
    }
    (out / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(out / "results.json")


# ── compare ─────────────────────────────────────────────────────────────────

def _median(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values)) if values else None


def summarize(results: dict) -> dict:
    by_name = {s["name"]: s for s in results["startups"]}
    cold = [s for s in results["startups"] if s["name"].startswith("start-cold-")]
    return {
        "cold_wall": _median([s["wall_ms"] for s in cold]),
        "cold_js": _median([s["js_ms"] for s in cold]),
        "fresh_wall": by_name.get("start-fresh-install", {}).get("wall_ms"),
        "offline_wall": by_name.get("start-offline", {}).get("wall_ms"),
        "offline_home": by_name.get("start-offline", {}).get("home_visible"),
        "freezes": len(results["freezes"]),
        "worst_freeze": max((f["duration_ms"] for f in results["freezes"]), default=None),
        "crashes": len(results["crashes"]) + len(results["anrs"]),
        "steps_failed": [s["name"] for s in results["steps"] if not s["ok"]]
        + [s["name"] for s in results["startups"] if s.get("error") or not s.get("home_visible") or not s.get("alive", True)],
    }


def fmt_ms(ms):
    return "–" if ms is None else f"{ms / 1000:.2f} s"


def verdict(base, pr, key, slower_is_worse=True, rel=0.20, abs_ms=300):
    b, p = base[key], pr[key]
    if b is None or p is None:
        return "–"
    diff = p - b
    if slower_is_worse and diff > max(b * rel, abs_ms):
        return "slower"
    if slower_is_worse and -diff > max(b * rel, abs_ms):
        return "faster"
    return "same"


def compare(args: argparse.Namespace) -> None:
    base = summarize(json.loads(Path(args.base).read_text()))
    pr = summarize(json.loads(Path(args.pr).read_text()))
    rows = [
        ("Cold start, median of 3", fmt_ms(base["cold_wall"]), fmt_ms(pr["cold_wall"]), verdict(base, pr, "cold_wall")),
        ("  JS part of cold start", fmt_ms(base["cold_js"]), fmt_ms(pr["cold_js"]), verdict(base, pr, "cold_js")),
        ("First launch after install", fmt_ms(base["fresh_wall"]), fmt_ms(pr["fresh_wall"]), verdict(base, pr, "fresh_wall")),
        ("Offline cold start", fmt_ms(base["offline_wall"]), fmt_ms(pr["offline_wall"]), verdict(base, pr, "offline_wall")),
        ("UI freezes (1 s or more)", str(base["freezes"]), str(pr["freezes"]),
         "more" if pr["freezes"] > base["freezes"] else ("fewer" if pr["freezes"] < base["freezes"] else "same")),
        ("Longest freeze", fmt_ms(base["worst_freeze"]), fmt_ms(pr["worst_freeze"]), ""),
        ("Crashes and not-responding", str(base["crashes"]), str(pr["crashes"]), "FAIL" if pr["crashes"] else "ok"),
    ]
    print("| Measure | main | PR | Result |")
    print("|---|---|---|---|")
    for row in rows:
        print("| " + " | ".join(row) + " |")
    print()
    failed = pr["steps_failed"]
    print("Failed steps on the PR build: " + (", ".join(failed) if failed else "none"))
    base_failed = base["steps_failed"]
    if base_failed:
        print("Steps that also fail on main: " + ", ".join(base_failed))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--apk", required=True)
    run_parser.add_argument("--label", required=True)
    run_parser.add_argument("--out", required=True)
    run_parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", DEFAULT_SERIAL))
    compare_parser = sub.add_parser("compare")
    compare_parser.add_argument("base")
    compare_parser.add_argument("pr")
    args = parser.parse_args()
    if args.command == "run":
        run(args)
    else:
        compare(args)


if __name__ == "__main__":
    sys.exit(main())
