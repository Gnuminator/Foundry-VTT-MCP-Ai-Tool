/**
 * `plan-handout-press` (Prep set): Claude turns supplied text into a handout picture (a letter, a
 * notice or a card) rendered on the GM's PC. The module query `uploadHandoutImage` (a write behind
 * the write gate, GM client only) stores the PNG under `assets/ai-art/handouts/`; the page itself
 * is a guarded write under the `handouts` feature (apply confirms, undo removes the page).
 */

/** Module query name (the module keeps its own copy; a module file imports types only). */
export const UPLOAD_HANDOUT_IMAGE_QUERY = 'uploadHandoutImage';

/** The three templates. */
export const HANDOUT_PRESS_TEMPLATES = ['letter', 'notice', 'card'] as const;
export type HandoutPressTemplate = (typeof HANDOUT_PRESS_TEMPLATES)[number];

export interface UploadHandoutImageRequest {
  /** The rendered picture, base64 (PNG). The module checks the bytes again. */
  data: string;
}

export interface UploadHandoutImageReply {
  success: boolean;
  error?: string;
  /** Where the file is, relative to the Foundry Data folder. */
  path?: string;
}
