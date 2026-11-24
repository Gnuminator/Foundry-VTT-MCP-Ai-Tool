### Orange Pi

- **The nightly backup is tested in the ARM64 container:** a new stage 6 shard runs the installed `foundry-backup.sh` through a clean night, a player online and then gone, the GM browser restarted before the run, players online all night, restic failing, Foundry not coming back, and the Docker-cutover stack with a container that restarts during the copy. Each case checks the exit code and that Foundry is running afterwards (`stage6-container-scenarios`).
