### Dashboard

- **Back under the first-load bundle budget:** the Pre-flight drawer and the Radix dropdown behind
  the Advanced menu load from their own chunks, so the first load drops from 150.0 to 145.1 KB gzip
  (limit 150). The header buttons and the version banner stay in the entry; the Advanced button is
  the same button until its chunk arrives, and a click in that moment opens the menu as soon as it
  loads.
