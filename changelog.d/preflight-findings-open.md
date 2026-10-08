### Fixes

- **Pre-flight findings stay open:** when a pre-flight run finished, the drawer redrew the
  "N finding(s)" list closed, so a GM who had opened it saw it snap shut. An opened list now stays
  open across the redraw (a closed one stays closed). Found by the test kit.
