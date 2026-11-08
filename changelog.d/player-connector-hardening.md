### Player connector

- **Wrapper hardening (0.1.2):** the connector now answers initialize with one of three supported
  protocol versions instead of echoing the request, gives the first initialize at most 10 seconds,
  keeps the old session id when a restart fails so the next stale call tries again, and makes a call
  that starts during a restart wait for the new session. New tests cover tool calls after a failed
  initialize, the last reply at exit and a closed output pipe.
