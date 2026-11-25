### Tests

- **Handout press fit test:** removing its temp folder retries and ignores a leftover, so a browser still writing its profile (ENOTEMPTY or EBUSY on Windows) no longer fails the merge gate's drift check.
