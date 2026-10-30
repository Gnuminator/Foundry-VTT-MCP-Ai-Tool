### Dashboard (I-098)

- **Lighter page load:** the pre-flight check that runs by itself when Foundry connects now waits
  two seconds, so the panels' own first reads get the bridge first. The dashboard also remembers
  the play stats and the scene list for five seconds (two windows or a quick reload share one
  bridge call); any change through the dashboard or new game event clears that memory, and Recent
  Changes, Handouts, the Prep digest and combat are never remembered.
