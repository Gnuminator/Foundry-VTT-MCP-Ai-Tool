### Fixes

- **Screenshot baselines no longer get lost in the workflow:** the "Collect the changed and new PNGs" step of `visual-baselines.yml` ran under `sh`, where `read -d` fails without failing the step, so the artifact held no PNGs while six had changed. It now runs under bash, fails on a mismatch, and writes a `png-count.txt` marker. `npm run visual:baselines` fails loudly when the marker says N PNGs but the artifact holds fewer, and writes nothing in that case.
