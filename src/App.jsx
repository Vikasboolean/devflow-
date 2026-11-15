
import { useEffect, useRef, useState } from "react";
import ApiTester from "./ApiTester";
import "./App.css";
import DeveloperConsole from "./DeveloperConsole";
import NetworkMonitor from "./NetworkMonitor";
import DownloadManager from "./DownloadManager";

function App() {
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const viewportRef = useRef(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [panel, setPanel] = useState("");
  const [consoleMessages, setConsoleMessages] = useState([]);

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

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      window.browserAPI.setViewVisible(false);
      return;
    }

    window.browserAPI.setViewVisible(true);

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
  }, [panel]);

  const navigate = () => {
    let target = url.trim();
    if (!target) return;

    if (!/^https?:\/\//i.test(target)) {
      if (target.includes(".") || target.includes("localhost")) {
        target = `https://${target}`;
      } else {
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
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
    <div className="browser">
      <header className="topbar">
        <div className="brand">
          DEV<span>FLOW</span>
        </div>

        <div className="navigation">
          <button onClick={() => window.browserAPI.back()}>←</button>
          <button onClick={() => window.browserAPI.forward()}>→</button>
          <button onClick={() => window.browserAPI.reload()}>↻</button>
        </div>

        <input
          className="address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && navigate()}
          placeholder="Search or enter website URL"
        />

        <button className="go" onClick={navigate}>Go</button>
      </header>

      <div className="tabbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? "active" : ""}`}
            onClick={() => selectTab(tab.id)}
            title={tab.title}
          >
            <span className="tab-title">
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

        <button className="bookmark-btn" onClick={saveBookmark}>
          ☆
        </button>


      </div>

      <main className="workspace">
        <aside className="sidebar">
          <button onClick={() => setPanel("")}>⌂ Home</button>

          <button onClick={() => {
            setPanel("bookmarks");
            loadBookmarks();
          }}>
            ☆ Bookmarks
          </button>

          <button onClick={() => {
            setPanel("history");
            loadHistory();
          }}>
            ◷ History
          </button>

          <button onClick={() =>
            setPanel("api")}>
            ⌘ API Testing
          </button>

          <button>◈ Workspaces</button>
          <button onClick={() => setPanel("developer")}>
            ⌘ Developer Tools
          </button>

          <button onClick={() => setPanel("network")}>
            ⇄ Network Monitor
          </button>

          <button onClick={() => setPanel("downloads")}>
            ↓ Download Manager
          </button>

          <button>⚙ Settings</button>
        </aside>

        <section className="content">
          {panel === "" && (
            <div className="browser-viewport" ref={viewportRef} />
          )}

          {panel === "network" && (
            <NetworkMonitor activeTabId={activeTabId} />
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
        </section>
      </main>
    </div>
  );
}

export default App;
