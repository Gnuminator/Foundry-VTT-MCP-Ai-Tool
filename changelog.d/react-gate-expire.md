### Dashboard

- **React dashboard: the Tool runner's gate focus expires (#280 review):** a change refused for GM
  Actions asks for the focus on the gate bar's Enable button, and the request now lasts about a
  second. Before, a refusal that never drew the bar (a 403 for another reason, or the stream saying
  GM Actions are on first) left the request waiting, so GM Actions going off later took the focus
  from the field being typed in, and the next opening of the Tool runner went to the gate button
  instead of its usual first button.
