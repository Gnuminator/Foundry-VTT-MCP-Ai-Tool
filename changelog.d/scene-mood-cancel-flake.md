### Tests

- **Dashboard e2e: no more clicks on a sliding window:** the confirm window slides in for 0.16 s, and on a loaded CI runner Playwright could click Cancel where the button had been, which left the window open ("Cancel in the confirm window applies nothing" failed once on main). The dashboard e2e config now runs with reduced motion, as the visual config already does. No product change.
