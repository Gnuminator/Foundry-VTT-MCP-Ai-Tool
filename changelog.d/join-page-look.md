### Pi

- **Join page look (stage 19, backlog join-page-look):** the page players see before they log in can now get a
  background picture and a written description of the world. `scripts/pi/remote/19-join-image.sh` puts the
  picture in the world's folder (hash and webp checked, dry run, snapshot required, undo), and the GM script
  `scripts/pi/gm-scripts/join-page-look.js` sets Background Image and World Description as the Assistant GM
  (dry run first, theme and next session left alone). The picture itself is campaign art and is not in the repo.
