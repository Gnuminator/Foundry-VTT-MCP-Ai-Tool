### Orange Pi

- **Who uses what, written by the Pi (stage 34):** a Pi timer (every 4 hours and Sunday 23:00) asks the Pi dashboard for the usage report and pushes it as `Who uses what.md` to the vault repo with a deploy key made on the Pi, so the PM board's Who tab stays fresh without the PC. The stage takes one reading before it enables the timer and never touches another service. Tested against a real git repo and in the ARM64 container; not run on the Pi yet (item `who-uses-what-pi-job`).
