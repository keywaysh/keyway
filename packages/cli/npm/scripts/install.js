#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const os = require("os");
const crypto = require("crypto");

const VERSION = require("../package.json").version;
const REPO = "keywaysh/cli";
const BINARY_NAME = "keyway";

const PLATFORMS = {
  "darwin-arm64": "darwin_arm64",
  "darwin-x64": "darwin_amd64",
  "linux-arm64": "linux_arm64",
  "linux-x64": "linux_amd64",
  "win32-x64": "windows_amd64",
  "win32-arm64": "windows_arm64",
};

function getPlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function getBinaryPath() {
  const binDir = path.join(__dirname, "..", "bin");
  // Use keyway-bin to avoid conflict with the wrapper script
  const binaryName = process.platform === "win32" ? `${BINARY_NAME}-bin.exe` : `${BINARY_NAME}-bin`;
  return path.join(binDir, binaryName);
}

function fetch(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        fetch(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

async function downloadChecksum() {
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/checksums.txt`;
  try {
    const data = await fetch(url);
    return data.toString();
  } catch (error) {
    console.warn("Warning: Could not download checksums file");
    return null;
  }
}

function verifyChecksum(buffer, checksums, filename) {
  if (!checksums) return true;

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const expectedLine = checksums.split("\n").find((line) => line.includes(filename));

  if (!expectedLine) {
    console.warn(`Warning: No checksum found for ${filename}`);
    return true;
  }

  const expectedHash = expectedLine.split(/\s+/)[0];
  if (hash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${filename}\nExpected: ${expectedHash}\nGot: ${hash}`);
  }

  return true;
}

async function extractTarGz(buffer, destDir) {
  const tmpFile = path.join(os.tmpdir(), `keyway-${Date.now()}.tar.gz`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    execSync(`tar -xzf "${tmpFile}" -C "${destDir}"`, { stdio: "pipe" });
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function extractZip(buffer, destDir) {
  const tmpFile = path.join(os.tmpdir(), `keyway-${Date.now()}.zip`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    // Try powershell on Windows
    if (process.platform === "win32") {
      execSync(
        `powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${destDir}' -Force"`,
        { stdio: "pipe" }
      );
    } else {
      execSync(`unzip -o "${tmpFile}" -d "${destDir}"`, { stdio: "pipe" });
    }
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function install() {
  const platformKey = getPlatformKey();
  const target = PLATFORMS[platformKey];

  if (!target) {
    console.error(`\nUnsupported platform: ${platformKey}`);
    console.error(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`);
    console.error(`\nYou can install manually from: https://github.com/${REPO}/releases`);
    process.exit(1);
  }

  const binDir = path.join(__dirname, "..", "bin");
  const binaryPath = getBinaryPath();

  // Check if binary already exists and is correct version
  if (fs.existsSync(binaryPath)) {
    try {
      const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
      if (result.stdout && result.stdout.includes(VERSION)) {
        console.log(`keyway v${VERSION} already installed`);
        return;
      }
    } catch (e) {
      // Binary exists but couldn't run, reinstall
    }
  }

  const isWindows = process.platform === "win32";
  const ext = isWindows ? "zip" : "tar.gz";
  const filename = `${BINARY_NAME}_${VERSION}_${target}.${ext}`;
  const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${filename}`;

  console.log(`Downloading keyway v${VERSION} for ${target}...`);

  try {
    // Download checksums and binary in parallel
    const [checksums, archiveBuffer] = await Promise.all([downloadChecksum(), fetch(url)]);

    // Verify checksum
    verifyChecksum(archiveBuffer, checksums, filename);

    // Create bin directory
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    // Extract to temp dir first, then move binary
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "keyway-"));

    try {
      if (isWindows) {
        await extractZip(archiveBuffer, tmpDir);
      } else {
        await extractTarGz(archiveBuffer, tmpDir);
      }

      // Find and move the binary (archive contains 'keyway', we save as 'keyway-bin')
      const archiveBinaryName = isWindows ? `${BINARY_NAME}.exe` : BINARY_NAME;
      const extractedBinary = path.join(tmpDir, archiveBinaryName);

      if (!fs.existsSync(extractedBinary)) {
        throw new Error(`Binary not found in archive: ${archiveBinaryName}`);
      }

      // Remove old binary if exists
      if (fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
      }

      fs.copyFileSync(extractedBinary, binaryPath);

      // Make executable on Unix
      if (!isWindows) {
        fs.chmodSync(binaryPath, 0o755);
      }

      console.log(`Successfully installed keyway v${VERSION}`);
    } finally {
      // Cleanup temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(`\nFailed to install keyway: ${error.message}`);
    console.error(`\nYou can install manually from: https://github.com/${REPO}/releases`);
    console.error(`Or use: curl -fsSL https://keyway.sh/install.sh | sh`);
    process.exit(1);
  }
}

// Only run if called directly (not required as module)
if (require.main === module) {
  install();
}

module.exports = { install, getBinaryPath };
