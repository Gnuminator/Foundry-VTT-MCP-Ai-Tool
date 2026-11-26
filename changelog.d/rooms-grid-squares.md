### Module

- **Rooms by grid squares:** `plan-room-setup` stairs, hazard and whisper take `squares` instead of `area`: grid labels like "C4 to H9, without E6 to F7" (letter column, number row, A1 at the map's top left). One Region with Foundry 14's grid shape covers exactly those squares, so an L-shaped room with a pillar is one Region, not two rectangles. Rectangle `area` plans work as before (Backlog `rooms-grid-squares`).
