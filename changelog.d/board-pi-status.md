### Pi

- **Board status report (stage 16):** a systemd timer on the Pi sends a small read-only health report (up, disk free, last nightly backup, Foundry up or down with the Foundry and dnd5e versions) to the PM board once an hour, over Cloudflare Access with a service token kept in a root-only file. The board shows it on Today, red when the backup is older than 30 hours or no report came for 3 hours. Not installed yet: it runs in the Saturday Pi sitting.
