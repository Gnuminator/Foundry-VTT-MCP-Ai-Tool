### Dashboard

- **Version tracker follow-ups (I-127):** the online lookups now close the reply body after an error, redirect or oversize answer. A module whose newest release needs a newer Foundry than the installed one shows "(needs Foundry X)" beside "Update available". The private-address guard also refuses `::7f00:1`, `64:ff9b::`, `.lan`, `.home.arpa`, `fritz.box`, `198.18.0.0/15` and multicast.

### Module

- **`get-modules` is smaller:** manifest urls are only included with `includeManifest: true` (the version tracker asks for them), and a `#fragment` is dropped from them.
