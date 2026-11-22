
import { useEffect, useState } from "react";
import "./BrowserSettings.css";
import { showToast } from "./toast";

function BrowserSettings({ onSearchEngineChange, onThemeChange }) {
  const [settings, setSettings] = useState({
    searchEngine: "google",
    homepage: "https://www.google.com",
    startupBehavior: "homepage",
    theme: "dark",
    downloadLocation: "",
    openPopupsInNewTabs: true,
    downloadNotifications: true
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [clearRange, setClearRange] = useState("all");
  const [clearTypes, setClearTypes] = useState({ history: true, downloads: true, cookies: true, cache: true, permissions: true, siteData: true });
  const [message, setMessage] = useState("");

  useEffect(() => {
    window.browserAPI.getSettings()
      .then((data) => {
        if (data) {
          setSettings((previous) => ({ ...previous, ...data }));
        }
      })
      .catch((error) => {
        console.error("Settings load error:", error);
        setMessage("Could not load settings.");
      })
      .finally(() => setLoading(false));
  }, []);

  const updateField = (key, value) => {
    setSettings((previous) => ({
      ...previous,
      [key]: value
    }));
    if (key === "theme") onThemeChange?.(value);
    setMessage("");
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage("");

    try {
      const result = await window.browserAPI.updateSettings(settings);

      if (result?.success) {
        setSettings(result.settings);
        try { localStorage.setItem("devflow-theme", result.settings?.theme || "dark"); } catch { /* Theme is still persisted in the JSON settings file. */ }
        onThemeChange?.(result.settings?.theme || "dark");
        onSearchEngineChange?.(result.settings?.searchEngine || "google");
        setMessage("Settings saved successfully!");
        showToast("Settings saved", "success");
      } else {
        setMessage(result?.error || "Could not save settings.");
        showToast(result?.error || "Could not save settings", "error");
        const persisted = await window.browserAPI.getSettings().catch(() => null);
        if (persisted?.theme) {
          setSettings(previous => ({ ...previous, theme: persisted.theme }));
          onThemeChange?.(persisted.theme);
        }
      }
    } catch (error) {
      console.error("Settings save error:", error);
      setMessage("Something went wrong while saving.");
      showToast("Settings could not be saved", "error");
      const persisted = await window.browserAPI.getSettings().catch(() => null);
      if (persisted?.theme) {
        setSettings(previous => ({ ...previous, theme: persisted.theme }));
        onThemeChange?.(persisted.theme);
      }
    } finally {
      setSaving(false);
    }
  };

  const clearBrowsingData = async () => {
    const selected = Object.entries(clearTypes).filter(([, enabled]) => enabled).map(([key]) => key);
    if (!selected.length) { setMessage("Choose at least one type of data to clear."); return; }
    const labels = { history: "browsing history", downloads: "download history", cookies: "cookies", cache: "cached files", permissions: "website permissions", siteData: "saved website data" };
    const summary = selected.map(key => labels[key]).join(", ");
    if (!window.confirm(`Clear ${summary}? Bookmarks and saved API collections will not be changed. Private-session data is cleared when the last private tab closes.`)) return;
    setClearingData(true); setMessage("");
    try {
      const result = await window.browserAPI.clearBrowsingData({ range: clearRange, types: clearTypes });
      if (!result?.success) throw new Error(result?.error || "Could not clear browsing data.");
      const info = result.limitations ? ` ${result.limitations}` : "";
      setMessage(`Selected browsing data was cleared.${info}`);
      showToast("Browsing data cleared", "success");
    } catch (error) {
      setMessage(error.message || "Could not clear browsing data.");
      showToast(error.message || "Could not clear browsing data", "error");
    } finally { setClearingData(false); }
  };

  if (loading) {
    return <div className="settings-panel">Loading settings...</div>;
  }

  return (
    <div className="settings-panel">
      <div className="settings-heading">
        <h2>Browser Settings</h2>
        <p>Customize your DevFlow browser experience.</p>
      </div>

      <section className="settings-section">
        <h3>General</h3>
        <p>Choose how DevFlow opens and restores browser sessions.</p>
      </section>

      <section className="settings-section keyboard-shortcuts-settings">
        <h3>Keyboard Shortcuts</h3>
        <div className="keyboard-shortcut-list">
          {[ ["Ctrl + T", "New tab"], ["Ctrl + W", "Close current tab"], ["Ctrl + Shift + T", "Reopen closed tab"], ["Ctrl + L", "Focus address bar"], ["Ctrl + R", "Reload"], ["Ctrl + Shift + R", "Hard reload"], ["Ctrl + F", "Find in page"], ["Ctrl + H", "History"], ["Ctrl + J", "Downloads"], ["Ctrl + D", "Bookmark page"], ["Ctrl + Tab", "Next tab"], ["Ctrl + Shift + Tab", "Previous tab"], ["Ctrl + 1–8", "Switch to tab"], ["Ctrl + 9", "Last tab"], ["Alt + ← / →", "Back / forward"] ].map(([keys, action]) => <div key={keys}><kbd>{keys}</kbd><span>{action}</span></div>)}
        </div>
      </section>

      <section className="settings-section">
        <h3>Homepage</h3>
        <div className="setting-item"><label htmlFor="homepage-setting">Homepage URL</label><input id="homepage-setting" value={settings.homepage} onChange={(e) => updateField("homepage", e.target.value)} placeholder="https://www.google.com" /></div>
      </section>

      <section className="settings-section">
        <h3>Startup</h3>
        <div className="setting-item"><label htmlFor="startup-setting">When DevFlow starts</label><select id="startup-setting" value={settings.startupBehavior} onChange={(e) => updateField("startupBehavior", e.target.value)}><option value="homepage">Open Homepage</option><option value="newtab">Open New Tab</option><option value="continue">Continue Previous Session</option></select></div>
      </section>

      <section className="settings-section">
        <h3>Appearance</h3>

        <div className="setting-item">
          <label>Browser Theme</label>
          <select
            value={settings.theme}
            onChange={(e) => updateField("theme", e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>Search</h3>
        <div className="setting-item">
          <label htmlFor="search-engine-setting">Default Search Engine</label>
          <select id="search-engine-setting" value={settings.searchEngine} onChange={(e) => updateField("searchEngine", e.target.value)}>
            <option value="google">Google</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>Downloads</h3>

        <div className="setting-item">
          <label>Download Location</label>
          <input
            value={settings.downloadLocation}
            onChange={(e) => updateField("downloadLocation", e.target.value)}
            placeholder="Default Downloads folder"
          />
          <small>Folder selection will be added in the next step.</small>
        </div>
        <div className="setting-item setting-checkbox">
          <label><input type="checkbox" checked={settings.downloadNotifications !== false} onChange={e => updateField("downloadNotifications", e.target.checked)} /> Show download completion notifications</label>
        </div>
      </section>

      <section className="settings-section">
        <h3>Popups</h3>
        <div className="setting-item setting-checkbox">
          <label><input type="checkbox" checked={settings.openPopupsInNewTabs !== false} onChange={e => updateField("openPopupsInNewTabs", e.target.checked)} /> Open allowed popups in a new tab</label>
          <small>Turn this off to block popup windows opened by websites.</small>
        </div>
      </section>

      <section className="settings-section clear-data-settings">
        <h3>Clear Browsing Data</h3>
        <p>Select the data to remove. Bookmarks and saved API collections are never included.</p>
        <div className="setting-item"><label htmlFor="clear-data-range">Time range</label><select id="clear-data-range" value={clearRange} onChange={event => setClearRange(event.target.value)}><option value="hour">Last hour</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="4weeks">Last 4 weeks</option><option value="all">All time</option></select></div>
        <div className="clear-data-types">{[["history", "Browsing history"], ["downloads", "Download history"], ["cookies", "Cookies"], ["cache", "Cached images and files"], ["permissions", "Website permissions"], ["siteData", "Saved website data"]].map(([key, label]) => <label key={key}><input type="checkbox" checked={clearTypes[key]} onChange={event => setClearTypes(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</div>
        <p className="clear-data-note">Time ranges apply to history records. Cookies, cache, permissions, and saved site data are cleared for all time. Private-session data is managed separately and clears when its last private tab closes.</p>
        <button className="clear-data-button" onClick={clearBrowsingData} disabled={clearingData}>{clearingData ? "Clearing…" : "Clear selected data"}</button>
      </section>

      <div className="settings-footer">
        <button onClick={saveSettings} disabled={saving}>
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {message && <span>{message}</span>}
      </div>
    </div>
  );
}

export default BrowserSettings;
