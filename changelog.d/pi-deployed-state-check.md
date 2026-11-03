### Pi

- **Deployed-state check:** `deploy/pi/deployed-state.ps1` runs a read-only check on the Pi and prints what is
  wrong: a stopped or crash-looping service, a missing `DASHBOARD_FOUNDRY_URL` (and other env names, never their
  values), a missing libicu, and whether the deployed build is the newest release (and how many commits main is past
  it). It also reads container health and restart counts for the coming Docker stack.
