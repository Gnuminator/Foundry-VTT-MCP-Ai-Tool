### Pi

- **Join page look (stage 19, backlog join-page-look):** the page players see before they log in can now get a
  background picture and a written description of the world. `scripts/pi/remote/19-join-page-look.sh` stops Foundry,
  puts the picture in the world's folder, sets `background` and `description` in `world.json` (Join Page Theme and
  Next Session untouched), starts Foundry again and checks the join page. It has a dry run, needs a snapshot from
  today and nobody online, saves the old values and has `UNDO=1`. It is a stage and not a GM script because
  Foundry accepts the world edit only from the full Gamemaster role, which the Assistant GM does not have. The
  picture itself is campaign art and is not in the repo.
