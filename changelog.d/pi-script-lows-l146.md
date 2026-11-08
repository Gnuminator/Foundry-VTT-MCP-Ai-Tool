### Orange Pi

- **Stage 26 UNDO reads the saved file by grep's exit status:** a saved copy grep cannot read now stops the undo before any key changes (the earlier readability test did nothing when the stage ran as root). Stage 25's "run did not finish" message says "the old folders are back" only when the folders really were put back.
- **Plan B restore: the app folder swap says where every folder is:** `restore.ps1` retries the move of the old app folder too, and a failure names the case (no app folder before, something sitting in its place, the old one moved back or left in its `-<build>` folder). A test now makes the rename fail.
- **Stage 13 container test:** a new scenario upgrades from an installed `aitool.9`. The Pi setup guide and the changelog now say `aitool.10` also carries the `aitool.8` review fixes, and that `aitool.8` never reached the Pi.
