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
import NewTabBackground from "./NewTabBackground";
import NewTabCustomize from "./NewTabCustomize";
import { NEW_TAB_BACKGROUND_DEFAULTS, normalizeNewTabBackground } from "./newTabBackgroundSettings";

function Icon({ name }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const shapes = {
    back: <path {...common} d="M15 18 9 12l6-6M9 12h11" />,
    forward: <path {...common} d="m9 18 6-6-6-6m6 6H4" />,
    reload: <path {...common} d="M20 7v5h-5M4.8 9A7 7 0 0 1 17 6l3 6M4 17v-5h5m10.2 3A7 7 0 0 1 7 18l-3-6" />,
    search: <><circle {...common} cx="10.8" cy="10.8" r="6.3" /><path {...common} d="m16 16 4 4" /></>,
    bookmark: <path {...common} d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4z" />,
    close: <path {...common} d="m6 6 12 12M18 6 6 18" />,
    restore: <path {...common} d="M4 10a8 8 0 1 1 2 7M4 4v6h6m2-2v5l3 2" />,
    history: <><circle {...common} cx="12" cy="12" r="8.5" /><path {...common} d="M12 7v5l3.5 2" /></>,
    sound: <><path {...common} d="M4 10v4h3l5 4V6l-5 4z" /><path {...common} d="M16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12" /></>,
    muted: <><path {...common} d="M4 10v4h3l5 4V6l-5 4z" /><path {...common} d="m16 9 5 6m0-6-5 6" /></>,
    permissions: <><path {...common} d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path {...common} d="m9 12 2 2 4-4" /></>
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{shapes[name]}</svg>;
}

function SiteFavicon({ url, title }) {
  const [failed, setFailed] = useState(false);
  const source = (() => { try { return `${new URL(url).origin}/favicon.ico`; } catch { return ""; } })();
  return source && !failed
    ? <img className="site-favicon" src={source} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="site-favicon-fallback" aria-hidden="true">{(title || url || "D").slice(0, 1).toUpperCase()}</span>;
}

function App() {
  const [url, setUrl] = useState("");
  const [tabs, setTabs] = useState([]);
  const [closedTabCount, setClosedTabCount] = useState(0);
  const [activeTabId, setActiveTabId] = useState(null);
  const activeTabRef = useRef(null);
  const addressInputRef = useRef(null);
  const findInputRef = useRef(null);
  const findTabIdRef = useRef(null);
  const browserShortcutHandlerRef = useRef(null);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState({ activeMatchOrdinal: 0, matches: 0, finalUpdate: false });
  const [findError, setFindError] = useState("");
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeError = activeTab?.loadError;
  const [sitePermissionCount, setSitePermissionCount] = useState(0);
  const viewportRef = useRef(null);
  const responsivePreviewRef = useRef(null);
  const activeTabIdRef = useRef(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [history, setHistory] = useState([]);
  const [panel, setPanel] = useState("");
  const [consoleMessages, setConsoleMessages] = useState([]);
  const [searchEngine, setSearchEngine] = useState("google");
  const [theme, setTheme] = useState(() => {
    if (window.browserAPI?.initialTheme === "light" || window.browserAPI?.initialTheme === "dark") return window.browserAPI.initialTheme;
    try { return localStorage.getItem("devflow-theme") === "light" ? "light" : "dark"; }
    catch { return "dark"; }
  });
  const [newTabBackgroundSettings, setNewTabBackgroundSettings] = useState(() => ({ ...NEW_TAB_BACKGROUND_DEFAULTS }));
  const [newTabBackgroundPreview, setNewTabBackgroundPreview] = useState(null);
  const [isNewTabCustomizeOpen, setIsNewTabCustomizeOpen] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressSelectedIndex, setAddressSelectedIndex] = useState(-1);
  const [isAddressFocused, setIsAddressFocused] = useState(false);
  const [isAddressSuggestionsOpen, setIsAddressSuggestionsOpen] = useState(false);
  const [addressSuggestionError, setAddressSuggestionError] = useState("");
  const [newTabSearchValue, setNewTabSearchValue] = useState("");
  const [newTabSuggestions, setNewTabSuggestions] = useState([]);
  const [newTabSelectedIndex, setNewTabSelectedIndex] = useState(-1);
  const [isNewTabSearchFocused, setIsNewTabSearchFocused] = useState(false);
  const [isNewTabSuggestionsOpen, setIsNewTabSuggestionsOpen] = useState(false);
  const [newTabSuggestionError, setNewTabSuggestionError] = useState("");
  const [contextTab, setContextTab] = useState(null);
  const [shortcutDraft, setShortcutDraft] = useState(null);
  const [shortcutError, setShortcutError] = useState("");
  const [clock, setClock] = useState(new Date());
  const [popupNotice, setPopupNotice] = useState(null);
  const [toasts, setToasts] = useState([]);
  const inspectorViewportRef = useRef(null);

  function resetAutocomplete() {
    setAddressSuggestions([]); setAddressSelectedIndex(-1); setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); setAddressSuggestionError("");
    setNewTabSearchValue(""); setNewTabSuggestions([]); setNewTabSelectedIndex(-1); setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false); setNewTabSuggestionError("");
    setNewTabBackgroundPreview(null); setIsNewTabCustomizeOpen(false);
  }
  function closeNewTabCustomize() { setNewTabBackgroundPreview(null); setIsNewTabCustomizeOpen(false); }

  useEffect(() => {
    window.browserAPI.getSettings()
      .then((settings) => {
        setSearchEngine(settings?.searchEngine || "google");
        const selectedTheme = settings?.theme === "light" ? "light" : "dark";
        setNewTabBackgroundSettings(normalizeNewTabBackground(settings?.newTabBackground));
        try { localStorage.setItem("devflow-theme", selectedTheme); } catch { /* JSON settings remain the source of truth. */ }
        setTheme(selectedTheme);
      })
      .catch((error) => console.error("Could not load settings:", error));
  }, []);

  const searchEngines = {
    google: { name: "Google", domain: "google.com" },
    bing: { name: "Bing", domain: "bing.com" },
    duckduckgo: { name: "DuckDuckGo", domain: "duckduckgo.com" }
  };
  const selectedSearchEngine = searchEngines[searchEngine] || searchEngines.google;
  const matchingHistory = !activeTab?.isPrivate && url.trim().length >= 1
    ? history.filter(item => /^https?:\/\//i.test(item.url || "") && `${item.title || ""} ${item.url}`.toLowerCase().includes(url.trim().toLowerCase())).slice(0, 4).map(item => ({ kind: "history", value: item.url, title: item.title || item.url }))
    : [];
  const addressOptions = [
    ...matchingHistory,
    ...addressSuggestions.filter(value => !matchingHistory.some(item => item.value === value)).map(value => ({ kind: "search", value }))
  ];
  const visibleSitePermissionCount = activeTab?.isPrivate || !/^https?:\/\//i.test(activeTab?.url || "") ? 0 : sitePermissionCount;

  useEffect(() => {
    const unsubscribe = window.browserAPI.onTabsUpdated((data) => {
      if (activeTabIdRef.current !== data.activeTabId) resetAutocomplete();
      activeTabIdRef.current = data.activeTabId;
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      setClosedTabCount(data.closedTabCount || 0);

      const active = data.tabs.find(
        (tab) => tab.id === data.activeTabId
      );
      activeTabRef.current = active || null;

      if (active) setUrl(active.url === "devflow://newtab" ? "" : active.url);
    });




    window.browserAPI.getTabs().then((data) => {
      if (activeTabIdRef.current !== data.activeTabId) resetAutocomplete();
      activeTabIdRef.current = data.activeTabId;
      setTabs(data.tabs);
      setActiveTabId(data.activeTabId);
      setClosedTabCount(data.closedTabCount || 0);

      const active = data.tabs.find(
        (tab) => tab.id === data.activeTabId
      );
      activeTabRef.current = active || null;

      if (active) setUrl(active.url === "devflow://newtab" ? "" : active.url);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const current = activeTab;
    if (!current || current.isPrivate || !/^https?:\/\//i.test(current.url)) return;
    const tabId = current.id;
    window.browserAPI.getWebsitePermissions().then(result => {
      if (activeTabIdRef.current !== tabId) return;
      let origin = "";
      try { origin = new URL(current.url).origin; } catch { return; }
      setSitePermissionCount((result?.permissions || []).filter(item => item.origin === origin && item.decision !== "ask").length);
    }).catch(() => setSitePermissionCount(0));
  }, [activeTabId, activeTab, activeTab?.url, activeTab?.isPrivate]);

  useEffect(() => window.browserAPI.onWebsitePermissionsUpdated(updated => {
    const current = activeTabRef.current;
    if (!current || current.isPrivate || !/^https?:\/\//i.test(current.url)) { setSitePermissionCount(0); return; }
    let origin = "";
    try { origin = new URL(current.url).origin; } catch { setSitePermissionCount(0); return; }
    setSitePermissionCount((updated || []).filter(item => item.origin === origin && item.decision !== "ask").length);
  }), []);

  useEffect(() => window.browserAPI.onPopupBlocked(data => setPopupNotice(data || null)), []);
  useEffect(() => {
    if (!popupNotice) return undefined;
    const timer = setTimeout(() => setPopupNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [popupNotice]);

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
    if (!isAddressFocused || !isAddressSuggestionsOpen || activeTab?.isPrivate || !url.trim() || /^https?:\/\//i.test(url)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const settings = await window.browserAPI.getSettings();
        const result = await window.browserAPI.getSearchSuggestions(url.trim(), settings?.searchEngine || searchEngine);
        if (cancelled) return;
        setAddressSuggestions(result?.suggestions || []);
        setAddressSuggestionError(result?.success ? "" : (result?.error || ""));
      } catch { if (!cancelled) { setAddressSuggestions([]); setAddressSuggestionError("Search suggestions are unavailable."); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url, isAddressFocused, isAddressSuggestionsOpen, searchEngine, activeTab?.isPrivate]);

  useEffect(() => {
    if (!isNewTabSearchFocused || !isNewTabSuggestionsOpen || activeTab?.isPrivate || !newTabSearchValue.trim() || /^https?:\/\//i.test(newTabSearchValue)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const settings = await window.browserAPI.getSettings();
        const result = await window.browserAPI.getSearchSuggestions(newTabSearchValue.trim(), settings?.searchEngine || searchEngine);
        if (cancelled) return;
        setNewTabSuggestions(result?.suggestions || []);
        setNewTabSuggestionError(result?.success ? "" : (result?.error || ""));
      } catch { if (!cancelled) { setNewTabSuggestions([]); setNewTabSuggestionError("Search suggestions are unavailable."); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [newTabSearchValue, isNewTabSearchFocused, isNewTabSuggestionsOpen, searchEngine, activeTab?.isPrivate]);

  useEffect(() => {
    if (panel !== "" || activeTab?.url !== "devflow://newtab") return;
    Promise.all([loadBookmarks(), window.browserAPI.getHistory()]).then(([, recent]) => {
      setHistory(recent || []);
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
    closeNewTabCustomize();
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
  useEffect(() => { setShortcutDraft(null); }, [activeTabId, activeTab?.url, panel]);



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
  const contextTarget = contextTab && tabs.find(tab => tab.id === contextTab.id);

  const navigateSearch = async (query = newTabSearchValue) => {
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
    setUrl(target); setNewTabSearchValue(""); setNewTabSuggestions([]); setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false); await window.browserAPI.navigate(target);
  };

  const selectAddressSuggestion = (option) => {
    if (option.kind === "history") {
      setUrl(option.value); setAddressSuggestions([]); setAddressSelectedIndex(-1); setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); window.browserAPI.navigate(option.value); return;
    }
    const base = { google: "https://www.google.com/search?q=", bing: "https://www.bing.com/search?q=", duckduckgo: "https://duckduckgo.com/?q=" }[searchEngine] || "https://www.google.com/search?q=";
    const target = `${base}${encodeURIComponent(option.value)}`;
    setUrl(target); setAddressSuggestions([]); setAddressSelectedIndex(-1); setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); window.browserAPI.navigate(target);
  };

  const selectNewTabSuggestion = (value) => {
    const base = { google: "https://www.google.com/search?q=", bing: "https://www.bing.com/search?q=", duckduckgo: "https://duckduckgo.com/?q=" }[searchEngine] || "https://www.google.com/search?q=";
    const target = `${base}${encodeURIComponent(value)}`;
    setUrl(target); setNewTabSearchValue(""); setNewTabSuggestions([]); setNewTabSelectedIndex(-1); setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false); window.browserAPI.navigate(target);
  };

  const applyNewTabBackground = async (value) => {
    const next = normalizeNewTabBackground(value);
    const previous = newTabBackgroundSettings;
    setNewTabBackgroundSettings(next);
    setNewTabBackgroundPreview(next);
    try {
      const result = await window.browserAPI.updateSettings({ newTabBackground: next });
      if (!result?.success) {
        setNewTabBackgroundSettings(previous); setNewTabBackgroundPreview(previous);
        showToast(result?.error || "Could not save New Tab background settings", "error");
        return;
      }
      showToast("New Tab background saved", "success");
    } catch {
      setNewTabBackgroundSettings(previous); setNewTabBackgroundPreview(previous);
      showToast("Could not save New Tab background settings", "error");
    }
  };

  const loadBookmarks = async () => {
    const data = await window.browserAPI.getBookmarks();
    const unique = [];
    const seen = new Set();
    const duplicates = [];
    for (const item of data || []) {
      const key = canonicalPage(item.url);
      if (!key) continue;
      if (seen.has(key)) duplicates.push(item.id);
      else { seen.add(key); unique.push(item); }
    }
    await Promise.all(duplicates.map(id => window.browserAPI.deleteBookmark(id)));
    setBookmarks(unique);
    return unique;
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

  const canonicalPage = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      if (!/^https?:$/.test(parsed.protocol)) return null;
      parsed.hash = "";
      if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      return parsed.href;
    } catch { return null; }
  };
  const frequentSites = Object.values((history || []).reduce((acc, item) => {
    const key = canonicalPage(item.url);
    if (!key || /^(new\s*tab|devflow\s*new\s*tab)$/i.test(item.title || "")) return acc;
    if (!acc[key]) acc[key] = { ...item, url: key, visits: 0 };
    acc[key].visits++;
    return acc;
  }, {})).sort((a, b) => b.visits - a.visits).slice(0, 6);
  const uniqueBookmarks = [...new Map((bookmarks || []).filter(item => canonicalPage(item.url)).map(item => [canonicalPage(item.url), item])).values()].slice(0, 8);
  const recentSites = Object.values((history || []).reduce((acc, item) => {
    const key = canonicalPage(item.url);
    if (key && !acc[key]) acc[key] = { ...item, url: key };
    return acc;
  }, {})).slice(0, 5);
  const openShortcutDialog = (item = null) => {
    setShortcutError("");
    setShortcutDraft(item ? { id: item.id, title: item.title || "", url: item.url || "" } : { id: null, title: "", url: "" });
  };
  const saveShortcut = async (event) => {
    event.preventDefault();
    const title = shortcutDraft.title.trim();
    const raw = shortcutDraft.url.trim();
    if (!raw) return setShortcutError("Enter a website address.");
    let parsed;
    try { parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
    catch { return setShortcutError("Enter a valid website address."); }
    if (!/^https?:$/.test(parsed.protocol)) return setShortcutError("Only HTTP and HTTPS shortcuts are supported.");
    const normalized = canonicalPage(parsed.href);
    const match = bookmarks.find(item => canonicalPage(item.url) === normalized && item.id !== shortcutDraft.id);
    try {
      const original = bookmarks.find(item => item.id === shortcutDraft.id);
      let targetUrl = parsed.href;
      let removeOriginal = false;
      if (match) {
        targetUrl = match.url;
        removeOriginal = Boolean(original);
      } else if (original && canonicalPage(original.url) === normalized) {
        targetUrl = original.url;
      } else if (original) {
        removeOriginal = true;
      }
      const targetTitle = title || parsed.hostname;
      const result = await window.browserAPI.addBookmark({ title: targetTitle, url: targetUrl });
      if (!result?.success) return setShortcutError("Could not save this shortcut.");
      if (removeOriginal) await window.browserAPI.deleteBookmark(shortcutDraft.id);
      await loadBookmarks();
      setShortcutDraft(null); setShortcutError("");
      showToast(match ? "Shortcut merged with the existing site" : (shortcutDraft.id ? "Shortcut updated" : "Shortcut added"), "success");
    } catch { setShortcutError("Could not save this shortcut."); }
  };
  const deleteShortcut = async (item) => {
    const key = canonicalPage(item.url);
    await Promise.all(bookmarks.filter(candidate => canonicalPage(candidate.url) === key).map(candidate => window.browserAPI.deleteBookmark(candidate.id)));
    await loadBookmarks();
    showToast("Shortcut removed", "success");
  };

  const openFindPanel = () => {
    if (!activeTab || activeTab.url === "devflow://newtab") { showToast("Find in Page is available on websites", "info"); return; }
    setPanel(""); setFindQuery(""); setFindError(""); setFindResult({ activeMatchOrdinal: 0, matches: 0, finalUpdate: false });
    findTabIdRef.current = activeTab.id;
    setIsFindOpen(true);
  };
  const closeFindPanel = () => {
    const tabId = findTabIdRef.current;
    if (tabId) window.browserAPI.stopFindInPage(tabId);
    findTabIdRef.current = null;
    setFindQuery(""); setFindError(""); setFindResult({ activeMatchOrdinal: 0, matches: 0, finalUpdate: false }); setIsFindOpen(false);
  };
  const searchInPage = async (query, action = "start") => {
    setFindQuery(query); setFindError("");
    if (!query.trim()) {
      setFindResult({ activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
      if (findTabIdRef.current) await window.browserAPI.stopFindInPage(findTabIdRef.current);
      return;
    }
    const result = await window.browserAPI.findInPage({ tabId: findTabIdRef.current || activeTabId, query, action });
    if (!result?.success) setFindError(result?.error || "Could not search this page.");
  };

  useEffect(() => {
  browserShortcutHandlerRef.current = action => {
    const currentTabs = tabs;
    const currentId = activeTabId;
    const currentIndex = currentTabs.findIndex(tab => tab.id === currentId);
    const switchByOffset = offset => { if (currentTabs.length) window.browserAPI.switchTab(currentTabs[(currentIndex + offset + currentTabs.length) % currentTabs.length].id); };
    if (action === "new-tab") addTab();
    else if (action === "close-tab") {
      const currentTab = currentTabs.find(tab => tab.id === currentId);
      if (currentTab?.pinned) showToast("Unpin the tab or use its menu to close it", "info");
      else if (currentId) window.browserAPI.closeTab(currentId);
    }
    else if (action === "reopen-tab") reopenClosed();
    else if (action === "focus-address") { setPanel(""); addressInputRef.current?.focus(); addressInputRef.current?.select(); }
    else if (action === "reload") window.browserAPI.reload();
    else if (action === "hard-reload") window.browserAPI.hardReload();
    else if (action === "find") openFindPanel();
    else if (action === "history") { closeNewTabCustomize(); setPanel("history"); loadHistory(); }
    else if (action === "downloads") { closeNewTabCustomize(); setPanel("downloads"); }
    else if (action === "bookmark") saveBookmark();
    else if (action === "next-tab") switchByOffset(1);
    else if (action === "previous-tab") switchByOffset(-1);
    else if (action === "back") window.browserAPI.back();
    else if (action === "forward") window.browserAPI.forward();
    else if (action.startsWith("tab-") && currentTabs.length) {
      const slot = Number(action.slice(4));
      window.browserAPI.switchTab(slot === 9 ? currentTabs.at(-1).id : currentTabs[slot - 1]?.id);
    } else if (action === "escape") {
      if (isFindOpen) closeFindPanel();
      if (contextTab) setContextTab(null);
      if (shortcutDraft) setShortcutDraft(null);
      if (isNewTabCustomizeOpen) closeNewTabCustomize();
      setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false);
    }
  };
  });

  useEffect(() => {
    const onKeyDown = event => {
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      let action = null;
      if (ctrl) {
        if (key === "t" && !event.shiftKey) action = "new-tab";
        else if (key === "w" && !event.shiftKey) action = "close-tab";
        else if (key === "t" && event.shiftKey) action = "reopen-tab";
        else if (key === "l" && !event.shiftKey) action = "focus-address";
        else if (key === "r") action = event.shiftKey ? "hard-reload" : "reload";
        else if (key === "f" && !event.shiftKey) action = "find";
        else if (key === "h" && !event.shiftKey) action = "history";
        else if (key === "j" && !event.shiftKey) action = "downloads";
        else if (key === "d" && !event.shiftKey) action = "bookmark";
        else if (key === "tab") action = event.shiftKey ? "previous-tab" : "next-tab";
        else if (/^[1-9]$/.test(key)) action = `tab-${key}`;
      } else if (event.altKey && key === "arrowleft") action = "back";
      else if (event.altKey && key === "arrowright") action = "forward";
      else if (key === "escape") action = "escape";
      if (!action) return;
      event.preventDefault();
      browserShortcutHandlerRef.current?.(action);
    };
    const removeShortcutListener = window.browserAPI.onBrowserShortcut(action => browserShortcutHandlerRef.current?.(action));
    const removeFindListener = window.browserAPI.onFindResult(data => {
      if (data?.tabId === activeTabIdRef.current && data.tabId === findTabIdRef.current) {
        setFindResult({ activeMatchOrdinal: data.activeMatchOrdinal || 0, matches: data.matches || 0, finalUpdate: Boolean(data.finalUpdate) });
      }
    });
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); removeShortcutListener(); removeFindListener(); };
  }, []);

  useEffect(() => {
    if (isFindOpen) requestAnimationFrame(() => findInputRef.current?.focus());
  }, [isFindOpen]);
  useEffect(() => {
    if (findTabIdRef.current && findTabIdRef.current !== activeTabId) closeFindPanel();
  }, [activeTabId]);

  return (
    <div className={`browser theme-${theme}`} onMouseDown={event => {
      const target = event.target;
      if (!target.closest?.(".address-container")) { setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); }
      if (!target.closest?.(".new-tab-search-wrap")) { setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false); }
    }}>
      {popupNotice && <div className="popup-notice"><span>{popupNotice.kind === "download" ? `A download from ${popupNotice.origin || "this site"} was blocked.` : `Blocked a popup from ${popupNotice.origin || "this site"}.`}</span>{popupNotice.url && <button onClick={() => { window.browserAPI.openBlockedPopup({ tabId: popupNotice.tabId, url: popupNotice.url }); setPopupNotice(null); }}>Open in new tab</button>}<button onClick={() => { setPopupNotice(null); if (!popupNotice.url) setPanel("permissions"); }}>Manage</button><button onClick={() => setPopupNotice(null)}>Dismiss</button></div>}
      <div className="toast-stack" aria-live="polite">{toasts.map(toast => <div className={`app-toast ${toast.type}`} key={toast.id}><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}><Icon name="close" /></button></div>)}</div>
      {shortcutDraft && panel === "" && activeTab?.url === "devflow://newtab" && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShortcutDraft(null); }}><form className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-dialog-title" onKeyDown={event => { if (event.key === "Escape") setShortcutDraft(null); }} onSubmit={saveShortcut}>
        <button type="button" className="modal-close" aria-label="Close dialog" onClick={() => setShortcutDraft(null)}><Icon name="close" /></button>
        <h2 id="shortcut-dialog-title">{shortcutDraft.id ? "Edit shortcut" : "Add shortcut"}</h2>
        <p>Save a site to your New Tab shortcuts.</p>
        <label htmlFor="shortcut-title">Title</label><input id="shortcut-title" autoFocus maxLength={120} value={shortcutDraft.title} onChange={event => setShortcutDraft(value => ({ ...value, title: event.target.value }))} placeholder="My website" />
        <label htmlFor="shortcut-url">Website URL</label><input id="shortcut-url" inputMode="url" maxLength={2048} value={shortcutDraft.url} onChange={event => setShortcutDraft(value => ({ ...value, url: event.target.value }))} placeholder="https://example.com" />
        {shortcutError && <div className="shortcut-dialog-error" role="alert">{shortcutError}</div>}
        <div className="shortcut-dialog-actions"><button type="button" onClick={() => setShortcutDraft(null)}>Cancel</button><button className="shortcut-save" type="submit">Save shortcut</button></div>
      </form></div>}
      <header className="topbar">
        <div className="brand" aria-label="DevFlow">
          <span className="brand-dev">DEV</span><span>FLOW</span>
        </div>

        <div className="navigation">
          <button aria-label="Back" title="Back" onClick={() => window.browserAPI.back()}><Icon name="back" /></button>
          <button aria-label="Forward" title="Forward" onClick={() => window.browserAPI.forward()}><Icon name="forward" /></button>
          <button className={`refresh-button ${activeTab?.loading ? "is-loading" : ""}`} aria-label={activeTab?.loading ? "Stop loading" : "Reload"} title={activeTab?.loading ? "Stop loading" : "Reload"} onClick={() => activeTab?.loading ? window.browserAPI.stopLoading() : window.browserAPI.reload()}><Icon name="reload" /></button>
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
            ref={addressInputRef}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setAddressSuggestions([]); setAddressSuggestionError(""); setAddressSelectedIndex(-1); setIsAddressSuggestionsOpen(true); }}
            onFocus={(e) => { e.target.select(); setIsAddressFocused(true); setIsAddressSuggestionsOpen(true); if (!activeTab?.isPrivate) loadHistory().catch(() => {}); }}
            onBlur={() => { setIsAddressFocused(false); setIsAddressSuggestionsOpen(false); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && addressOptions.length) { e.preventDefault(); setAddressSelectedIndex(i => (i + 1) % addressOptions.length); }
              else if (e.key === "ArrowUp" && addressOptions.length) { e.preventDefault(); setAddressSelectedIndex(i => i <= 0 ? addressOptions.length - 1 : i - 1); }
              else if (e.key === "Enter") { e.preventDefault(); if (addressSelectedIndex >= 0 && addressOptions[addressSelectedIndex]) selectAddressSuggestion(addressOptions[addressSelectedIndex]); else { setIsAddressSuggestionsOpen(false); navigate(); } }
              else if (e.key === "Escape") { setIsAddressSuggestionsOpen(false); setAddressSuggestions([]); setAddressSuggestionError(""); }
            }}
            placeholder="Search or enter website URL"
          />
          {isAddressFocused && isAddressSuggestionsOpen && addressOptions.length > 0 && <div className="search-suggestions" role="listbox">{addressOptions.map((item, index) => <button type="button" role="option" aria-selected={index === addressSelectedIndex} key={`${item.kind}-${item.value}-${index}`} className={index === addressSelectedIndex ? "selected" : ""} onMouseDown={event => event.preventDefault()} onClick={() => selectAddressSuggestion(item)}>{item.kind === "history" ? <><span className="suggestion-kind">History</span><span>{item.title}</span></> : item.value}</button>)}</div>}
          {isAddressFocused && isAddressSuggestionsOpen && addressSuggestionError && <div className="suggestion-error" role="status">{addressSuggestionError}</div>}
        </div>

        <button className="go" onClick={navigate}>Go</button>
        <button className="bookmark-action" title="Bookmark this page" aria-label="Bookmark this page" disabled={!activeTab || !/^https?:/i.test(activeTab.url)} onClick={saveBookmark}><Icon name="bookmark" /></button>
        <button className="history-action" title="Browsing history" aria-label="Browsing history" onClick={() => { closeNewTabCustomize(); setPanel("history"); loadHistory(); }}><Icon name="history" /></button>
        <button className={`permissions-launch ${visibleSitePermissionCount ? "has-site-permissions" : ""}`} aria-label="Website permissions" title={activeTab?.isPrivate ? "Private session permission choices are temporary" : `${visibleSitePermissionCount} saved permissions for this site`} onClick={() => { closeNewTabCustomize(); setPanel("permissions"); }}><Icon name="permissions" />{visibleSitePermissionCount > 0 && <span className="permission-count">{visibleSitePermissionCount}</span>}</button>
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
        <div className="tabs-strip">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? "active" : ""} ${tab.isPrivate ? "private-tab" : ""} ${tab.pinned ? "pinned" : ""}`}
            onClick={() => selectTab(tab.id)}
            onContextMenu={event => { event.preventDefault(); setContextTab({ id: tab.id, x: event.clientX, y: event.clientY }); }}
            title={tab.title}
          >
            <span className="tab-title">
              {tab.isPrivate ? "P · " : ""}
              {tab.loading && <span className="tab-spinner" aria-label="Loading" />}
              {tab.pinned ? "◆ " : ""}{tab.url === "devflow://newtab" ? "New Tab" : (tab.title || "New Tab")}
            </span>

            {(tab.audible || tab.muted) && <button className="tab-audio-state" type="button" title={tab.muted ? "Unmute tab" : "Mute tab"} aria-label={tab.muted ? "Unmute tab" : "Mute tab"} onClick={event => { event.stopPropagation(); window.browserAPI.toggleTabMute(tab.id); }}><Icon name={tab.muted ? "muted" : "sound"} /></button>}
            {!tab.pinned && <button className="close-tab" onClick={(event) => removeTab(event, tab.id)} title="Close tab"><Icon name="close" /></button>}
          </div>
        ))}
        </div>

        <button className="new-tab" onClick={addTab} title="New Tab">
          +
        </button>
        <button className="reopen-tab" onClick={reopenClosed} title="Reopen closed tab" disabled={closedTabCount === 0}><Icon name="restore" /></button>
        {contextTab && contextTarget && <div className="tab-context-menu" style={{ left: contextTab.x, top: contextTab.y }} onMouseLeave={() => setContextTab(null)}>
          <button onClick={() => { addTab(); setContextTab(null); }}>New Tab</button>
          <button onClick={() => duplicateTab(contextTarget.id)}>Duplicate Tab</button>
          <button disabled={contextTarget.url === "devflow://newtab"} onClick={() => { window.browserAPI.reloadTab(contextTarget.id); setContextTab(null); }}>Reload Tab</button>
          <button disabled={contextTarget.isPrivate || (!contextTarget.pinned && contextTarget.url === "devflow://newtab")} onClick={() => togglePinned(contextTarget)}>{contextTarget.pinned ? "Unpin Tab" : "Pin Tab"}</button>
          <button disabled={contextTarget.url === "devflow://newtab"} onClick={() => { window.browserAPI.toggleTabMute(contextTarget.id); setContextTab(null); }}>{contextTarget.muted ? "Unmute Tab" : "Mute Tab"}</button>
          <button onClick={() => { if (contextTarget.pinned) window.browserAPI.closePinnedTab(contextTarget.id); else window.browserAPI.closeTab(contextTarget.id); setContextTab(null); }}>{contextTarget.pinned ? "Close Pinned Tab" : "Close Tab"}</button>
          <button disabled={tabs.length <= 1} onClick={() => { window.browserAPI.closeOtherTabs(contextTarget.id); setContextTab(null); }}>Close Other Tabs</button>
          <button disabled={tabs.findIndex(tab => tab.id === contextTarget.id) >= tabs.length - 1} onClick={() => { window.browserAPI.closeTabsToRight(contextTarget.id); setContextTab(null); }}>Close Tabs to the Right</button>
          <button disabled={closedTabCount === 0} onClick={() => { reopenClosed(); setContextTab(null); }}>Reopen Closed Tab</button>
        </div>}




      </div>

      {isFindOpen && <div className="find-bar" role="search" aria-label="Find in page">
        <label className="sr-only" htmlFor="find-in-page-input">Find in page</label>
        <input id="find-in-page-input" ref={findInputRef} value={findQuery} placeholder="Find in page" onChange={event => searchInPage(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); searchInPage(findQuery, event.shiftKey ? "previous" : "next"); } }} />
        <span className="find-result-count" aria-live="polite">{findError || (findQuery ? findResult.matches ? `${findResult.activeMatchOrdinal} of ${findResult.matches}` : findResult.finalUpdate ? "No matches found" : "Searching…" : "Type to find")}</span>
        <button type="button" title="Previous match" aria-label="Previous match" disabled={!findQuery || !findResult.matches} onClick={() => searchInPage(findQuery, "previous")}>↑</button>
        <button type="button" title="Next match" aria-label="Next match" disabled={!findQuery || !findResult.matches} onClick={() => searchInPage(findQuery, "next")}>↓</button>
        <button type="button" title="Close find" aria-label="Close find" onClick={closeFindPanel}>×</button>
      </div>}

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
                <NewTabBackground settings={newTabBackgroundPreview || newTabBackgroundSettings} />
                <button type="button" className="new-tab-customize-trigger" onClick={() => { setNewTabBackgroundPreview(newTabBackgroundSettings); setIsNewTabCustomizeOpen(true); }}>Customize</button>
                {isNewTabCustomizeOpen && <NewTabCustomize settings={newTabBackgroundSettings} onPreview={setNewTabBackgroundPreview} onApply={applyNewTabBackground} onClose={() => { setNewTabBackgroundPreview(null); setIsNewTabCustomizeOpen(false); }} />}
                <div className="new-tab-content">
                <div className="new-tab-greeting"><span>{clock.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span><h1>{clock.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</h1><p>Your flow starts here.</p></div>
                <div className="new-tab-search-wrap">
                  <form className="new-tab-search" onSubmit={event => { event.preventDefault(); navigateSearch(newTabSearchValue); }}>
                    <Icon name="search" /><input value={newTabSearchValue} onFocus={() => { setIsNewTabSearchFocused(true); setIsNewTabSuggestionsOpen(true); }} onBlur={() => { setIsNewTabSearchFocused(false); setIsNewTabSuggestionsOpen(false); }} onChange={event => { setNewTabSearchValue(event.target.value); setNewTabSuggestions([]); setNewTabSuggestionError(""); setNewTabSelectedIndex(-1); setIsNewTabSuggestionsOpen(true); }} onKeyDown={event => { if (event.key === "ArrowDown" && newTabSuggestions.length) { event.preventDefault(); setNewTabSelectedIndex(i => (i + 1) % newTabSuggestions.length); } else if (event.key === "ArrowUp" && newTabSuggestions.length) { event.preventDefault(); setNewTabSelectedIndex(i => i <= 0 ? newTabSuggestions.length - 1 : i - 1); } else if (event.key === "Enter" && newTabSelectedIndex >= 0 && newTabSuggestions[newTabSelectedIndex]) { event.preventDefault(); selectNewTabSuggestion(newTabSuggestions[newTabSelectedIndex]); } else if (event.key === "Escape") { setIsNewTabSuggestionsOpen(false); setNewTabSuggestions([]); setNewTabSuggestionError(""); } }} placeholder={`Search with ${selectedSearchEngine.name} or enter a URL`} /><button type="submit">Search</button>
                  </form>
                  {isNewTabSearchFocused && isNewTabSuggestionsOpen && (newTabSuggestions.length > 0 || newTabSuggestionError) && <div className="new-tab-suggestions" role="listbox">{newTabSuggestions.map((item, index) => <button type="button" role="option" aria-selected={index === newTabSelectedIndex} className={index === newTabSelectedIndex ? "selected" : ""} key={`${item}-${index}`} onMouseDown={event => event.preventDefault()} onClick={() => selectNewTabSuggestion(item)}>{item}</button>)}{newTabSuggestionError && <p role="status">{newTabSuggestionError}</p>}</div>}
                </div>
                <div className="new-tab-section">
                  <div className="new-tab-section-title"><h2>Shortcuts</h2><button onClick={() => openShortcutDialog()}>+ Add shortcut</button></div>
                  <div className="shortcut-grid">{uniqueBookmarks.map(item => <article className="shortcut-card" key={item.id}>
                    <button className="shortcut-open" onClick={() => openSavedPage(item.url)} title={`Open ${item.title}`}><SiteFavicon url={item.url} title={item.title} /><strong>{item.title || new URL(item.url).hostname}</strong></button>
                    <div className="shortcut-actions"><button title="Edit shortcut" aria-label={`Edit ${item.title}`} onClick={() => openShortcutDialog(item)}>Edit</button><button title="Remove shortcut" aria-label={`Remove ${item.title}`} onClick={() => deleteShortcut(item)}>Remove</button></div>
                  </article>)}</div>
                  {uniqueBookmarks.length === 0 && <p>Add a website shortcut or bookmark to see it here.</p>}
                </div>
                <div className="new-tab-section"><h2>Frequently visited</h2><div className="shortcut-grid">{frequentSites.map(item => <button className="shortcut-card frequent-card" key={item.url} onClick={() => openSavedPage(item.url)}><SiteFavicon url={item.url} title={item.title} /><strong>{item.title || new URL(item.url).hostname}</strong><small>{item.visits} {item.visits === 1 ? "visit" : "visits"}</small></button>)}{frequentSites.length === 0 && <p>Pages you visit will appear here.</p>}</div></div>
                <div className="new-tab-section"><h2>Recently visited</h2><div className="recent-pages">{recentSites.map(item => <button key={canonicalPage(item.url)} onClick={() => openSavedPage(item.url)}><SiteFavicon url={item.url} title={item.title} /><span className="recent-page-copy"><strong>{item.title || new URL(item.url).hostname}</strong><span>{new URL(item.url).host}</span></span><time>{item.visited_at ? new Date(item.visited_at).toLocaleDateString() : ""}</time></button>)}{recentSites.length === 0 && <p>Your recent pages will appear here.</p>}</div></div>
                <footer>DEV<span>FLOW</span> · A calmer place to build and browse</footer>
                </div>
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
