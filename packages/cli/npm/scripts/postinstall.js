#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const zlib = require("zlib");

const REPO = "keywaysh/cli";
const BIN_DIR = path.join(__dirname, "..", "bin");
const BINARY_NAME = process.platform === "win32" ? "keyway.exe" : "keyway";

// Platform mapping
const PLATFORM_MAP = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

// Architecture mapping
const ARCH_MAP = {
  x64: "amd64",
  arm64: "arm64",
};

function getPlatform() {
  const platform = PLATFORM_MAP[process.platform];
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  return platform;
}

function getArch() {
  const arch = ARCH_MAP[process.arch];
  if (!arch) {
    throw new Error(`Unsupported architecture: ${process.arch}`);
  }
  return arch;
}

function getVersion() {
  const pkg = require("../package.json");
  return pkg.version;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "keyway-npm-installer" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return httpsGet(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function downloadAndExtract(url, destPath) {
  console.log(`Downloading ${url}`);
  const data = await httpsGet(url);

  // Create bin directory if it doesn't exist
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  if (url.endsWith(".tar.gz")) {
    // Extract tar.gz
    const tmpDir = path.join(__dirname, "..", "tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tarPath = path.join(tmpDir, "keyway.tar.gz");
    fs.writeFileSync(tarPath, data);

    // Use tar command to extract
    execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: "pipe" });

    // Find and move binary
    const extractedBinary = path.join(tmpDir, "keyway");
    if (fs.existsSync(extractedBinary)) {
      fs.copyFileSync(extractedBinary, destPath);
      fs.chmodSync(destPath, 0o755);
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else if (url.endsWith(".zip")) {
    // For Windows, use PowerShell to extract
    const tmpDir = path.join(__dirname, "..", "tmp");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const zipPath = path.join(tmpDir, "keyway.zip");
    fs.writeFileSync(zipPath, data);

    execSync(
      `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: "pipe" }
    );

    const extractedBinary = path.join(tmpDir, "keyway.exe");
    if (fs.existsSync(extractedBinary)) {
      fs.copyFileSync(extractedBinary, destPath);
    }

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const platform = getPlatform();
    const arch = getArch();
    const version = getVersion();

    // Skip download for version 0.0.0 (development)
    if (version === "0.0.0") {
      console.log("Development version detected, skipping binary download");
      // Create a placeholder script
      const placeholder = `#!/bin/sh
echo "Keyway CLI not installed. Run 'make build' in the cli directory."
exit 1
`;
      fs.writeFileSync(path.join(BIN_DIR, "keyway"), placeholder);
      fs.chmodSync(path.join(BIN_DIR, "keyway"), 0o755);
      return;
    }

    const ext = platform === "windows" ? "zip" : "tar.gz";
    const filename = `keyway_${version}_${platform}_${arch}.${ext}`;
    const url = `https://github.com/${REPO}/releases/download/v${version}/${filename}`;

    const destPath = path.join(BIN_DIR, BINARY_NAME);
    await downloadAndExtract(url, destPath);

    console.log(`Keyway CLI v${version} installed successfully!`);
  } catch (error) {
    console.error("Failed to install Keyway CLI:", error.message);
    console.error("You can install manually from: https://github.com/keywaysh/cli/releases");
    process.exit(1);
  }
}

main();
