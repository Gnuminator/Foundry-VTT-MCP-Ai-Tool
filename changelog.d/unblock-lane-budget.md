### Fixes

- **Main green again:** the lane skill word budget is raised from 1,889 to 1,925 so main CI passes; the proper trim is the backlog item `lane-skill-trim`.
- **Handout press waits for a relaunching browser:** Edge 158 and Chrome start themselves again and write the screenshot a few hundred milliseconds after the program started exits, so the press reported "The browser exited without writing the picture". It now waits (up to 10 s) for the picture to appear and stop growing.
