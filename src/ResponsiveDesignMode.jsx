
import { useState, useEffect, useRef } from "react";
import "./ResponsiveDesignMode.css";

const devices = [
  { name: "Custom", width: 1280, height: 800, dpr: 1 },
  { name: "iPhone 16", width: 393, height: 852, dpr: 3 },
  { name: "iPhone 16 Pro Max", width: 440, height: 956, dpr: 3 },
  { name: "Samsung Galaxy S24", width: 360, height: 780, dpr: 3 },
  { name: "iPad", width: 768, height: 1024, dpr: 2 },
  { name: "iPad Pro", width: 1024, height: 1366, dpr: 2 },
  { name: "Desktop", width: 1440, height: 900, dpr: 1 }
];

function ResponsiveDesignMode({ previewRef, activeTabId }) {
  const [device, setDevice] = useState(devices[0]);
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(800);
  const [dpr, setDpr] = useState(1);
  const [orientation, setOrientation] = useState("portrait");
  const [touch, setTouch] = useState(false);

  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);

  const isIPhone = device.name.startsWith("iPhone");
  const isSamsung = device.name.startsWith("Samsung");
  const isTablet = device.name.startsWith("iPad");

  const selectDevice = (name) => {
    const selected = devices.find((item) => item.name === name);
    if (!selected) return;

    setDevice(selected);
    setWidth(selected.width);
    setHeight(selected.height);
    setDpr(selected.dpr);
    setOrientation("portrait");
  };

  const rotateDevice = () => {
    setWidth(height);
    setHeight(width);

    setOrientation((previous) =>
      previous === "portrait" ? "landscape" : "portrait"
    );
  };

  const reset = () => {
    selectDevice("Desktop");
    setTouch(false);
  };

  // Keep the actual device viewport at 100%.
  useEffect(() => {
    setScale(1);
  }, [width, height]);

  // Apply actual device dimensions to Electron's native browser view.
  useEffect(() => {
    const preview = previewRef?.current;
    const stage = stageRef.current;

    if (!preview || !stage) return;

    let scheduled = false;

    const applyResponsiveSettings = async () => {
      if (scheduled) return;
      scheduled = true;

      requestAnimationFrame(async () => {
        scheduled = false;

        const rect = preview.getBoundingClientRect();

        if (!rect.width || !rect.height) return;

        const result = await window.browserAPI.setResponsiveMode({
          bounds: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          },
          width,
          height,
          dpr,
          touch
        });

        if (!result?.success) {
          console.error(
            "Responsive mode error:",
            result?.error
          );
        }
      });
    };

    const observer = new ResizeObserver(applyResponsiveSettings);
    observer.observe(preview);
    observer.observe(stage);

    stage.addEventListener("scroll", applyResponsiveSettings);
    window.addEventListener("resize", applyResponsiveSettings);

    applyResponsiveSettings();

    return () => {
      observer.disconnect();
      stage.removeEventListener("scroll", applyResponsiveSettings);
      window.removeEventListener("resize", applyResponsiveSettings);
    };
  }, [activeTabId, previewRef, width, height, dpr, touch]);

  useEffect(() => () => {
    window.browserAPI.resetResponsiveMode()
      .catch((error) => console.error("Could not reset responsive mode:", error));
  }, []);

  return (
    <div className="responsive-panel">

      <div className="responsive-header">
        <div>
          <h2>Responsive Design Mode</h2>
          <p>Test your website across different screen sizes</p>
        </div>

        <button onClick={reset}>Reset</button>
      </div>

      <div className="responsive-toolbar">

        <select
          value={device.name}
          onChange={(e) => selectDevice(e.target.value)}
        >
          {devices.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>

        <label>
          W
          <input
            type="number"
            min="200"
            max="3840"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>

        <label>
          H
          <input
            type="number"
            min="200"
            max="3840"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>

        <select
          value={dpr}
          onChange={(e) => setDpr(Number(e.target.value))}
        >
          {[1, 1.5, 2, 3].map((value) => (
            <option key={value} value={value}>
              DPR {value}
            </option>
          ))}
        </select>

        <button onClick={rotateDevice} title="Rotate device">
          ↻
        </button>

        <button
          className={touch ? "touch-active" : ""}
          onClick={() => setTouch((previous) => !previous)}
        >
          Touch {touch ? "ON" : "OFF"}
        </button>

      </div>

      <div className="responsive-preview">

        <div className="preview-info">
          {device.name} · {width} × {height} · DPR {dpr}
          · {orientation} · Zoom {Math.round(scale * 100)}%
        </div>

        <div className="device-stage" ref={stageRef}>

          <div
            className={`device-frame ${isIPhone
                ? "iphone-frame"
                : isSamsung
                  ? "android-frame"
                  : isTablet
                    ? "tablet-frame"
                    : "desktop-frame"
              }`}
            style={{
              width: `${width + (isIPhone ? 10 : isSamsung ? 10 : isTablet ? 14 : 4)}px`,
              height: `${height + (isIPhone ? 40 : isSamsung ? 10 : isTablet ? 14 : 4)}px`
            }}
          >

            {isIPhone && (
              <div className="dynamic-island">
                <span />
              </div>
            )}

            <div
              ref={previewRef}
              className="device-placeholder live-preview"
              style={{
                width: `${width}px`,
                height: `${height}px`
              }}
            />

          </div>
        </div>
      </div>
    </div>
  );
}

export default ResponsiveDesignMode;
