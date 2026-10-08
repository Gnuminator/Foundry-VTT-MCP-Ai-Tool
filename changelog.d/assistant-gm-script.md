### Orange Pi (D-068)

- **GM scripts on the Pi:** `gm-script.sh` runs one GM script (a local file on the Pi) in the
  running world as the Assistant GM, so world changes that need a GM in the browser (a module's
  own import, placing map pins) work without anyone typing the Gamemaster's password. A dry run
  lets only known reads through (an allow list, checked in the page and again on the wire) and
  lists everything it held back; a real run needs a passed dry run of the same file first. The
  bridge link stays down while a script runs. Every run logs the file, its sha256 and the result
  to the journal and keeps a copy of the script. Nothing over the network can start one. The
  Assistant GM's service mode is unchanged.
