# DevFlow 1.0.0 release gate

## Automated checks completed

- Vite production build succeeds and uses relative asset paths suitable for Electron `file://` loading.
- Production output includes the app favicon and omits the public console test page.
- `npm audit` reported zero known vulnerabilities at release preparation time.
- Electron app and NSIS x64 metadata are configured in `package.json`.
- User data remains in the existing `%APPDATA%\browser-pro` directory after the product rename.
- A fresh Vite server ignored a probe file created under `release/`; no reload or EBUSY watcher output occurred.

## Verified security and branding controls

- Windows icon was generated from the existing DevFlow SVG logo with 16, 24, 32, 48, 64, 128, and 256 pixel entries.
- Bounded IPC payload and URL-policy tests pass. Packaged runtime checks confirmed the DevFlow preload is absent from a controlled website, malformed IPC is rejected, website `file:` navigation is blocked, and the app window remains on its local document.
- Packaged runtime checks confirmed cookies are isolated from normal tabs and cleared when the final private tab closes. Private download metadata is handled in memory and excluded from persistent history.

## Remaining limitations

- Private download permission and file-save flows were not exercised in the packaged runtime.
- The installer was not installed on a clean Windows machine. Shortcuts, uninstall/reinstall, and the full browser feature matrix remain unverified.
- No publisher identity or signing certificate was supplied. Windows may show an unknown-publisher SmartScreen warning.
- During the first smoke-test attempt, the temporary `APPDATA` override was ineffective and the packaged app restored tabs from the existing `%APPDATA%\browser-pro` profile. The process was force-stopped before manual interaction, but its session autosave may have refreshed `lastSession`. Later runtime tests used `release/smoke-userdata`; the existing profile was not inspected or restored.

## Release artifact status

- Production renderer build: available in `dist/`.
- A local installer from the previous packaging pass exists at `release/DevFlow-Setup-x64.exe`; its filename does not match the versioned release naming requirement.
- Packaging is now configured to emit `DevFlow-Setup-${version}-${arch}.exe` (for 1.0.0 x64: `DevFlow-Setup-1.0.0-x64.exe`). This preparation pass did not generate or replace an installer.
- Version, release notes, installation README, and SHA-256: included in `release/`.
