### Fixes

- **Play log gaps, honest wording:** a recording gap caused by the link to Foundry being down now
  says the events were read back when the link returned, instead of "some events may be missing".
  The pre-flight "Session and play log recording" line shows local times (HH:MM), mentions the gap
  marker only when a recent gap is listed, and no longer says the logs are "switched off" when
  nothing is recording.
- **Event pump:** a full batch that still holds the saved boundary event is no longer taken for a
  ring wrap (nothing was lost); "not recording" clears when the link returns even if the first read
  then fails; a failed log or state write can no longer produce a second, inverted link-down line.
- **Module:** the live window's "Try again" clears the old answer before showing the panel again.
