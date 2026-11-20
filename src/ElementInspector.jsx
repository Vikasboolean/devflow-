
import { useEffect, useState } from "react";
import "./ElementInspector.css";


function DOMTreeNode({
  node,
  depth = 0,
  expanded,
  onToggle,
  onSelect,
  selectedSelector
}) {
  const isExpanded = expanded.has(node.selector);
  const isSelected = selectedSelector === node.selector;

  return (
    <div className="dom-tree-node">
      <div
        className={`dom-tree-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <button
          className="dom-tree-toggle"
          onClick={() => onToggle(node.selector)}
          disabled={!node.hasChildren}
        >
          {node.hasChildren ? (isExpanded ? "▾" : "▸") : " "}
        </button>

        <button
          className="dom-tree-element"
          onClick={() => onSelect(node)}
        >
          <span className="dom-tree-tag">
            {node.tagName}
          </span>

          {node.id && (
            <span className="dom-tree-id">#{node.id}</span>
          )}

          {!node.id && node.className && (
            <span className="dom-tree-class">
              .{node.className.trim().split(/\s+/).slice(0, 2).join(".")}
            </span>
          )}
        </button>
      </div>

      {isExpanded && node.children?.map((child) => (
        <DOMTreeNode
          key={child.selector}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          selectedSelector={selectedSelector}
        />
      ))}
    </div>
  );
}


function ElementInspector({ activeTabId }) {
  const [inspecting, setInspecting] = useState(false);
  const [element, setElement] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [error, setError] = useState("");
  const [domTree, setDomTree] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [cssProperty, setCssProperty] = useState("background-color");
  const [cssValue, setCssValue] = useState("");
  const [cssSaving, setCssSaving] = useState(false);
  const [cssMessage, setCssMessage] = useState("");
  const [boxModel, setBoxModel] = useState(null);
  const [boxModelLoading, setBoxModelLoading] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [htmlSaving, setHtmlSaving] = useState(false);
  const [htmlMessage, setHtmlMessage] = useState("");


  useEffect(() => {
    const unsubscribe = window.browserAPI.onElementSelected((data) => {
      if (data.tabId !== activeTabId) return;

      setElement(data);
      setHtmlDraft(data.innerHTML || "");
      setHtmlMessage("");
      setActiveSection("overview");

      if (data.selector) {
        loadBoxModel(data.selector);
        highlightElement(data.selector);
      }
    });

    return () => {
      unsubscribe();
      window.browserAPI.stopElementInspection().catch(() => { });
    };
  }, [activeTabId]);


  useEffect(() => {
    loadDOMTree();
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


  const loadDOMTree = async () => {
    setTreeLoading(true);
    setTreeError("");

    try {
      const result = await window.browserAPI.getDOMTree();

      if (result?.success) {
        setDomTree(result.tree);

        if (result.tree) {
          setExpandedNodes(new Set([result.tree.selector]));
        }
      } else {
        setTreeError(result?.error || "Could not load DOM tree");
      }
    } catch (err) {
      setTreeError(err.message || "DOM tree loading failed");
    } finally {
      setTreeLoading(false);
    }
  };

  const toggleDOMNode = (selector) => {
    setExpandedNodes(previous => {
      const next = new Set(previous);

      if (next.has(selector)) {
        next.delete(selector);
      } else {
        next.add(selector);
      }

      return next;
    });
  };

  const selectDOMNode = async (node) => {
    setError("");

    try {
      const result = await window.browserAPI.selectDOMElement(
        node.selector
      );

      if (result?.success) {
        setElement(result);
        setActiveSection("overview");

        await highlightElement(node.selector);
        await loadBoxModel(node.selector);
      } else {
        setError(result?.error || "Could not select element");
      }
    } catch (err) {
      setError(err.message || "Element selection failed");
    }
  };


  const applyCSSChange = async () => {
    if (!element?.selector) {
      setCssMessage("Select an element first.");
      return;
    }

    if (!cssProperty || !cssValue.trim()) {
      setCssMessage("Enter a CSS property and value.");
      return;
    }

    setCssSaving(true);
    setCssMessage("");

    try {
      const result = await window.browserAPI.updateElementStyle(
        element.selector,
        cssProperty,
        cssValue.trim()
      );

      if (!result?.success) {
        setCssMessage(result?.error || "CSS update failed.");
        return;
      }

      // Refresh selected element details after applying CSS.
      const refreshed = await window.browserAPI.selectDOMElement(
        element.selector
      );

      if (refreshed?.success) {
        setElement(refreshed);
      }

      setCssMessage("CSS applied successfully!");
    } catch (err) {
      setCssMessage(err.message || "CSS update failed.");
    } finally {
      setCssSaving(false);
    }
  };


  const loadBoxModel = async (selector) => {
    if (!selector) return;

    setBoxModelLoading(true);

    try {
      const result = await window.browserAPI.getElementBoxModel(selector);

      if (result?.success) {
        setBoxModel(result);
      } else {
        setBoxModel(null);
        setError(result?.error || "Could not load Box Model");
      }
    } catch (err) {
      setError(err.message || "Box Model loading failed");
    } finally {
      setBoxModelLoading(false);
    }
  };

  const highlightElement = async (selector) => {
    if (!selector) return;

    try {
      const result = await window.browserAPI.highlightDOMElement(selector);

      if (!result?.success) {
        setError(result?.error || "Could not highlight element");
      }
    } catch (err) {
      setError(err.message || "Highlight failed");
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
            {["dom", "overview", "styles", "edit-css", "box-model", "attributes", "html"].map((section) => (
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

            {activeSection === "dom" && (
              <div className="dom-tree-panel">
                <div className="dom-tree-heading">
                  <h3>DOM Structure</h3>

                  <button
                    onClick={loadDOMTree}
                    disabled={treeLoading}
                  >
                    {treeLoading ? "Loading..." : "↻ Refresh"}
                  </button>
                </div>

                {treeError && (
                  <div className="inspector-error">{treeError}</div>
                )}

                {treeLoading && !domTree && (
                  <p>Loading DOM tree...</p>
                )}

                {!treeLoading && domTree && (
                  <div className="dom-tree-list">
                    <DOMTreeNode
                      node={domTree}
                      depth={0}
                      expanded={expandedNodes}
                      onToggle={toggleDOMNode}
                      onSelect={selectDOMNode}
                      selectedSelector={element?.selector}
                    />
                  </div>
                )}

                {!treeLoading && !domTree && !treeError && (
                  <p>No DOM structure available.</p>
                )}
              </div>
            )}


            {activeSection === "edit-css" && (
              <div className="css-editor-panel">
                <h3>Live CSS Editor</h3>

                <label>CSS Property</label>

                <select
                  value={cssProperty}
                  onChange={(e) => setCssProperty(e.target.value)}
                >
                  <option value="color">color</option>
                  <option value="background-color">background-color</option>
                  <option value="font-size">font-size</option>
                  <option value="font-weight">font-weight</option>
                  <option value="width">width</option>
                  <option value="height">height</option>
                  <option value="padding">padding</option>
                  <option value="margin">margin</option>
                  <option value="border">border</option>
                  <option value="border-radius">border-radius</option>
                  <option value="display">display</option>
                  <option value="opacity">opacity</option>
                  <option value="box-shadow">box-shadow</option>
                </select>

                <label>CSS Value</label>

                <input
                  type="text"
                  value={cssValue}
                  onChange={(e) => setCssValue(e.target.value)}
                  placeholder="Example: #2563eb, 20px, flex"
                />

                <button
                  className="css-apply-button"
                  onClick={applyCSSChange}
                  disabled={cssSaving}
                >
                  {cssSaving ? "Applying..." : "Apply CSS"}
                </button>

                {cssMessage && (
                  <p className="css-editor-message">{cssMessage}</p>
                )}

                <p className="css-editor-note">
                  Changes are applied directly to the selected webpage element.
                </p>
              </div>
            )}


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


            {activeSection === "box-model" && (
              <div className="box-model-panel">
                <h3>CSS Box Model</h3>

                {boxModelLoading && <p>Loading Box Model...</p>}

                {!boxModelLoading && boxModel && (
                  <>
                    <div className="box-model-dimensions">
                      <span>Width: {boxModel.width}px</span>
                      <span>Height: {boxModel.height}px</span>
                    </div>

                    <div className="box-model-margin">
                      <span className="box-model-label">MARGIN</span>

                      <div className="box-model-side-values">
                        <span>Top: {boxModel.margin.top}px</span>
                        <span>Right: {boxModel.margin.right}px</span>
                        <span>Bottom: {boxModel.margin.bottom}px</span>
                        <span>Left: {boxModel.margin.left}px</span>
                      </div>

                      <div className="box-model-border">
                        <span className="box-model-label">BORDER</span>

                        <div className="box-model-side-values">
                          <span>Top: {boxModel.border.top}px</span>
                          <span>Right: {boxModel.border.right}px</span>
                          <span>Bottom: {boxModel.border.bottom}px</span>
                          <span>Left: {boxModel.border.left}px</span>
                        </div>

                        <div className="box-model-padding">
                          <span className="box-model-label">PADDING</span>

                          <div className="box-model-side-values">
                            <span>Top: {boxModel.padding.top}px</span>
                            <span>Right: {boxModel.padding.right}px</span>
                            <span>Bottom: {boxModel.padding.bottom}px</span>
                            <span>Left: {boxModel.padding.left}px</span>
                          </div>

                          <div className="box-model-content">
                            <strong>CONTENT</strong>
                            <span>
                              {Math.round(boxModel.content.width)} ×
                              {Math.round(boxModel.content.height)}px
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="box-model-info">
                      Box Sizing: {boxModel.boxSizing}
                    </div>
                  </>
                )}
              </div>
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
