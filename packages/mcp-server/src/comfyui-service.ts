/**
 * ComfyUI service lifecycle — extracted verbatim from backend.ts.
 *
 * Owns the headless ComfyUI process used by the map-generation pipeline: locating
 * the bundled install + Python, spawning the server on 127.0.0.1:31411, polling it
 * to ready, stopping it, and reporting status. Pulling it out of backend.ts turns
 * the previously module-global `comfyuiProcess`/`comfyuiStatus` into encapsulated
 * instance state and makes the lifecycle unit-testable (backend.ts itself runs a
 * process lock + server bootstrap at import time and can't be loaded in a test).
 *
 * Return shapes (`{ status, message, pid? }`) are the live control-channel contract
 * for the `start/stop/check-comfyui` tools and are unchanged.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

import { Logger } from './logger.js';

export type ComfyUIStatus = 'stopped' | 'starting' | 'running' | 'error';

export class ComfyUIService {
  private process: ChildProcess | null = null;
  private status: ComfyUIStatus = 'stopped';

  constructor(private readonly logger: Logger) {}

  async start(): Promise<any> {
    if (this.status === 'running') {
      return { status: 'already_running', message: 'ComfyUI service is already running' };
    }

    if (this.status === 'starting') {
      return { status: 'starting', message: 'ComfyUI service start already in progress' };
    }

    try {
      this.status = 'starting';

      this.logger.info('Starting ComfyUI service...');

      // Find ComfyUI installation
      const comfyUIPath = await this.findComfyUIPath();

      this.logger.info('ComfyUI found', { path: comfyUIPath });

      // Spawn ComfyUI process
      this.logger.info('Starting ComfyUI process', { path: path.join(comfyUIPath, 'main.py') });

      // Use bundled Python virtual environment
      const pythonExe = this.getBundledPythonPath();
      this.logger.info('Using bundled Python', { pythonPath: pythonExe });

      this.process = spawn(
        pythonExe,
        [
          'main.py',
          '--port',
          '31411',
          '--listen',
          '127.0.0.1',
          '--disable-auto-launch',
          '--dont-print-server',
        ],
        {
          cwd: comfyUIPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true, // Prevent Python console window on Windows
        }
      );

      // Handle process events
      this.process.on('spawn', () => {
        this.logger.info('ComfyUI process spawned successfully');
      });

      this.process.on('error', error => {
        this.logger.error('ComfyUI process error', { error: error.message });
        this.status = 'error';
      });

      this.process.on('exit', (code, signal) => {
        this.logger.info('ComfyUI process exited', { code, signal });
        this.status = 'stopped';
        this.process = null;
      });

      // Capture stdout/stderr for debugging
      this.process.stdout?.on('data', data => {
        this.logger.debug('ComfyUI stdout', { data: data.toString().trim() });
      });

      this.process.stderr?.on('data', data => {
        this.logger.debug('ComfyUI stderr', { data: data.toString().trim() });
      });

      // Wait for ComfyUI API to be ready
      await this.waitForReady();

      // Snapshot the handle: the 'exit' listener nulls this.process if the
      // process dies between becoming ready and here, which would otherwise make
      // `this.process.pid` throw and mis-report a brief success as a failure.
      const proc = this.process;
      if (!proc) {
        throw new Error('ComfyUI process exited before it became ready');
      }

      this.status = 'running';

      this.logger.info('ComfyUI service started successfully', {
        pid: proc.pid,
        status: this.status,
      });

      return {
        status: 'running',
        message: 'ComfyUI service started successfully',
        pid: proc.pid,
      };
    } catch (error: any) {
      this.logger.error('ComfyUI service start failed', { error: error.message });

      this.status = 'error';

      if (this.process) {
        // Drop the 'exit' listener first so the kill below can't fire it and
        // overwrite status back to 'stopped', contradicting the 'error' we return.
        this.process.removeAllListeners();
        this.process.kill();
        this.process = null;
      }

      return {
        status: 'error',
        message: `Failed to start ComfyUI service: ${error.message}`,
      };
    }
  }

  async stop(): Promise<any> {
    if (this.status === 'stopped') {
      return { status: 'already_stopped', message: 'ComfyUI service is already stopped' };
    }

    try {
      this.logger.info('Stopping ComfyUI service...');

      if (this.process) {
        this.process.kill('SIGTERM');

        // Wait for graceful shutdown, then force kill if needed
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }

      this.status = 'stopped';
      this.process = null;

      this.logger.info('ComfyUI service stopped successfully');

      return { status: 'stopped', message: 'ComfyUI service stopped successfully' };
    } catch (error: any) {
      this.logger.error('ComfyUI service stop failed', { error: error.message });

      return { status: 'error', message: `Failed to stop ComfyUI service: ${error.message}` };
    }
  }

  async checkStatus(): Promise<any> {
    // Always check if ComfyUI is actually responsive on port 31411
    // This handles both spawned processes and externally-started instances
    try {
      const response = await fetch('http://127.0.0.1:31411/system_stats', {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        this.status = 'running';
      } else {
        this.status = 'error';
      }
    } catch (error) {
      // ComfyUI is not responsive on port 31411
      this.status = 'stopped';
    }

    return {
      status: this.status,
      message: this.statusMessage(this.status),
      pid: this.process?.pid || null,
    };
  }

  private statusMessage(status: ComfyUIStatus): string {
    const statusMessages = {
      stopped: 'ComfyUI service is not running',
      starting: 'ComfyUI service is starting...',
      running: 'ComfyUI service is running',
      error: 'ComfyUI service encountered an error',
    };

    return statusMessages[status];
  }

  private getBundledPythonPath(): string {
    // Detect installation directory based on current executable location
    let installDir = path.join(os.homedir(), 'AppData', 'Local', 'FoundryMCPServer');

    // Try to detect install directory from current process location
    const currentDir = process.cwd();
    const execDir = path.dirname(process.execPath);

    // Check if we're running from an installed location
    if (currentDir.includes('FoundryMCPServer') || execDir.includes('FoundryMCPServer')) {
      // Extract the installation directory
      const foundryMcpIndex = currentDir.indexOf('FoundryMCPServer');
      if (foundryMcpIndex !== -1) {
        installDir = currentDir.substring(0, foundryMcpIndex + 'FoundryMCPServer'.length);
      } else {
        const foundryMcpExecIndex = execDir.indexOf('FoundryMCPServer');
        if (foundryMcpExecIndex !== -1) {
          installDir = execDir.substring(0, foundryMcpExecIndex + 'FoundryMCPServer'.length);
        }
      }
    }

    // Check for nested ComfyUI installation (current actual structure)
    const nestedComfyUIPythonPath = path.join(
      installDir,
      'ComfyUI',
      'ComfyUI',
      'python_embeded',
      'python.exe'
    );
    if (fs.existsSync(nestedComfyUIPythonPath)) {
      return nestedComfyUIPythonPath;
    }

    // Check for flat ComfyUI portable installation (fallback)
    const portablePythonPath = path.join(installDir, 'ComfyUI', 'python_embeded', 'python.exe');
    if (fs.existsSync(portablePythonPath)) {
      return portablePythonPath;
    }

    // Path to bundled Python virtual environment (legacy)
    const bundledPythonPath = path.join(installDir, 'ComfyUI-env', 'Scripts', 'python.exe');

    // Check if bundled Python exists
    if (fs.existsSync(bundledPythonPath)) {
      return bundledPythonPath;
    }

    // Fallback: try alternative installation paths
    const fallbackPaths = [
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'FoundryMCPServer',
        'ComfyUI',
        'ComfyUI',
        'python_embeded',
        'python.exe'
      ),
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'FoundryMCPServer',
        'ComfyUI-headless',
        'ComfyUI',
        'python_embeded',
        'python.exe'
      ),
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'FoundryMCPServer',
        'ComfyUI',
        'python_embeded',
        'python.exe'
      ),
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'FoundryMCPServer',
        'ComfyUI-headless',
        'python_embeded',
        'python.exe'
      ),
      path.join(
        os.homedir(),
        'AppData',
        'Local',
        'FoundryMCPServer',
        'ComfyUI-env',
        'Scripts',
        'python.exe'
      ),
      path.join(process.cwd(), '..', '..', 'ComfyUI-env', 'Scripts', 'python.exe'),
      path.join(__dirname, '..', '..', '..', 'ComfyUI-env', 'Scripts', 'python.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'FoundryMCPServer', 'Python', 'python.exe'),
    ];

    for (const fallbackPath of fallbackPaths) {
      if (fs.existsSync(fallbackPath)) {
        return fallbackPath;
      }
    }

    // Final fallback to system Python (should not happen with bundled installer)
    console.error('Bundled Python not found, falling back to system Python');
    return 'python';
  }

  private async findComfyUIPath(): Promise<string> {
    // Check for nested ComfyUI installation (current actual structure)
    const nestedComfyUIPath = path.join(
      os.homedir(),
      'AppData',
      'Local',
      'FoundryMCPServer',
      'ComfyUI',
      'ComfyUI'
    );

    if (fs.existsSync(path.join(nestedComfyUIPath, 'main.py'))) {
      return nestedComfyUIPath;
    }

    // Check for legacy nested ComfyUI-headless installation (fallback)
    const nestedHeadlessPath = path.join(
      os.homedir(),
      'AppData',
      'Local',
      'FoundryMCPServer',
      'ComfyUI-headless',
      'ComfyUI'
    );

    if (fs.existsSync(path.join(nestedHeadlessPath, 'main.py'))) {
      return nestedHeadlessPath;
    }

    // Check for flat ComfyUI installation (unlikely but possible)
    const flatPath = path.join(os.homedir(), 'AppData', 'Local', 'FoundryMCPServer', 'ComfyUI');

    if (fs.existsSync(path.join(flatPath, 'main.py'))) {
      return flatPath;
    }

    // Check for legacy flat ComfyUI-headless installation (fallback)
    const legacyFlatPath = path.join(
      os.homedir(),
      'AppData',
      'Local',
      'FoundryMCPServer',
      'ComfyUI-headless'
    );

    if (fs.existsSync(path.join(legacyFlatPath, 'main.py'))) {
      return legacyFlatPath;
    }

    throw new Error('ComfyUI installation not found');
  }

  private async waitForReady(timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch('http://127.0.0.1:31411/system_stats', {
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return; // ComfyUI is ready
        }
      } catch (error) {
        // Still starting up, continue polling
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('ComfyUI failed to start within timeout');
  }
}
