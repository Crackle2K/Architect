"""
Advanced detection utilities for Among Us Bot
Includes template matching, contour detection, and color-based analysis
"""

import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)

class AdvancedDetector:
    """Advanced detection methods for Among Us game elements"""
    
    def __init__(self):
        self.player_colors = {
            'red': {'lower': np.array([0, 70, 70]), 'upper': np.array([10, 255, 255])},
            'blue': {'lower': np.array([110, 70, 70]), 'upper': np.array([130, 255, 255])},
            'green': {'lower': np.array([35, 70, 70]), 'upper': np.array([85, 255, 255])},
            'pink': {'lower': np.array([140, 70, 70]), 'upper': np.array([170, 255, 255])},
            'orange': {'lower': np.array([5, 70, 70]), 'upper': np.array([25, 255, 255])},
            'yellow': {'lower': np.array([20, 70, 70]), 'upper': np.array([35, 255, 255])},
            'black': {'lower': np.array([0, 0, 0]), 'upper': np.array([180, 50, 100])},
            'white': {'lower': np.array([0, 0, 200]), 'upper': np.array([180, 30, 255])},
        }
    
    def detect_player_positions(self, frame):
        """
        Detect player positions on screen by color
        Returns list of (x, y, color_name) tuples
        """
        if frame is None:
            return []
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        players = []
        
        for color_name, color_range in self.player_colors.items():
            mask = cv2.inRange(hsv, color_range['lower'], color_range['upper'])
            
            # Clean up mask
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            
            # Find contours
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Only keep the single largest contour per color so each
            # color reports at most 1 player (prevents voting-screen spam)
            valid = [c for c in contours if 300 < cv2.contourArea(c) < 5000]
            if valid:
                contour = max(valid, key=cv2.contourArea)
                area = cv2.contourArea(contour)
                x, y, w, h = cv2.boundingRect(contour)
                cx, cy = x + w // 2, y + h // 2
                players.append({
                    'pos': (cx, cy),
                    'color': color_name,
                    'area': area,
                    'box': (x, y, w, h)
                })
        
        return players
    
    def detect_impostor_indicators(self, frame):
        """
        Detect visual indicators that show if player is impostor
        Returns confidence score 0.0-1.0
        """
        if frame is None:
            return 0.0
        
        # Look at top region where role indicator appears
        top_region = frame[0:120, 0:400]
        
        # Convert to HSV for better color detection
        hsv = cv2.cvtColor(top_region, cv2.COLOR_BGR2HSV)
        
        # Impostor badge tends to be more reddish
        red_mask = cv2.inRange(hsv, np.array([0, 100, 100]), np.array([15, 255, 255]))
        
        red_pixels = cv2.countNonZero(red_mask)
        
        # Also check for red text/highlight
        red_mask2 = cv2.inRange(hsv, np.array([170, 100, 100]), np.array([180, 255, 255]))
        red_pixels += cv2.countNonZero(red_mask2)
        
        total_pixels = top_region.shape[0] * top_region.shape[1]
        red_ratio = red_pixels / total_pixels
        
        # If more than 5% of top region is red, likely impostor
        confidence = min(1.0, max(0.0, (red_ratio - 0.02) / 0.08))
        
        return confidence
    
    def detect_task_prompts(self, frame):
        """
        Detect task interaction prompts (E to interact)
        Returns list of (x, y, confidence) for task locations
        """
        if frame is None:
            return []
        
        # Task prompts typically appear near player as white/light text
        # Look for bright regions that could be prompt text
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Threshold for bright areas (prompts are usually white)
        _, bright_mask = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)
        
        # Find contours
        contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        tasks = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if 50 < area < 1000:  # Prompt is relatively small
                x, y, w, h = cv2.boundingRect(contour)
                cx, cy = x + w // 2, y + h // 2
                
                # Calculate confidence based on area and shape
                aspect_ratio = float(w) / h if h > 0 else 0
                confidence = 0.7 if 0.3 < aspect_ratio < 3.0 else 0.3
                
                tasks.append((cx, cy, confidence))
        
        return tasks
    
    def detect_menu_state(self, frame):
        """
        Detect if in menu/lobby/game state
        Returns: 'menu', 'lobby', 'in_game', or 'unknown'
        """
        if frame is None:
            return 'unknown'
        
        height, width = frame.shape[:2]
        
        # Count colored pixels (indicates active players in game)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Count all player colors
        player_color_pixels = 0
        for color_range in self.player_colors.values():
            mask = cv2.inRange(hsv, color_range['lower'], color_range['upper'])
            player_color_pixels += cv2.countNonZero(mask)
        
        # In game has more colored player sprites
        if player_color_pixels > 2000:
            return 'in_game'
        
        # Check for menu buttons (large centered elements)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY)
        
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        large_elements = sum(1 for c in contours if 1000 < cv2.contourArea(c) < 50000)
        
        if large_elements > 2:
            return 'menu'
        
        if player_color_pixels > 500:
            return 'lobby'
        
        return 'unknown'
    
    def detect_dead_players(self, frame):
        """
        Detect if player is dead
        Dead players show different UI/animations
        """
        if frame is None:
            return False
        
        # Dead screen shows black background with some UI
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        
        # Count dark pixels
        dark_pixels = np.sum(gray < 50)
        total_pixels = gray.shape[0] * gray.shape[1]
        darkness_ratio = dark_pixels / total_pixels
        
        # Dead screen is mostly dark
        return darkness_ratio > 0.7
    
    def find_sabotage_indicators(self, frame):
        """
        Detect if there's an active sabotage
        Returns confidence 0.0-1.0
        """
        if frame is None:
            return 0.0
        
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Sabotage UI is usually red/orange
        red_mask = cv2.inRange(hsv, np.array([0, 50, 50]), np.array([30, 255, 255]))
        
        red_pixels = cv2.countNonZero(red_mask)
        total_pixels = frame.shape[0] * frame.shape[1]
        
        confidence = min(1.0, red_pixels / 1000)
        
        return confidence
    
    def detect_voting_screen(self, frame):
        """
        Detect if in emergency meeting/voting screen
        Returns True/False
        """
        if frame is None:
            return False
        
        # Voting screen shows all players in circular arrangement
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Count distinct colored regions (multiple players displayed)
        color_count = 0
        for color_range in self.player_colors.values():
            mask = cv2.inRange(hsv, color_range['lower'], color_range['upper'])
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            color_count += len([c for c in contours if 200 < cv2.contourArea(c) < 3000])
        
        # Voting screen shows many players at once
        return color_count > 4


