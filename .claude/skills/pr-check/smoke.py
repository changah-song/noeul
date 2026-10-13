#!/usr/bin/env python3
"""Scripted smoke test of a Noeul release APK on the user's Android phone.

    smoke.py run --apk PATH --label NAME --out DIR [--serial R3KYC01FY8K]
    smoke.py compare BASE.json PR.json        # prints a markdown comparison

`run` installs the APK over the phone's dev build, wipes the app's data, and then:
  1. fresh-install launch, then three normal cold starts (startup time),
  2. visits every tab,
  3. adds a public-domain book and pages through it in the reader,
  4. turns on focus mode in the reader and steps to the next sentence,
  5. adds a song with lyrics and opens it,
  6. saves a word from the reader and reviews it as a flashcard in Learn,
  7. starts the floating OCR scanner, scans the screen, and turns it off,
  8. a cold start in airplane mode (the offline-first promise).

`--steps` runs a subset (comma-separated: startup, tabs, book, focus, songs,
flashcards, ocr, offline). A fresh-install launch always runs first.

It reads the app's `[noeul-telemetry]` log lines (frontend/services/
appTelemetry.js) to time startup and count UI freezes, and watches the system
log for crashes and "app not responding" dialogs. Results go to
DIR/results.json plus a screenshot per step for a human or Claude to look at.

Standard library only. Talks to the device through adb.
"""
from __future__ import annotations

import argparse
import fcntl
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
# A fatal Java crash prints "FATAL EXCEPTION" and then "Process: <name>". Only
# count it when the process is Noeul: uiautomator itself can crash too.
APP_CRASH_RE = re.compile(r"AndroidRuntime.*Process: " + re.escape(PACKAGE) + r"(,|\s|$)")
ANR_RE = re.compile(r"ANR in " + re.escape(PACKAGE))

# System dialogs that can block the UI during a run, and what to tap.
# The phone's system language may be Korean, so each has both wordings.
DISMISS = [
    (re.compile(r"^(Don.t show again|다시 표시 안함)$", re.I), "16 KB page-size compatibility notice"),
    (re.compile(r"^(Don.t allow|허용 안함|허용 안 함)$", re.I), "permission prompt"),
    (re.compile(r"^(Close app|앱 닫기)$", re.I), "crash dialog"),
]
NOT_RESPONDING_RE = re.compile(r"isn.t responding", re.I)

STARTUP_TIMEOUT_S = 60
DEFAULT_SERIAL = "R3KYC01FY8K"  # the user's Galaxy S25 Ultra
ALL_STEPS = ("startup", "tabs", "book", "focus", "songs", "flashcards", "ocr", "offline")
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
                "hint": (node.get("hint") or "").strip(),
                "cls": node.get("class") or "",
                "enabled": node.get("enabled") != "false",
                "bounds": (x1, y1, x2, y2),
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

    def find_input(self, pattern: re.Pattern) -> dict | None:
        """An editable field whose hint (or empty-field text) matches."""
        for node in self.ui_nodes():
            if "EditText" in node["cls"] and (pattern.search(node["hint"]) or pattern.search(node["text"])):
                return node
        return None

    def type_text(self, text: str) -> None:
        """Type ASCII text into the focused field (adb can't type Hangul)."""
        escaped = re.sub(r"([\\'\"`$&|;<>()])", r"\\\1", text).replace(" ", "%s")
        self.shell(f"input text {escaped}")

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


