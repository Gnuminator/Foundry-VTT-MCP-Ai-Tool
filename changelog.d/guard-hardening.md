### Orange Pi (D-068)

- **The remote-command guard checks long commands in linear time:** the regexes that re-read the
  rest of a line from every possible start (`rm -rm -rm ...`, runs of newlines, `(`, `;`, `$(` or
  quotes, `sed -i...`, a `cat` with no pipe after it, many `.sh` names) are replaced by scans that
  read each stretch once. A crafted 50,000-character command took up to 36 s before (a hook past its
  timeout lets the command through); now every check takes a few milliseconds, and tests hold it
  under 200 ms.
- **More ways to delete everything are caught:** `cd / && rm -rf *` (a relative delete is resolved
  against an earlier `cd` in the same script), `find / -delete` and `find ... -exec rm` (by start
  path, like `rm`), `xargs rm` (asks), `rm -rf -- /` and `rm -rf --interactive=never ~` (deny now,
  like `rm -rf /`), and paths that only reach / or a system folder after `..`, `//` or `/./`, or
  through a wildcard in the first folder (`/e*c`). Every path of an `rm` is checked, not only the
  first. `rm -rf *`, `.` or `..` with no known folder, and deletes in the home folder (`~/x`), ask.
  A comparison of the old and new guard on about 41,000 commands (the review's hand-written cases
  and generated ones) found no decision that got looser; the stage scripts and the rebuild drill
  commands pass as before.
