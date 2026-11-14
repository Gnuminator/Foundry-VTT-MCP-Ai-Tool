### Fixes

- **Merge runner retries GitHub 5xx:** the merge runner now retries a merge that GitHub answered with a 5xx error (such as a 502 Bad
  Gateway from `gh pr merge`) instead of refusing the PR, so a short GitHub outage no longer needs
  a lane to write a new ready line.
