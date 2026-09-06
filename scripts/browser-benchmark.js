"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8094;

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png"
      };
      const contentType = contentTypes[ext] || "application/octet-stream";

      const acceptEncoding = req.headers["accept-encoding"] || "";
      const rawData = fs.readFileSync(filePath);

      // Support gzip compression if requested
      if (req.headers["x-force-gzip"] === "1" || (acceptEncoding.includes("gzip") && ext === ".json" && rawData.length > 50000)) {
        zlib.gzip(rawData, { level: 6 }, (err, gzipped) => {
          if (err) {
            res.writeHead(500);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Encoding": "gzip",
            "Access-Control-Allow-Origin": "*"
          });
          res.end(gzipped);
        });
      } else {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*"
        });
        res.end(rawData);
      }
    });

    server.listen(PORT, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.callbacks = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const WebSocket = globalThis.WebSocket;
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id);
          this.callbacks.delete(msg.id);
          if (msg.error) cb.reject(new Error(msg.error.message));
          else cb.resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
}

async function runBrowserBenchmark() {
  const server = await startStaticServer();
  console.log(`Static server running on http://127.0.0.1:${PORT}`);

  const userDataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "cdp-bench-"));
  const chromeProc = spawn(CHROME_BIN, [
    "--headless=new",
    "--remote-debugging-port=9223",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
  ]);

  let cdp = null;
  try {
    let version = null;
    for (let i = 0; i < 30; i++) {
      try {
        version = await fetchJson("http://127.0.0.1:9223/json/version");
        if (version && version.webSocketDebuggerUrl) break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    const pages = await fetchJson("http://127.0.0.1:9223/json/list");
    const target = pages.find(p => p.type === "page") || pages[0];
    cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    console.log("Navigating to app...");
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1200));

    const benchDatasets = [
      { id: "oberasbach", name: "Oberasbach", path: "data/cities/oberasbach.json" },
      { id: "de-nw-wenden", name: "Wenden", path: "data/cities/de-nw-wenden.json" },
      { id: "de-by-zirndorf", name: "Zirndorf", path: "tests/fixtures/de-by-zirndorf.json" },
      { id: "de-nw-siegen", name: "Siegen", path: "data/cities/de-nw-siegen.json" },
      { id: "de-nw-koeln", name: "Köln", path: "data/cities/de-nw-koeln.json" }
    ];

    console.log("\n--- In-Browser CDP Benchmark ---");
    const browserResults = [];

    for (const ds of benchDatasets) {
      const script = `(async () => {
        const datasetPath = "${ds.path}";
        const initialHeap = performance.memory ? performance.memory.usedJSHeapSize : null;

        // 1. Fetch & decomp (network)
        const t0 = performance.now();
        const resp = await fetch(datasetPath);
        const fetchTime = performance.now() - t0;

        // 2. Text read
        const t1 = performance.now();
        const text = await resp.text();
        const textTime = performance.now() - t1;

        // 3. JSON parse
        const t2 = performance.now();
        const parsed = JSON.parse(text);
        const parseTime = performance.now() - t2;

        // 4. Contract & City Validation
        const validator = window.StrassentrainerCityDataValidator;
        const t3 = performance.now();
        const pkgCheck = validator.validateCityPackage(parsed);
        const pkgValTime = performance.now() - t3;

        const t4 = performance.now();
        const cityCheck = validator.validateCityData(parsed);
        const cityValTime = performance.now() - t4;

        // 5. Target preparation
        const t5 = performance.now();
        const streetTargets = window.StrassentrainerTargets.prepareStreetTargets(parsed.streets || [], window.StreetGeometry);
        const poiTargets = window.StrassentrainerTargets.preparePoiTargets(parsed.pois || []);
        const targetPrepTime = performance.now() - t5;

        // 6. IndexedDB save & load
        const storage = window.StrassentrainerCityStorage;
        const t6 = performance.now();
        await storage.saveCity(parsed.city, parsed.streets, parsed.pois, parsed.areas);
        const idbSaveTime = performance.now() - t6;

        const t7 = performance.now();
        const loadedFromIdb = await storage.getCityData(parsed.city.id);
        const idbLoadTime = performance.now() - t7;

        const peakHeap = performance.memory ? performance.memory.usedJSHeapSize : null;

        return {
          textLength: text.length,
          fetchTime: Number(fetchTime.toFixed(2)),
          textTime: Number(textTime.toFixed(2)),
          parseTime: Number(parseTime.toFixed(2)),
          pkgValTime: Number(pkgValTime.toFixed(2)),
          cityValTime: Number(cityValTime.toFixed(2)),
          targetPrepTime: Number(targetPrepTime.toFixed(2)),
          idbSaveTime: Number(idbSaveTime.toFixed(2)),
          idbLoadTime: Number(idbLoadTime.toFixed(2)),
          valid: pkgCheck.valid && cityCheck.valid,
          streetCount: (parsed.streets || []).length,
          poiCount: (parsed.pois || []).length,
          streetTargetsCount: streetTargets.length,
          poiTargetsCount: poiTargets.length,
          loadedStreetsCount: loadedFromIdb?.streets?.length || 0,
          heapDeltaMb: initialHeap && peakHeap ? Number(((peakHeap - initialHeap) / 1024 / 1024).toFixed(2)) : null
        };
      })()`;

      try {
        const res = await cdp.eval(script);
        browserResults.push({ id: ds.id, name: ds.name, ...res });
        console.log(`\nDataset: ${ds.name} (${ds.id})`);
        console.log(`  Raw Text: ${(res.textLength / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Fetch (HTTP gzipped transfer): ${res.fetchTime} ms`);
        console.log(`  Text read: ${res.textTime} ms`);
        console.log(`  JSON parse: ${res.parseTime} ms`);
        console.log(`  Package Validate: ${res.pkgValTime} ms`);
        console.log(`  City Validate: ${res.cityValTime} ms`);
        console.log(`  Target Prep (${res.streetTargetsCount} streets + ${res.poiTargetsCount} pois): ${res.targetPrepTime} ms`);
        console.log(`  IndexedDB Save: ${res.idbSaveTime} ms | Load (${res.loadedStreetsCount} streets): ${res.idbLoadTime} ms`);
        console.log(`  Heap Delta: ${res.heapDeltaMb} MB | Valid: ${res.valid}`);
      } catch (e) {
        console.error(`Error benchmarking ${ds.name}:`, e.message);
      }
    }

    const outPath = path.join(ROOT, "tools/dataset-benchmark/browser-benchmark-results.json");
    fs.writeFileSync(outPath, JSON.stringify(browserResults, null, 2) + "\n", "utf8");
    console.log(`\nBrowser-Benchmark-Ergebnisse gespeichert: ${outPath}`);
  } catch (outerErr) {
    console.error("Outer error:", outerErr);
  } finally {
    if (cdp && cdp.ws) cdp.ws.close();
    chromeProc.kill();
    await new Promise(r => setTimeout(r, 600));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (e) {}
    server.close();
  }
}

runBrowserBenchmark().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
