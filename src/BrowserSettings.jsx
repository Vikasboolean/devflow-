
import { useEffect, useState } from "react";
import "./BrowserSettings.css";

function BrowserSettings({ onSearchEngineChange, onThemeChange }) {
  const [settings, setSettings] = useState({
    searchEngine: "google",
    homepage: "https://www.google.com",
    startupBehavior: "homepage",
    theme: "dark",
    downloadLocation: ""
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
      } else {
        setMessage(result?.error || "Could not save settings.");
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

        <div className="setting-item">
          <label>Homepage URL</label>
          <input
            value={settings.homepage}
            onChange={(e) => updateField("homepage", e.target.value)}
            placeholder="https://www.google.com"
          />
        </div>

        <div className="setting-item">
          <label>Startup Behavior</label>
          <select
            value={settings.startupBehavior}
            onChange={(e) => updateField("startupBehavior", e.target.value)}
          >
            <option value="homepage">Open Homepage</option>
            <option value="newtab">Open New Tab</option>
            <option value="continue">Continue Previous Session</option>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>Search Engine</h3>

        <div className="setting-item">
          <label>Default Search Engine</label>
          <select
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
