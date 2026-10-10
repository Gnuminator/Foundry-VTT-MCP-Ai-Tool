### Dashboard

- **The React dashboard gets the Before / During / After views (D-109):** the header on `/next/`
  has the three moment tabs, and each view holds its panels in the page: Pre-flight (with Ready
  for session) and Prep in Before, Party and Handouts in During, Prep and Handouts in After. A
  panel in the page has no close button, no dark backdrop and Escape leaves it alone; its header
  or menu button scrolls to it instead of opening a second copy. The moment follows the play
  session (open is During, ended in the last 12 hours is After, else Before) and a tab click holds
  the pick until a session starts or ends. The page waits for the first session answer, so a
  reload during play no longer shows Before first. A panel that stays in the page when the moment
  changes keeps what it loaded; one that comes back loads again, as when its drawer opens. The
  tabs work from the keyboard (arrow keys, Home, End), and when a moment change takes away the
  panel holding the focus, the focus goes to the new tab. Live Feed, Recent Changes, the feature
  cards and the After stats show a short card that points to the full dashboard until they move.
- **get-play-session says when the last session ended:** a closed session now also gives
  `endedAt` (its end marker, or its last activity when it went quiet), so After shows on any
  browser and after a reload, not only in the browser that saw the session end.
