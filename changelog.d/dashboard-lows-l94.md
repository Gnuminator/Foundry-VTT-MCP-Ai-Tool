### Dashboard

- **Attack form fixes:** the form shares the combat strip's one-write lock, Cancel and Escape do nothing while an attack runs, a failed weapon read shows its error, a vanished attacker falls back to the default one, and the form says Undo does not give back ammunition.
- **World switch:** a feed read that was out when the world switched no longer writes the old world's cursor or events, and a fight read still out no longer brings the old fight back.
- **Smaller fixes:** the live strip's Undo title matches its label when a change has no summary, and the header says "reconnecting" instead of "reload the page" when the stream goes quiet.
