const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const binDir = path.join(root, "node_modules", ".bin");
const target = path.join(root, "desk-send.js");
const link = path.join(binDir, process.platform === "win32" ? "desk.cmd" : "desk");

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

fs.chmodSync(target, 0o755);

if (fs.existsSync(link)) {
  fs.rmSync(link, { force: true });
}

if (process.platform === "win32") {
  fs.writeFileSync(
    link,
    "@echo off\r\nnode \"%~dp0\\..\\..\\desk-send.js\" %*\r\n"
  );
} else {
  fs.symlinkSync(target, link);
}
