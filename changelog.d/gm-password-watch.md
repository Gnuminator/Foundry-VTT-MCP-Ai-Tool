### Orange Pi

- **Game-night check names open passwords:** `CHECK=1` on stage 29 now also reports, read-only and by name, "no administrator password" and every Gamemaster or Assistant GM without a password in any world, and exits 1 on either (it needs `lib-gm-passwords.sh` in the pipe). Container scenarios cover clean, GM without a password, no administrator password and a missing helper.
