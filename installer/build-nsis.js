#!/usr/bin/env node

/**
 * Build the Foundry AI Tool client installer (NSIS) for a GM's Windows PC.
 *
 * The installer holds only what Claude Desktop needs: a portable Node.js (node.exe) and the bundled
 * MCP client (packages/mcp-server/dist/index.bundle.cjs). The bridge, Foundry and the Foundry
 * module run on another machine, so none of them ships here.
 *
 * Steps:
 * - downloads the portable Node.js runtime and keeps node.exe
 * - stages the bundled MCP client
 * - stages the installer scripts
 * - runs makensis
 *
 * Needs `npm run build:shared && npm run bundle:server` first.
 * Flags: --version vX.Y.Z, --skip-download (no Node), --skip-nsis (stage only).
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const packageJson = require('../package.json');
let version = `v${packageJson.version}`; // default version from package.json
let skipDownload = false;
let skipNsis = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version' && i + 1 < args.length) {
    version = args[i + 1];
    i++;
    continue;
  }
  if (args[i] === '--skip-download') {
    skipDownload = true;
    continue;
  }
  if (args[i] === '--skip-nsis') {
    skipNsis = true;
    continue;
  }
}

console.log('Building the Foundry AI Tool client installer (NSIS)\n');
console.log(`Version: ${version}\n`);

// Configuration
const rootDir = path.join(__dirname, '..');
const config = {
  // Node 22 LTS ("Jod"). The SHA-256 is the line for this zip in
  // https://nodejs.org/dist/v22.23.3/SHASUMS256.txt; the build fails if the download differs.
  // To bump: change the three Node lines and the hash together.
  nodeVersion: 'v22.23.3',
  nodeArchive: 'node-v22.23.3-win-x64.zip',
  nodeUrl: 'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip',
  nodeSha256: '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71',
  buildDir: path.join(__dirname, 'build'),
  nsisDir: path.join(__dirname, 'nsis'),
  outputDir: path.join(__dirname, 'build', 'installer-files'),
  tempDir: path.join(__dirname, 'build', 'temp'),
};

// Files copied from installer/nsis into the staging folder
const installerFiles = ['LICENSE.txt', 'README.txt', 'icon.ico', 'configure-claude.ps1'];

// Helper functions
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function downloadAndExtractNode() {
  console.log('Preparing Node.js runtime...');

  const nodeZipPath = path.join(config.tempDir, config.nodeArchive);
  const nodeExtractPath = path.join(config.tempDir, 'node-extracted');

  if (fs.existsSync(nodeZipPath)) {
    console.log('   Node.js archive already exists, skipping download');
  } else {
    console.log(`   Downloading: ${config.nodeUrl}`);
    try {
      execSync(
        `powershell -Command "Invoke-WebRequest -Uri '${config.nodeUrl}' -OutFile '${nodeZipPath}'"`,
        { stdio: 'inherit' }
      );
      console.log('   Node.js download completed');
    } catch (error) {
      console.error('   Failed to download Node.js:', error.message);
      process.exit(1);
    }
  }

  // Verify the archive (fresh download or cached) against the pinned hash before it is unpacked.
  const actualSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(nodeZipPath))
    .digest('hex');
  if (actualSha256 !== config.nodeSha256) {
    console.error(`   Node.js archive checksum mismatch for ${config.nodeArchive}`);
    console.error(`   expected ${config.nodeSha256}`);
    console.error(`   actual   ${actualSha256}`);
    console.error('   Delete the file in installer/build/temp and try again, or update the pin.');
    process.exit(1);
  }
  console.log('   Node.js archive checksum OK (SHA-256)');

  console.log('   Extracting Node.js...');
  ensureDir(nodeExtractPath);

  try {
    execSync(
      `powershell -Command "Expand-Archive -Path '${nodeZipPath}' -DestinationPath '${nodeExtractPath}' -Force"`,
      { stdio: 'inherit' }
    );

    const nodeDir = fs
      .readdirSync(nodeExtractPath)
      .find(item => item.startsWith('node-') && item.includes('win-x64'));
    if (!nodeDir) {
      throw new Error('Node.js directory not found after extraction');
    }

    // The client only needs node.exe (not npm), plus Node's licence text
    const sourceNodePath = path.join(nodeExtractPath, nodeDir);
    fs.copyFileSync(path.join(sourceNodePath, 'node.exe'), path.join(config.outputDir, 'node.exe'));
    const licence = path.join(sourceNodePath, 'LICENSE');
    if (fs.existsSync(licence)) {
      fs.copyFileSync(licence, path.join(config.outputDir, 'node-LICENSE.txt'));
    }

    console.log('   Node.js runtime prepared (node.exe)');
  } catch (error) {
    console.error('   Failed to extract Node.js:', error.message);
    process.exit(1);
  }
}

function copyMcpClient() {
  console.log('Preparing the MCP client...');

  const bundlePath = path.join(rootDir, 'packages', 'mcp-server', 'dist', 'index.bundle.cjs');
  if (!fs.existsSync(bundlePath)) {
    console.error(
      '   MCP client bundle not found. Run "npm run build:shared && npm run bundle:server" first.'
    );
    process.exit(1);
  }

  // One self-contained file: no node_modules and no backend are needed, because the client only
  // connects to a bridge that runs elsewhere (MCP_NO_SPAWN=1).
  const clientDir = path.join(config.outputDir, 'foundry-mcp-client');
  ensureDir(clientDir);
  fs.copyFileSync(bundlePath, path.join(clientDir, 'index.cjs'));

  console.log('   MCP client prepared');
}

function copyInstallerFiles() {
  console.log('Copying installer files...');

  for (const name of installerFiles) {
    const source = path.join(config.nsisDir, name);
    if (!fs.existsSync(source)) {
      throw new Error(`Required file missing from installer/nsis: ${name}`);
    }
    fs.copyFileSync(source, path.join(config.outputDir, name));
  }

  console.log('   Installer files prepared');
}

function updateNSISVersion(sourcePath, destPath, version) {
  let content = fs.readFileSync(sourcePath, 'utf8');

  // Convert version format (remove 'v' prefix if present)
  const cleanVersion = version.startsWith('v') ? version.slice(1) : version;
  const versionParts = cleanVersion.split('.');

  // Ensure we have 4 parts for Windows version (e.g., "0.4.9.0")
  while (versionParts.length < 4) {
    versionParts.push('0');
  }
  const windowsVersion = versionParts.join('.');

  // Update VIProductVersion (needs 4-part version)
  content = content.replace(/VIProductVersion\s+"[\d.]+"/, `VIProductVersion "${windowsVersion}"`);

  // Update VIAddVersionKey "FileVersion" (needs 4-part version)
  content = content.replace(
    /VIAddVersionKey\s+"FileVersion"\s+"[\d.]+"/,
    `VIAddVersionKey "FileVersion" "${windowsVersion}"`
  );

  // Update DisplayVersion in the registry entry (3-part version is fine)
  content = content.replace(/("DisplayVersion"\s+")[^"]+(")/, `$1${cleanVersion}$2`);

  fs.writeFileSync(destPath, content);
}

function buildInstaller() {
  console.log('Building NSIS installer...');

  try {
    execSync('makensis /VERSION', { stdio: 'pipe' });
    console.log('   NSIS found');
  } catch (error) {
    console.error('   NSIS not found. Please install NSIS from https://nsis.sourceforge.io/');
    console.error(
      '   After installation, add NSIS to your PATH or run this script from NSIS directory.'
    );
    return false;
  }

  try {
    const nsisScript = path.join(config.nsisDir, 'foundry-mcp-server.nsi');
    const outputPath = path.join(config.buildDir, `FoundryMCPServer-Setup-${version}.exe`);

    // Copy the NSIS script next to the staged files and update its version numbers
    const nsisScriptLocal = path.join(config.outputDir, 'foundry-mcp-server.nsi');
    updateNSISVersion(nsisScript, nsisScriptLocal, version);

    // makensis resolves File paths from the working directory
    const originalCwd = process.cwd();
    process.chdir(config.outputDir);
    try {
      execSync(
        `makensis /V2 /DVERSION=${version} /DOUTFILE="${outputPath}" "foundry-mcp-server.nsi"`,
        { stdio: 'inherit' }
      );
    } finally {
      process.chdir(originalCwd);
    }

    if (!fs.existsSync(outputPath)) {
      console.error(`   Installer not found at ${outputPath}`);
      return false;
    }

    const stats = fs.statSync(outputPath);
    console.log(`   Installer created: ${outputPath}`);
    console.log(`   Installer size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB`);
    return true;
  } catch (error) {
    console.error('   Failed to build installer:', error.message);
    return false;
  }
}

// Main build process
async function build() {
  try {
    console.log('Preparing build environment...');

    if (fs.existsSync(config.buildDir)) {
      console.log('   Cleaning existing build directory...');
      fs.rmSync(config.buildDir, { recursive: true, force: true });
    }

    ensureDir(config.buildDir);
    ensureDir(config.outputDir);
    ensureDir(config.tempDir);

    console.log('   Build environment ready\n');

    if (!skipDownload) {
      downloadAndExtractNode();
      console.log();
    } else {
      console.log('   Skipping Node.js runtime download (staging-only)\n');
    }

    copyMcpClient();
    console.log();

    copyInstallerFiles();
    console.log();

    const success = skipNsis
      ? (console.log('   Skipping NSIS compilation (staging-only)'), true)
      : buildInstaller();
    console.log();

    if (success) {
      console.log('Build completed successfully.');
      console.log(`Installer: FoundryMCPServer-Setup-${version}.exe`);
    } else {
      console.log('Build completed but installer creation failed.');
      console.log('   Files are prepared in: ' + config.outputDir);
      console.log('   Run NSIS manually to create installer.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Build failed:', error.message);
    process.exit(1);
  }
}

// Run the build
build();
