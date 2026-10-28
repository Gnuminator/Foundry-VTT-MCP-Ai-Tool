### Fixes

- **Dashboard:** the stream status `lastPollAt` now moves with each successful poll. It stayed at the first poll time while events flowed (seen on the Pi), because the status is only published when something else changes. The time is updated quietly, with no extra message to the browsers.
