# Blink Desktop

A desktop application for building and running Blink agents with a graphical user interface.

## Prerequisites

- [Bun](https://bun.sh/) (JavaScript runtime and package manager)
- macOS, Windows, or Linux

## Building from Source

### 1. Install Dependencies

From the repository root:

```bash
bun install
```

### 2. Build Required Packages

Build the dependencies in order:

```bash
# Build compute protocol
cd packages/compute-protocol
bun run build

# Build compute SDK
cd ../compute
bun run build

# Build core Blink SDK
cd ../../blink
bun run build
```

### 3. Build Desktop App

```bash
cd ../desktop
bun run build
```

## Running the App

### Development Mode

Run with hot-reload during development:

```bash
bun run dev
```

This starts the app with file watchers that automatically rebuild when you make changes.

### Production Mode (from dist)

Run the built app directly:

```bash
bun run start
```

### Package and Run

Create a packaged `.app` bundle (macOS) or equivalent for your platform:

```bash
# Build and package
bun run package

# Launch the packaged app
bun run start:packaged
```

The packaged app will be in `release/mac-arm64/Blink Desktop.app` (or equivalent for your platform).

## Available Scripts

- `bun run dev` - Start development mode with hot-reload
- `bun run build` - Build all assets for production
- `bun run start` - Run the app from dist/ folder
- `bun run package` - Build and package the app (creates .app bundle)
- `bun run start:packaged` - Launch the packaged app
- `bun run dist` - Build and package with installer (DMG for macOS)

## Project Structure

```
packages/desktop/
├── src/
│   ├── main.ts           # Electron main process
│   ├── app.tsx           # Main app renderer
│   ├── agent.tsx         # Agent management
│   ├── file-viewer.tsx   # File viewer window
│   └── components/       # React components
├── assets/               # App icons and resources
├── dist/                 # Built output (gitignored)
└── release/              # Packaged app (gitignored)
```

## Features

- **Blink Desktop Branding** - Custom app name and icon
- **Agent Management** - Create and run Blink agents
- **Source Browser** - View and edit agent files
- **File Viewer** - Syntax-highlighted file viewing with search
- **Mode Switching** - Toggle between Edit and Run modes
- **Settings** - Configure app preferences

## Troubleshooting

### "Cannot find module" errors

Make sure you've built all dependencies in the correct order (see step 2 above).

### App won't start in development mode

Try rebuilding:

```bash
bun run build
bun run dev
```

### Packaged app issues

Clean and rebuild:

```bash
rm -rf dist/ release/
bun run package
```

## License

See the repository root LICENSE file.