def lock_device(serial: str):
    """Hold an exclusive lock on the phone for the whole run.

    Two checks on one phone at once install over each other and fight over the
    screen, which makes both runs' results meaningless. A second run waits here.
    """
    lock_dir = Path(os.environ.get("NOEUL_PR_CHECK_CACHE", Path.home() / ".cache/noeul-pr-check"))
    lock_dir.mkdir(parents=True, exist_ok=True)
    handle = open(lock_dir / f"device-{serial}.lock", "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print(f"Another check is using {serial}; waiting for it to finish...", file=sys.stderr, flush=True)
        fcntl.flock(handle, fcntl.LOCK_EX)
    return handle  # keep a reference; the lock lasts until the process exits


def run(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    _lock = lock_device(args.serial)
    dev = Device(args.serial)
    state = subprocess.run([ADB, "-s", args.serial, "get-state"], capture_output=True, text=True)
    if state.stdout.strip() != "device":
        raise SystemExit(
            f"Phone {args.serial} isn't connected ({(state.stdout or state.stderr).strip() or 'not found'}). "
            "Plug it in, unlock it, and allow USB debugging if asked."
        )

    dev.ensure_awake()
    dev.set_airplane(False)
    dev.adb("install", "-r", args.apk, timeout=300)
    dev.shell(f"pm clear {PACKAGE}")
    dev.adb("logcat", "-c", check=False)

    groups = set(args.steps.split(",")) if args.steps else set(ALL_STEPS)
    unknown = groups - set(ALL_STEPS)
    if unknown:
        raise SystemExit(f"unknown --steps: {', '.join(sorted(unknown))}")
    # The OCR scanner draws over other apps; grant that from adb so the run
    # doesn't stop at Android's settings screen.
    dev.shell(f"appops set {PACKAGE} SYSTEM_ALERT_WINDOW allow", check=False)

    startups = [cold_start(dev, out, "start-fresh-install")]
    if "startup" in groups:
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

    if "tabs" in groups:
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

    def go_home():
        if not dev.tap_text(re.compile(r"^Home$", re.I)):
            dev.shell("input keyevent KEYCODE_BACK")
            time.sleep(1)
            dev.tap_text(re.compile(r"^Home$", re.I))
        time.sleep(2)
        # Back to the top, where the header (and the scanner switch) lives.
        for _ in range(3):
            dev.shell("input swipe 540 900 540 1900 250")
            time.sleep(0.5)

    counter_re = re.compile(r"^SENTENCES? (\d+)(?:[–-]\d+)? / (\d+)$", re.I)

    def focus_counter():
        node = dev.find(counter_re)
        if not node:
            return None
        match = counter_re.search(node["text"] or node["desc"])
        return int(match[1]), int(match[2])

    def focus_mode():
        if dev.find(re.compile(r"^Resume", re.I)) and not dev.find(re.compile(r"^Focus mode$")):
            open_reader()
        if not dev.tap_text(re.compile(r"^Focus mode$")):
            raise RuntimeError("'Focus mode' button not found in the reader")
        time.sleep(2)
        before = focus_counter()
        if not before:
            raise RuntimeError("focus mode did not show its sentence counter")
        if dev.find(re.compile(r"^Next sentence$")):
            dev.tap_text(re.compile(r"^Next sentence$"))
            how = "Next button"
        else:
            size = dev.shell("wm size").strip().split()[-1]
            width, height = map(int, size.split("x"))
            dev.shell(f"input swipe {width // 2} {int(height * 0.7)} {width // 2} {int(height * 0.35)} 250")
            how = "swipe"
        time.sleep(1.5)
        after = focus_counter()
        dev.tap_text(re.compile(r"^Focus mode$"))  # leave focus mode
        time.sleep(1)
        if not after or after[0] <= before[0]:
            raise RuntimeError(f"sentence counter did not advance ({before} -> {after}) using {how}")
        return f"sentence {before[0]} -> {after[0]} of {after[1]} via {how}"

    # Digits only: `adb input text` goes through the phone's keyboard, and a
    # keyboard in Korean mode turns Latin letters into jamo. Digits type the
    # same in every layout.
    song_title = "1013 2026"

    def scroll_to(pattern, swipes=4):
        """Home's "Continue reading" card pushes the list below the fold."""
        for _ in range(swipes + 1):
            if dev.wait_for(pattern, timeout_s=2):
                return True
            dev.shell("input swipe 540 1900 540 1000 300")
            time.sleep(1)
        return False

    def song_add():
        go_home()
        if not dev.tap_text(re.compile(r"^Songs$", re.I)):
            raise RuntimeError("'Songs' tab not found on Home")
        time.sleep(2)
        if not dev.tap_text(re.compile(r"^(New song|Add a song|\+ Add song)$", re.I)):
            raise RuntimeError("no button to add a song")
        time.sleep(2)
        title = dev.find_input(re.compile(r"^Song title$", re.I))
        if not title:
            raise RuntimeError("song title field not found")
        dev.tap(*title["center"])
        dev.type_text(song_title)
        lyrics = dev.find_input(re.compile(r"^Enter lyrics$", re.I))
        if not lyrics:
            raise RuntimeError("lyrics field not found")
        dev.tap(*lyrics["center"])
        dev.type_text("10 13 2026")
        dev.shell("input keyevent KEYCODE_ENTER")
        dev.type_text("1 2 3 4 5")
        time.sleep(1)
        if not dev.tap_text(re.compile(r"^Save$", re.I)):
            raise RuntimeError("'Save' button not found in the song editor")
        time.sleep(2)
        if not scroll_to(re.compile(rf"^{song_title}$")):
            raise RuntimeError("the new song did not appear in the list")
        return "added a song with two lines of lyrics"

    def song_open():
        scroll_to(re.compile(rf"^{song_title}$"))
        if not dev.tap_text(re.compile(rf"^{song_title}$")):
            raise RuntimeError("song not found in the list")
        time.sleep(3)
        # The lyrics view doesn't expose its words to the screen reader, so
        # confirm the song reader by its header; the screenshot shows the lyrics.
        if not dev.wait_for(re.compile(r"\bwords saved$", re.I), timeout_s=8):
            raise RuntimeError("the song reader did not open")
        shot = dev.screenshot(out / "song-reader.png")
        dev.tap_text(re.compile(r"^Back to songs$"), timeout_s=3) or dev.shell("input keyevent KEYCODE_BACK")
        time.sleep(1)
        return f"lyrics shown ({Path(shot).name})"

    def flashcards():
        # Into the reader with the book from the earlier step.
        if not dev.find(re.compile(r"^Focus mode$")):
            go_home()
            open_reader()
        # Tap a word near the start of a paragraph until the lookup panel offers "Save word".
        # The lookup panel's save button; the reader header then counts it as "Saved (1)".
        save_re = re.compile(r"^(Save|Save word)$")
        saved_re = re.compile(r"^Saved \(([1-9]\d*)\)$")
        # The reader's text isn't exposed to the screen reader, so tap spots in
        # the text area (as fractions of the screen) where lines of the book sit.
        size = dev.shell("wm size").strip().split()[-1]
        width, height = map(int, size.split("x"))
        # Words with no dictionary entry can't be saved (their Save button does
        # nothing), so try spots across the page until a word with a definition opens.
        no_entry_re = re.compile(r"^(No dictionary entry available|No definition found)$")
        spots = [(fx, fy) for fy in (0.34, 0.40, 0.46, 0.52, 0.58, 0.64) for fx in (0.6, 0.3, 0.8)]
        save_node = None
        for fx, fy in spots:
            if not dev.find(re.compile(r"^Focus mode$")):
                go_home()
                open_reader()
            dev.tap(int(width * fx), int(height * fy))
            if not dev.wait_for(save_re, timeout_s=8):
                continue
            time.sleep(2)  # let the definition finish loading
            nodes = dev.ui_nodes()
            if not dev.find(no_entry_re, nodes):
                save_node = dev.find(save_re, nodes)
                if save_node:
                    break
            dev.shell("input keyevent KEYCODE_BACK")
            time.sleep(1)
        if not save_node:
            raise RuntimeError("no tapped word opened a dictionary entry that could be saved")
        dev.tap(*save_node["center"])
        dev.shell("input keyevent KEYCODE_BACK")  # close the lookup panel
        time.sleep(1)
        if not dev.wait_for(saved_re, timeout_s=6):
            raise RuntimeError("tapped Save, but the reader's saved-word count didn't go up")
        dev.screenshot(out / "flashcards-saved-word.png")
        # Review it in Learn.
        if not dev.tap_text(re.compile(r"^Learn$", re.I)):
            raise RuntimeError("'Learn' tab not found")
        time.sleep(2)
        if not dev.tap_text(re.compile(r"^Review \d+ due$", re.I), timeout_s=8):
            raise RuntimeError("Learn shows no 'Review N due' button after saving a word")
        time.sleep(2)
        if not dev.tap_text(re.compile(r"^(Show answer|Tap to flip)$", re.I), timeout_s=8):
            raise RuntimeError("flashcard did not appear")
        time.sleep(1.5)
        dev.screenshot(out / "flashcards-answer.png")
        if not dev.tap_text(re.compile(r"^Okay$", re.I), timeout_s=6):
            raise RuntimeError("grading buttons (Hard / Okay / Easy) did not appear")
        time.sleep(2)
        return "saved a word from the reader, flipped its flashcard and graded it Okay"

    ocr_on = re.compile(r"^Turn on screen text scanner$")
    ocr_off = re.compile(r"^Turn off screen text scanner$")
    # Android's screen-capture consent dialog, worded differently across
    # versions and languages. It may default to sharing a single app; open
    # that dropdown and pick the entire screen, then confirm.
    capture_single_app = re.compile(r"^(A single app|Share one app|앱 하나 공유)$", re.I)
    capture_choice = re.compile(r"^(Entire screen|Share entire screen|Full screen|전체 화면 공유|전체 화면)$", re.I)
    capture_confirm = re.compile(r"^(Start now|Start|Next|Share screen|Allow|지금 시작|시작|다음|화면 공유|허용)$", re.I)
    capture_cancel = re.compile(r"^(Cancel|취소)$", re.I)

    def ocr_bubble():
        """Center of the floating scanner bubble. It's an overlay window the
        screen reader doesn't list, so find it in the window manager's list."""
        windows = dev.shell("dumpsys window windows", check=False)
        for block in windows.split("Window #")[1:]:
            header = block.splitlines()[0]
            if f"u0 {PACKAGE}}}" not in header or "ty=APPLICATION_OVERLAY" not in block:
                continue
            match = re.search(r"\bframe=\[(\d+),(\d+)\]\[(\d+),(\d+)\]", block)
            if not match:
                continue
            x1, y1, x2, y2 = map(int, match.groups())
            if 0 < x2 - x1 < 500 and 0 < y2 - y1 < 500:
                return (x1 + x2) // 2, (y1 + y2) // 2
        return None

    ocr_result_re = re.compile(r"OcrResultOverlay: .*targets=(\d+)")

    def ocr_scan():
        go_home()
        if not dev.tap_text(ocr_on):
            raise RuntimeError("scanner switch not found on Home")
        deadline = time.time() + 20
        chose_entire_screen = False
        while time.time() < deadline:
            nodes = dev.ui_nodes()
            if dev.find(ocr_off, nodes):
                break
            # Once "entire screen" is picked, the dropdown shows that same
            # text; tapping it again would just reopen the dropdown.
            if not chose_entire_screen:
                choice = dev.find(capture_choice, nodes)
                if choice:
                    dev.tap(*choice["center"])
                    chose_entire_screen = True
                    time.sleep(1)
                    continue
                single = dev.find(capture_single_app, nodes)
                if single:
                    dev.tap(*single["center"])  # opens the share-mode dropdown
                    time.sleep(1)
                    continue
            confirm = dev.find(capture_confirm, nodes)
            if confirm:
                dev.tap(*confirm["center"])
            time.sleep(1)
        else:
            raise RuntimeError("scanner did not turn on (screen-capture consent may need a manual tap)")
        try:
            # Scan a page of Korean text: the scanner only picks out words in
            # the language being learned.
            open_reader()
            bubble = ocr_bubble()
            if not bubble:
                raise RuntimeError("scanner is on but its floating bubble isn't on screen")
            dev.adb("logcat", "-c", check=False)
            dev.tap(*bubble)
            words = None
            deadline = time.time() + 15
            while time.time() < deadline and words is None:
                for line in dev.adb("logcat", "-d", check=False).splitlines():
                    match = ocr_result_re.search(line)
                    if match:
                        words = int(match[1])
                time.sleep(0.5)
            dev.screenshot(out / "ocr-result.png")
            dev.drain_log()
            if words is None:
                raise RuntimeError("tapped the bubble but no scan result appeared within 15 s")
            if words == 0:
                raise RuntimeError("scan ran but found no words on a page of Korean text")
            return f"scanned the reader page and found {words} words"
        finally:
            # Never leave the screen-share prompt up; it covers later steps.
            leftover = dev.find(capture_cancel)
            if leftover:
                dev.tap(*leftover["center"])
                time.sleep(1)
            # Always turn the scanner off again.
            dev.shell("input keyevent KEYCODE_BACK")
            time.sleep(1)
            go_home()
            if dev.tap_text(ocr_off, timeout_s=8):
                time.sleep(2)

    if groups & {"book", "focus", "flashcards", "ocr"}:
        steps.append(step(dev, out, "book-add", add_book))
        steps.append(step(dev, out, "book-open-reader", open_reader))
    if "book" in groups:
        steps.append(step(dev, out, "book-page-through", page_through))
    if "focus" in groups:
        steps.append(step(dev, out, "focus-mode", focus_mode))
    if "flashcards" in groups:
        steps.append(step(dev, out, "flashcards", flashcards))
    if "songs" in groups:
        steps.append(step(dev, out, "song-add", song_add))
        steps.append(step(dev, out, "song-open", song_open))
    if "ocr" in groups:
        steps.append(step(dev, out, "ocr-scan", ocr_scan))
        dev.shell(f"am force-stop {PACKAGE}")  # never leave the scanner running

    if "offline" in groups:
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
        elif APP_CRASH_RE.search(line):
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
    run_parser.add_argument("--steps", help="comma-separated subset of: " + ",".join(ALL_STEPS))
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
