### Test kit

- **Actor Studio fork on the expected list:** the `heroes-studio` scenario ran live on both kit worlds
  against our fork of Actor Studio (2.10.5-aitool.1) and passes with no STUDIO difference and no console
  errors. The expected list (`studio-expected.json`) no longer holds the unset Subclass advancement, the
  jQuery selector error, the 404 and the "no slot to spend" feature problem; the slot finding now says
  that the fork fills level 1 slots only.
