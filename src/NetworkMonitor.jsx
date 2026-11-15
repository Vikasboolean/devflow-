
import { useEffect, useMemo, useState } from "react";
import "./NetworkMonitor.css";

function NetworkMonitor({ activeTabId }) {
    const [requests, setRequests] = useState([]);
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [copyMessage, setCopyMessage] = useState("");

    useEffect(() => {
        if (!activeTabId) {
            setRequests([]);
            setSelectedRequest(null);
            return;
        }

        let mounted = true;

        const loadRequests = async () => {
            try {
                const data = await window.browserAPI.getNetworkRequests(activeTabId);

                if (mounted) {
                    setRequests(Array.isArray(data) ? data : []);
                }
            } catch (error) {
                console.error("Unable to load network requests:", error);
            }
        };

        loadRequests();

        const unsubscribe = window.browserAPI.onNetworkUpdated((entry) => {
            if (!mounted || entry.tabId !== activeTabId) return;

            setRequests((previous) => {
                const index = previous.findIndex((item) => item.id === entry.id);

                if (index === -1) {
                    return [...previous, entry].slice(-500);
                }

                const updated = [...previous];
                updated[index] = { ...updated[index], ...entry };
                return updated;
            });

            setSelectedRequest((previous) => {
                if (previous?.id !== entry.id) return previous;
                return { ...previous, ...entry };
            });
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [activeTabId]);

    const visibleRequests = useMemo(() => {
        return requests.filter((request) => {
            const matchesSearch =
                !search ||
                request.url?.toLowerCase().includes(search.toLowerCase()) ||
                request.method?.toLowerCase().includes(search.toLowerCase());

            let matchesFilter = true;

            if (filter === "fetch") {
                matchesFilter = ["XHR", "Fetch"].includes(request.resourceType);
            } else if (filter === "failed") {
                matchesFilter =
                    request.state === "failed" || request.status === "Failed";
            } else if (filter === "documents") {
                matchesFilter = request.resourceType === "mainFrame" ||
                    request.resourceType === "subFrame";
            } else if (filter !== "all") {
                matchesFilter = String(request.status) === filter;
            }

            return matchesSearch && matchesFilter;
        });
    }, [requests, filter, search]);


    const waterfallMetrics = useMemo(() => {
        if (visibleRequests.length === 0) {
            return { start: 0, total: 1 };
        }

        const start = Math.min(
            ...visibleRequests.map((item) => item.startedAt || Date.now())
        );

        const end = Math.max(
            ...visibleRequests.map((item) =>
                (item.startedAt || Date.now()) + (item.duration ?? 1)
            )
        );

        return {
            start,
            total: Math.max(end - start, 1)
        };
    }, [visibleRequests]);


    const performanceSummary = useMemo(() => {
        const completed = requests.filter(
            (request) =>
                request.state === "completed" &&
                Number.isFinite(Number(request.duration))
        );

        const failed = requests.filter(
            (request) =>
                request.state === "failed" ||
                request.status === "Failed" ||
                (
                    Number.isFinite(Number(request.status)) &&
                    Number(request.status) >= 400
                )
        );

        const slow = requests.filter(
            (request) =>
                Number.isFinite(Number(request.duration)) &&
                Number(request.duration) > 1000
        );

        const large = requests.filter((request) => {
            const size = Number(
                request.transferSize ?? request.responseBody?.size
            );

            return Number.isFinite(size) && size > 1024 * 1024;
        });

        const totalDuration = completed.reduce(
            (sum, request) => sum + Number(request.duration),
            0
        );

        const transferredBytes = requests.reduce((sum, request) => {
            const size = Number(
                request.transferSize ?? request.responseBody?.size
            );

            return sum + (
                Number.isFinite(size) && size >= 0 ? size : 0
            );
        }, 0);

        return {
            total: requests.length,
            completed: completed.length,
            failed: failed.length,
            slow: slow.length,
            large: large.length,
            averageDuration: completed.length
                ? totalDuration / completed.length
                : null,
            transferredBytes
        };
    }, [requests]);

    const resourceTypeSummary = useMemo(() => {
        const categories = [
            { label: "Documents", types: ["mainframe", "subframe", "document"] },
            { label: "JavaScript", types: ["script"] },
            { label: "Stylesheets", types: ["stylesheet"] },
            { label: "Images", types: ["image"] },
            { label: "Fetch / XHR", types: ["fetch", "xhr"] },
            { label: "Fonts", types: ["font"] },
            { label: "Other", types: ["other", "ping", "media", "websocket", "cspreport"] }
        ];

        const counts = categories.map((category) => {
            const count = requests.filter((request) =>
                category.types.includes(
                    String(request.resourceType || "other").toLowerCase()
                )
            ).length;

            return {
                label: category.label,
                count
            };
        });

        const total = counts.reduce((sum, item) => sum + item.count, 0);

        return counts.map((item) => ({
            ...item,
            percentage: total > 0
                ? (item.count / total) * 100
                : 0
        }));
    }, [requests]);


    const resourceSizeSummary = useMemo(() => {
        const categories = [
            { label: "Documents", types: ["mainframe", "subframe", "document"] },
            { label: "JavaScript", types: ["script"] },
            { label: "Stylesheets", types: ["stylesheet"] },
            { label: "Images", types: ["image"] },
            { label: "Fetch / XHR", types: ["fetch", "xhr"] },
            { label: "Fonts", types: ["font"] },
            { label: "Other", types: ["other", "ping", "media", "websocket", "cspreport"] }
        ];

        const knownRequests = requests.filter((request) =>
            request.transferSize !== null &&
            request.transferSize !== undefined &&
            Number.isFinite(Number(request.transferSize))
        );

        const categoryData = categories.map((category) => {
            const matching = knownRequests.filter((request) =>
                category.types.includes(
                    String(request.resourceType || "other").toLowerCase()
                )
            );

            const bytes = matching.reduce(
                (sum, request) => sum + Math.max(0, Number(request.transferSize)),
                0
            );

            return {
                label: category.label,
                bytes,
                count: matching.length
            };
        });

        const totalBytes = categoryData.reduce(
            (sum, item) => sum + item.bytes,
            0
        );

        const largestResources = [...knownRequests]
            .filter((request) => Number(request.transferSize) > 0)
            .sort(
                (a, b) =>
                    Number(b.transferSize) - Number(a.transferSize)
            )
            .slice(0, 5);

        return {
            categories: categoryData.map((item) => ({
                ...item,
                percentage: totalBytes > 0
                    ? (item.bytes / totalBytes) * 100
                    : 0
            })),
            totalBytes,
            knownCount: knownRequests.length,
            unknownCount: requests.length - knownRequests.length,
            largestResources
        };
    }, [requests]);


    const bottleneckSummary = useMemo(() => {
        const completed = requests.filter(
            (request) =>
                request.state === "completed" &&
                typeof request.duration === "number" &&
                Number.isFinite(request.duration)
        );

        const failed = requests.filter((request) => {
            const status = Number(request.status);

            return (
                request.state === "failed" ||
                request.status === "Failed" ||
                (Number.isFinite(status) && status >= 400)
            );
        });

        const slow = completed.filter(
            (request) => request.duration > 1000
        );

        const highTtfb = requests.filter(
            (request) =>
                typeof request.timing?.ttfb === "number" &&
                request.timing.ttfb > 800
        );

        const large = requests.filter(
            (request) =>
                typeof request.transferSize === "number" &&
                request.transferSize > 1024 * 1024
        );

        const slowest = [...completed]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 5);

        const bottlenecks = [
            {
                label: "High server wait (TTFB)",
                count: highTtfb.length,
                description: "Requests with TTFB above 800 ms"
            },
            {
                label: "Slow network requests",
                count: slow.length,
                description: "Requests taking more than 1 second"
            },
            {
                label: "Large response payloads",
                count: large.length,
                description: "Measured transfers above 1 MB"
            },
            {
                label: "Failed requests",
                count: failed.length,
                description: "Network failures or HTTP errors"
            }
        ];

        return {
            completed: completed.length,
            slow: slow.length,
            highTtfb: highTtfb.length,
            large: large.length,
            failed: failed.length,
            slowest,
            bottlenecks
        };
    }, [requests]);


    const aggregatePerformanceReport = useMemo(() => {
        const completed = requests.filter(
            (request) =>
                request.state === "completed" &&
                typeof request.duration === "number" &&
                Number.isFinite(request.duration)
        );

        const failed = requests.filter((request) => {
            const status = Number(request.status);

            return (
                request.state === "failed" ||
                request.status === "Failed" ||
                (Number.isFinite(status) && status >= 400)
            );
        });

        const slow = completed.filter((request) => request.duration > 1000);

        const knownTtfb = completed.filter(
            (request) =>
                typeof request.timing?.ttfb === "number" &&
                Number.isFinite(request.timing.ttfb)
        );

        const highTtfb = knownTtfb.filter(
            (request) => request.timing.ttfb > 800
        );

        const knownSizes = requests.filter(
            (request) =>
                typeof request.transferSize === "number" &&
                Number.isFinite(request.transferSize) &&
                request.transferSize >= 0
        );

        const large = knownSizes.filter(
            (request) => request.transferSize > 1024 * 1024
        );

        const averageDuration = completed.length
            ? completed.reduce((sum, request) => sum + request.duration, 0) /
            completed.length
            : null;

        const transferredBytes = knownSizes.reduce(
            (sum, request) => sum + request.transferSize,
            0
        );

        const rate = (count, total) => total > 0 ? count / total : null;

        const failureRate = rate(failed.length, requests.length);
        const slowRate = rate(slow.length, completed.length);
        const ttfbRate = rate(highTtfb.length, knownTtfb.length);
        const largeRate = rate(large.length, knownSizes.length);

        // Missing measurements are excluded, not treated as zero.
        const score = completed.length
            ? Math.max(
                0,
                Math.round(
                    100 -
                    (failureRate ?? 0) * 40 -
                    (slowRate ?? 0) * 25 -
                    (ttfbRate ?? 0) * 20 -
                    (largeRate ?? 0) * 15
                )
            )
            : null;

        const grade =
            score === null ? "Insufficient data" :
                score >= 90 ? "Excellent" :
                    score >= 75 ? "Good" :
                        score >= 60 ? "Needs improvement" :
                            "Poor";

        const coverage = {
            completed: completed.length,
            ttfbMeasured: knownTtfb.length,
            sizeMeasured: knownSizes.length
        };

        const recommendations = [];

        if (failed.length > 0) {
            recommendations.push({
                priority: "CRITICAL",
                title: "Resolve failed requests",
                detail: `${failed.length} request(s) failed or returned an HTTP error.`,
                action: "Inspect failed request status codes, browser errors, authentication and server logs."
            });
        }

        if (slow.length > 0) {
            recommendations.push({
                priority: "HIGH",
                title: "Reduce slow request duration",
                detail: `${slow.length} completed request(s) took more than 1000 ms.`,
                action: "Inspect the timing breakdown and optimize the slowest request phases."
            });
        }

        if (highTtfb.length > 0) {
            recommendations.push({
                priority: "HIGH",
                title: "Improve server response time",
                detail: `${highTtfb.length} measured request(s) had TTFB above 800 ms.`,
                action: "Profile backend processing, database queries and upstream API calls."
            });
        }

        if (large.length > 0) {
            recommendations.push({
                priority: "MEDIUM",
                title: "Reduce large response payloads",
                detail: `${large.length} measured response(s) exceeded 1 MB.`,
                action: "Consider compression, pagination and smaller optimized assets."
            });
        }

        if (recommendations.length === 0 && completed.length > 0) {
            recommendations.push({
                priority: "LOW",
                title: "No configured threshold exceeded",
                detail: "No major issue was detected in the available measurements.",
                action: "Continue monitoring with representative pages and normal traffic."
            });
        }

        const confidence =
            completed.length < 5 ? "Low" :
                knownTtfb.length < 3 || knownSizes.length < 3 ? "Limited" :
                    "Better coverage";

        return {
            score,
            grade,
            confidence,
            total: requests.length,
            completed: completed.length,
            failed: failed.length,
            slow: slow.length,
            highTtfb: highTtfb.length,
            large: large.length,
            averageDuration,
            transferredBytes,
            coverage,
            recommendations
        };
    }, [requests]);


    const getRequestBottleneck = (request) => {
        if (
            request.state === "failed" ||
            request.status === "Failed" ||
            (Number.isFinite(Number(request.status)) &&
                Number(request.status) >= 400)
        ) {
            return {
                label: "Request failed",
                reason: request.error || `HTTP ${request.status}`
            };
        }

        const timing = request.timing || {};

        if (typeof timing.ttfb === "number" && timing.ttfb > 800) {
            return {
                label: "Server / TTFB delay",
                reason: `Server wait: ${timing.ttfb.toFixed(0)} ms`
            };
        }

        if (typeof timing.dns === "number" && timing.dns > 100) {
            return {
                label: "DNS lookup delay",
                reason: `DNS lookup: ${timing.dns.toFixed(0)} ms`
            };
        }

        if (typeof timing.tcp === "number" && timing.tcp > 100) {
            return {
                label: "TCP connection delay",
                reason: `TCP connection: ${timing.tcp.toFixed(0)} ms`
            };
        }

        if (typeof timing.ssl === "number" && timing.ssl > 150) {
            return {
                label: "SSL handshake delay",
                reason: `SSL handshake: ${timing.ssl.toFixed(0)} ms`
            };
        }

        if (
            typeof timing.responseTransfer === "number" &&
            timing.responseTransfer > 500
        ) {
            return {
                label: "Response download delay",
                reason: `Download phase: ${timing.responseTransfer.toFixed(0)} ms`
            };
        }

        if (
            typeof request.duration === "number" &&
            request.duration > 1000
        ) {
            return {
                label: "Overall request latency",
                reason: `Total duration: ${request.duration.toFixed(0)} ms; exact phase unavailable`
            };
        }

        if (
            typeof request.transferSize === "number" &&
            request.transferSize > 1024 * 1024
        ) {
            return {
                label: "Large response payload",
                reason: "Consider compression or smaller payloads"
            };
        }

        return {
            label: "No major bottleneck detected",
            reason: "No configured threshold was exceeded"
        };
    };

    const clearRequests = async () => {
        if (!activeTabId) return;

        try {
            await window.browserAPI.clearNetworkRequests(activeTabId);
            setRequests([]);
            setSelectedRequest(null);
        } catch (error) {
            console.error("Unable to clear network requests:", error);
        }
    };



    const copyAsCurl = async () => {
        if (!selectedRequest) return;

        const quote = (value) =>
            `'${String(value).replace(/'/g, "''")}'`;

        try {
            const safeUrl = new URL(selectedRequest.url);

            const sensitiveParams =
                /token|secret|password|api[_-]?key|branch[_-]?key|signature|session|auth/i;

            for (const key of [...safeUrl.searchParams.keys()]) {
                if (sensitiveParams.test(key)) {
                    safeUrl.searchParams.set(key, "[REDACTED]");
                }
            }

            const parts = [
                "curl.exe",
                "-X",
                quote(selectedRequest.method || "GET"),
                quote(safeUrl.toString())
            ];

            const headers = selectedRequest.requestHeaders || {};

            for (const [key, values] of Object.entries(headers)) {
                const value = Array.isArray(values)
                    ? values.join(", ")
                    : String(values);

                if (
                    /authorization|cookie|api[_-]?key|token|secret/i.test(key) ||
                    value.includes("[REDACTED]")
                ) {
                    continue;
                }

                parts.push("-H", quote(`${key}: ${value}`));
            }

            const body = selectedRequest.requestBody?.text;

            if (body) {
                parts.push("--data-raw", quote(body));
            }

            await navigator.clipboard.writeText(parts.join(" "));
            setCopyMessage("Safe cURL command copied!");
        } catch (error) {
            console.error("Copy as cURL failed:", error);
            setCopyMessage("Unable to generate cURL command.");
        }

        setTimeout(() => setCopyMessage(""), 2500);
    };

    const exportPerformanceReport = () => {
            const report = {
                reportName: "DevFlow Aggregate Performance Report",
                version: "1.0",
                generatedAt: new Date().toISOString(),

                scoring: {
                    score: aggregatePerformanceReport.score,
                    grade: aggregatePerformanceReport.grade,
                    confidence: aggregatePerformanceReport.confidence,
                    method: "Threshold-based heuristic. Missing measurements are excluded."
                },

                summary: {
                    totalRequests: aggregatePerformanceReport.total,
                    completedRequests: aggregatePerformanceReport.completed,
                    failedRequests: aggregatePerformanceReport.failed,
                    slowRequests: aggregatePerformanceReport.slow,
                    highTtfbRequests: aggregatePerformanceReport.highTtfb,
                    largeResponses: aggregatePerformanceReport.large,
                    averageDurationMs: aggregatePerformanceReport.averageDuration,
                    measuredTransferBytes: aggregatePerformanceReport.transferredBytes
                },

                measurementCoverage: aggregatePerformanceReport.coverage,

                recommendations: aggregatePerformanceReport.recommendations
            };

            const blob = new Blob(
                [JSON.stringify(report, null, 2)],
                { type: "application/json" }
            );

            const downloadUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");

            link.href = downloadUrl;
            link.download = `devflow-performance-report-${Date.now()}.json`;

            document.body.appendChild(link);
            link.click();
            link.remove();

            URL.revokeObjectURL(downloadUrl);
            setCopyMessage("Performance report exported successfully!");

            setTimeout(() => setCopyMessage(""), 2500);
    };

    const exportHar = () => {
        if (requests.length === 0) {
            setCopyMessage("No requests available to export.");
            return;
        }

        const entries = requests.map((request) => {
            const parsedUrl = redactSensitiveUrl(request.url);
            const startedAt = Number(request.startedAt) || Date.now();
            const duration = Math.max(Number(request.duration) || 0, 0);

            const requestHeaders = redactHarHeaders(
                request.requestHeaders
            );

            const responseHeaders = redactHarHeaders(
                request.responseHeaders
            );

            const requestBody = request.requestBody?.text || "";
            const responseBody = request.responseBody?.text || "";

            const contentType =
                request.responseBody?.mimeType ||
                request.responseHeaders?.["content-type"] ||
                "application/octet-stream";

            const status = Number(request.status);

            return {
                startedDateTime: new Date(startedAt).toISOString(),
                time: duration,

                request: {
                    method: request.method || "GET",
                    url: parsedUrl?.toString() || request.url || "",
                    httpVersion: "HTTP/1.1",
                    cookies: [],
                    headers: requestHeaders,
                    queryString: parsedUrl
                        ? [...parsedUrl.searchParams.entries()].map(([name, value]) => ({
                            name,
                            value
                        }))
                        : [],
                    headersSize: -1,
                    bodySize: requestBody ? new Blob([requestBody]).size : 0,
                    ...(requestBody
                        ? {
                            postData: {
                                mimeType:
                                    request.requestHeaders?.["content-type"] ||
                                    "text/plain",
                                text: redactHarBody(requestBody)
                            }
                        }
                        : {})
                },

                response: {
                    status: Number.isFinite(status) ? status : 0,
                    statusText:
                        request.status === "Failed"
                            ? "Failed"
                            : "",
                    httpVersion: "HTTP/1.1",
                    cookies: [],
                    headers: responseHeaders,
                    content: {
                        size: request.responseBody?.size ?? 0,
                        mimeType: contentType,
                        ...(responseBody
                            ? { text: redactHarBody(responseBody) }
                            : {})
                    },
                    redirectURL: "",
                    headersSize: -1,
                    bodySize: request.responseBody?.size ?? -1
                },

                cache: {},

                timings: getHarTimings(request.timing),

                _resourceType: request.resourceType || "Other",
                _state: request.state || "completed",
                ...(request.error ? { _error: request.error } : {})
            };
        });




        const har = {
            log: {
                version: "1.2",
                creator: {
                    name: "DevFlow",
                    version: "1.0.0"
                },
                pages: [],
                entries
            }
        };

        const blob = new Blob(
            [JSON.stringify(har, null, 2)],
            { type: "application/json" }
        );

        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = downloadUrl;
        link.download = `devflow-network-${Date.now()}.har`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(downloadUrl);

        setCopyMessage("HAR file exported successfully!");
        setTimeout(() => setCopyMessage(""), 2500);
    };

    const redactSensitiveUrl = (url) => {
        try {
            const parsed = new URL(url);

            const sensitiveParams =
                /token|secret|password|api[_-]?key|branch[_-]?key|signature|session|auth/i;

            for (const key of [...parsed.searchParams.keys()]) {
                if (sensitiveParams.test(key)) {
                    parsed.searchParams.set(key, "[REDACTED]");
                }
            }

            return parsed;
        } catch {
            return null;
        }
    };

    const redactHarHeaders = (headers = {}) => {
        const sensitiveHeaders =
            /authorization|cookie|set-cookie|api[_-]?key|token|secret/i;

        return Object.entries(headers).map(([name, rawValue]) => ({
            name,
            value: sensitiveHeaders.test(name)
                ? "[REDACTED]"
                : Array.isArray(rawValue)
                    ? rawValue.join(", ")
                    : String(rawValue ?? "")
        }));
    };

    const redactHarBody = (body) => {
        if (!body) return "";

        try {
            const parsed = JSON.parse(body);

            const redactObject = (value) => {
                if (Array.isArray(value)) return value.map(redactObject);

                if (value && typeof value === "object") {
                    return Object.fromEntries(
                        Object.entries(value).map(([key, item]) => [
                            key,
                            /token|secret|password|api[_-]?key|branch[_-]?key|signature|session|auth/i.test(key)
                                ? "[REDACTED]"
                                : redactObject(item)
                        ])
                    );
                }

                return value;
            };

            return JSON.stringify(redactObject(parsed));
        } catch {
            return body;
        }
    };

    const getStatusClass = (request) => {
        if (request.state === "failed" || request.status === "Failed") {
            return "network-status failed";
        }

        const status = Number(request.status);

        if (status >= 200 && status < 300) return "network-status success";
        if (status >= 300 && status < 400) return "network-status redirect";
        if (status >= 400) return "network-status failed";

        return "network-status pending";
    };

    const formatHeaders = (headers = {}) => {
        return Object.entries(headers)
            .map(([key, values]) => {
                const value = Array.isArray(values) ? values.join(", ") : values;
                return `${key}: ${value}`;
            })
            .join("\n");
    };


    const formatTiming = (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return "N/A";
        }

        return `${value.toFixed(2)} ms`;
    };


    const formatBytes = (bytes) => {
        if (
            typeof bytes !== "number" ||
            !Number.isFinite(bytes) ||
            bytes < 0
        ) {
            return "N/A";
        }

        if (bytes < 1024) {
            return `${bytes.toFixed(0)} B`;
        }

        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };


    const getHarTimings = (timing = {}) => ({
        blocked: -1,
        dns: timing.dns ?? -1,
        connect: timing.tcp ?? -1,
        send: timing.send ?? -1,
        wait: timing.ttfb ?? -1,
        receive: timing.responseTransfer ?? -1,
        ssl: timing.ssl ?? -1
    });



    const getPerformanceInsights = (request) => {
        if (!request) return [];

        const insights = [];
        const timing = request.timing || {};

        const duration = Number(request.duration);
        const ttfb = timing.ttfb;
        const dns = timing.dns;
        const tcp = timing.tcp;
        const ssl = timing.ssl;
        const download = timing.responseTransfer;

        const rawSize = request.transferSize ?? request.responseBody?.size;
        const responseSize =
            typeof rawSize === "number" && Number.isFinite(rawSize)
                ? rawSize
                : null;

        const status = Number(request.status);

        const isFailed =
            request.state === "failed" ||
            request.status === "Failed" ||
            (Number.isFinite(status) && status >= 400);

        const addInsight = (type, priority, title, cause, action) => {
            insights.push({
                type,
                priority,
                title,
                detail: cause,
                action
            });
        };

        // Request failure
        if (isFailed) {
            const isServerError = Number.isFinite(status) && status >= 500;

            addInsight(
                "error",
                isServerError ? "CRITICAL" : "HIGH",
                "Request failed",
                request.error
                    ? `Browser error: ${request.error}`
                    : `Request returned status ${request.status}.`,
                isServerError
                    ? "Check server logs, backend exceptions, API dependencies and server availability."
                    : "Check the request URL, authentication, permissions, parameters and API response."
            );
        }

        // DNS delay
        if (typeof dns === "number" && dns > 100) {
            addInsight(
                "warning",
                "MEDIUM",
                "DNS lookup delay",
                `DNS lookup took ${dns.toFixed(2)} ms.`,
                "Check DNS resolver performance, DNS configuration and hostname lookup latency."
            );
        }

        // TCP delay
        if (typeof tcp === "number" && tcp > 150) {
            addInsight(
                "warning",
                "MEDIUM",
                "TCP connection delay",
                `TCP connection took ${tcp.toFixed(2)} ms.`,
                "Check network latency, server reachability and connection establishment."
            );
        }

        // SSL delay
        if (typeof ssl === "number" && ssl > 200) {
            addInsight(
                "warning",
                "MEDIUM",
                "SSL / TLS handshake delay",
                `TLS handshake took ${ssl.toFixed(2)} ms.`,
                "Check TLS configuration, certificate chain and connection reuse."
            );
        }

        // TTFB delay
        if (typeof ttfb === "number" && ttfb > 800) {
            addInsight(
                "warning",
                "HIGH",
                "High Time to First Byte",
                `TTFB is ${ttfb.toFixed(2)} ms. This measures waiting until response headers begin arriving.`,
                "Profile backend processing, database queries, upstream APIs and server response latency."
            );
        }

        // Response download delay
        if (typeof download === "number" && download > 500) {
            addInsight(
                "warning",
                "MEDIUM",
                "Response transfer delay",
                `The measured response phase took ${download.toFixed(2)} ms.`,
                "Check response payload size, compression, bandwidth and server streaming behavior."
            );
        }

        // Large response
        if (responseSize !== null && responseSize > 1024 * 1024) {
            addInsight(
                "warning",
                "MEDIUM",
                "Large response payload",
                `Measured response transfer is ${(responseSize / (1024 * 1024)).toFixed(2)} MB.`,
                "Consider compression, pagination, smaller API payloads and optimized assets."
            );
        }

        // Overall duration
        if (Number.isFinite(duration) && duration > 1000) {
            addInsight(
                "warning",
                "HIGH",
                "Slow request",
                `Total request duration is ${duration.toFixed(0)} ms.`,
                "Inspect the timing phases above to isolate whether waiting, connection setup or response transfer contributes most."
            );
        }

        // Missing timing data
        if (
            typeof duration !== "number" ||
            !Number.isFinite(duration)
        ) {
            addInsight(
                "info",
                "INFO",
                "Timing data unavailable",
                "A completed request duration was not available.",
                "Reload the page and select a completed request to collect timing data."
            );
        }

        if (insights.length === 0) {
            addInsight(
                "success",
                "LOW",
                "No performance warning detected",
                "No configured performance threshold was exceeded for this request.",
                "No action is currently required. Continue monitoring under normal traffic."
            );
        }

        return insights;
    };





    const formatResponseBody = (responseBody) => {
        if (!responseBody) return "Response preview not available.";

        const text = responseBody.text || "";
        const mimeType = (responseBody.mimeType || "").toLowerCase();

        if (mimeType.includes("json")) {
            try {
                return JSON.stringify(JSON.parse(text), null, 2);
            } catch {
                return text;
            }
        }

        return text || "(Empty response)";
    };


    return (
        <div className="network-monitor">
            <div className="network-header">
                <div>
                    <h2>Network Monitor</h2>
                    <p>Inspect requests made by the active browser tab</p>
                </div>

                <button onClick={exportHar} className="network-export">
                    Export HAR
                </button>


                <button onClick={clearRequests} className="network-clear">
                    Clear
                </button>
            </div>


            <div className="network-content-scroll">
                <div className="network-dashboard">
                    <div className="dashboard-card">
                        <span>Total Requests</span>
                        <strong>{performanceSummary.total}</strong>
                        <small>Captured requests</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Completed</span>
                        <strong className="dashboard-success">
                            {performanceSummary.completed}
                        </strong>
                        <small>Completed requests</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Failed</span>
                        <strong className="dashboard-danger">
                            {performanceSummary.failed}
                        </strong>
                        <small>Failed / HTTP errors</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Slow Requests</span>
                        <strong className="dashboard-warning">
                            {performanceSummary.slow}
                        </strong>
                        <small>Above 1000 ms</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Average Duration</span>
                        <strong>
                            {performanceSummary.averageDuration !== null
                                ? `${performanceSummary.averageDuration.toFixed(0)} ms`
                                : "N/A"}
                        </strong>
                        <small>Completed requests</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Transferred Data</span>
                        <strong>
                            {(performanceSummary.transferredBytes / (1024 * 1024)).toFixed(2)} MB
                        </strong>
                        <small>Known response sizes</small>
                    </div>

                    <div className="dashboard-card">
                        <span>Large Responses</span>
                        <strong>{performanceSummary.large}</strong>
                        <small>Above 1 MB</small>
                    </div>

                </div>


                <div className="resource-analytics">
                    <div className="resource-analytics-header">
                        <div>
                            <h3>Resource Type Analytics</h3>
                            <p>Breakdown of captured network requests</p>
                        </div>

                        <span>
                            {requests.length} total requests
                        </span>
                    </div>

                    <div className="resource-chart">
                        {resourceTypeSummary.map((item) => (
                            <div className="resource-chart-row" key={item.label}>
                                <div className="resource-chart-info">
                                    <strong>{item.label}</strong>
                                    <span>
                                        {item.count} requests · {item.percentage.toFixed(1)}%
                                    </span>
                                </div>

                                <div className="resource-chart-track">
                                    <div
                                        className="resource-chart-fill"
                                        style={{
                                            width: `${item.percentage}%`
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>


                <div className="resource-size-analytics">
                    <div className="resource-size-header">
                        <div>
                            <h3>Resource Size Analytics</h3>
                            <p>Actual network transfer size by resource category</p>
                        </div>

                        <div className="resource-size-total">
                            <strong>{formatBytes(resourceSizeSummary.totalBytes)}</strong>
                            <small>
                                {resourceSizeSummary.knownCount} measured requests
                            </small>
                        </div>
                    </div>

                    <div className="resource-size-grid">
                        {resourceSizeSummary.categories.map((item) => (
                            <div className="resource-size-row" key={item.label}>
                                <div className="resource-size-info">
                                    <strong>{item.label}</strong>
                                    <span>
                                        {formatBytes(item.bytes)} · {item.count} requests
                                    </span>
                                </div>

                                <div className="resource-size-track">
                                    <div
                                        className="resource-size-fill"
                                        style={{ width: `${item.percentage}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="largest-resources">
                        <h4>Top 5 Largest Resources</h4>

                        {resourceSizeSummary.largestResources.length > 0 ? (
                            resourceSizeSummary.largestResources.map((request) => (
                                <div
                                    className="largest-resource-row"
                                    key={request.id}
                                    title={request.url}
                                >
                                    <span>
                                        {request.url
                                            ? request.url.replace(/^https?:\/\//, "")
                                            : "Unknown URL"}
                                    </span>

                                    <strong>{formatBytes(Number(request.transferSize))}</strong>
                                </div>
                            ))
                        ) : (
                            <p>No measured resource sizes available yet.</p>
                        )}
                    </div>

                    <small className="resource-size-note">
                        {resourceSizeSummary.unknownCount} requests have no measured transfer size.
                        Values represent encoded network transfer bytes, not decoded file size.
                    </small>
                </div>


                <div className="bottleneck-dashboard">
                    <div className="bottleneck-header">
                        <div>
                            <h3>Performance & Bottleneck Analyzer</h3>
                            <p>Identify slow requests and possible performance issues</p>
                        </div>
                        <span>{bottleneckSummary.completed} completed requests analyzed</span>
                    </div>

                    <div className="bottleneck-stats">
                        <div className="bottleneck-stat">
                            <span>Slow Requests</span>
                            <strong className="warning-text">{bottleneckSummary.slow}</strong>
                            <small>Above 1000 ms</small>
                        </div>

                        <div className="bottleneck-stat">
                            <span>High TTFB</span>
                            <strong className="warning-text">{bottleneckSummary.highTtfb}</strong>
                            <small>Above 800 ms</small>
                        </div>

                        <div className="bottleneck-stat">
                            <span>Large Responses</span>
                            <strong>{bottleneckSummary.large}</strong>
                            <small>Above 1 MB measured</small>
                        </div>

                        <div className="bottleneck-stat">
                            <span>Failed Requests</span>
                            <strong className="danger-text">{bottleneckSummary.failed}</strong>
                            <small>Network / HTTP errors</small>
                        </div>
                    </div>

                    <div className="bottleneck-content">
                        <div className="bottleneck-list">
                            <h4>Possible Bottlenecks</h4>

                            {bottleneckSummary.bottlenecks.map((item) => (
                                <div className="bottleneck-item" key={item.label}>
                                    <div>
                                        <strong>{item.label}</strong>
                                        <small>{item.description}</small>
                                    </div>
                                    <span>{item.count}</span>
                                </div>
                            ))}
                        </div>

                        <div className="slowest-requests">
                            <h4>Top 5 Slowest Requests</h4>

                            {bottleneckSummary.slowest.length > 0 ? (
                                bottleneckSummary.slowest.map((request) => {
                                    const analysis = getRequestBottleneck(request);

                                    return (
                                        <button
                                            type="button"
                                            className="slowest-request"
                                            key={request.id}
                                            onClick={() => setSelectedRequest(request)}
                                            title={request.url}
                                        >
                                            <span className="slowest-request-info">
                                                <strong>
                                                    {request.method} · {request.url}
                                                </strong>
                                                <small>
                                                    {analysis.label} — {analysis.reason}
                                                </small>
                                            </span>

                                            <strong className="slowest-duration">
                                                {request.duration.toFixed(0)} ms
                                            </strong>
                                        </button>
                                    );
                                })
                            ) : (
                                <p className="bottleneck-empty">
                                    No completed requests available yet.
                                </p>
                            )}
                        </div>
                    </div>
                </div>


                <div className="aggregate-report">
                    <div className="aggregate-report-header">
                        <div>
                            <h3>Aggregate Performance Report</h3>
                            <p>Overall network health and optimization summary</p>
                        </div>

                        <button
                            type="button"
                            className="aggregate-export"
                            onClick={exportPerformanceReport}
                            disabled={aggregatePerformanceReport.total === 0}
                        >
                            Export JSON Report
                        </button>
                    </div>

                    <div className="aggregate-score-section">
                        <div className="aggregate-score">
                            <strong>
                                {aggregatePerformanceReport.score === null
                                    ? "—"
                                    : aggregatePerformanceReport.score}
                            </strong>
                            <span>Performance Score / 100</span>
                        </div>

                        <div className="aggregate-grade">
                            <strong>{aggregatePerformanceReport.grade}</strong>
                            <span>
                                Data confidence: {aggregatePerformanceReport.confidence}
                            </span>
                            <small>
                                Threshold-based estimate, not a Lighthouse score.
                            </small>
                        </div>
                    </div>

                    <div className="aggregate-metrics">
                        <div>
                            <span>Total Requests</span>
                            <strong>{aggregatePerformanceReport.total}</strong>
                        </div>

                        <div>
                            <span>Completed</span>
                            <strong>{aggregatePerformanceReport.completed}</strong>
                        </div>

                        <div>
                            <span>Failed</span>
                            <strong>{aggregatePerformanceReport.failed}</strong>
                        </div>

                        <div>
                            <span>Slow</span>
                            <strong>{aggregatePerformanceReport.slow}</strong>
                        </div>

                        <div>
                            <span>High TTFB</span>
                            <strong>{aggregatePerformanceReport.highTtfb}</strong>
                        </div>

                        <div>
                            <span>Large Responses</span>
                            <strong>{aggregatePerformanceReport.large}</strong>
                        </div>
                    </div>

                    <div className="aggregate-footer">
                        <div>
                            <span>Average Duration</span>
                            <strong>
                                {aggregatePerformanceReport.averageDuration !== null
                                    ? `${aggregatePerformanceReport.averageDuration.toFixed(0)} ms`
                                    : "N/A"}
                            </strong>
                        </div>

                        <div>
                            <span>Measured Transfer</span>
                            <strong>
                                {formatBytes(aggregatePerformanceReport.transferredBytes)}
                            </strong>
                        </div>
                    </div>

                    <div className="aggregate-coverage">
                        <h4>Measurement Coverage</h4>
                        <p>
                            Completed durations: {aggregatePerformanceReport.coverage.completed}
                        </p>
                        <p>
                            Measured TTFB: {aggregatePerformanceReport.coverage.ttfbMeasured}
                        </p>
                        <p>
                            Measured transfer sizes: {aggregatePerformanceReport.coverage.sizeMeasured}
                        </p>
                    </div>

                    <div className="aggregate-recommendations">
                        <h4>Prioritized Recommendations</h4>

                        {aggregatePerformanceReport.recommendations.length > 0 ? (
                            aggregatePerformanceReport.recommendations.map((item, index) => (
                                <div className="aggregate-recommendation" key={`${item.title}-${index}`}>
                                    <div className="aggregate-recommendation-heading">
                                        <strong>{item.title}</strong>
                                        <span className={`aggregate-priority ${item.priority.toLowerCase()}`}>
                                            {item.priority}
                                        </span>
                                    </div>

                                    <p>{item.detail}</p>
                                    <small>{item.action}</small>
                                </div>
                            ))
                        ) : (
                            <p>Load a webpage to generate performance recommendations.</p>
                        )}
                    </div>
                </div>



                <div className="network-toolbar">
                    <select
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                    >
                        <option value="all">All requests</option>
                        <option value="fetch">Fetch / XHR</option>
                        <option value="documents">Documents</option>
                        <option value="failed">Failed</option>
                        <option value="200">Status 200</option>
                        <option value="301">Status 301</option>
                        <option value="302">Status 302</option>
                        <option value="404">Status 404</option>
                        <option value="500">Status 500</option>
                    </select>

                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Filter by URL or method..."
                    />

                    <span>{visibleRequests.length} requests</span>
                </div>

                <div className="network-table-wrap">
                    <table className="network-table">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Method</th>
                                <th>Type</th>
                                <th>URL</th>
                                <th>Time</th>
                                <th className="waterfall-heading">Waterfall</th>
                            </tr>
                        </thead>

                        <tbody>
                            {visibleRequests.map((request) => (
                                <tr
                                    key={request.id}
                                    className={
                                        selectedRequest?.id === request.id ? "selected" : ""
                                    }
                                    onClick={() => setSelectedRequest(request)}
                                    title={request.url}
                                >
                                    <td>
                                        <span className={getStatusClass(request)}>
                                            {request.status || "Pending"}
                                        </span>
                                    </td>
                                    <td>{request.method}</td>
                                    <td>{request.resourceType}</td>
                                    <td className="network-url">{request.url}</td>
                                    <td>
                                        {request.duration !== null && request.duration !== undefined
                                            ? `${request.duration} ms`
                                            : "Pending"}
                                    </td>

                                    <td className="waterfall-cell">
                                        <div className="waterfall-track">
                                            <div
                                                className={`waterfall-bar ${request.state === "failed" ? "failed" : ""
                                                    }`}
                                                style={{
                                                    left: `${((request.startedAt - waterfallMetrics.start) /
                                                        waterfallMetrics.total) * 100
                                                        }%`,
                                                    width: `${Math.max(
                                                        ((request.duration ?? 1) / waterfallMetrics.total) * 100,
                                                        1
                                                    )
                                                        }%`
                                                }}
                                                title={`${request.duration ?? "Pending"} ms`}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {visibleRequests.length === 0 && (
                        <div className="network-empty">
                            <span>⇄</span>
                            <h3>No network requests</h3>
                            <p>Load or refresh a webpage to capture its requests.</p>
                        </div>
                    )}
                </div>

                {selectedRequest && (
                    <div className="network-details">
                        <div className="network-detail-actions">
                            <button onClick={copyAsCurl}>
                                Copy as cURL
                            </button>

                            <button onClick={() => setSelectedRequest(null)}>
                                Close
                            </button>
                        </div>

                        {copyMessage && (
                            <div className="curl-copy-message">
                                {copyMessage}
                            </div>
                        )}

                        <div className="network-detail-grid">
                            <div>
                                <h4>General</h4>
                                <p><strong>Status:</strong> {selectedRequest.status}</p>
                                <p><strong>Method:</strong> {selectedRequest.method}</p>
                                <p><strong>Type:</strong> {selectedRequest.resourceType}</p>
                                <p><strong>Duration:</strong> {selectedRequest.duration ?? "Pending"} ms</p>

                                <div className="network-timing">
                                    <h4>Network Timing</h4>


                                    <div className="timing-waterfall">
                                        {[
                                            { label: "DNS", key: "dns" },
                                            { label: "TCP", key: "tcp" },
                                            { label: "SSL", key: "ssl" },
                                            { label: "Send", key: "send" },
                                            { label: "TTFB", key: "ttfb" },
                                            { label: "Download", key: "responseTransfer" }
                                        ].map((phase) => {
                                            const value = selectedRequest.timing?.[phase.key];
                                            const total = selectedRequest.timing?.total;

                                            const width =
                                                typeof value === "number" &&
                                                    typeof total === "number" &&
                                                    total > 0
                                                    ? Math.max((value / total) * 100, 1)
                                                    : 0;

                                            return (
                                                <div className="timing-bar-row" key={phase.key}>
                                                    <span>{phase.label}</span>

                                                    <div className="timing-bar-track">
                                                        <div
                                                            className="timing-bar-fill"
                                                            style={{ width: `${Math.min(width, 100)}%` }}
                                                        />
                                                    </div>

                                                    <strong>{formatTiming(value)}</strong>
                                                </div>
                                            );
                                        })}
                                    </div>


                                    {[
                                        { label: "DNS Lookup", key: "dns" },
                                        { label: "TCP Connection", key: "tcp" },
                                        { label: "SSL / TLS Handshake", key: "ssl" },
                                        { label: "Request Sending", key: "send" },
                                        { label: "Waiting (TTFB)", key: "ttfb" },
                                        { label: "Response Transfer", key: "responseTransfer" }
                                    ].map((item) => (
                                        <div className="timing-row" key={item.key}>
                                            <span>{item.label}</span>
                                            <strong>
                                                {formatTiming(selectedRequest.timing?.[item.key])}
                                            </strong>
                                        </div>
                                    ))}

                                    <div className="timing-total">
                                        <span>Total Duration</span>
                                        <strong>
                                            {formatTiming(selectedRequest.timing?.total)}
                                        </strong>
                                    </div>

                                    <small>
                                        Timings are captured from Chromium DevTools Protocol.
                                        Some phases may be unavailable for cached or reused connections.
                                    </small>
                                </div>


                                <div className="performance-insights">
                                    <h4>Performance Insights</h4>

                                    {getPerformanceInsights(selectedRequest).map((insight, index) => (
                                        <div
                                            className={`insight-card ${insight.type}`}
                                            key={`${insight.title}-${index}`}
                                        >

                                            <div className="insight-heading">
                                                <strong>{insight.title}</strong>
                                                <span className={`insight-priority ${insight.type}`}>
                                                    {insight.priority}
                                                </span>
                                            </div>

                                            <p>{insight.detail}</p>

                                            <div className="insight-recommendation">
                                                <strong>Recommended Action</strong>
                                                <p>{insight.action}</p>
                                            </div>

                                        </div>
                                    ))}
                                </div>



                                <div>
                                    <h4>Response Preview</h4>

                                    {selectedRequest.responseBody ? (
                                        <>
                                            <div className="response-meta">
                                                <span>{selectedRequest.responseBody.mimeType || "Unknown type"}</span>
                                                <span>
                                                    {selectedRequest.responseBody.size.toLocaleString()} bytes
                                                </span>
                                            </div>

                                            <pre className="response-preview">
                                                {formatResponseBody(selectedRequest.responseBody)}
                                            </pre>

                                            {selectedRequest.responseBody.truncated && (
                                                <small className="payload-warning">
                                                    Preview limited to 256 KB. Full response is not displayed.
                                                </small>
                                            )}
                                        </>
                                    ) : (
                                        <p>Response preview is not available for this request yet.</p>
                                    )}
                                </div>

                                {selectedRequest.error && (
                                    <p className="network-error-text">
                                        <strong>Error:</strong> {selectedRequest.error}
                                    </p>
                                )}
                            </div>

                            <div>
                                <h4>Request Payload</h4>

                                {selectedRequest.requestBody ? (
                                    <>
                                        <pre>
                                            {selectedRequest.requestBody.text}
                                        </pre>

                                        {selectedRequest.requestBody.truncated && (
                                            <small className="payload-warning">
                                                Payload preview truncated at 64 KB.
                                            </small>
                                        )}
                                    </>
                                ) : (
                                    <p>No request payload available.</p>
                                )}
                            </div>

                            <div>
                                <h4>Request Headers</h4>
                                <pre>{formatHeaders(selectedRequest.requestHeaders)}</pre>
                            </div>

                            <div>
                                <h4>Response Headers</h4>
                                <pre>{formatHeaders(selectedRequest.responseHeaders)}</pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default NetworkMonitor;
