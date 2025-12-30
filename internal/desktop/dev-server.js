const { spawn } = require("child_process");
const { watch } = require("fs");
const { join } = require("path");

let electronProcess = null;
let isRestarting = false;

function startElectron() {
  if (electronProcess) {
    return;
  }

  console.log("🚀 Starting Electron...");
  electronProcess = spawn("electron", ["dist/main.js"], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });

  electronProcess.on("close", (code) => {
    if (!isRestarting) {
      console.log("Electron exited with code", code);
      process.exit(code);
    }
    electronProcess = null;
  });
}

function restartElectron() {
  if (isRestarting) {
    return;
  }

  isRestarting = true;
  console.log("🔄 Restarting Electron...");

  if (electronProcess) {
    electronProcess.kill();
    // Wait a bit for the process to exit
    setTimeout(() => {
      isRestarting = false;
      startElectron();
    }, 500);
  } else {
    isRestarting = false;
    startElectron();
  }
}

// Watch dist directory for changes
const distPath = join(__dirname, "dist");
console.log("👀 Watching for changes in dist/...");

watch(distPath, { recursive: true }, (eventType, filename) => {
  if (filename && filename.endsWith(".js")) {
    console.log(`📝 Detected change: ${filename}`);
    restartElectron();
  }
});

// Start initially
startElectron();

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  if (electronProcess) {
    electronProcess.kill();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (electronProcess) {
    electronProcess.kill();
  }
  process.exit(0);
});
