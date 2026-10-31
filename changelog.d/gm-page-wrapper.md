### Dashboard

- **GM page (third live-screen option):** `/gm` shows Foundry in one pane and the live strip (the
  same component as the Live screen and the Foundry window) in the other, GM only, behind the same
  login. A drag divider (also by keyboard), a layout saved per browser (strip right or left, or
  Foundry alone with the strip in its own window), and map picks in Foundry pick in the strip
  through the page. When Foundry refuses to be framed the page says so and offers to open Foundry
  in its own tab. Foundry needs one Cloudflare response-header rule on the play host to be framed
  (see the PR); players keep the plain Foundry link.

### Module

- **Map picks go up to the GM page:** a Foundry page that sits in the GM page's frame (or was opened
  by it) posts the controlled token ids to it, to the dashboard origin only, and answers its
  "ready" message.
