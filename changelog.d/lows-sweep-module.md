### Fixes

- **Live window colour scheme:** the live window now follows Foundry's own window rule: the windows scheme decides, the interface scheme is ignored, and a browser that reports both dark and light counts as dark.
- **Token ring script:** `apply-rings.js` saves the original art backup before changing the actor (and removes it if the update fails), and it only switches the fit mode when an actor was changed or reverted.
