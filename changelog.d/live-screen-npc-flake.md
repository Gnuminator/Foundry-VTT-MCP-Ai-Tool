### Fixes

- **Tests:** the live screen's three Start combat toast checks look inside the toast stack, so Radix's repeat of the text in its screen-reader live region no longer makes them fail with a strict-mode violation on a slow runner. The app shows each toast once.
