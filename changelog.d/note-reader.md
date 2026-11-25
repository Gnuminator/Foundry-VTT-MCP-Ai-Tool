### Tooling

- **Note-reader agent and hint:** a Haiku `note-reader` agent answers questions about a long vault
  note in 15 lines with quoted lines, and a Read hook points a lane at it once per file when it
  reads a whole vault note over 300 lines (such as `Backlog.md`). It only adds a hint and never
  blocks a read.
