# DevFlow security verification checklist

Run these checks against a disposable profile and controlled test pages. Record the app version, Electron version, platform, and result for each release.

## Renderer boundary and IPC

- [ ] From an external page, attempt `window.browserAPI` access; it must be absent.
- [ ] Invoke a privileged channel from a website frame or child frame; it must be rejected.
- [ ] Invoke a privileged channel from an unexpected app URL; it must be rejected.
- [ ] Send invalid types, oversized strings, and objects with unexpected fields to each IPC method; the handler must reject invalid input without changing state.

## Navigation and popups

- [ ] Navigate to valid HTTP and HTTPS pages, including HTTP-to-HTTPS and HTTPS-to-HTTP redirects.
- [ ] Attempt `javascript:`, `data:`, `file:`, malformed URLs, and custom protocols as top-level website navigation; each must be blocked.
- [ ] Exercise `target="_blank"`, `window.open`, redirecting popups, dangerous popup protocols, and repeated popup requests.
- [ ] Confirm app-window links and redirects cannot replace the DevFlow application document or create a child window.

## Permissions

- [ ] Exercise camera/media, microphone, geolocation, notifications, and clipboard permission requests from controlled origins.
- [ ] Unknown permissions must be denied.
- [ ] Confirm origin-specific allow/deny, revocation, private-session separation, and behavior after profile restart.

## Credentials and network tools

- [ ] Save and reload API authentication with safeStorage available; verify the JSON database contains ciphertext rather than plaintext.
- [ ] Verify storage fails safely when safeStorage is unavailable.
- [ ] Inspect application logs, Network Monitor previews, HAR exports, and API errors for bearer/basic/API-key credentials.
- [ ] Send bounded and oversized responses through the API Tester and verify timeout and response-size behavior.

## Downloads and persistence

- [ ] Try traversal filenames (`../outside`, `..`, absolute paths), filename collisions, interrupted downloads, and non-HTTP(S) downloads.
- [ ] Confirm open/reveal operations only target files inside the configured download directory.
- [ ] Test malformed JSON recovery, settings field validation, and interrupted writes using a disposable userData directory.

## Incognito, profiles, and app workflows

- [ ] Verify private cookies/storage are unavailable to normal tabs; private history and tabs do not survive restart.
- [ ] Close the final private tab and verify its session storage is cleared.
- [ ] Verify profile partitions are independent if named profiles are enabled.
- [ ] Smoke-test startup, navigation, tabs, API Tester, Network Monitor, Developer Console, Element Inspector, Responsive Design Mode, downloads, themes, and session restoration.

## Build and dependencies

- [ ] Run `npm audit`, `npm run lint`, `npm run build`, and `node --check electron/main.cjs` on the release environment.
- [ ] Review packaged artifacts to ensure development server settings and development-only tooling are not enabled in production.
