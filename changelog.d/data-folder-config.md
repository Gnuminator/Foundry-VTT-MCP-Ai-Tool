### Voice and recordings

- **One data folder setting:** `FVTT_DATA_DIR` names the folder that holds FoundrySessions, FoundryRehearsals and FoundryNarration (and, by hand, FoundryDemo, VoiceBench and VoiceTest). The sessions folder, the rehearsal folder, the narration tool, the session-notes scripts and the voice stack all read it. A folder that has not been moved there yet still answers from `Documents\<name>`, and the older `FVTT_SESSIONS_DIR`, `FVTT_REHEARSAL_DIR` and `NARRATION_OUT_DIR` still win when set (backlog item data-folder-move, part 1).
