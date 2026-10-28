### Pi

- **Pi clock stays under NTP (stage 18, backlog pi-ntp):** DietPi's default time sync is "boot + daily",
  so `timedatectl` said "NTP service: inactive" and the clock could drift between syncs, which Cloudflare
  Access tokens and the board's hourly report depend on. `scripts/pi/remote/18-time-sync.sh` switches DietPi
  to its daemon mode (`dietpi-set_software ntpd-mode 4`), with `DRY_RUN=1`, `CHECK=1` and `UNDO=1`, and
  waits until "NTP service: active" and "System clock synchronized: yes".
