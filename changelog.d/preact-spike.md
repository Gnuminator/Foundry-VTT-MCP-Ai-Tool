### Dashboard

- **Preact instead of React at run time:** the dashboard build, Storybook and the browser tests alias `react` and `react-dom` to `preact/compat`; the first load drops from 149.4 KB to 90.5 KB gzip (Backlog `preact-spike`).
