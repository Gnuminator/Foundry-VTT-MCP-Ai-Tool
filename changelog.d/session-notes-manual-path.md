### Session notes

- **One command per recording:** `tools/session-notes/session.ps1 <session>` pulls the recording from the
  Pi, checks consent, builds names, transcribes under the GPU lock, writes the notes and publishes them,
  to the test bridge unless `-Real` is given. The skill and both READMEs now name it as the current way
  until G2.
