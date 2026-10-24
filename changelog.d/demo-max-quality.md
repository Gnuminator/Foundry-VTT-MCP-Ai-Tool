### Demo recorder

- **Maximum quality recordings:** the ffmpeg recorder captures at constant quality 10 with the
  slowest NVENC preset and no bitrate cap (4:4:4 on the gdigrab path), and `compose.mjs` encodes
  the final cuts with x264 at an average of 12 Mbps instead of NVENC at constant quality 21, which
  had left the GM videos near 4.7 Mbps (spec: 8 to 12).
- **Chapters without a title card:** a compose chapter with `"card": false` in the manifest goes into
  a cut with no title card (for an intro or outro shot), and `"clip": false` leaves it out of the
  per-chapter clip cuts.