class TaskRecognizer:
    """Recognizes and handles different Among Us task types"""
    
    TASK_TYPES = {
        'WIRES': 'wires',
        'STABILIZERS': 'stabilizers',
        'ADMIN': 'admin',
        'REACTOR': 'reactor',
        'OXYGEN': 'oxygen',
        'COMMS': 'comms',
        'TRASH': 'trash',
        'WEAPONS': 'weapons',
    }
    
    def detect_task_type(self, frame):
        """
        Detect what type of task is currently active
        Returns task type string or None
        """
        if frame is None:
            return None
        
        # Analyze the task UI to determine type
        # This is simplified - real implementation would use template matching
        
        # Extract task panel area (usually center-right of screen)
        h, w = frame.shape[:2]
        task_region = frame[h//4:3*h//4, w//2:w]
        
        # Color-based task identification
        hsv = cv2.cvtColor(task_region, cv2.COLOR_BGR2HSV)
        
        # Look for specific color patterns per task
        # Wires task: has multiple colored horizontal lines
        # Reactor/Oxygen: has circular elements
        # etc.
        
        # Count lines (indicates wires task)
        gray = cv2.cvtColor(task_region, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 100, 200)
        lines = cv2.HoughLinesP(edges, 1, np.pi/180, 50, minLineLength=30, maxLineGap=10)
        
        if lines is not None and len(lines) > 3:
            return self.TASK_TYPES['WIRES']
        
        return None
    
    def solve_wires_task(self, frame):
        """
        Solve wires task by matching colored patterns
        """
        # Placeholder for wires solving logic
        # Real implementation would:
        # 1. Detect colored wire endpoints
        # 2. Match them according to the displayed pattern
        # 3. Click connections in correct order
        pass
    
    def solve_stabilizers_task(self, frame):
        """
        Solve stabilizers by centering indicators
        """
        # Placeholder
        pass
    
    def general_task_click(self, frame):
        """
        For tasks not specifically identified, try standard completion
        """
        pass
