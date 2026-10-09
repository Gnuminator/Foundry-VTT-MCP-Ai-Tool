### Dashboard

- **The React dashboard gets the Tool runner (D-109):** a 🛠 Tools button on `/next/` lists every
  bridge tool by category with a search, and opens one as a form built from its parameters, with
  **Pick…** lists for anything that names a scene, a token, a page, a plan and so on. Reads run at
  once and show their result under the form. A plan typed by hand always opens the confirm window
  before it applies (Enter in a field never applies a change by itself), and so does any other
  write; the toast has Undo. With GM Actions off nothing is planned, and the gate bar's **Enable
  GM Actions** turns them on. **+ Queue a page** in the Handouts drawer now opens it on
  `plan-page-reveal` with the queue action and the active scene filled in. Better than the old
  drawer: a prefilled or picked value shows its name under the field (a scene id shows the
  scene's name), the confirm window names what an id points at, each tool keeps its form while
  the drawer is closed or another tool is open, numbers and JSON are checked before anything is
  sent (all problems at once), plans are tagged `plan` in the list, and a click on Run while a
  Pick… list is open is no longer lost.
