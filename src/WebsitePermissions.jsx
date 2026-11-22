import { useEffect, useState } from "react";
import { showToast } from "./toast";

const permissionNames = [
  ["media", "Camera and microphone"],
  ["geolocation", "Location"],
  ["notifications", "Notifications"],
  ["clipboard-read", "Clipboard read"],
  ["clipboard-sanitized-write", "Clipboard write"],
  ["popups", "Popups / new tabs"],
  ["downloads", "File downloads"]
];

export default function WebsitePermissions() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await window.browserAPI.getWebsitePermissions();
      if (result?.success) setItems(result.permissions || []);
      else setError(result?.error || "Could not load website permissions.");
    } catch (err) { setError(err.message || "Could not load website permissions."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    refresh();
    return window.browserAPI.onWebsitePermissionsUpdated(updated => setItems(updated || []));
  }, []);

  const change = async (origin, permission, decision) => {
    setError("");
    const result = await window.browserAPI.setWebsitePermission({ origin, permission, decision });
    if (result?.success) { setItems(result.permissions || []); showToast("Website permission updated", "success"); }
    else { setError(result?.error || "Could not update permission."); showToast(result?.error || "Could not update permission", "error"); }
  };

  const resetOrigin = async origin => {
    if (!window.confirm(`Reset all saved permissions for ${origin}?`)) return;
    const result = await window.browserAPI.resetWebsitePermissions(origin);
    if (result?.success) { setItems(result.permissions || []); showToast("Site permissions reset", "success"); }
    else { setError(result?.error || "Could not reset site permissions."); showToast(result?.error || "Could not reset permissions", "error"); }
  };

  const origins = [...new Set(items.map(item => item.origin))];
  return <section className="site-permissions">
    <header><div><h2>Website Permissions</h2><p>Sites must ask before access is granted. Private session decisions are temporary.</p></div><button onClick={refresh} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button></header>
    {error && <p className="permission-error">{error}</p>}
    {!busy && !origins.length && <div className="permission-empty"><h3>No saved site permissions</h3><p>Permission requests from websites will appear here after you respond.</p></div>}
    {origins.map(origin => <article className="permission-origin" key={origin}><div className="permission-origin-heading"><h3>{origin}</h3><button onClick={() => resetOrigin(origin)}>Reset site permissions</button></div>{permissionNames.map(([permission, label]) => {
      const current = items.find(item => item.origin === origin && item.permission === permission)?.decision || "ask";
      return <label key={permission}><span>{label}</span><select aria-label={`${label} for ${origin}`} value={current} onChange={event => change(origin, permission, event.target.value)}><option value="ask">{permission === "popups" ? "Use browser setting" : "Ask each time"}</option><option value="granted">Allow</option><option value="denied">Deny</option></select></label>;
    })}</article>)}
  </section>;
}
