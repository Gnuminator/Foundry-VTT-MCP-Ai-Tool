/**
 * The part of the shared package that is safe in a browser bundle: no Node built-ins and no zod.
 * The Foundry module is bundled for the browser (packages/foundry-module/build-options.mjs), and
 * the main entry pulls in files that read the disk, which a browser build cannot resolve. A
 * module value import comes from `@gnuminator/shared/browser`; types still come from the main entry.
 */
export * from './util/errors.js';
export * from './util/record.js';
export * from './util/html.js';
export * from './macro-source.js';
export * from './client-versions.js';
