### Dashboard

- **Player portraits, small fixes:** the "My character" upload control also hides when Allow Write Operations is off (the flag is cached for 20 seconds in `/api/me`); "Use the picture for" comes before the Upload button in tab order, the result note stays visible when the box hides, and the picture-for list keeps the field's font size. The Player portraits switch hint now mentions placed tokens.
- **App route ratchet:** the comment stripper skips strings, so a `/*` or `//` inside a string no longer hides a route from the count.
