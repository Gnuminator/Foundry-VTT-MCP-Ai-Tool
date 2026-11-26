### Session notes

- **Table agenda that carries over:** every "Proposed, not settled" and "Open at the table" line of a
  session's Table page becomes an agenda item with a status (open, settled, dropped) and the session it
  came from, kept in `table-agenda.json` in the sessions folder. A later session's House rules line that
  answers an open item marks it settled with a link to that moment. Each notes run writes
  `agenda.<lang>.md` ("Settle at the start"), `session-notes agenda --settle|--drop|--reopen <id>` sets a
  status by hand, and `get-prep-digest` shows the open items as `agenda` (backlog `table-agenda`).
