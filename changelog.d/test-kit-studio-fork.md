### Test kit

- **Actor Studio fork on the expected list:** the `heroes-studio` scenario ran live on both kit worlds
  against our fork of Actor Studio (2.10.5-aitool.1) and passes with no STUDIO difference and no console
  errors. For that build the expected list (`studio-expected.json`) leaves out the unset Subclass advancement,
  the jQuery selector error, the 404 and the "no slot to spend" feature problem; the slot finding now
  says that the fork fills level 1 slots only.
- **The expected list follows the installed Actor Studio:** `studio-expected.json` still holds the
  upstream 2.10.5 findings; the four the fork fixed carry `fixedIn: "2.10.5-aitool.1"` and are left
  out when the installed module is that build or a later build of the fork. The `heroes-studio`
  scenario and the console groups read the version from the GM page, so one run on upstream 2.10.5
  and one on the fork both pass with no new findings. An unknown version falls back to the upstream
  list and says so.
