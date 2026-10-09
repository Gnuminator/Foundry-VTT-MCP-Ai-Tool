### Dashboard

- **Short GM tokens refused off loopback:** when `DASHBOARD_HOST` is not a loopback address, the
  dashboard refuses to start unless `GM_DASHBOARD_TOKEN` is at least 32 characters (the error
  gives the length, never the token). Loopback setups and the Pi's token (24 random bytes, 32
  characters) are unchanged. A Docker or other off-loopback setup with a shorter token must replace
  it before upgrading (`openssl rand -hex 32` gives 64 characters).
