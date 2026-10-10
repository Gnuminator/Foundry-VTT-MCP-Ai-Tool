### Orange Pi (D-068)

- **Stage 12 also needs Foundry's administrator password (#308 review):** without one, `/setup`
  would be open to anyone past Cloudflare Access. The stage and `gm-passwords.sh` check that
  `Config/admin.txt` is there (the file is never read). The GM check now fails when there is no
  worlds folder, removes its copy of the users databases even when a run is cut off, and copies a
  symlinked users folder instead of opening it in place. The docs say to rerun the check after
  adding worlds or GM users, and explain the "no Gamemaster" refusal.
