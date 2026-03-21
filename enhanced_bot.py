"""
Enhanced Among Us Bot with advanced detection
Uses ML and computer vision for better task and role detection
"""

import dxcam
import cv2
import numpy as np
import pyautogui
import time
import logging
import msvcrt
import os
from advanced_detection import AdvancedDetector, TaskRecognizer
from role_detector import RoleDetector, Role, RoleDetectionResult

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class EnhancedAmongUsBot:
    def __init__(self):
        self.camera = dxcam.create()
        self.detector = AdvancedDetector()
        self.task_recognizer = TaskRecognizer()
        self.role_detector = RoleDetector(debug_screenshots=False)
        self.window_region = None  # (left, top, right, bottom) of game window

        self.running = True
        self.bot_active = False

        # Game state
        self.state = None
        self._prev_state = None   # used to detect state transitions
        self.is_impostor = False
        self.is_dead = False
        self.in_voting = False
        self._role_locked = False  # True once role has been read this round
        self._last_role_result: RoleDetectionResult = RoleDetectionResult(
            Role.UNKNOWN, 0.0, "unknown"
        )

        # Player tracking
        self.my_position = None
        self.all_players = []
        self.tasks = []

        # Statistics
        self.tasks_completed = 0
        self.frame_count = 0
        self._null_frame_streak = 0  # consecutive None grabs
    
    def _get_window_region(self):
        """Return (left, top, right, bottom) for the Among Us window, or None."""
        try:
            wins = pyautogui.getWindowsWithTitle('Among Us')
            if wins:
                w = wins[0]
                return (w.left, w.top, w.right, w.bottom)
        except Exception:
            pass
        return None

    def _grab_frame(self):
        """Capture only the Among Us window region. Returns None on failure."""
        try:
            if self.window_region is None:
                self.window_region = self._get_window_region()
            if self.window_region is not None:
                return self.camera.grab(region=self.window_region)
            return self.camera.grab()  # fallback: full screen
        except Exception as e:
            logger.debug(f"Frame grab error: {e}")
            return None

    def update_game_state(self, frame):
        """Update all game state information from current frame"""
        if frame is None:
            return

        self._prev_state = self.state

        # Detect basic state
        self.state = self.detector.detect_menu_state(frame)

        # ── State transition hooks ────────────────────────────────────────
        if self.state != self._prev_state:
            logger.info(f"Game state: {self._prev_state} → {self.state}")

            # Returning to menu/lobby means a new round will start — reset role
            if self.state in ('menu', 'lobby', 'unknown') and self._prev_state == 'in_game':
                logger.info("Round ended — resetting role for next round")
                self._role_locked = False
                self.is_impostor = False
                self._last_role_result = RoleDetectionResult(Role.UNKNOWN, 0.0, "unknown")

        # Detect voting FIRST — other detections depend on this
        self.in_voting = self.detector.detect_voting_screen(frame)

        # Dead detection: skip during voting to avoid false positives
        if self.in_voting:
            self.is_dead = False
        else:
            self.is_dead = self.detector.detect_dead_players(frame)

        # ── Role detection ────────────────────────────────────────────────
        # Only runs when:
        #   • We haven't locked a role yet this round
        #   • Not in voting / dead screen (avoids UI false positives)
        #   • The screen looks like the role-reveal screen (mostly dark)
        if not self._role_locked and not self.in_voting and not self.is_dead:
            if self.role_detector.is_reveal_screen(frame):
                result = self.role_detector.detect(frame)
                if result.role != Role.UNKNOWN:
                    self._last_role_result = result
                    self.is_impostor = (result.role == Role.IMPOSTOR)
                    self._role_locked = True
                    logger.info(f"Role locked in: {result}")

        # Detect all players (capped to 1 per color)
        self.all_players = self.detector.detect_player_positions(frame)

        # Only detect tasks when in game and not voting/dead
        if self.state == 'in_game' and not self.in_voting and not self.is_dead:
            self.tasks = self.detector.detect_task_prompts(frame)
        else:
            self.tasks = []
    
    def execute_bot_logic(self, frame):
        """Execute bot actions based on current state"""
        if not self.bot_active or self.is_dead or self.is_impostor:
            return
        
        if self.state != 'in_game':
            return
        
        if self.in_voting:
            logger.info("In voting screen - bot idle")
            return
        
        # Find and complete tasks
        if self.tasks:
            self.complete_nearest_task()
    
    def complete_nearest_task(self):
        """Find and navigate to the nearest task"""
        if not self.tasks:
            return
        
        # Find nearest task
        nearest = min(self.tasks, key=lambda t: t[2])  # Sort by confidence
        tx, ty, confidence = nearest
        
        logger.info(f"Moving to task at ({tx}, {ty}) - confidence: {confidence:.2f}")
        
        # Move mouse to task
        pyautogui.moveTo(tx, ty, duration=0.3)
        time.sleep(0.2)
        
        # Press E to interact
        pyautogui.press('e')
        time.sleep(0.8)
        
        # Attempt to solve task
        current_frame = self.camera.grab()
        if current_frame is not None:
            task_type = self.task_recognizer.detect_task_type(current_frame)
            logger.info(f"Detected task type: {task_type}")
            
            # Simple task completion - click center of screen
            h, w = current_frame.shape[:2]
            pyautogui.click(w // 2, h // 2)
            time.sleep(0.5)
            
            # Look for next button or completion
            pyautogui.press('enter')
            self.tasks_completed += 1
    
    def print_stats(self):
        """Print current bot statistics, overwriting the previous stats block."""
        r = self._last_role_result

        # Role display
        if r.role == Role.UNKNOWN:
            role_text = "--- (waiting for round to start)"
        else:
            role_text = (
                f"{r.role.value.upper()}  "
                f"(conf={r.confidence:.2f}  via={r.method})"
            )

        # State display with human-friendly label
        state_labels = {
            'menu':    'MENU',
            'lobby':   'LOBBY — waiting for host to start',
            'in_game': 'IN GAME',
            'unknown': 'SCANNING...',
            None:      'SCANNING...',
        }
        state_text = state_labels.get(self.state, self.state or 'SCANNING...')

        status = "ACTIVE" if self.bot_active else "PAUSED"
        flags  = []
        if self.is_dead:   flags.append("DEAD")
        if self.in_voting: flags.append("VOTING")
        flag_str = "  [" + " | ".join(flags) + "]" if flags else ""

        lines = [
            f"  State   : {state_text}",
            f"  Role    : {role_text}",
            f"  Bot     : {status}{flag_str}",
            f"  Players : {len(self.all_players)} detected",
            f"  Tasks   : {len(self.tasks)} visible   {self.tasks_completed} completed",
            f"  Frames  : {self.frame_count}",
        ]

        print(f"\033[{len(lines)}A", end="")
        for line in lines:
            print(f"\033[2K{line}")
    
    def run(self):
        """Main bot loop"""
        print("\n" + "="*50)
        print("ENHANCED AMONG US BOT - ARCHITECT VISION")
        print("="*50)
        print("\nControls:")
        print("  SPACE - Toggle bot active/paused")
        print("  'r'   - Reset statistics")
        print("  'q'   - Quit bot")
        print("\nGame Detection:")
        print("  - Role: Detects Crewmate vs Impostor")
        print("  - State: Tracks game state (menu/lobby/in-game)")
        print("  - Tasks: Finds task interaction prompts")
        print("  - Players: Locates all players by color")
        print("\nBot Behavior:")
        print("  - IMPOSTOR: Idle (no action)")
        print("  - CREWMATE: Auto-complete tasks")
        print("  - DEAD: Idle")
        print("="*50 + "\n")

        # Print blank lines that print_stats will overwrite
        print("  State   :")  
        print("  Role    :")
        print("  Bot     :")
        print("  Players :")
        print("  Tasks   :")
        print("  Frames  :")

        self.frame_count = 0

        try:
            while self.running:
                loop_start = time.perf_counter()

                # ── Keyboard input (non-blocking) ─────────────────────────
                if msvcrt.kbhit():
                    key = msvcrt.getch()
                    if key == b'q':
                        self.running = False
                        break
                    elif key == b' ':
                        self.bot_active = not self.bot_active
                        logger.info(f"Bot {'ACTIVATED' if self.bot_active else 'PAUSED'}")
                    elif key == b'r':
                        self.tasks_completed = 0
                        logger.info("Statistics reset")

                # ── Window refresh every 5 seconds (~150 frames at 30fps) ─
                if self.frame_count % 150 == 0:
                    self.window_region = self._get_window_region()
                    if self.window_region:
                        l, t, r, b = self.window_region
                        logger.debug(f"Game window: ({l},{t}) {r-l}x{b-t}")
                    else:
                        logger.warning("Among Us window not found — waiting...")

                # ── Grab frame ────────────────────────────────────────────
                frame = self._grab_frame()

                if frame is None:
                    # dxcam returns None when the screen hasn't refreshed yet;
                    # just wait a tick and try again — don't crash
                    self._null_frame_streak += 1
                    if self._null_frame_streak % 60 == 0:
                        logger.debug(f"No frame for {self._null_frame_streak} ticks — still waiting")
                    time.sleep(0.05)
                    continue

                self._null_frame_streak = 0
                self.frame_count += 1

                # ── Game state detection (every 3 frames) ─────────────────
                if self.frame_count % 3 == 0:
                    self.update_game_state(frame)

                # ── Bot actions (every 30 frames ≈ 1 s) ───────────────────
                if self.frame_count % 30 == 0:
                    self.execute_bot_logic(frame)

                # ── Stats display (every 15 frames ≈ 0.5 s) ──────────────
                if self.frame_count % 15 == 0:
                    self.print_stats()

                # ── Cap to ~30 fps ────────────────────────────────────────
                elapsed = time.perf_counter() - loop_start
                sleep_time = max(0.0, (1 / 30) - elapsed)
                if sleep_time:
                    time.sleep(sleep_time)

        except KeyboardInterrupt:
            logger.info("Interrupted by user (Ctrl+C)")
        except Exception as e:
            logger.error(f"Unexpected error in main loop: {e}", exc_info=True)
            input("Press Enter to exit...")  # keep window open so error is visible
        finally:
            logger.info(f"Bot shutdown. Tasks completed: {self.tasks_completed}")

if __name__ == "__main__":
    bot = EnhancedAmongUsBot()
    bot.run()
