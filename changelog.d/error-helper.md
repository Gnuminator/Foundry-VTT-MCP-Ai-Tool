### Fixes

- **Clearer error messages for Claude:** one shared helper now words the errors the tools send back. A feature that is switched off says so, names the setting and tells Claude to stop and ask the GM instead of working around it. "Not found" errors name the tool that lists what exists, "not connected" says to tell the GM and not retry, an expired plan says how to list plans, and an unknown tool hints that its tool set may be switched off. The "Received args" dump is gone from compendium validation errors.
