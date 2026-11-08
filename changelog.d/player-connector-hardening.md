### Player connector

- **Wrapper hardening (0.1.2):** when the table cannot be reached at startup, the connector's own
  initialize answer now names one of the supported protocol versions instead of echoing the
  request. The first initialize, and the retry after a failed one, get at most 10 seconds. A failed
  restart of a lost session keeps the old session id so the next stale call tries again, and a call
  that starts during a restart waits for the new session. New tests cover tool calls after a failed
  initialize, the last reply at exit and a closed output pipe.
