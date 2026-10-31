### Fixes

- **Planner playbook:** the "Main is red" step names the oldest run of the unbroken red streak (cancelled runs skipped) as the commit to revert, and the main CI listing uses `-L 15` like the start-alerts hook.
