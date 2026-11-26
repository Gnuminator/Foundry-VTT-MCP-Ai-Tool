### Dev tooling

- **A refused PR wakes its lane:** the merge runner writes its refusal line as one comment on the
  PR (once per head), and lanes bind the PR and turn the app's PR monitor on right after opening
  it, so a lane can fix a refusal while its cache is warm.
- **Baseline and tool pages merge themselves:** git merge drivers (`scripts/merge-drivers`,
  registered by `npm ci`) merge `scripts/line-baseline.json` entry by entry and keep the
  branch's generated tool pages, so merging main into a branch no longer stops on them (GitHub's own conflict flag still shows until main is merged in).
