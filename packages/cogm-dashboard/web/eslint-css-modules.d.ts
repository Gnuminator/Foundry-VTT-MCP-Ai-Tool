// Only ESLint's TypeScript program reads this file (tsconfig.eslint.json takes packages/**/*.ts;
// web/tsconfig.json lists its folders and gets the same declaration from vite/client). Without it
// a `*.module.css` import has no type there and every use of it is flagged.
declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}
