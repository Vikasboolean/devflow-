
import { useEffect, useState } from "react";
import "./DownloadManager.css";

function formatBytes(bytes) {
    if (bytes == null || !Number.isFinite(Number(bytes))) return "Unknown";

    const value = Number(bytes);
    if (value === 0) return "0 B";

    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(
        Math.floor(Math.log(value) / Math.log(1024)),
        units.length - 1
    );

    return `${(value / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function formatSpeed(bytes) {
    return `${formatBytes(bytes)}/s`;
}

function formatDate(timestamp) {
    if (!timestamp) return "—";
    return new Date(timestamp).toLocaleString();
}

function getStatusLabel(download) {
    if (download.state === "progressing") return "Downloading";
    if (download.state === "paused") return "Paused";
    if (download.state === "completed") return "Completed";
    if (download.state === "cancelled") return "Cancelled";
    if (download.state === "interrupted") return "Interrupted";
    return download.state || "Unknown";
}


function getFileIcon(download) {
    const filename = download.filename || download.url?.split("/").pop() || "";
    const extension = filename.split("?")[0].split(".").pop()?.toLowerCase();
    const mimeType = download.mimeType?.toLowerCase() || "";

    if (extension === "pdf" || mimeType.includes("pdf")) return "📕";

    if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "🗜️";

    if (["exe", "msi", "apk", "dmg"].includes(extension)) return "⚙️";

    if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) return "🖼️";

    if (["mp4", "mkv", "mov", "avi", "webm"].includes(extension)) return "🎬";

    if (["mp3", "wav", "ogg", "flac", "aac"].includes(extension)) return "🎵";

    if (["doc", "docx", "txt", "rtf"].includes(extension)) return "📄";

    if (["xls", "xlsx", "csv"].includes(extension)) return "📊";

    if (["js", "jsx", "ts", "tsx", "html", "css", "json", "py", "java"].includes(extension)) return "💻";

    return "📦";
}


function DownloadManager() {
    const [downloads, setDownloads] = useState([]);
    const [filter, setFilter] = useState("all");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let mounted = true;

        const loadDownloads = async () => {
            try {
                const data = await window.browserAPI.getDownloads();
                if (mounted) setDownloads(Array.isArray(data) ? data : []);
            } catch (err) {
                if (mounted) setError(err.message || "Could not load downloads.");
            } finally {
                if (mounted) setLoading(false);
            }
        };

        loadDownloads();

        const unsubscribe = window.browserAPI.onDownloadsUpdated((data) => {
            if (mounted) {
                setDownloads(Array.isArray(data) ? data : []);
                setError("");
            }
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    const performAction = async (action, id) => {
        try {
            setError("");

            const result = await window.browserAPI.controlDownload(id, action);

            if (!result?.success) {
                setError(result?.error || `Could not ${action} download.`);
            }
        } catch (err) {
            setError(err.message || `Could not ${action} download.`);
        }
    };

    const removeDownload = async (id) => {
        try {
            setError("");

            const result = await window.browserAPI.removeDownload(id);

            if (!result?.success) {
                setError(result?.error || "Could not remove download.");
            }
        } catch (err) {
            setError(err.message || "Could not remove download.");
        }
    };

    const openFile = async (id) => {
        try {
            setError("");
            const result = await window.browserAPI.openDownloadedFile(id);

            if (!result?.success) {
                setError(result?.error || "Could not open downloaded file.");
            }
        } catch (err) {
            setError(err.message || "Could not open downloaded file.");
        }
    };

    const showFolder = async (id) => {
        try {
            setError("");
            const result = await window.browserAPI.showDownloadFolder(id);

            if (!result?.success) {
                setError(result?.error || "Could not open download folder.");
            }
        } catch (err) {
            setError(err.message || "Could not open download folder.");
        }
    };

    const activeDownloads = downloads.filter((item) =>
        ["progressing", "paused"].includes(item.state)
    );

    const completedDownloads = downloads.filter(
        (item) => item.state === "completed"
    );

    const failedDownloads = downloads.filter((item) =>
        ["interrupted", "cancelled"].includes(item.state)
    );

    const filteredDownloads = downloads.filter((item) => {
        if (filter === "active") {
            return ["progressing", "paused"].includes(item.state);
        }

        if (filter === "completed") return item.state === "completed";

        if (filter === "failed") {
            return ["interrupted", "cancelled"].includes(item.state);
        }

        return true;
    });

    const getFileName = (download) =>
        download.filename || download.url?.split("/").pop() || "Unknown file";

    return (
        <div className="download-manager">
            <div className="download-header">
                <div>
                    <h2>Download Manager</h2>
                    <p>Manage your browser downloads in one place</p>
                </div>

                <div className="download-header-icon">↓</div>
            </div>

            {error && (
                <div className="download-error">
                    {error}
                    <button onClick={() => setError("")}>×</button>
                </div>
            )}

            <div className="download-stats">
                <div className="download-stat-card">
                    <span>All Downloads</span>
                    <strong>{downloads.length}</strong>
                </div>

                <div className="download-stat-card">
                    <span>Active</span>
                    <strong className="active-number">{activeDownloads.length}</strong>
                </div>

                <div className="download-stat-card">
                    <span>Completed</span>
                    <strong className="completed-number">{completedDownloads.length}</strong>
                </div>

                <div className="download-stat-card">
                    <span>Failed / Cancelled</span>
                    <strong className="failed-number">{failedDownloads.length}</strong>
                </div>
            </div>

            <div className="download-toolbar">
                <div className="download-filters">
                    {[
                        ["all", "All"],
                        ["active", "Active"],
                        ["completed", "Completed"],
                        ["failed", "Failed"]
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            className={filter === value ? "selected" : ""}
                            onClick={() => setFilter(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <span className="download-count">
                    {filteredDownloads.length} downloads
                </span>
            </div>

            <div className="download-list">
                {loading ? (
                    <div className="download-empty">Loading downloads...</div>
                ) : filteredDownloads.length === 0 ? (
                    <div className="download-empty">
                        <div className="empty-download-icon">↓</div>
                        <h3>No downloads found</h3>
                        <p>Your downloads will appear here when you download a file.</p>
                    </div>
                ) : (
                    filteredDownloads.map((download) => {
                        const active = ["progressing", "paused"].includes(download.state);
                        const percent = download.percent;

                        return (
                            <div className="download-file" key={download.id}>
                                <div className="download-file-icon">
                                    {getFileIcon(download)}
                                </div>

                                <div className="download-file-info">
                                    <div className="download-file-heading">
                                        <strong title={getFileName(download)}>
                                            {getFileName(download)}
                                        </strong>

                                        <span className={`download-status ${download.state}`}>
                                            {getStatusLabel(download)}
                                        </span>
                                    </div>

                                    <div className="download-file-url" title={download.url}>
                                        {download.url}
                                    </div>

                                    {active && (
                                        <>
                                            <div className="download-progress-track">
                                                <div
                                                    className="download-progress-fill"
                                                    style={{
                                                        width: percent == null
                                                            ? "0%"
                                                            : `${percent}%`
                                                    }}
                                                />
                                            </div>

                                            <div className="download-progress-info">
                                                <span>
                                                    {percent == null ? "Progress unavailable" : `${percent}%`}
                                                    {" · "}
                                                    {formatBytes(download.receivedBytes)}
                                                    {" / "}
                                                    {formatBytes(download.totalBytes)}
                                                </span>

                                                <span>
                                                    {formatSpeed(download.speed)}
                                                </span>
                                            </div>
                                        </>
                                    )}

                                    {!active && (
                                        <div className="download-meta">
                                            <span>{formatBytes(download.receivedBytes)}</span>
                                            <span>{formatDate(download.completedAt || download.startedAt)}</span>
                                        </div>
                                    )}

                                    {download.error && (
                                        <div className="download-item-error">
                                            {download.error}
                                        </div>
                                    )}

                                    <div className="download-actions">
                                        {download.state === "progressing" && (
                                            <button onClick={() => performAction("pause", download.id)}>
                                                Pause
                                            </button>
                                        )}

                                        {download.state === "paused" && (
                                            <button onClick={() => performAction("resume", download.id)}>
                                                Resume
                                            </button>
                                        )}

                                        {active && (
                                            <button
                                                className="cancel-download"
                                                onClick={() => performAction("cancel", download.id)}
                                            >
                                                Cancel
                                            </button>
                                        )}

                                        {download.state === "completed" && (
                                            <>
                                                <button onClick={() => openFile(download.id)}>
                                                    Open File
                                                </button>
                                                <button onClick={() => showFolder(download.id)}>
                                                    Show in Folder
                                                </button>
                                            </>
                                        )}

                                        {!active && (
                                            <button
                                                className="remove-download"
                                                onClick={() => removeDownload(download.id)}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default DownloadManager;
