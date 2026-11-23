# DevFlow

Developer-Focused Desktop Browser built with Electron, React, and Vite.

## Development

```powershell
npm install
npm start
```

## Production build

```powershell
npm run build
```

The Vite output is written to `dist/` with relative asset paths for Electron's `file://` production window. `public/console-test.html` is intentionally excluded from production output.

Run the bounded IPC and URL policy tests with `npm run test:security`. After packaging creates `release/win-unpacked/DevFlow.exe`, `npm run test:packaged` runs production smoke checks against a controlled local page and a temporary user-data folder.

## Windows installer

The project uses electron-builder and is configured for a Windows x64 NSIS installer:

```powershell
npm run dist:win
```

The installer configuration expects the approved DevFlow Windows icon at `build/devflow.ico`. The installer cannot be generated until that icon is supplied and the security release gate is cleared. No code-signing certificate is configured.

## User data

Settings, bookmarks, history, API collections, downloads metadata, and encrypted API credentials are stored under Electron `userData`. The packaged application keeps the existing `browser-pro` user-data folder to preserve settings created by earlier builds. Downloads are saved to the selected folder or the operating-system Downloads folder.

See [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md) for the release verification steps.
Current release blockers are tracked in [RELEASE_GATE.md](RELEASE_GATE.md).
