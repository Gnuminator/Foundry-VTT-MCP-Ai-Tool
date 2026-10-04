export declare const FONTS: Array<{ family: string; file: string; weight: string; style: string }>;
export declare const LICENSE_FILES: string[];
export declare const THEMES: string[];
export declare function fontFaceCss(fontsDir: string): string;
export declare function licenseText(fontsDir: string): string;
export declare function copyrightLines(fontsDir: string): string[];
export declare function pluginCss(input: { base: string; theme: string; fontsDir: string }): string;
export declare function snippetCss(input: { theme: string; id: string; fontsDir: string }): string;
