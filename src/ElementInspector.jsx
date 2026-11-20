
import { useEffect, useState } from "react";
import "./ElementInspector.css";

function ElementInspector({ activeTabId }) {
  const [inspecting, setInspecting] = useState(false);
  const [element, setElement] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = window.browserAPI.onElementSelected((data) => {
      if (data.tabId !== activeTabId) return;
      setElement(data);
      setActiveSection("overview");
    });

    return () => {
      unsubscribe();
      window.browserAPI.stopElementInspection().catch(() => {});
    };
  }, [activeTabId]);

  const startInspecting = async () => {
    setError("");
    setElement(null);

    const result = await window.browserAPI.startElementInspection();

    if (result?.success) {
      setInspecting(true);
    } else {
      setError(result?.error || "Could not start inspection");
    }
  };

  const stopInspecting = async () => {
    await window.browserAPI.stopElementInspection();
    setInspecting(false);
  };

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value || "");
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  return (
    <div className="element-inspector">
      <header className="inspector-header">
        <div>
          <h2>Element Inspector</h2>
          <p>Inspect and explore webpage elements</p>
        </div>

        <button
          className={inspecting ? "inspect-active" : "inspect-button"}
          onClick={inspecting ? stopInspecting : startInspecting}
        >
          {inspecting ? "Stop Inspecting" : "◎ Inspect Element"}
        </button>
      </header>

      {error && <div className="inspector-error">{error}</div>}

      {inspecting && (
        <div className="inspector-hint">
          Move your mouse over the webpage and click an element to inspect it.
        </div>
      )}

      {!element ? (
        <div className="inspector-empty">
          <div className="inspector-empty-icon">⌕</div>
          <h3>No element selected</h3>
          <p>Click Inspect Element, then select an element on the webpage.</p>
        </div>
      ) : (
        <>
          <div className="inspector-element-title">
            <span className="element-tag">&lt;{element.tagName}&gt;</span>
            {element.id && <span>#{element.id}</span>}
            <button onClick={() => copyText(element.selector)}>
              Copy Selector
            </button>
          </div>

          <nav className="inspector-tabs">
            {["overview", "styles", "attributes", "html"].map((section) => (
              <button
                key={section}
                className={activeSection === section ? "active" : ""}
                onClick={() => setActiveSection(section)}
              >
                {section}
              </button>
            ))}
          </nav>

          <div className="inspector-content">
            {activeSection === "overview" && (
              <>
                <h3>Element Details</h3>
                <div className="inspector-row">
                  <span>Tag</span>
                  <strong>{element.tagName}</strong>
                </div>
                <div className="inspector-row">
                  <span>ID</span>
                  <strong>{element.id || "None"}</strong>
                </div>
                <div className="inspector-row">
                  <span>Classes</span>
                  <strong>{element.className || "None"}</strong>
                </div>
                <div className="inspector-row">
                  <span>Text</span>
                  <strong>{element.text || "None"}</strong>
                </div>
                <div className="inspector-row">
                  <span>Dimensions</span>
                  <strong>
                    {element.dimensions.width} × {element.dimensions.height}px
                  </strong>
                </div>
                <div className="inspector-row">
                  <span>Selector</span>
                  <strong className="selector-value">{element.selector}</strong>
                </div>
              </>
            )}

            {activeSection === "styles" && (
              <>
                <h3>Computed Styles</h3>
                {Object.entries(element.styles || {}).map(([key, value]) => (
                  <div className="inspector-row" key={key}>
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </>
            )}

            {activeSection === "attributes" && (
              <>
                <h3>HTML Attributes</h3>
                {element.attributes?.length ? (
                  element.attributes.map((attr, index) => (
                    <div className="inspector-row" key={`${attr.name}-${index}`}>
                      <span>{attr.name}</span>
                      <strong>{attr.value || '""'}</strong>
                    </div>
                  ))
                ) : (
                  <p>No attributes found.</p>
                )}
              </>
            )}

            {activeSection === "html" && (
              <>
                <div className="inspector-html-heading">
                  <h3>Outer HTML</h3>
                  <button onClick={() => copyText(element.outerHTML)}>
                    Copy HTML
                  </button>
                </div>
                <pre className="inspector-html">
                  {element.outerHTML}
                </pre>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ElementInspector;
