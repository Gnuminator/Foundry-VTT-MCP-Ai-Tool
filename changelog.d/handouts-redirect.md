### Dashboard

- **Showing a handout is one question:** a page reveal is an ordinary change with an Undo, no
  longer a destructive one. The window asks `Show "<title>" to <players>?` in one line, with a
  **Show page to players** button and no tick box.
- **A refusal can turn the switch on:** when a change is refused because GM Actions or one of the
  session switches is off, the warning toast has a **Turn on <switch> and the rest for tonight**
  button (the same click as Turn on for tonight in Pre-flight, so it turns on all of them). Switches the
  dashboard does not control keep the named pointer to Foundry's settings.
- **One switch-off sentence:** the bridge and the dashboard take the "is switched off. In Foundry,
  open Game Settings..." wording from one shared constant; the module (which cannot import it in
  the browser) keeps a copy that a test checks against it.
