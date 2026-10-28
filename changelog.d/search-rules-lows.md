### Rules search (I-152)

- **The DMG 2024 is searched by default:** it lives in the `aitool-content` "Books" pack, which
  `search-rules` now reads with the other rules packs. `includeWorld` is only for the imported
  adventure text, and the empty-result note says so.
- **Faster after the cache expires:** a stale index answers at once and one rebuild runs in the
  background, so a search no longer waits for a whole pack (the dashboard gave up after 15 s).
- **Fewer wrong matches:** "cone" no longer finds "Con", "uses" no longer finds "us", and "ally"
  finds "allies". Encoded `&lt;` and `&gt;` in rules text read as ‹ and › instead of a space.
- **Settings hint** names the real default packs.
