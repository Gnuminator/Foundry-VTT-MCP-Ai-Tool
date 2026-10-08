### Dashboard

- **The React dashboard starts (D-109):** a new dashboard page in React + TypeScript + Vite at
  `/next/`, next to the old page, with Radix UI primitives, TanStack Query and Playwright browser
  tests in CI. It keeps the old look (it links the same stylesheets and themes). The first panel
  on it is Player links; the old page is unchanged and stays the default. The build puts it in
  `dist/web`, so the Docker image and the Pi get it with the rest.
