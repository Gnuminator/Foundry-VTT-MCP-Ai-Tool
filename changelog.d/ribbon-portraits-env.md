### Orange Pi

- **Initiative ribbon portraits on the Pi and in Plan B:** stage 7 takes `DASHBOARD_FOUNDRY_URL`
  (for example `https://play.<domain>`), validates it, keeps it on later runs and writes it to the
  dashboard's settings; Plan B passes its local Foundry address. Without it the ribbon shows
  initials. The remote-access guide explains why no image proxy is needed behind Cloudflare Access.
