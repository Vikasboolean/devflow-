
import { useEffect, useState } from "react";
import "./ApiTester.css";

function ApiTester() {
  // Request configuration
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState(
    "https://jsonplaceholder.typicode.com/posts/1"
  );

  const [headers, setHeaders] = useState(
    '{\n  "Accept": "application/json"\n}'
  );

  const [body, setBody] = useState(
    '{\n  "title": "DevFlow API Test",\n  "body": "Testing API",\n  "userId": 1\n}'
  );

  // Authentication
  const [authType, setAuthType] = useState("none");
  const [authConfig, setAuthConfig] = useState({
    token: "",
    username: "",
    password: "",
    key: "",
    value: "",
    location: "header"
  });

  const [activeEditor, setActiveEditor] = useState("headers");

  // Response
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Collections
  const [collections, setCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [savedRequests, setSavedRequests] = useState([]);
  const [requestName, setRequestName] = useState("");

  const updateAuth = (key, value) => {
    setAuthConfig(previous => ({
      ...previous,
      [key]: value
    }));
  };

  // Load collections
  const loadCollections = async () => {
    try {
      const data = await window.browserAPI.getCollections();
      setCollections(data);
    } catch {
      setError("Unable to load collections");
    }
  };

  // Load saved requests
  const loadSavedRequests = async (collectionId) => {
    try {
      const data = await window.browserAPI.getSavedRequests(collectionId);
      setSavedRequests(data);
    } catch {
      setError("Unable to load saved requests");
    }
  };

  useEffect(() => {
    loadCollections();
  }, []);

  // Create collection
  const createCollection = async () => {
    const name = prompt("Enter collection name:");

    if (!name?.trim()) return;

    const result = await window.browserAPI.addCollection(name);

    if (!result.success) {
      alert(result.error || "Unable to create collection");
      return;
    }

    await loadCollections();
    setSelectedCollection(result.id);
    setSavedRequests([]);
  };

  // Select collection
  const selectCollection = async (id) => {
    setSelectedCollection(id);
    await loadSavedRequests(id);
  };

  // Delete collection
  const removeCollection = async (id) => {
    if (!confirm("Delete this collection and its saved requests?")) {
      return;
    }

    const result = await window.browserAPI.deleteCollection(id);

    if (result.success) {
      if (selectedCollection === id) {
        setSelectedCollection(null);
        setSavedRequests([]);
      }

      await loadCollections();
    } else {
      alert("Unable to delete collection");
    }
  };

  // Validate authentication
  const validateAuth = () => {
    if (authType === "bearer" && !authConfig.token.trim()) {
      throw new Error("Please enter a Bearer token");
    }

    if (
      authType === "basic" &&
      (!authConfig.username || !authConfig.password)
    ) {
      throw new Error("Please enter username and password");
    }

    if (
      authType === "apikey" &&
      (!authConfig.key.trim() || !authConfig.value)
    ) {
      throw new Error("Please enter API key and value");
    }
  };

  // Send API request
  const sendRequest = async () => {
    setLoading(true);
    setError("");
    setResponse(null);

    try {
      const parsedHeaders = JSON.parse(headers);

      if (
        !parsedHeaders ||
        typeof parsedHeaders !== "object" ||
        Array.isArray(parsedHeaders)
      ) {
        throw new Error("Headers must be a JSON object");
      }

      validateAuth();

      const result = await window.browserAPI.sendApiRequest({
        method,
        url,
        headers: parsedHeaders,
        body,
        authType,
        authConfig
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setResponse(result);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  };

  // Save API request
  const saveCurrentRequest = async () => {
    if (!selectedCollection) {
      alert("Please select a collection first.");
      return;
    }

    try {
      const parsedHeaders = JSON.parse(headers);

      if (
        !parsedHeaders ||
        typeof parsedHeaders !== "object" ||
        Array.isArray(parsedHeaders)
      ) {
        throw new Error("Headers must be a JSON object");
      }

      validateAuth();

      const result = await window.browserAPI.saveApiRequest({
        collectionId: selectedCollection,
        name: requestName.trim() || `${method} Request`,
        method,
        url: url.trim(),
        headers: parsedHeaders,
        body,
        authType,
        authConfig
      });

      if (!result.success) {
        throw new Error(result.error || "Unable to save request");
      }

      setRequestName("");
      await loadSavedRequests(selectedCollection);

      alert("Request saved successfully!");
    } catch (err) {
      alert(err.message);
    }
  };

  // Load saved request
  const loadRequest = async (item) => {
    const loaded = await window.browserAPI.getSavedRequest(item.id);
    if (!loaded?.success) {
      setError(loaded?.error || "Unable to load saved request");
      return;
    }
    item = loaded.request;
    setMethod(item.method);
    setUrl(item.url);

    try {
      setHeaders(
        JSON.stringify(
          typeof item.headers === "string"
            ? JSON.parse(item.headers)
            : item.headers || {},
          null,
          2
        )
      );
    } catch {
      setHeaders("{}");
    }

    setBody(item.body || "");
    setAuthType(item.auth_type || "none");

    setAuthConfig({
      token: item.authConfig?.token || "",
      username: item.authConfig?.username || "",
      password: item.authConfig?.password || "",
      key: item.authConfig?.key || "",
      value: item.authConfig?.value || "",
      location: item.authConfig?.location || "header"
    });

    setResponse(null);
    setError("");
    setActiveEditor("auth");
  };

  // Delete saved request
  const removeSavedRequest = async (id) => {
    if (!confirm("Delete this saved request?")) return;

    const result = await window.browserAPI.deleteSavedRequest(id);

    if (result.success) {
      await loadSavedRequests(selectedCollection);
    } else {
      alert("Unable to delete request");
    }
  };

  return (
    <div className="api-container">

      {/* Header */}
      <div className="api-heading">
        <div>
          <h1>API Testing</h1>
          <p>Test and debug your REST APIs.</p>
        </div>

        <span className="api-version">REST CLIENT</span>
      </div>

      {/* Collections */}
      <div className="collections-area">
        <div className="collections-header">
          <h3>My Collections</h3>

          <button onClick={createCollection}>
            + New Collection
          </button>
        </div>

        {collections.map(item => (
          <div
            className={`collection-item ${
              selectedCollection === item.id ? "selected" : ""
            }`}
            key={item.id}
          >
            <span onClick={() => selectCollection(item.id)}>
              📁 {item.name}
            </span>

            <button onClick={() => removeCollection(item.id)}>
              ×
            </button>
          </div>
        ))}

        {collections.length === 0 && (
          <p>No collections created yet.</p>
        )}

        {selectedCollection && (
          <div className="saved-requests">
            <h4>Saved Requests</h4>

            {savedRequests.map(item => (
              <div className="saved-request" key={item.id}>
                <span onClick={() => loadRequest(item)}>
                  <strong>{item.method}</strong> {item.name}
                </span>

                <button onClick={() => removeSavedRequest(item.id)}>
                  ×
                </button>
              </div>
            ))}

            {savedRequests.length === 0 && (
              <p>No saved requests yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Save Request */}
      <div className="save-request-area">
        <input
          value={requestName}
          onChange={e => setRequestName(e.target.value)}
          placeholder="Request name (optional)"
        />

        <button onClick={saveCurrentRequest}>
          Save Request
        </button>
      </div>

      {/* Request URL */}
      <div className="request-box">
        <select
          value={method}
          onChange={e => setMethod(e.target.value)}
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Enter API endpoint URL"
        />

        <button onClick={sendRequest} disabled={loading}>
          {loading ? "Sending..." : "Send"}
        </button>
      </div>

      {/* Request editor tabs */}
      <div className="api-editor-tabs">
        <button
          className={activeEditor === "headers" ? "active" : ""}
          onClick={() => setActiveEditor("headers")}
        >
          Headers
        </button>

        <button
          className={activeEditor === "body" ? "active" : ""}
          onClick={() => setActiveEditor("body")}
        >
          Body
        </button>

        <button
          className={activeEditor === "auth" ? "active" : ""}
          onClick={() => setActiveEditor("auth")}
        >
          Authorization
        </button>
      </div>

      {/* Headers */}
      {activeEditor === "headers" && (
        <div className="editor-section">
          <h3>Request Headers (JSON)</h3>

          <textarea
            value={headers}
            onChange={e => setHeaders(e.target.value)}
            spellCheck="false"
          />
        </div>
      )}

      {/* Body */}
      {activeEditor === "body" && (
        <div className="editor-section">
          <h3>Request Body (JSON)</h3>

          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            spellCheck="false"
            disabled={method === "GET" || method === "HEAD"}
          />
        </div>
      )}

      {/* Authorization */}
      {activeEditor === "auth" && (
        <div className="auth-section">
          <h3>Authorization</h3>

          <div className="auth-type-row">
            <label>Authentication Type</label>

            <select
              value={authType}
              onChange={e => setAuthType(e.target.value)}
            >
              <option value="none">No Auth</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="apikey">API Key</option>
            </select>
          </div>

          {authType === "none" && (
            <p className="auth-description">
              This request does not use authentication.
            </p>
          )}

          {authType === "bearer" && (
            <div className="auth-fields">
              <label>Access Token</label>

              <input
                type="password"
                autoComplete="off"
                value={authConfig.token}
                onChange={e => updateAuth("token", e.target.value)}
                placeholder="Enter your Bearer token"
              />

              <p className="auth-description">
                The token will be sent as an Authorization Bearer header.
              </p>
            </div>
          )}

          {authType === "basic" && (
            <div className="auth-fields">
              <label>Username</label>

              <input
                autoComplete="off"
                value={authConfig.username}
                onChange={e => updateAuth("username", e.target.value)}
                placeholder="Enter username"
              />

              <label>Password</label>

              <input
                type="password"
                autoComplete="new-password"
                value={authConfig.password}
                onChange={e => updateAuth("password", e.target.value)}
                placeholder="Enter password"
              />
            </div>
          )}

          {authType === "apikey" && (
            <div className="auth-fields">
              <label>Key Name</label>

              <input
                value={authConfig.key}
                onChange={e => updateAuth("key", e.target.value)}
                placeholder="Example: x-api-key"
              />

              <label>API Key Value</label>

              <input
                type="password"
                autoComplete="off"
                value={authConfig.value}
                onChange={e => updateAuth("value", e.target.value)}
                placeholder="Enter API key"
              />

              <label>Add API Key To</label>

              <select
                value={authConfig.location}
                onChange={e => updateAuth("location", e.target.value)}
              >
                <option value="header">Request Header</option>
                <option value="query">Query Parameter</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* Response */}
      <div className="response-section">
        <h3>Response</h3>

        {loading && <p>Sending API request...</p>}

        {error && (
          <div className="api-error">{error}</div>
        )}

        {response && (
          <>
            <div className="response-meta">
              <span>
                Status: {response.status} {response.statusText}
              </span>

              <span>Time: {response.duration} ms</span>

              <span>Size: {response.size} bytes</span>
            </div>

            <div className="response-headers">
              <h4>Response Headers</h4>
              <pre>
                {JSON.stringify(response.headers, null, 2)}
              </pre>
            </div>

            <div className="response-body">
              <h4>Response Body</h4>
              <pre>{response.body}</pre>

              {response.truncated && (
                <p>Response truncated at 1 MB.</p>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

export default ApiTester;
