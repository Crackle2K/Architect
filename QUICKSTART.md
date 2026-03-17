# Quick Start Guide - Among Us Bot

## 1. Installation

```bash
# Install dependencies
pip install -r requirements.txt
```

## 2. Running the Bot

Choose one of the two versions:

### Basic Version
```bash
python main.py
```
- Simple, stable implementation
- Color-based detection
- Good for testing

### Enhanced Version (Recommended)
```bash
python enhanced_bot.py
```
- Advanced detection methods
- Better task identification
- Real-time debugging info

## 3. Basic Usage

1. Start the bot with Among Us running in windowed mode
2. The bot window will appear showing game detection info
3. Press **SPACE** to activate the bot
4. Bot will automatically:
   - Detect if you're impostor or crewmate
   - Find task prompts
   - Navigate and complete tasks (crewmate only)
5. Press **Q** to quit

## 4. Understanding the Display

**Basic Info (top-left):**
- State: Current game state (menu/lobby/in_game)
- Role: Detected role (CREWMATE/IMPOSTOR)
- Bot Status: ACTIVE or PAUSED

**Debug Info (bottom-left):**
- Players: Number of detected players
- Tasks Detected: Number of task prompts found
- Completed: Counter of completed tasks

**Visual Indicators:**
- Green circles: Detected tasks
- Colored circles: Detected players
- Red text: Impostor detected
- Green text: Crewmate detected

## 5. Configuration

Edit `config.py` to customize:
- Detection thresholds
- Bot behavior settings
- Update rates
- Logging options

Example:
```python
IMPOSTOR_CONFIDENCE_THRESHOLD = 0.7  # Higher = more strict
TASK_MIN_AREA = 100  # Adjust for your screen resolution
MOVEMENT_SPEED = 0.5  # Slower = smoother movement
```

## 6. Common Issues & Solutions

**Bot doesn't detect tasks:**
- Adjust TASK_MIN/MAX_AREA in config.py
- Check if Among Us window is active
- Ensure game is in windowed mode

**Role detection is wrong:**
- Adjust IMPOSTOR_RED_THRESHOLD
- This is expected sometimes - bot defaults to safe mode

**Mouse movements too fast/slow:**
- Change MOVEMENT_SPEED in config.py
- Increase INTERACTION_DELAY for slower interactions

**Bot doesn't respond to inputs:**
- Make sure the bot window is focused when pressing keys
- Try pressing the key multiple times

## 7. Advanced Customization

### Add Custom Task Handlers

Edit `advanced_detection.py` `TaskRecognizer` class:

```python
def solve_custom_task(self, frame):
    # Your custom task solving logic
    pass
```

### Improve Detection Accuracy

Add template matching (requires template images):

```python
template = cv2.imread('crewmate_badge.png', 0)
result = cv2.matchTemplate(frame, template, cv2.TM_CCOEFF)
min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
```

### Monitor Multiple Screens

Modify camera capture:

```python
cameras = [dxcam.create(output_idx=i) for i in range(3)]
frames = [cam.grab() for cam in cameras]
```

## 8. Performance Tips

- Reduce detection update frequency for slower PCs
- Disable debug visualization (ENABLE_DEBUG_VISUALIZATION = False)
- Lower display resolution to improve speed
- Close other applications

## 9. Safety & Responsibility

⚠️ **Important:**
- This bot is for educational/testing purposes
- Use only in private games with friends
- May be detected by anti-cheat systems
- Respect game terms of service
- Disable bot when not actively testing

## 10. Troubleshooting Commands

Try these in order:

1. Check window detection:
   ```python
   import pyautogui
   print(pyautogui.getWindowsWithTitle('Among Us'))
   ```

2. Test screen capture:
   ```python
   import dxcam
   cam = dxcam.create()
   frame = cam.grab()
   print(f"Captured frame size: {frame.shape}")
   ```

3. Debug detection:
   - Set LOG_LEVEL = 'DEBUG' in config.py
   - Check console output for detection accuracy

## 11. Next Steps

1. Run the bot in a private lobby with friends
2. Check detection accuracy
3. Adjust config.py as needed
4. Experiment with different resolutions
5. Try both basic and enhanced versions

## 12. Getting Help

If the bot isn't working:
1. Check README.md for more details
2. Enable debug mode in config.py
3. Check console logs for errors
4. Try adjusting color detection ranges
5. Ensure Among Us is in windowed mode with visible UI

---

**Happy automating! 🤖**
