# Architect

An ML-powered automation bot for Among Us that detects your role and automatically completes tasks when you're a crewmate.

## Features

- **Role Detection**: Detects whether you're a Crewmate or Impostor
- **Game State Detection**: Recognizes menu, lobby, and in-game states
- **Task Automation**: Automatically finds and navigates to tasks as a crewmate
- **Safety**: Does nothing if you're an Impostor
- **Real-time Visualization**: Shows detection results and task locations
- **Keyboard Controls**: Space to toggle bot, Q to quit

## Installation

1. Install required packages:
```bash
pip install -r requirements.txt
```

2. Make sure Among Us is running in windowed mode on Steam

## Usage

1. Run the bot:
```bash
python main.py
```

2. The bot will:
   - Find your Among Us window
   - Start screen capture and analysis
   - Display real-time information about game state and role
   - Use **Space** to toggle bot on/off
   - Use **Q** to quit

## Controls

- **Space**: Toggle bot active/paused
- **Q**: Quit the bot
- **ESC**: Emergency stop (if needed)

## How It Works

### Role Detection
- Analyzes UI elements and color patterns at the top of the screen
- Looks for Impostor-specific indicators
- Defaults to Crewmate (safe mode)

### Task Detection
- Scans the screen for interactive UI elements
- Identifies task button locations using color-based detection
- Finds the nearest task to your character

### Task Automation
- Moves towards nearest task using arrow keys
- Presses E to interact
- Clicks task buttons to complete
- Repeats until all tasks are done or game ends

## Customization

### Adjust Detection Sensitivity

Edit the color ranges:
```python
self.red_range = ([100, 50, 50], [180, 120, 120])
```

### Modify Task Clicking Locations

Change button detection in `attempt_task_completion()`:
```python
buttons = [
    (frame_width // 2, frame_height - 50),
]
```

## Advanced Features (Optional)

### Template Matching for Better Detection
For more accurate role detection, you can add template images:
```python
template = cv2.imread('crewmate_badge.png', 0)
result = cv2.matchTemplate(frame, template, cv2.TM_CCOEFF)
```

### ML Model Integration
For even better detection, integrate an ML model:
```python
# Use YOLO or similar to detect game objects
model = torch.hub.load('ultralytics/yolov5', 'yolov5s')
results = model(frame)
```

### Task-Specific Automation
Create specialized handlers for different task types:
- **Wires**: Connect colored wires
- **Stabilizers**: Align targets  
- **Keys**: Type the correct sequence
- **Calibrate**: Click moving targets

## Limitations & Future Work

- **Role Detection**: Uses basic color analysis. Could be improved with ML models or template matching
- **Task Automation**: Simplified task completion. Real tasks have varied mechanics
- **Navigation**: Basic movement. Doesn't account for obstacles or optimal paths
- **Consistency**: May need adjustments based on Among Us updates

## Safety & Fair Play Notes

- This bot is for testing/educational purposes
- Use only in private games with friends
- May be detected by anti-cheat in online multiplayer
- Respect game terms of service

## Troubleshooting

**Bot doesn't detect among us window:**
- Make sure Among Us is running and visible
- Try clicking the window manually to focus it

**Role detection incorrect:**
- Adjust the color detection ranges in `detect_role()`
- Add logging to see detected pixel counts

**Tasks not detected:**
- Adjust the contour area threshold in `find_interactive_tasks()`
- Check the console for debug information

**Mouse movements jerky:**
- Reduce `duration` parameter in `move_and_click_task()`
- Increase sleep timing between actions

