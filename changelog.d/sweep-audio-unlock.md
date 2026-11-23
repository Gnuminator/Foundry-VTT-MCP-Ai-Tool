### Tests

- **Live sweep unlocks audio in its GM browser:** the browser the merge train and the sweep join
  as Claude now gets one real click after joining, so Foundry unlocks audio and the scene mood
  music step no longer fails on a locked browser. The sweep also splits that step in two: the
  darkness half always runs, and the music half is skipped with the reason if audio stays locked.
  The product's own audio-lock refusal is unchanged (sweep-audio-unlock).
