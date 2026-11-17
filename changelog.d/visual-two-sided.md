### Tests

- **Two-sided dashboard story shots (step 1, not yet a gate):** each dashboard visual shard also builds the base (main) Storybook in a second folder, renders every photographed story from both sides in the same container and compares them. A new `dashboard-visual-diff` artifact (`visual-diff.json`, a before / after / diff page and the PNGs) and a job summary list the changed, added and removed stories. The committed baselines and their comparison still decide the check; the new render never turns CI red.
