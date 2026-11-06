### Docs

- **The control check is stricter:** `npm run docs:ui` now also reads `docs/player` and its Danish twins, reports each problem at the line of the name, fails when a docs folder, the smoke checklist or the dashboard sources go missing, and no longer counts comments, stories or quoted ids as labels. A bold name written as code (**`Undo`**) is read. `green --quick` runs `docs:ui` and `docs:kit` for dashboard, module and kit scenario changes too. `docs:kit` takes `--root` and has its own test.
- **Quest page check:** a heading with a code span gets the right anchor, problems carry the real file line, and headings, `:::` lines and table rows no longer join the paragraph around them.

### Discord

- **Dashboard posts:** `{gm}` in a `dashboard` text becomes the GM role mention, the role id is trimmed, and RELEASING and the README say the role needs "Allow anyone to @mention this role".

### Session notes

- **Tell tests:** a failed transcription has its own test, the raw-scenes fixture is written by the real notes writer, and the README says a paused or failed step is told once per day.
