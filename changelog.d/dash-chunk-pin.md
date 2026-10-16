### Dashboard

- **React page loads faster:** Tools, Tarokka, Prep, Party, Handouts, Player links and Module
  diagnostics load from their own chunks, so the first load is 140.2 KB gzip instead of 150.5 KB.
  The three that sit in a view download right after the page draws, the others when the browser is
  idle; a failed download shows a toast instead of a blank page. The bundle budget lists each chunk.
- **Layout trial and the session:** if the session opens or closes while the old page's layout trial
  is running, Stop or Escape no longer puts back the tab the GM had pinned before the trial.
