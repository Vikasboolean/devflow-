const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.disableHardwareAcceleration();

function makeIco(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  const chunks = [header];
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header[entry + 2] = 0;
    header[entry + 3] = 0;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    chunks.push(png);
    offset += png.length;
  });
  return Buffer.concat(chunks);
}

app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "../..");
  const png = fs.readFileSync(path.join(root, "src", "assets", "Neon Gradient Fox Emblem.png"), "base64");
  const window = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const html = `<html><body><img id="logo" src="data:image/png;base64,${png}"></body></html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const images = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const base64 = await window.webContents.executeJavaScript(`(async () => {
      const image = document.getElementById('logo');
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = ${size}; canvas.height = ${size};
      const context = canvas.getContext('2d');
      const scale = Math.min(${size} / image.naturalWidth, ${size} / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      context.drawImage(image, (${size} - width) / 2, (${size} - height) / 2, width, height);
      return canvas.toDataURL('image/png').split(',')[1];
    })()`);
    images.push({ size, png: Buffer.from(base64, "base64") });
  }

  const iconPath = path.join(root, "build", "devflow.ico");
  fs.mkdirSync(path.dirname(iconPath), { recursive: true });
  fs.writeFileSync(iconPath, makeIco(images));
  console.log(`Generated ${iconPath} from the existing DevFlow logo (${fs.statSync(iconPath).size} bytes)`);
  window.destroy();
  app.quit();
}).catch(error => {
  console.error("Could not generate the DevFlow Windows icon:", error.message);
  app.exit(1);
});
