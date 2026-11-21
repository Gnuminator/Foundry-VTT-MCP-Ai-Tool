### Orange Pi

- **Who uses what goes to the board, not to the vault (stage 35):** the Pi's usage reading is now POSTed to the PM board's `/api/who-uses-what` with the same Cloudflare Access token as the hourly health report (stage 16), instead of being pushed to the vault repo with a deploy key. The Pi holds no key to the vault any more; a real run of stage 35 removes the old key and clone folder. The board needs its matching endpoint before the first reading is accepted (`stage35-board-endpoint`, D-149).
