import dxcam
import cv2
import numpy as np

camera = dxcam.create()

print("Architect Vision Active. Press 'q' to stop.")

while True:
    frame = camera.grab()

    if frame is not None:
        
        display_frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)

        cv2.imshow('Architect Vision', display_frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cv2.destroyAllWindows()