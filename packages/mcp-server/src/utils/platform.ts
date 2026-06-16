/**
 * Cross-platform utilities for detecting OS and providing platform-specific paths
 */

type Platform = 'win32' | 'linux';

function getPlatform(): Platform {
  return process.platform as Platform;
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Get the default application data directory for this MCP server
 */
export function getAppDataDir(): string {
  const platform = getPlatform();

  switch (platform) {
    case 'win32':
      return process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\FoundryMCPServer`
        : 'C:\\Users\\Default\\AppData\\Local\\FoundryMCPServer';

    case 'linux':
      return `${process.env.HOME}/.local/share/FoundryMCPServer`;

    default:
      throw new Error(`Unsupported platform: ${platform as string}`);
  }
}

/**
 * Get the default ComfyUI installation directory for the current platform
 */
export function getDefaultComfyUIDir(): string {
  const appDataDir = getAppDataDir();

  // Windows and Linux use the same relative path structure
  return `${appDataDir}/ComfyUI-headless`;
}

/**
 * Get platform-specific spawn options for running a hidden background process
 */
export function getHiddenProcessSpawnOptions(): {
  detached: boolean;
  stdio: 'ignore' | Array<'ignore' | 'pipe'>;
  windowsHide?: boolean;
} {
  const platform = getPlatform();

  if (platform === 'win32') {
    return {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    };
  } else {
    // Linux: detached + ignore stdio to prevent terminal window
    return {
      detached: true,
      stdio: 'ignore',
    };
  }
}
