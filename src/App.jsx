import { useEffect, useRef, useState } from "react";
import ApiTester from "./ApiTester";
import "./App.css";
import DeveloperConsole from "./DeveloperConsole";
import NetworkMonitor from "./NetworkMonitor";
import DownloadManager from "./DownloadManager";
import BrowserSettings from "./BrowserSettings";
import ResponsiveDesignMode from "./ResponsiveDesignMode";
import ElementInspector from "./ElementInspector";
import WebsitePermissions from "./WebsitePermissions";
import { showToast } from "./toast";

function Icon({ name }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    back: <path {...common} d="M15 18 9 12l6-6M9 12h11" />,
    forward: <path {...common} d="m9 18 6-6-6-6m6 6H4" />,
    reload: <path {...common} d="M20 7v5h-5M4.8 9A7 7 0 0 1 17 6l3 6M4 17v-5h5m10.2 3A7 7 0 0 1 7 18l-3-6" />,
    search: <><circle {...common} cx="10.8" cy="10.8" r="6.3" /><path {...common} d="m16 16 4 4" /></>,
    bookmark: <path {...common} d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4z" />,
    close: <path {...common} d="m6 6 12 12M18 6 6 18" />,
    restore: <path {...common} d="M4 10a8 8 0 1 1 2 7M4 4v6h6m2-2v5l3 2" />
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{shapes[name]}</svg>;
}

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
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [addressFocused, setAddressFocused] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");
  const [contextTab, setContextTab] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [popupNotice, setPopupNotice] = useState("");
  const [toasts, setToasts] = useState([]);
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

      if (active) setUrl(active.url === "devflow://newtab" ? "" : active.url);
    });




    window.browserAPI.getTabs().then((data) => {
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId);

      const active = data.tabs.find(
        (tab) => tab.id === data.activeTabId
      );

      if (active) setUrl(active.url === "devflow://newtab" ? "" : active.url);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => window.browserAPI.onPopupBlocked(data => {
    setPopupNotice(`Blocked a popup from ${data?.origin || "this site"}. Change this in Browser Settings.`);
    const timer = setTimeout(() => setPopupNotice(""), 6000);
    return () => clearTimeout(timer);
  }), []);

  useEffect(() => {
    const listener = event => {
      const toast = { id: `${Date.now()}-${Math.random()}`, type: event.detail?.type || "info", message: String(event.detail?.message || "") };
      setToasts(current => [...current.slice(-3), toast]);
      setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), 3800);
    };
    window.addEventListener("devflow:toast", listener);
    return () => window.removeEventListener("devflow:toast", listener);
  }, []);

  useEffect(() => {
    if (!addressFocused || activeTab?.isPrivate || !url.trim() || /^https?:\/\//i.test(url)) { setSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const settings = await window.browserAPI.getSettings();
        const result = await window.browserAPI.getSearchSuggestions(url.trim(), settings?.searchEngine || searchEngine);
        if (cancelled) return;
        setSuggestions(result?.suggestions || []);
        setSuggestionError(result?.success ? "" : (result?.error || ""));
      } catch { if (!cancelled) { setSuggestions([]); setSuggestionError("Search suggestions are unavailable."); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url, addressFocused, searchEngine, activeTab?.isPrivate]);

  useEffect(() => {
    if (panel !== "" || activeTab?.url !== "devflow://newtab") return;
    Promise.all([window.browserAPI.getBookmarks(), window.browserAPI.getHistory()]).then(([saved, recent]) => {
      setBookmarks(saved || []); setHistory(recent || []);
    }).catch(() => {});
  }, [activeTab?.url, panel]);

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
      active?.url !== "devflow://newtab" &&
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

  useEffect(() => { window.browserAPI.setActiveTool(panel); }, [panel]);



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
    window.browserAPI.createTab();
  };

  const selectTab = (id) => {
    window.browserAPI.switchTab(id);
  };

  const removeTab = (event, id) => {
    event.stopPropagation();
    window.browserAPI.closeTab(id);
  };

  const duplicateTab = async (id) => { await window.browserAPI.duplicateTab(id); setContextTab(null); };
  const togglePinned = async (tab) => { await window.browserAPI.setTabPinned(tab.id, !tab.pinned); setContextTab(null); };
  const reopenClosed = () => window.browserAPI.reopenClosedTab();

  const navigateSearch = async (query = url) => {
    const value = query.trim();
    if (!value) return;
    let target = value;
    if (!/^https?:\/\//i.test(target)) {
      if (target.includes(".") || target.includes("localhost")) target = `https://${target}`;
      else {
        const base = { google: "https://www.google.com/search?q=", bing: "https://www.bing.com/search?q=", duckduckgo: "https://duckduckgo.com/?q=" }[searchEngine] || "https://www.google.com/search?q=";
        target = `${base}${encodeURIComponent(target)}`;
      }
    }
    try { target = new URL(target).href; } catch { return; }
    setUrl(target); setSuggestions([]); setAddressFocused(false); await window.browserAPI.navigate(target);
  };

  const selectSuggestion = (value) => {
    const base = { google: "https://www.google.com/search?q=", bing: "https://www.bing.com/search?q=", duckduckgo: "https://duckduckgo.com/?q=" }[searchEngine] || "https://www.google.com/search?q=";
    const target = `${base}${encodeURIComponent(value)}`;
    setUrl(target); setSuggestions([]); setAddressFocused(false); window.browserAPI.navigate(target);
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
      showToast("Bookmark saved", "success");
    }
  };

  const openSavedPage = (savedUrl) => {
    setUrl(savedUrl);
    window.browserAPI.navigate(savedUrl);
  };

  const frequentSites = Object.values((history || []).reduce((acc, item) => {
    if (!item.url || !/^https?:/i.test(item.url)) return acc;
    acc[item.url] = acc[item.url] || { ...item, visits: 0 };
    acc[item.url].visits++;
    return acc;
  }, {})).sort((a, b) => b.visits - a.visits).slice(0, 6);

  const addCustomShortcut = async () => {
    const target = window.prompt("Website URL to add as a shortcut:");
    if (!target) return;
    try {
      const parsed = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`);
      if (!/^https?:$/.test(parsed.protocol)) return;
      await window.browserAPI.addBookmark({ title: parsed.hostname, url: parsed.href });
      setBookmarks(await window.browserAPI.getBookmarks());
    } catch { setSuggestionError("Enter a valid website address."); }
  };

  return (
    <div className={`browser theme-${theme}`}>
      {popupNotice && <div className="popup-notice">{popupNotice}<button onClick={() => setPopupNotice("")}>Dismiss</button></div>}
      <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`app-toast ${toast.type}`} key={toast.id}><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><Icon name="close" /></button></div>)}</div>
      <header className="topbar">
        <div className="brand">
          DEV<span>FLOW</span>
        </div>

        <div className="navigation">
          <button aria-label="Back" title="Back" onClick={() => window.browserAPI.back()}><Icon name="back" /></button>
          <button aria-label="Forward" title="Forward" onClick={() => window.browserAPI.forward()}><Icon name="forward" /></button>
          <button aria-label="Reload" title="Reload" onClick={() => window.browserAPI.reload()}><Icon name="reload" /></button>
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
            onChange={(e) => { setUrl(e.target.value); setSuggestionIndex(-1); }}
            onFocus={(e) => e.target.select()}
            onFocusCapture={() => setAddressFocused(true)}
            onBlur={() => setTimeout(() => setAddressFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setSuggestionIndex(i => (i + 1) % suggestions.length); }
              else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setSuggestionIndex(i => i <= 0 ? suggestions.length - 1 : i - 1); }
              else if (e.key === "Enter") { e.preventDefault(); if (suggestionIndex >= 0 && suggestions[suggestionIndex]) selectSuggestion(suggestions[suggestionIndex]); else navigate(); }
              else if (e.key === "Escape") setSuggestions([]);
            }}
            placeholder="Search or enter website URL"
          />
          {addressFocused && suggestions.length > 0 && <div className="search-suggestions">{suggestions.map((item, index) => <button key={`${item}-${index}`} className={index === suggestionIndex ? "selected" : ""} onMouseDown={event => event.preventDefault()} onClick={() => selectSuggestion(item)}>{item}</button>)}</div>}
          {addressFocused && suggestionError && <div className="suggestion-error">{suggestionError}</div>}
        </div>

        <button className="go" onClick={navigate}>Go</button>
        <button className="bookmark-action" title="Bookmark this page" aria-label="Bookmark this page" disabled={!activeTab || !/^https?:/i.test(activeTab.url)} onClick={saveBookmark}><Icon name="bookmark" /></button>
        <button className="permissions-launch" onClick={() => setPanel("permissions")}>Permissions</button>
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
            onContextMenu={event => { event.preventDefault(); setContextTab({ id: tab.id, x: event.clientX, y: event.clientY }); }}
            title={tab.title}
          >
            <span className="tab-title">
              {tab.isPrivate ? "P · " : ""}
              {tab.loading && <span className="tab-spinner" aria-label="Loading" />}
              {tab.pinned ? "◆ " : ""}{tab.url === "devflow://newtab" ? "New Tab" : (tab.title || "New Tab")}
            </span>

            <button
              className="close-tab"
              onClick={(event) => removeTab(event, tab.id)}
              title="Close tab"
            >
              <Icon name="close" />
            </button>
          </div>
        ))}

        <button className="new-tab" onClick={addTab} title="New Tab">
          +
        </button>
        <button className="reopen-tab" onClick={reopenClosed} title="Reopen closed tab"><Icon name="restore" /></button>
        {contextTab && <div className="tab-context-menu" style={{ left: contextTab.x, top: contextTab.y }} onMouseLeave={() => setContextTab(null)}>
          <button onClick={() => duplicateTab(contextTab.id)}>Duplicate tab</button>
          <button onClick={() => { const t = tabs.find(item => item.id === contextTab.id); if (t) togglePinned(t); }}>Pin / unpin tab</button>
          <button onClick={() => { window.browserAPI.closeTab(contextTab.id); setContextTab(null); }}>Close tab</button>
          <button onClick={reopenClosed}>Reopen closed tab</button>
        </div>}




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
            ) : activeTab?.url === "devflow://newtab" ? (
              <div className={`new-tab-page ${theme === "light" ? "new-tab-light" : ""}`}>
                <div className="new-tab-greeting"><span>{clock.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h1>{clock.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</h1><p>Your flow starts here.</p></div>
                <form className="new-tab-search" onSubmit={event => { event.preventDefault(); navigateSearch(); }}>
                  <Icon name="search" /><input value={url} onFocus={() => setAddressFocused(true)} onChange={event => { setUrl(event.target.value); setSuggestionIndex(-1); }} onKeyDown={event => { if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setSuggestionIndex(i => (i + 1) % suggestions.length); } else if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setSuggestionIndex(i => i <= 0 ? suggestions.length - 1 : i - 1); } else if (event.key === "Enter" && suggestionIndex >= 0) { event.preventDefault(); selectSuggestion(suggestions[suggestionIndex]); } else if (event.key === "Escape") setSuggestions([]); }} placeholder={`Search with ${selectedSearchEngine.name} or enter a URL`} /><button type="submit">Search</button>
                </form>
                {addressFocused && suggestions.length > 0 && <div className="new-tab-suggestions">{suggestions.map(item => <button key={item} onClick={() => selectSuggestion(item)}>{item}</button>)}</div>}
                {addressFocused && suggestionError && <p className="new-tab-suggestion-error">{suggestionError}</p>}
                <div className="new-tab-section"><div className="new-tab-section-title"><h2>Shortcuts</h2><button onClick={addCustomShortcut}>+ Add shortcut</button></div><div className="shortcut-grid">{bookmarks.slice(0, 8).map(item => <button className="shortcut-card" key={item.id} onClick={() => openSavedPage(item.url)}><span>{item.title?.slice(0, 1)?.toUpperCase() || "↗"}</span><strong>{item.title}</strong></button>)}</div>{bookmarks.length === 0 && <p>Add a website shortcut or bookmark to see it here.</p>}</div>
                <div className="new-tab-section"><h2>Frequently visited</h2><div className="shortcut-grid">{frequentSites.map(item => <button className="shortcut-card" key={item.url} onClick={() => openSavedPage(item.url)}><span>↗</span><strong>{item.title || new URL(item.url).hostname}</strong><small>{item.visits} visits</small></button>)}{frequentSites.length === 0 && <p>Pages you visit will appear here.</p>}</div></div>
                <div className="new-tab-section"><h2>Recently visited</h2><div className="recent-pages">{history.slice(0, 5).map(item => <button key={item.id} onClick={() => openSavedPage(item.url)}><strong>{item.title}</strong><span>{item.url}</span></button>)}{history.length === 0 && <p>Your recent pages will appear here.</p>}</div></div>
                <footer>DEV<span>FLOW</span> · A calmer place to build and browse</footer>
              </div>
            ) : (
              <div className="browser-viewport" ref={viewportRef} />
            )
          )}

          {panel === "permissions" && <WebsitePermissions />}

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
              onClear={() => setConsoleMessages(previous => previous.filter(message => message.tabId !== activeTabId))}
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
