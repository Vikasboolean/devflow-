import { useEffect, useRef, useState } from "react";
import ApiTester from "./ApiTester";
import "./App.css";
import DeveloperConsole from "./DeveloperConsole";
import NetworkMonitor from "./NetworkMonitor";
import DownloadManager from "./DownloadManager";
import BrowserSettings from "./BrowserSettings";
import ResponsiveDesignMode from "./ResponsiveDesignMode";
import ElementInspector from "./ElementInspector";

function App() {
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeError = activeTab?.loadError;
  const viewportRef = useRef(null);
  const responsivePreviewRef = useRef(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [panel, setPanel] = useState("");
  const [consoleMessages, setConsoleMessages] = useState([]);
  const [searchEngine, setSearchEngine] = useState("google");
  const [theme, setTheme] = useState("dark");
  const inspectorViewportRef = useRef(null);

  useEffect(() => {
    window.browserAPI.getSettings()
      .then((settings) => {
        setSearchEngine(settings?.searchEngine || "google");
        setTheme(settings?.theme || "dark");
      })
      .catch((error) => console.error("Could not load settings:", error));
  }, []);

  const searchEngines = {
    google: { name: "Google", domain: "google.com" },
    bing: { name: "Bing", domain: "bing.com" },
    duckduckgo: { name: "DuckDuckGo", domain: "duckduckgo.com" }
  };
  const selectedSearchEngine = searchEngines[searchEngine] || searchEngines.google;

  useEffect(() => {
    const unsubscribe = window.browserAPI.onTabsUpdated((data) => {
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId);

      const active = data.tabs.find(
        (tab) => tab.id === data.activeTabId
      );

      if (active) setUrl(active.url);
    });




    window.browserAPI.getTabs().then((data) => {
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId);

      const active = data.tabs.find(
        (tab) => tab.id === data.activeTabId
      );

      if (active) setUrl(active.url);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.browserAPI.onConsoleMessage((data) => {
      setConsoleMessages((previous) => [...previous.slice(-499), data]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => window.browserAPI.onToolSelected((toolId) => {
    if (toolId === "private-tab") {
      window.browserAPI.createPrivateTab("https://www.google.com");
      return;
    }
    setPanel(toolId);
    if (toolId === "bookmarks") loadBookmarks();
    if (toolId === "history") loadHistory();
  }), []);


  useEffect(() => {
    const active = tabs.find((tab) => tab.id === activeTabId);

    const viewport =
      panel === "inspector"
        ? inspectorViewportRef.current
        : viewportRef.current;

    const showBrowserView =
      (panel === "" || panel === "inspector" || panel === "responsive") &&
      !active?.loadError;

    if (panel === "responsive") {
      window.browserAPI.setViewVisible(showBrowserView);
      return;
    }

    if (!viewport) {
      window.browserAPI.setViewVisible(false);
      return;
    }

    window.browserAPI.setViewVisible(showBrowserView);

    const updateBounds = () => {
      const rect = viewport.getBoundingClientRect();

      window.browserAPI.resize({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    const observer = new ResizeObserver(updateBounds);
    observer.observe(viewport);

    const removeResizeListener =
      window.browserAPI.onWindowResize(updateBounds);

    updateBounds();

    return () => {
      observer.disconnect();
      removeResizeListener();
      window.browserAPI.setViewVisible(false);
    };
  }, [panel, activeTabId, tabs]);



  const navigate = async () => {
    let target = url.trim();
    if (!target) return;

    if (!/^https?:\/\//i.test(target)) {
      if (target.includes(".") || target.includes("localhost")) {
        target = `https://${target}`;
      } else {
        try {
          const settings = await window.browserAPI.getSettings();
          const searchEngine = settings?.searchEngine || "google";

          const searchUrls = {
            google: "https://www.google.com/search?q=",
            bing: "https://www.bing.com/search?q=",
            duckduckgo: "https://duckduckgo.com/?q="
          };

          const searchBase =
            searchUrls[searchEngine] || searchUrls.google;

          target = `${searchBase}${encodeURIComponent(target)}`;
        } catch (error) {
          console.error("Could not load search settings:", error);
          target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
        }
      }
    }

    try {
      const parsed = new URL(target);

      if (!["http:", "https:"].includes(parsed.protocol)) return;

      setUrl(parsed.href);
      window.browserAPI.navigate(parsed.href);
    } catch {
      console.log("Invalid URL");
    }
  };


  const addTab = () => {
    window.browserAPI.createTab("https://www.google.com");
  };

  const selectTab = (id) => {
    window.browserAPI.switchTab(id);
  };

  const removeTab = (event, id) => {
    event.stopPropagation();
    window.browserAPI.closeTab(id);
  };

  const loadBookmarks = async () => {
    const data = await window.browserAPI.getBookmarks();
    setBookmarks(data);
  };

  const loadHistory = async () => {
    const data = await window.browserAPI.getHistory();
    setHistory(data);
  };

  const saveBookmark = async () => {
    const active = tabs.find(tab => tab.id === activeTabId);
    if (!active) return;

    const result = await window.browserAPI.addBookmark({
      title: active.title || "Untitled",
      url: active.url
    });

    if (result.success) {
      await loadBookmarks();
      alert("Bookmark saved successfully!");
    }
  };

  const openSavedPage = (savedUrl) => {
    setUrl(savedUrl);
    window.browserAPI.navigate(savedUrl);
  };

  return (
    <div className={`browser theme-${theme}`}>
      <header className="topbar">
        <div className="brand">
          DEV<span>FLOW</span>
        </div>

        <div className="navigation">
          <button onClick={() => window.browserAPI.back()}>←</button>
          <button onClick={() => window.browserAPI.forward()}>→</button>
          <button onClick={() => window.browserAPI.reload()}>↻</button>
        </div>

        <div className="address-container">
          <img
            className="search-engine-icon"
            src={`https://www.google.com/s2/favicons?domain=${selectedSearchEngine.domain}&sz=32`}
            alt={`${selectedSearchEngine.name} icon`}
            title={`Search with ${selectedSearchEngine.name}`}
          />
          <input
            className="address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === "Enter" && navigate()}
            placeholder="Search or enter website URL"
          />
        </div>

        <button className="go" onClick={navigate}>Go</button>
      </header>

      <div className="tabbar">
        <button
          className={`tools-menu-trigger ${panel !== "" ? "selected" : ""}`}
          title="DevFlow Tools"
          onMouseEnter={(event) => window.browserAPI.openToolsMenu({ x: event.screenX, y: event.screenY })}
          onClick={(event) => window.browserAPI.openToolsMenu({ x: event.screenX, y: event.screenY })}
        >
          <span>&#9776;</span>
        </button>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""}`}
            onClick={() => selectTab(tab.id)}
            title={tab.title}
          >
            <span className="tab-title">
              {tab.isPrivate ? "◉ " : ""}
              {tab.loading ? "◌ " : ""}
              {tab.title || "New Tab"}
            </span>

            <button
              className="close-tab"
              onClick={(event) => removeTab(event, tab.id)}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}

        <button className="new-tab" onClick={addTab} title="New Tab">
          +
        </button>




      </div>

      <main className="workspace">


        <section className="content">
          {panel === "" && (
            activeError ? (
              <div className="browser-error-page">
                <div className="error-content">
                  <div className="error-icon">⚠</div>

                  <h1>Unable to Connect</h1>

                  <p className="error-description">
                    {activeError.description || "This website couldn't be reached."}
                  </p>

                  <p className="error-url">{activeError.url || activeTab?.url}</p>

                  <p className="error-code">
                    Error Code: {activeError.code}
                  </p>

                  <div className="error-actions">
                    <button onClick={() => window.browserAPI.back()}>
                      Go Back
                    </button>

                    <button
                      className="retry-error-btn"
                      onClick={() => window.browserAPI.retryPage()}
                    >
                      ↻ Try Again
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="browser-viewport" ref={viewportRef} />
            )
          )}

          {panel === "network" && (
            <NetworkMonitor activeTabId={activeTabId} />
          )}

          {panel === "inspector" && (
            <div className="inspector-workspace">
              <div
                className="inspector-browser-viewport"
                ref={inspectorViewportRef}
              />

              <div className="inspector-side-panel">
                <ElementInspector activeTabId={activeTabId} />
              </div>
            </div>
          )}

          {panel === "downloads" && (
            <DownloadManager />
          )}

          {panel === "developer" && (
            <DeveloperConsole
              messages={consoleMessages}
              activeTabId={activeTabId}
              onClear={() => setConsoleMessages([])}
              onAddMessage={(message) => {
                setConsoleMessages((previous) => [
                  ...previous.slice(-499),
                  message
                ]);
              }}
            />
          )}

          {panel === "bookmarks" && (
            <div className="data-panel">
              <h2>Saved Bookmarks</h2>

              {bookmarks.map(item => (
                <div className="saved-item" key={item.id}>
                  <span onClick={() => openSavedPage(item.url)}>
                    {item.title}
                    <small>{item.url}</small>
                  </span>

                  <button onClick={async () => {
                    await window.browserAPI.deleteBookmark(item.id);
                    loadBookmarks();
                  }}>
                    Delete
                  </button>
                </div>
              ))}

              {bookmarks.length === 0 && <p>No bookmarks saved yet.</p>}
            </div>
          )}

          {panel === "history" && (
            <div className="data-panel">
              <h2>Browsing History</h2>

              <button onClick={async () => {
                await window.browserAPI.clearHistory();
                loadHistory();
              }}>
                Clear History
              </button>

              {history.map(item => (
                <div className="saved-item" key={item.id}>
                  <span onClick={() => openSavedPage(item.url)}>
                    {item.title || "Untitled"}
                    <small>{item.url}</small>
                  </span>
                </div>
              ))}

              {history.length === 0 && <p>No browsing history yet.</p>}
            </div>
          )}

          {panel === "api" && <ApiTester />}
          {panel === "responsive" && (
            <ResponsiveDesignMode
              activeTabId={activeTabId}
              previewRef={responsivePreviewRef}
            />
          )}

          {panel === "settings" && (
            <BrowserSettings
              onSearchEngineChange={setSearchEngine}
              onThemeChange={setTheme}
            />
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
