# Leitfaden: Deployment des statischen Dataset-Repositorys

Dieses Dokument beschreibt die Bereitstellung des Verzeichnisses `dist/dataset-repository/` auf statischen Hosting-Plattformen (GitHub Pages, AWS S3 / CloudFront, Cloudflare Pages und Nginx).

---

## 1. Übersicht

Das generierte Verzeichnis `dist/dataset-repository/` ist **vollständig statisch**. Es benötigt keine serverseitige Logik (kein Node.js, kein PHP, keine Datenbank). Alle Ressourcen können von jedem Webserver oder Content Delivery Network (CDN) ausgeliefert werden.

### Dateistruktur

- `catalog.json`: Einstiegspunkt für den Client. Ändert sich bei Veröffentlichung neuer Versionen.
- `datasets/<id>/package.json`: Vollständiges Stadtpaket (unveränderlich pro Version).
- `datasets/<id>/manifest.json`: Metadaten und Prüfsummen.
- `datasets/<id>/package.json.gz`: Vorkomprimierte Gzip-Version (Level 9).
- `datasets/<id>/package.json.br`: Vorkomprimierte Brotli-Version (Quality 11).

---

## 2. HTTP-Header & Caching-Empfehlungen

Für optimale Performance und deterministisches Caching sollten Webserver folgende Header setzen:

| Ressource | `Cache-Control` | `Content-Type` | Erläuterung |
| :--- | :--- | :--- | :--- |
| `catalog.json` | `public, max-age=300, stale-while-revalidate=3600` | `application/json; charset=utf-8` | Regelmäßig neu validieren (5 Minuten Cache), damit neue Versionen rasch erkannt werden |
| `datasets/<id>/package.json` | `public, max-age=31536000, immutable` | `application/json; charset=utf-8` | Da Versionen im Pfad bzw. per contentHash fixiert sind, ist das Paket unveränderlich |
| `datasets/<id>/manifest.json` | `public, max-age=31536000, immutable` | `application/json; charset=utf-8` | Unveränderlich pro Paketversion |

### CORS-Header (Cross-Origin Resource Sharing)

Falls das Repository auf einer separaten Subdomain (z. B. `datasets.strassentrainer.de`) gehostet wird:
```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range, Accept-Encoding
```

---

## 3. Hosting-Optionen

### 3.1 Option A: GitHub Pages (Automatisiert via GitHub Actions)

GitHub Pages ist ideal für quelloffene oder interne Bereitstellung direkt aus dem Git-Repository.

#### GitHub Actions Workflow (`.github/workflows/deploy-datasets.yml`)

```yaml
name: Deploy Dataset Repository

on:
  push:
    branches: [ main ]
    paths:
      - 'data/cities/**'
      - 'tools/dataset-publisher/**'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Generate Dataset Repository
        run: |
          node tools/dataset-publisher/index.js --output dist/dataset-repository

      - name: Upload Pages Artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist/dataset-repository

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

### 3.2 Option B: AWS S3 & CloudFront CDN

AWS S3 mit CloudFront bietet weltweite Hochverfügbarkeit, automatische Brotli/Gzip-Aushandlung und minimale Latenzen.

#### Synchronisation via AWS CLI

```bash
# 1. Repository lokal generieren
node tools/dataset-publisher/index.js --output dist/dataset-repository

# 2. Pakete mit 'immutable' Caching hochladen (ohne catalog.json)
aws s3 sync dist/dataset-repository/datasets s3://mein-dataset-bucket/datasets \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/json; charset=utf-8"

# 3. Vorkomprimierte Brotli-Dateien mit entsprechendem Content-Encoding hochladen
aws s3 sync dist/dataset-repository/datasets s3://mein-dataset-bucket/datasets \
  --exclude "*" --include "*.br" \
  --content-encoding "br" \
  --content-type "application/json; charset=utf-8" \
  --cache-control "public, max-age=31536000, immutable"

# 4. catalog.json mit kurzem Cache hochladen
aws s3 cp dist/dataset-repository/catalog.json s3://mein-dataset-bucket/catalog.json \
  --cache-control "public, max-age=300, stale-while-revalidate=3600" \
  --content-type "application/json; charset=utf-8"

# 5. CloudFront Invalidation für den Katalog anstoßen
aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/catalog.json"
```

---

### 3.3 Option C: Cloudflare Pages / R2

Cloudflare komprimiert JSON-Dateien automatisch dynamisch per Brotli oder liefert vorberechnete Dateien aus:
- **Cloudflare R2 Bucket**: Keine Egress-Kosten.
- **Custom Domain**: `datasets.strassentrainer.de`
- **Cache Rules**: Cache Everyting für `/datasets/*` mit TTL 1 Jahr; Bypass oder kurze TTL für `/catalog.json`.

---

### 3.4 Option D: Nginx (Eigener Server)

Wenn das Repository auf einem Linux-Server mit Nginx gehostet wird, kann Nginx vorberechnete `.gz` und `.br` Dateien ohne CPU-Last direkt ausliefern:

```nginx
# /etc/nginx/conf.d/dataset-repository.conf

server {
    listen 443 ssl http2;
    server_name datasets.strassentrainer.de;

    root /var/www/strassentrainer/dist/dataset-repository;

    # Pre-Compression Support aktivieren
    gzip_static on;
    brotli_static on;

    # CORS erlauben
    add_header Access-Control-Allow-Origin * always;

    # Katalog mit kurzem Cache
    location = /catalog.json {
        add_header Content-Type "application/json; charset=utf-8";
        add_header Cache-Control "public, max-age=300, stale-while-revalidate=3600";
    }

    # Pakete und Manifeste immutable cachen
    location /datasets/ {
        add_header Content-Type "application/json; charset=utf-8";
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

---

## 4. Rollback- & Update-Szenarien

1. **Neuer Datensatz oder Update**:
   - Die Pipeline generiert das aktualisierte Paket in `data/cities/<id>.json`.
   - `node tools/dataset-publisher/index.js` aktualisiert `dist/dataset-repository/`.
   - Alte Paketdateien bleiben unter ihrer bisherigen Version erreichbar (keine 404-Fehler für bestehende Clients).
   - Der `catalog.json` zeigt auf die neue Version.
2. **Sofortiges Rollback**:
   - Wenn ein Datensatz zurückgezogen werden muss, wird der vorherige Stand des `catalog.json` wiederhergestellt und deployed.
   - Clients mit bereits installierten Paketen behalten ihre Daten in IndexedDB; neue Installationen werden verhindert.
