### Test kit (D-090 lane 2)

- **Test server scripts:** a damaged `pids.started.json` (empty, broken, a list, an entry without
  a pid or a start time) no longer stops `start.ps1` and `stop.ps1`; the bad entries are skipped
  and the service is judged by its port and command line alone (a #192 review low).
