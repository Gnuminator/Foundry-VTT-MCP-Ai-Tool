### Tests

- **Outcome polling test no longer flaky under load:** the apply-outcome recovery tests shared an 80 ms wall-clock deadline, so a stalled event loop in the merge gate made one of them give up ("no answer within 0 s"). Recovery tests now use a long deadline; only the give-up test uses the short one. No production change.
