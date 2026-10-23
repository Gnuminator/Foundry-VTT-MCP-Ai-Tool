### Process tooling

- **Merge train on the PM board:** `scripts/lane-merge.mjs` writes the merge train (count, last roundtrip, last event) to the vault note `Dev/Foundry AI Tool/Merge train.md` on every merge, every `--train-reset` and every refusal, so the board's Today card shows it. A vault problem only prints a warning and never fails or undoes a merge; `--dry-run` writes nothing.
