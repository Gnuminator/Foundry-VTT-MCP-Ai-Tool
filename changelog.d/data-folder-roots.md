### Orange Pi

- **Plan B, the campaign copy, the GPU lock and the module archive follow `FVTT_DATA_DIR`:** `C:\FoundryPlanB`, `C:\FoundryCampaign` and `C:\FoundryAI` (and `FoundryPlanB-drill2`) are read from one place, `Get-RootFolder` in `scripts/data-folder.ps1` (also `scripts/data-folder.mjs` and `rootFolder()` in the shared package). While a folder has not been moved under the data folder, the old `C:\<name>` still answers, so nothing changes until the move. The scene-restore default paths use the same rule (backlog item data-folder-roots, part 1; no folder is moved by this change).
