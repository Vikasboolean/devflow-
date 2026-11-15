
import { useMemo, useState } from "react";
import "./DeveloperConsole.css";

function DeveloperConsole({ messages = [], activeTabId, onClear, onAddMessage }) {
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");

    const [code, setCode] = useState(
        'console.log("Hello from DevFlow!");\n\n2 + 2'
    );

    const [executing, setExecuting] = useState(false);
    const [executionResult, setExecutionResult] = useState(null);

    const visibleMessages = useMemo(() => {
        return messages.filter((item) => {
            const belongsToActiveTab = item.tabId === activeTabId;
            const level = String(item.level).toLowerCase();

            const type =
                level === "error" ? "error" :
                    level === "warning" ? "warning" :
                        level === "debug" ? "verbose" : "log";

            const matchesFilter = filter === "all" || type === filter;

            const matchesSearch =
                !search ||
                item.message?.toLowerCase().includes(search.toLowerCase()) ||
                item.source?.toLowerCase().includes(search.toLowerCase());

            return belongsToActiveTab && matchesFilter && matchesSearch;
        });
    }, [messages, activeTabId, filter, search]);

    const getType = (level) => {
        const value = String(level).toLowerCase();

        if (value === "error") return "error";
        if (value === "warning") return "warning";
        if (value === "debug") return "verbose";

        return "log";
    };

    const getLabel = (type) => {
        if (type === "error") return "ERROR";
        if (type === "warning") return "WARN";
        if (type === "verbose") return "VERBOSE";
        return "LOG";
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return "";
        return new Date(timestamp).toLocaleTimeString();
    };


    const runCode = async () => {
        if (!code.trim() || executing) return;

        if (!activeTabId) {
            setExecutionResult({
                success: false,
                output: "No active browser tab"
            });
            return;
        }

        setExecuting(true);

        const addConsoleEntry = (level, message) => {
            onAddMessage?.({
                tabId: activeTabId,
                level,
                message: String(message),
                source: "DevFlow Executor",
                lineNumber: 0,
                timestamp: new Date().toISOString()
            });
        };

        addConsoleEntry("info", `> ${code}`);

        try {
            const response = await window.browserAPI.executeJavaScript(code);

            if (!response.success) {
                addConsoleEntry("error", response.error || "Execution failed");
                return;
            }

            let output;

            if (response.result === undefined) {
                output = "undefined";
            } else if (typeof response.result === "string") {
                output = response.result;
            } else {
                try {
                    output = JSON.stringify(response.result, null, 2);
                } catch {
                    output = String(response.result);
                }
            }

            addConsoleEntry("info", `Result: ${output}`);

        } catch (error) {
            addConsoleEntry("error", error.message || "Execution failed");
        } finally {
            setExecuting(false);
        }
    };


    const clearExecution = () => {
        setExecutionResult(null);
    };

    return (
        <div className="dev-console">

            <div className="dev-console-header">
                <div>
                    <h2>Developer Console</h2>
                    <p>Inspect and execute JavaScript in the active tab</p>
                </div>

                <button className="console-clear" onClick={onClear}>
                    Clear Console
                </button>
            </div>

            {/* JavaScript Executor */}
            <div className="js-executor">
                <div className="executor-heading">
                    <div>
                        <h3>JavaScript Executor</h3>
                        <span>Run JavaScript in the active webpage</span>
                    </div>

                    <button
                        className="run-code-btn"
                        onClick={runCode}
                        disabled={executing || !activeTabId}
                    >
                        {executing ? "Running..." : "▶ Run Code"}
                    </button>
                </div>

                <textarea
                    className="js-code-editor"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    spellCheck={false}
                    placeholder="Write JavaScript here..."
                />


            </div>

            {/* Console Toolbar */}
            <div className="console-toolbar">
                <select
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                >
                    <option value="all">All messages</option>
                    <option value="log">Logs</option>
                    <option value="verbose">Verbose</option>
                    <option value="warning">Warnings</option>
                    <option value="error">Errors</option>
                </select>

                <input
                    type="text"
                    placeholder="Filter console messages..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />

                <span className="console-count">
                    {visibleMessages.length} messages
                </span>
            </div>

            {/* Console Output */}
            <div className="console-output">
                {visibleMessages.map((item, index) => {
                    const type = getType(item.level);

                    return (
                        <div
                            className={`console-message ${type}`}
                            key={`${item.timestamp}-${index}`}
                        >
                            <span className="console-type">
                                {getLabel(type)}
                            </span>

                            <div className="console-message-content">
                                <pre>{item.message}</pre>

                                {item.source && (
                                    <small>
                                        {item.source}
                                        {item.lineNumber > 0 && `:${item.lineNumber}`}
                                    </small>
                                )}
                            </div>

                            <time>{formatTime(item.timestamp)}</time>
                        </div>
                    );
                })}

                {visibleMessages.length === 0 && (
                    <div className="console-empty">
                        <span>⌘</span>
                        <h3>No console messages</h3>
                        <p>
                            Try opening a webpage that generates console logs or errors.
                        </p>
                    </div>
                )}
            </div>

            <div className="console-footer">
                Showing messages for the active browser tab
            </div>

        </div>
    );
}

export default DeveloperConsole;
