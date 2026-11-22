### Obsidian

- **Atlas rebuilt only when the mirror changed:** an export with no mirror write, move or trash
  since the last Atlas build no longer scans the whole vault, so event-only renders stay cheap on
  a big world (atlas-scan-throttle).
