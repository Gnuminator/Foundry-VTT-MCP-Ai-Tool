### Fixes

- **Assistant GM no longer burns CPU:** the headless browser redrew the endless "Game Paused" banner
  animation 60 times a second even with the map canvas off, which kept Chromium's gpu process near
  one core on the Orange Pi. The browser now lets every CSS animation run once and stop (PC test:
  gpu process 15 % down to 0.2 % of a core; the bridge link works as before).
