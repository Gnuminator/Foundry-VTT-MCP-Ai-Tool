### Fixes (Part C lows, round 3)

- **Remote access guide:** step 5 now says "Save the route." right after the route is described, and
  the optional JWT paragraph says "save the route again".
- **Obsidian plugin:** two Cloudflare Access header lines pasted into one field with no newline
  between them are split, so the Id and Secret each get their own value.
- **Windows tunnel installer:** when registering the sign-in task fails under `-NoStart`, the error
  no longer claims the old tunnel was stopped (it was left alone).
