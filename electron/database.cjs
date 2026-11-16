const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const dataDirectory = app.getPath("userData");
const dbPath = path.join(dataDirectory, "devflow-data.json");

function emptyData() {
  return {
    bookmarks: [],
    history: [],
    apiCollections: [],
    savedRequests: [],
    downloads: [],
    settings: {
      searchEngine: "google",
      homepage: "https://www.google.com",
      startupBehavior: "homepage",
      theme: "dark",
      downloadLocation: ""
    },
    nextIds: {
      bookmark: 1,
      history: 1,
      collection: 1,
      request: 1
    }
  };
}

function readData() {
  try {
    const stored = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    const defaults = emptyData();
    return {
      ...defaults,
      ...stored,
      bookmarks: Array.isArray(stored.bookmarks) ? stored.bookmarks : [],
      history: Array.isArray(stored.history) ? stored.history : [],
      apiCollections: Array.isArray(stored.apiCollections)
        ? stored.apiCollections
        : [],
      savedRequests: Array.isArray(stored.savedRequests)
        ? stored.savedRequests
        : [],
      nextIds: { ...defaults.nextIds, ...stored.nextIds },
      downloads: Array.isArray(stored.downloads)
        ? stored.downloads
        : [],
      settings: {
        ...defaults.settings,
        ...(stored.settings || {})
      }
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyData();
    throw error;
  }
}

function writeData(data) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryPath = `${dbPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporaryPath, dbPath);
}

function nextId(data, table) {
  const id = data.nextIds[table];
  data.nextIds[table] += 1;
  return id;
}

function addBookmark(title, url) {
  const data = readData();
  const existing = data.bookmarks.find((bookmark) => bookmark.url === url);

  if (existing) {
    existing.title = title;
  } else {
    data.bookmarks.unshift({
      id: nextId(data, "bookmark"),
      title,
      url,
      created_at: new Date().toISOString()
    });
  }

  writeData(data);
}

function addCollection(name) {
  const data = readData();
  if (data.apiCollections.some((collection) => collection.name === name)) {
    throw new Error("A collection with this name already exists");
  }

  const collection = {
    id: nextId(data, "collection"),
    name,
    created_at: new Date().toISOString()
  };
  data.apiCollections.unshift(collection);
  writeData(data);
  return collection;
}

function saveRequest(request) {
  const data = readData();
  const saved = {
    id: nextId(data, "request"),
    collection_id: request.collectionId,
    name: request.name,
    method: request.method,
    url: request.url,
    headers: JSON.stringify(request.headers || {}),
    body: request.body || "",
    auth_type: request.authType || "none",
    auth_config: JSON.stringify(request.authConfig || {}),
    created_at: new Date().toISOString()
  };
  data.savedRequests.unshift(saved);
  writeData(data);
  return saved;
}

function deleteCollection(id) {
  const data = readData();
  data.apiCollections = data.apiCollections.filter(
    (collection) => collection.id !== id
  );
  data.savedRequests = data.savedRequests.filter(
    (request) => request.collection_id !== id
  );
  writeData(data);
}

module.exports = {
  dbPath,
  addBookmark,
  getBookmarks: () => readData().bookmarks,
  deleteBookmark(id) {
    const data = readData();
    data.bookmarks = data.bookmarks.filter((bookmark) => bookmark.id !== id);
    writeData(data);
  },
  addHistory(title, url) {
    const data = readData();
    data.history.unshift({
      id: nextId(data, "history"),
      title,
      url,
      visited_at: new Date().toISOString()
    });
    data.history = data.history.slice(0, 1000);
    writeData(data);
  },
  getHistory: () => readData().history.slice(0, 100),
  clearHistory() {
    const data = readData();
    data.history = [];
    writeData(data);
  },
  addCollection,
  getCollections: () => readData().apiCollections,
  deleteCollection,
  saveRequest,
  getSavedRequests(collectionId) {
    return readData().savedRequests.filter(
      (request) => request.collection_id === collectionId
    );
  },
  deleteSavedRequest(id) {
    const data = readData();
    data.savedRequests = data.savedRequests.filter(
      (request) => request.id !== id
    );
    writeData(data);
  },

  // Download Manager Persistence

  saveDownload(download) {
    const data = readData();

    const record = {
      id: download.id,
      filename: download.filename || "Unknown file",
      url: download.url || "",
      mimeType: download.mimeType || "",
      state: download.state || "completed",
      receivedBytes: download.receivedBytes || 0,
      totalBytes: download.totalBytes || 0,
      filePath: download.filePath || "",
      startedAt: download.startedAt || Date.now(),
      completedAt: download.completedAt || Date.now(),
      error: download.error || null
    };

    const existingIndex = data.downloads.findIndex(
      item => item.id === record.id
    );

    if (existingIndex >= 0) {
      data.downloads[existingIndex] = record;
    } else {
      data.downloads.unshift(record);
    }

    data.downloads = data.downloads.slice(0, 200);

    writeData(data);
    return record;
  },

  getDownloads() {
    return readData().downloads;
  },

  deleteDownload(id) {
    const data = readData();

    data.downloads = data.downloads.filter(
      item => item.id !== id
    );

    writeData(data);
  },

  clearDownloads() {
    const data = readData();
    data.downloads = [];
    writeData(data);
  },

  // Browser Settings
  getSettings() {
    return readData().settings;
  },

  updateSettings(newSettings) {
    const data = readData();

    data.settings = {
      ...data.settings,
      ...newSettings
    };

    writeData(data);
    return data.settings;
  }
};
