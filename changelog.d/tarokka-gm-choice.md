### Tarokka (tarokka-gm-choice)

- **A reading the GM chooses:** `plan-tarokka-import` takes the five cards the GM picked (arguments
  `tome`, `holySymbol`, `sunsword`, `ally`, `strahdLocation`) and stores them as the current
  reading with no draw and without the tarokka-reading module. The Tarokka drawer has a **Choose the
  cards…** form for it (open while **Show cards** is ticked). Cards are checked against their deck
  and cannot repeat; the previous reading is archived and the change can be undone. Reveals already
  go one position at a time.
