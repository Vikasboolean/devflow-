
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
    setMessage("");
  };

  const saveSettings = async () => {
    setSaving(true);
    setMessage("");

    try {
      const result = await window.browserAPI.updateSettings(settings);

      if (result?.success) {
        setSettings(result.settings);
        onThemeChange?.(result.settings?.theme || "dark");
        onSearchEngineChange?.(result.settings?.searchEngine || "google");
        setMessage("Settings saved successfully!");
        showToast("Settings saved", "success");
      } else {
        setMessage(result?.error || "Could not save settings.");
        showToast(result?.error || "Could not save settings", "error");
      }
    } catch (error) {
      console.error("Settings save error:", error);
      setMessage("Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
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

      <section className="settings-section">
        <h3>Homepage</h3>
        <div className="setting-item"><label htmlFor="homepage-setting">Homepage URL</label><input id="homepage-setting" value={settings.homepage} onChange={(e) => updateField("homepage", e.target.value)} placeholder="https://www.google.com" /></div>
      </section>

      <section className="settings-section">
        <h3>Startup</h3>
        <div className="setting-item"><label htmlFor="startup-setting">When DevFlow starts</label><select id="startup-setting" value={settings.startupBehavior} onChange={(e) => updateField("startupBehavior", e.target.value)}><option value="homepage">Open Homepage</option><option value="newtab">Open New Tab</option><option value="continue">Continue Previous Session</option></select></div>
      </section>

      <section className="settings-section">
        <h3>Search</h3>

        <div className="setting-item">
            <label htmlFor="search-engine-setting">Default Search Engine</label>
          <select
              id="search-engine-setting"
            value={settings.searchEngine}
            onChange={(e) => updateField("searchEngine", e.target.value)}
          >
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="duckduckgo">DuckDuckGo</option>
          </select>
        </div>
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
