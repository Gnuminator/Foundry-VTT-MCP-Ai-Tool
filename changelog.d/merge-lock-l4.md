### Dev tooling

- **`lane:merge` merge-train lock: a stale lock is taken over by rename (#314 L4):** two runs that both saw the same stale lock could both get in, because the second deleted the first run's fresh lock. The lock is now renamed to a name only that run uses (one rename wins, the others retry), and a live lock caught by mistake is put back. A test replays the race (it fails on the old code).
