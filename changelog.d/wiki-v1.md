### Docs

- **Wiki v1 (D-097):** a MkDocs Material site built from `docs/gm` and `docs/player`, the same
  pages as the dashboard help, with the GM coach zip as a download on its page.
  `npm run wiki:stage` stages the pages (links to the rest of the repo become GitHub links, the
  nav follows each README), and the new Wiki workflow builds it with `--strict` on every docs change and keeps
  the site as the artifact `wiki-site`. Publishing on GitHub Pages waits for the repository
  variable `WIKI_PAGES`.
- **Your first hour as GM:** a new GM page with a set reading order through Foundry's own
  knowledge base for the basics and our pages for the tool.
