### Fixes

- **Recent Changes no longer fails after a bulk delete:** a day's change journal could grow past
  what Node holds in one string (the test kit deleted 13,000 actors in a day: 550 MB, each delete
  with the actor's data), and `list-changes` and the journal pump then failed ("Invalid string
  length", a 422 on every Recent Changes call). The bridge now reads journal and session files
  line by line, and the history holds at most the journal's size cap
  (`FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB`, 64 MB) of the newest records; when it leaves older ones
  out, the list says from when it is complete and a rewind stops there.
