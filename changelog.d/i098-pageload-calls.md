### Dashboard (I-098)

- **Lighter page load:** the pre-flight check that runs by itself when Foundry connects now waits
  two seconds, so the panels' own first reads get the bridge first. The dashboard also remembers
  the play stats, the Prep digest and the scene list for five seconds (two windows or a quick
  reload share one bridge call); any change through the dashboard clears that memory, and Recent
  Changes, Handouts and combat are never remembered.
