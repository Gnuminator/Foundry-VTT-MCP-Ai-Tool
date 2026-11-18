### Fixes

- **Pi backup no longer counts the Assistant GM as a player:** after a quick restart of the GM browser, systemd could report an invocation id its journal lines did not carry, so the nightly backup saw "1 player online", waited three hours and skipped the night. The join check now also matches the run's main PID (Pi stage 6 and the shared helper in lib.sh).
