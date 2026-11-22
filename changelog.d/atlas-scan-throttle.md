### Obsidian

- **Atlas rebuilt only when the mirror changed:** an export with no mirror write, move or trash
  since the last Atlas build no longer scans the whole vault, so event-only renders stay cheap on
  a big world (atlas-scan-throttle). A build is redone after 10 minutes at most, so a note moved
  or edited in Obsidian reaches the Atlas by then.
