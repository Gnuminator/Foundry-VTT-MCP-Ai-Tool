### Test environment

- **Campaign copy test server:** `scripts/test-env/campaign-copy.ps1` pulls the live Curse of Strahd world, the dnd5e system and the modules from the Pi (read-only) into `C:\FoundryCampaign` and runs it on `http://localhost:30004`, so campaign-specific problems can be fixed and tested off the live server. See `docs/dev/CAMPAIGN-COPY.md`.
