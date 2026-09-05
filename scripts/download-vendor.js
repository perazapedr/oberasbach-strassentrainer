const fs = require("fs");
const path = require("path");
const https = require("https");

const downloads = [
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    dest: "vendor/leaflet/leaflet.js"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    dest: "vendor/leaflet/leaflet.css"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    dest: "vendor/leaflet/images/marker-icon.png"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    dest: "vendor/leaflet/images/marker-icon-2x.png"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    dest: "vendor/leaflet/images/marker-shadow.png"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/images/layers.png",
    dest: "vendor/leaflet/images/layers.png"
  },
  {
    url: "https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png",
    dest: "vendor/leaflet/images/layers-2x.png"
  },
  {
    url: "https://cdn.jsdelivr.net/npm/@turf/turf@7.3.0/turf.min.js",
    dest: "vendor/turf/turf.min.js"
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const fullDest = path.resolve(__dirname, "..", dest);
    fs.mkdirSync(path.dirname(fullDest), { recursive: true });

    function get(currentUrl) {
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, currentUrl).toString();
          return get(redirectUrl);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download ${currentUrl}: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(fullDest);
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            console.log(`✓ Downloaded ${dest} (${fs.statSync(fullDest).size} bytes)`);
            resolve();
          });
        });
        file.on("error", (err) => {
          fs.unlink(fullDest, () => reject(err));
        });
      }).on("error", reject);
    }

    get(url);
  });
}

async function main() {
  console.log("Downloading vendor assets...");
  for (const item of downloads) {
    await download(item.url, item.dest);
  }
  console.log("All vendor assets downloaded successfully.");
}

main().catch(err => {
  console.error("Download failed:", err);
  process.exit(1);
});

