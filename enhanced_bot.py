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
        self.is_impostor = False
        self.is_dead = False
        self.in_voting = False
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
        """Capture only the Among Us window region."""
        if self.window_region is None:
            self.window_region = self._get_window_region()
        if self.window_region is not None:
            return self.camera.grab(region=self.window_region)
        return self.camera.grab()  # fallback: full screen

    def update_game_state(self, frame):
        """Update all game state information from current frame"""
        if frame is None:
            return

        prev_state = self.state

        # Detect basic state
        self.state = self.detector.detect_menu_state(frame)

        # Detect voting FIRST — other detections depend on this
        self.in_voting = self.detector.detect_voting_screen(frame)

        # Dead detection: voting screen has a dark overlay so skip it
        # while voting to avoid false positives
        if self.in_voting:
            self.is_dead = False
        else:
            self.is_dead = self.detector.detect_dead_players(frame)

        # Role detection: run on every frame that looks like a reveal screen,
        # but only accept a result once per round (cache until next round).
        # Skip during voting/dead to avoid false positives from UI overlays.
        if not self.in_voting and not self.is_dead:
            if self.role_detector.is_reveal_screen(frame):
                result = self.role_detector.detect(frame)
                if result.role != Role.UNKNOWN:
                    self._last_role_result = result
                    self.is_impostor = (result.role == Role.IMPOSTOR)
                    logger.info(f"Role locked: {result}")

        # Detect all players (capped to 1 per color so max ~8)
        self.all_players = self.detector.detect_player_positions(frame)

        # Only detect tasks when actually in game and not voting/dead
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
        """Print current bot statistics to the console, overwriting the previous stats block."""
        r = self._last_role_result
        role_text = (
            f"{r.role.value.upper()}  "
            f"(conf={r.confidence:.2f} via={r.method})"
            if r.role.value != "unknown"
            else "UNKNOWN"
        )
        state_text = self.state or "unknown"
        status     = "ACTIVE"   if self.bot_active  else "PAUSED"
        flags = []
        if self.is_dead:    flags.append("DEAD")
        if self.in_voting:  flags.append("VOTING")
        flag_str = "  " + " | ".join(flags) if flags else ""

        lines = [
            f"  State   : {state_text}",
            f"  Role    : {role_text}",
            f"  Bot     : {status}{flag_str}",
            f"  Players : {len(self.all_players)}",
            f"  Tasks   : detected={len(self.tasks)}  completed={self.tasks_completed}",
            f"  Frames  : {self.frame_count}",
        ]

        # Move cursor up to overwrite the previous stats block
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
                # Refresh window region every ~300 frames in case window moved
                if self.frame_count % 300 == 0:
                    self.window_region = self._get_window_region()
                    if self.window_region:
                        l, t, r, b = self.window_region
                        logger.info(f"Game window: ({l},{t}) {r-l}x{b-t}")
                    else:
                        logger.warning("Among Us window not found - capturing full screen")

                frame = self._grab_frame()

                if frame is not None:
                    self.frame_count += 1

                    # Update game state every 3 frames
                    if self.frame_count % 3 == 0:
                        self.update_game_state(frame)

                    # Execute bot logic every 30 frames
                    if self.frame_count % 30 == 0:
                        self.execute_bot_logic(frame)

                    # Refresh console stats every 15 frames
                    if self.frame_count % 15 == 0:
                        self.print_stats()

                # Non-blocking keyboard input (Windows)
                if msvcrt.kbhit():
                    key = msvcrt.getch()
                    if key == b'q':
                        self.running = False
                        break
                    elif key == b' ':
                        self.bot_active = not self.bot_active
                        status = "ACTIVATED" if self.bot_active else "PAUSED"
                        logger.info(f"Bot {status}")
                    elif key == b'r':
                        self.tasks_completed = 0
                        logger.info("Statistics reset")

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        except Exception as e:
            logger.error(f"Error in bot loop: {e}", exc_info=True)
        finally:
            logger.info(f"Bot shutdown. Tasks completed: {self.tasks_completed}")

if __name__ == "__main__":
    bot = EnhancedAmongUsBot()
    bot.run()
