### Voice (Backlog: danish-transcription-tuning, pipeline-vocab-productnames)

- **Transcription default is now large-v3:** on six slices of the David GM test recording (Danish with
  English game words) it spells Danish clearly better than large-v3-turbo and runs at 0.06 of real
  time, so a 3 hour session takes about 11 minutes. Language stays `da`; the results table is in
  `tools/voice-stack/README.md`.
- **Hotwords are off by default:** `voice-stack.ps1 transcribe` passes `names.txt` to Whisper only with
  `-Hotwords` (a short list did not clearly win). `names.txt` still feeds the pipeline's name fixes.
- **Names the recogniser gets wrong are fixed after transcription:** the session pipeline ships rules
  for KGM to co-GM, Strut to Strahd, Danny to Danni and Poundry to Foundry (`--no-product-rules` turns
  them off, a session `rules.json` wins). Host names such as `kgm.example.com` are left alone.
