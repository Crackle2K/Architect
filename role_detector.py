"""
Role Detector for Among Us Bot
Phase 1 of the roadmap: reliable Crewmate vs Impostor detection.

Detection strategy (in priority order):
  1. OCR  — reads "Crewmate" / "Impostor" text directly from the reveal screen.
             Requires pytesseract + Tesseract-OCR to be installed.
  2. Color — compares red vs blue pixel density in the center of the frame.
             Impostor reveal is red-dominant; Crewmate reveal is blue-dominant.

Only the role-reveal screen (shown briefly when a round starts) is analysed.
The detector intentionally returns UNKNOWN during normal gameplay so the
cached role from the reveal is preserved by the caller.
"""

import cv2
import numpy as np
import logging
import os
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional OCR dependency
# ---------------------------------------------------------------------------
try:
    import pytesseract
    _OCR_AVAILABLE = True
except ImportError:
    _OCR_AVAILABLE = False
    logger.warning(
        "pytesseract not found — OCR detection disabled. "
        "Install it with: pip install pytesseract  (and install Tesseract-OCR)"
    )


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

class Role(Enum):
    CREWMATE = "crewmate"
    IMPOSTOR = "impostor"
    UNKNOWN  = "unknown"


@dataclass
class RoleDetectionResult:
    role:       Role
    confidence: float        # 0.0–1.0
    method:     str          # "ocr", "ocr_partial", "color", or "unknown"
    debug:      Dict[str, Any] = field(default_factory=dict)

    def __str__(self):
        return (f"Role={self.role.value}  conf={self.confidence:.2f}  "
                f"via={self.method}  {self.debug}")


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class RoleDetector:
    """
    Detects the local player's role from screen captures of Among Us.

    Usage
    -----
    detector = RoleDetector(debug_screenshots=True)   # saves crops to disk
    result   = detector.detect(frame)
    if result.role == Role.IMPOSTOR:
        hand_off_to_human()

    The caller should:
      - Call detect() on every frame during the game-start transition.
      - Cache the last high-confidence result and keep using it until the
        next round starts (don't re-call mid-game).
    """

    # Minimum confidence required to accept a result instead of returning UNKNOWN
    MIN_CONFIDENCE = 0.65

    # HSV bounds for the role-reveal screen colours
    # Impostor: vivid red glow around the character silhouette
    _IMPOSTOR_RED = [
        (np.array([0,   150, 100]), np.array([10,  255, 255])),
        (np.array([170, 150, 100]), np.array([180, 255, 255])),
    ]
    # Crewmate: blue/cyan tint on the reveal background
    _CREWMATE_BLUE = [
        (np.array([90, 80, 80]), np.array([130, 255, 255])),
    ]

    def __init__(self, debug_screenshots: bool = False,
                 screenshot_dir: str = "debug_screenshots"):
        self.debug_screenshots = debug_screenshots
        self.screenshot_dir    = screenshot_dir
        self._frame_count      = 0

        if debug_screenshots:
            os.makedirs(screenshot_dir, exist_ok=True)
            logger.info(f"Debug screenshots will be saved to: {screenshot_dir}/")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> RoleDetectionResult:
        """
        Analyse a single BGR frame and return a RoleDetectionResult.
        Returns Role.UNKNOWN if no clear signal is found.
        """
        if frame is None:
            return RoleDetectionResult(Role.UNKNOWN, 0.0, "unknown")

        self._frame_count += 1

        # Step 1 — try OCR (most reliable when Tesseract is installed)
        if _OCR_AVAILABLE:
            result = self._ocr_detect(frame)
            if result.confidence >= self.MIN_CONFIDENCE:
                self._save_debug(frame, result)
                logger.info(f"Role detected via OCR: {result}")
                return result

        # Step 2 — colour-based fallback
        result = self._color_detect(frame)
        if result.confidence >= self.MIN_CONFIDENCE:
            self._save_debug(frame, result)
            logger.info(f"Role detected via colour: {result}")

        return result

    def is_reveal_screen(self, frame: np.ndarray) -> bool:
        """
        Returns True when we appear to be on the role-reveal screen.
        The reveal screen is almost entirely dark with a small bright
        central element (the player sprite + role text).
        """
        if frame is None:
            return False
        gray       = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        dark_ratio = float(np.sum(gray < 40)) / gray.size
        return dark_ratio > 0.60

    # ------------------------------------------------------------------
    # OCR detection
    # ------------------------------------------------------------------

    def _ocr_detect(self, frame: np.ndarray) -> RoleDetectionResult:
        """Read the role text from the center of the frame with Tesseract."""
        h, w = frame.shape[:2]

        # The role text occupies the vertical middle of the screen
        roi = frame[int(h * 0.30) : int(h * 0.70),
                    int(w * 0.20) : int(w * 0.80)]

        # Pre-process: grayscale → upscale → Otsu threshold
        gray  = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        gray  = cv2.resize(gray, (gray.shape[1] * 2, gray.shape[0] * 2),
                           interpolation=cv2.INTER_CUBIC)
        _, thresh = cv2.threshold(gray, 0, 255,
                                  cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        config = (
            "--psm 6 "
            "-c tessedit_char_whitelist="
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz "
        )
        try:
            raw  = pytesseract.image_to_string(thresh, config=config)
            text = raw.lower().strip()
        except Exception as exc:
            logger.debug(f"Tesseract error: {exc}")
            return RoleDetectionResult(Role.UNKNOWN, 0.0, "ocr",
                                       {"error": str(exc)})

        debug = {"ocr_text": text}

        # Exact matches — high confidence
        if "impostor" in text or "imposter" in text:
            return RoleDetectionResult(Role.IMPOSTOR, 0.93, "ocr", debug)
        if "crewmate" in text:
            return RoleDetectionResult(Role.CREWMATE, 0.93, "ocr", debug)

        # Partial matches — OCR noise tolerance
        if any(s in text for s in ("impos", "mpost", "mposto")):
            return RoleDetectionResult(Role.IMPOSTOR, 0.72, "ocr_partial", debug)
        if any(s in text for s in ("crew", "ewmat", "rewm")):
            return RoleDetectionResult(Role.CREWMATE, 0.72, "ocr_partial", debug)

        return RoleDetectionResult(Role.UNKNOWN, 0.0, "ocr", debug)

    # ------------------------------------------------------------------
    # Colour-based detection
    # ------------------------------------------------------------------

    def _color_detect(self, frame: np.ndarray) -> RoleDetectionResult:
        """
        Compare red vs blue saturation in the center of the frame.
        Only meaningful on the role-reveal screen — caller should gate on
        is_reveal_screen() if they want to avoid false positives mid-game.
        """
        h, w = frame.shape[:2]
        roi  = frame[h // 4 : 3 * h // 4, w // 4 : 3 * w // 4]
        hsv  = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        total = roi.shape[0] * roi.shape[1]

        red_px = sum(
            cv2.countNonZero(cv2.inRange(hsv, lo, hi))
            for lo, hi in self._IMPOSTOR_RED
        )
        blue_px = sum(
            cv2.countNonZero(cv2.inRange(hsv, lo, hi))
            for lo, hi in self._CREWMATE_BLUE
        )

        red_ratio  = red_px  / total
        blue_ratio = blue_px / total
        debug = {"red_ratio": round(red_ratio, 4),
                 "blue_ratio": round(blue_ratio, 4)}

        # Neither colour is prominent → can't tell
        if red_ratio < 0.01 and blue_ratio < 0.01:
            return RoleDetectionResult(Role.UNKNOWN, 0.0, "color", debug)

        if red_ratio > blue_ratio:
            conf = min(0.88, 0.50 + (red_ratio - blue_ratio) * 10)
            return RoleDetectionResult(Role.IMPOSTOR, conf, "color", debug)
        else:
            conf = min(0.88, 0.50 + (blue_ratio - red_ratio) * 10)
            return RoleDetectionResult(Role.CREWMATE, conf, "color", debug)

    # ------------------------------------------------------------------
    # Debug helpers
    # ------------------------------------------------------------------

    def _save_debug(self, frame: np.ndarray, result: RoleDetectionResult):
        if not self.debug_screenshots:
            return
        fname = (f"{self.screenshot_dir}/"
                 f"frame_{self._frame_count:06d}"
                 f"_{result.role.value}"
                 f"_{result.confidence:.2f}.png")
        try:
            cv2.imwrite(fname, frame)
        except Exception as exc:
            logger.debug(f"Could not save debug screenshot: {exc}")
