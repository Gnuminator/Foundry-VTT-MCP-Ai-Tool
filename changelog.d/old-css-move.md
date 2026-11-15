### Dashboard

- **Old stylesheets bundled:** `styles.css` and `moments.css` moved from `public/` into `web/src/styles/`, with the shared themes imported after them in one bundled stylesheet, so the cascade order is unchanged and the page makes one stylesheet request instead of five. The player pages keep linking `public/themes/`.
