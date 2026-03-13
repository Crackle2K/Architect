import dxcam
import cv2
import numpy as np
import pyautogui
import time
import threading
from collections import deque
import logging
import msvcrt

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Game state constants
GAME_STATES = {
    'MENU': 0,
    'LOBBY': 1,
    'IN_GAME': 2,
    'DEAD': 3,
    'UNKNOWN': 4
}

ROLES = {
    'CREWMATE': 0,
    'IMPOSTOR': 1,
    'UNKNOWN': 2
}

class AmongUsBot:
    def __init__(self):
        self.camera = dxcam.create()
        self.running = True
        self.current_state = GAME_STATES['UNKNOWN']
        self.current_role = ROLES['UNKNOWN']
        self.game_window = None
        self.task_locations = []
        self.completed_tasks = set()
        
        # Color thresholds for Among Us detection
        self.red_range = ([100, 50, 50], [180, 120, 120])
        self.blue_range = ([50, 50, 100], [120, 120, 180])
        self.crewmate_colors = [
            ([255, 50, 50], [255, 120, 120]),    # Red
            ([50, 50, 255], [120, 120, 255]),    # Blue
            ([50, 255, 50], [120, 255, 120]),    # Green
            ([255, 255, 50], [255, 255, 150]),   # Yellow
            ([255, 150, 50], [255, 200, 120]),   # Orange
        ]
    
    def find_game_window(self):
        """Find and focus the Among Us game window"""
        try:
            # Look for Among Us window
            windows = pyautogui.getWindowsWithTitle('Among Us')
            if windows:
                self.game_window = windows[0]
                self.game_window.activate()
                logger.info("Found Among Us window")
                return True
        except Exception as e:
            logger.warning(f"Could not find Among Us window: {e}")
        return False
    
    def detect_role(self, frame):
        """
        Detect if player is Crewmate or Impostor
        Looks for role indicator UI elements
        """
        if frame is None:
            return ROLES['UNKNOWN']
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Check for "CREWMATE" UI indicator (usually appears in white/light color at top)
        # Look for distinctive UI elements that differ between roles
        
        # Sample top portion where role UI appears
        top_region = frame[0:100, 0:300]
        
        # Look for red dominant colors (impostor indicator)
        red_mask = cv2.inRange(hsv, np.array([0, 100, 100]), np.array([10, 255, 255]))
        red_mask += cv2.inRange(hsv, np.array([170, 100, 100]), np.array([180, 255, 255]))
        
        red_pixels = cv2.countNonZero(red_mask[0:100, 0:300])
        
        # Check for text rendering - crewmate shows different UI
        # This is a simplified heuristic - in real use, you'd want template matching
        
        # If we detect certain UI patterns, classify
        if red_pixels > 500:  # Impostor UI has more red
            return ROLES['IMPOSTOR']
        
        # Default to crewmate for safety (bot won't act if impostor anyway)
        return ROLES['CREWMATE']
    
    def detect_game_state(self, frame):
        """Detect current game state (menu, lobby, in-game, etc.)"""
        if frame is None:
            return GAME_STATES['UNKNOWN']
        
        # Check for IN_GAME indicators
        # Look for player colors, task bars, etc.
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Check lower region for task bar or bottom UI
        bottom_region = frame[-100:, :]
        
        # Count colored pixels that indicate active players
        color_count = 0
        for color_lower, color_upper in self.crewmate_colors:
            mask = cv2.inRange(frame, np.array(color_lower), np.array(color_upper))
            color_count += cv2.countNonZero(mask)
        
        if color_count > 1000:
            return GAME_STATES['IN_GAME']
        
        return GAME_STATES['UNKNOWN']
    
    def find_interactive_tasks(self, frame):
        """
        Find interactive task UI elements
        Returns list of (x, y) coordinates for clickable tasks
        """
        tasks = []
        
        if frame is None:
            return tasks
        
        # Look for task indicators - usually interactive UI elements
        # Tasks appear as colored buttons or icons
        
        # Search for bright/distinct UI elements that are tasks
        # This is simplified - real implementation would use template matching
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Look for low saturation but mid-value areas (UI elements)
        ui_mask = cv2.inRange(hsv, np.array([0, 0, 100]), np.array([180, 50, 255]))
        
        # Find contours
        contours, _ = cv2.findContours(ui_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 500:  # Filter by size
                x, y, w, h = cv2.boundingRect(contour)
                # Center of task UI element
                cx, cy = x + w // 2, y + h // 2
                tasks.append((cx, cy))
        
        self.task_locations = tasks
        return tasks
    
    def move_and_click_task(self, x, y, duration=0.5):
        """Move mouse to task location and click"""
        try:
            logger.info(f"Moving to task at ({x}, {y})")
            pyautogui.moveTo(x, y, duration=duration)
            time.sleep(0.3)
            pyautogui.click()
            logger.info("Task clicked")
            return True
        except Exception as e:
            logger.error(f"Error clicking task: {e}")
            return False
    
    def navigate_to_task(self, frame):
        """
        Navigate player to nearest task and attempt to complete it
        """
        tasks = self.find_interactive_tasks(frame)
        
        if not tasks:
            logger.debug("No tasks found")
            return
        
        # Find nearest task to current position
        nearest_task = min(tasks, key=lambda t: (t[0] - frame.shape[1]//2)**2 + (t[1] - frame.shape[0]//2)**2)
        
        logger.info(f"Found {len(tasks)} tasks, navigating to nearest")
        
        # Simulate movement towards task (arrow keys)
        tx, ty = nearest_task
        center_x, center_y = frame.shape[1] // 2, frame.shape[0] // 2
        
        # Simple pathfinding - move towards task
        if tx < center_x - 50:
            pyautogui.press('left')
        elif tx > center_x + 50:
            pyautogui.press('right')
        
        if ty < center_y - 50:
            pyautogui.press('up')
        elif ty > center_y + 50:
            pyautogui.press('down')
        
        time.sleep(0.2)
        
        # Try to interact (E key for Among Us)
        pyautogui.press('e')
        
        time.sleep(0.5)
        
        # Look for task UI and complete it
        task_complete_frame = self.camera.grab()
        if task_complete_frame is not None:
            self.attempt_task_completion(task_complete_frame)
    
    def attempt_task_completion(self, frame):
        """
        Detect and complete task UI (e.g., button clicks, slider interactions)
        """
        # Look for "Complete" or "Confirm" buttons
        # This is simplified - real tasks have different mechanics
        
        # Common task button locations
        frame_height, frame_width = frame.shape[:2]
        
        # Try common button locations
        buttons = [
            (frame_width // 2, frame_height - 50),  # Bottom center
            (frame_width - 100, 50),                 # Top right
            (100, 50),                               # Top left
        ]
        
        for btn_x, btn_y in buttons:
            try:
                logger.info(f"Attempting to click potential task button at ({btn_x}, {btn_y})")
                pyautogui.click(btn_x, btn_y)
                time.sleep(0.5)
                break
            except Exception as e:
                logger.debug(f"Button click failed: {e}")
    
    def run(self):
        """Main bot loop"""
        print("Among Us Bot Active. Controls:")
        print("  - Space: Toggle bot active/pause")
        print("  - 'q': Quit")
        print()
        
        if not self.find_game_window():
            print("WARNING: Could not find Among Us window. Make sure it's open and visible.")
        
        bot_active = False
        frame_count = 0

        # Print blank stat lines that will be overwritten each update
        stat_lines = [
            "  State  :",
            "  Role   :",
            "  Bot    :",
            "  Tasks  :",
            "  Frames :",
        ]
        for line in stat_lines:
            print(line)

        def print_stats():
            state_name = [k for k, v in GAME_STATES.items() if v == self.current_state][0]
            role_name  = [k for k, v in ROLES.items()       if v == self.current_role][0]
            lines = [
                f"  State  : {state_name}",
                f"  Role   : {role_name}",
                f"  Bot    : {'ACTIVE' if bot_active else 'PAUSED'}",
                f"  Tasks  : detected={len(self.task_locations)}",
                f"  Frames : {frame_count}",
            ]
            print(f"\033[{len(lines)}A", end="")
            for line in lines:
                print(f"\033[2K{line}")

        try:
            while self.running:
                frame = self.camera.grab()

                if frame is not None:
                    frame_count += 1

                    # Detect game state and role every 5 frames
                    if frame_count % 5 == 0:
                        self.current_state = self.detect_game_state(frame)
                        self.current_role = self.detect_role(frame)

                    # Refresh console stats every 15 frames
                    if frame_count % 15 == 0:
                        print_stats()

                    # Bot logic: Only act if crewmate and bot is active
                    if bot_active and self.current_state == GAME_STATES['IN_GAME']:
                        if self.current_role == ROLES['CREWMATE']:
                            self.navigate_to_task(frame)
                        else:
                            logger.info("Impostor detected - bot idle")

                # Non-blocking keyboard input (Windows)
                if msvcrt.kbhit():
                    key = msvcrt.getch()
                    if key == b'q':
                        self.running = False
                        break
                    elif key == b' ':
                        bot_active = not bot_active
                        status = "ACTIVATED" if bot_active else "PAUSED"
                        logger.info(f"Bot {status}")

        except Exception as e:
            logger.error(f"Error in main loop: {e}")

        finally:
            logger.info("Bot shutdown")

# Run the bot
if __name__ == "__main__":
    bot = AmongUsBot()
    bot.run()