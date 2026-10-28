### Dashboard (I-098)

- **The dashboard's JavaScript is gzipped:** the hashed files under `/next/assets/` are sent
  compressed to a browser that accepts it (the first load drops from about 456 KB to 145 KB of
  JavaScript on the wire, compressed once per file and kept in memory). The event stream and
  everything else are untouched.
