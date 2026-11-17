### Voice and recordings

- **Data folder audit:** README, help and comment lines now say the data folder (`FVTT_DATA_DIR`) first and `Documents` as the fallback. The voice-stack compose files fall back to `FoundrySessions` in `FVTT_DATA_DIR` too, and `.env.example` shows `C:/FoundryData`. The default picture folder of `plan-actor-image` is now `Foundry Art` in `FVTT_DATA_DIR` (Documents while it has not been moved; `FOUNDRY_AI_TOOL_IMAGE_ROOTS` still wins). Tests cover the Python `data_folder` copies and `Get-DataFolder`.
