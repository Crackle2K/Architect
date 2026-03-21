"""
Quick diagnostic — run this before enhanced_bot.py to find out
what's missing or broken on your system.

Usage:
    python diagnose.py
"""

import sys

print("=" * 50)
print("Among Us Bot — Diagnostics")
print("=" * 50)
print(f"Python: {sys.version}\n")

all_ok = True

def check(label, fn):
    global all_ok
    try:
        result = fn()
        print(f"  [OK]  {label}" + (f"  →  {result}" if result else ""))
    except Exception as e:
        print(f"  [FAIL] {label}")
        print(f"         {e}")
        all_ok = False

# ── Core imports ────────────────────────────────────────────────
print("[ Imports ]")
check("numpy",     lambda: __import__("numpy").__version__)
check("cv2",       lambda: __import__("cv2").__version__)
check("pyautogui", lambda: __import__("pyautogui").__version__)
check("dxcam",     lambda: __import__("dxcam").__version__)

# ── Optional OCR ────────────────────────────────────────────────
print()
print("[ OCR (optional) ]")
try:
    import pytesseract
    print(f"  [OK]  pytesseract  →  {pytesseract.__version__}")
    try:
        ver = pytesseract.get_tesseract_version()
        print(f"  [OK]  Tesseract binary  →  {ver}")
    except Exception as e:
        print(f"  [WARN] Tesseract binary not found — OCR will be disabled")
        print(f"         Download from: https://github.com/UB-Mannheim/tesseract/wiki")
        print(f"         Error: {e}")
except ImportError:
    print("  [WARN] pytesseract not installed — run: pip install pytesseract")

# ── Screen capture ───────────────────────────────────────────────
print()
print("[ Screen capture ]")
def test_dxcam():
    import dxcam
    cam = dxcam.create()
    frame = cam.grab()
    if frame is None:
        raise RuntimeError("grab() returned None — is your display active?")
    return f"frame shape: {frame.shape}"

check("dxcam grab()", test_dxcam)

# ── Game window ──────────────────────────────────────────────────
print()
print("[ Among Us window ]")
def test_window():
    import pyautogui
    wins = pyautogui.getWindowsWithTitle("Among Us")
    if not wins:
        raise RuntimeError("Among Us window not found — is the game running?")
    w = wins[0]
    return f"'{w.title}'  at ({w.left},{w.top})  size {w.width}x{w.height}"

check("Among Us window", test_window)

# ── Summary ──────────────────────────────────────────────────────
print()
print("=" * 50)
if all_ok:
    print("All checks passed — you can run: python enhanced_bot.py")
else:
    print("Some checks FAILED — fix the issues above, then re-run this script.")
print("=" * 50)
input("\nPress Enter to exit...")   # keeps the window open if double-clicked
