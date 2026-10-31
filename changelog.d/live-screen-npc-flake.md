### Fixes

- **Tests:** the live screen's "Rolled initiative" toast check looks inside the toast stack, so Radix's repeat of the text in its screen-reader live region no longer makes it fail with a strict-mode violation on a slow runner. The `toast` test helper takes a regex and `exact`. The app shows each toast once.
