/**
 * ComfyUI installation detection utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import { isWindows } from './platform.js';

/**
 * Check if a directory contains a valid ComfyUI installation
 */
export function isValidComfyUIPath(dirPath: string): boolean {
  try {
    const mainPyPath = path.join(dirPath, 'main.py');
    return fs.existsSync(mainPyPath) && fs.statSync(mainPyPath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * Get common ComfyUI installation paths for the current platform
 */
function getCommonComfyUIPaths(): string[] {
  const paths: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Default\\AppData\\Local';

    paths.push(
      `${localAppData}\\FoundryMCPServer\\ComfyUI-headless`,
      `${localAppData}\\ComfyUI`,
      'C:\\ComfyUI',
      `${home}\\ComfyUI`
    );
  } else {
    // Linux paths
    paths.push(
      `${home}/.local/share/FoundryMCPServer/ComfyUI-headless`,
      `${home}/ComfyUI`,
      '/opt/ComfyUI',
      '/usr/local/ComfyUI'
    );
  }

  return paths;
}

/**
 * Attempt to detect an existing ComfyUI installation
 * Returns the path if found, or null if not found
 */
export function detectComfyUIInstallation(): string | null {
  const commonPaths = getCommonComfyUIPaths();

  for (const dirPath of commonPaths) {
    if (isValidComfyUIPath(dirPath)) {
      return dirPath;
    }
  }

  return null;
}

/**
 * Get the ComfyUI Desktop download URL for Mac
 */
export function getComfyUIDesktopURL(): string {
  return 'https://www.comfy.org/download';
}

/**
 * Get Python command for running ComfyUI on the current platform
 * For headless installs, returns the path to the venv Python
 */
export function getDefaultPythonCommand(_installPath?: string): string {
  if (isWindows()) {
    // Windows: embedded Python in ComfyUI directory
    return 'python/python.exe';
  } else {
    // Linux: system Python
    return 'python3';
  }
}
