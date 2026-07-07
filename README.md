# RSRP Improvement & Automated Planning Pipeline (v0.2)

An enterprise-grade spatial optimization engine and interactive planning dashboard for detecting, analyzing, and resolving RSRP/RSRQ coverage holes at airport terminals — running entirely offline.

---

## 🏗 System Architecture

```
                         +---------------------------+
                         |       Input GIS Data      |
                         | (Shapefiles, TLP, MR CSVs)|
                         +------------+--------------+
                                      |
                                      v
                      +---------------+---------------+
                      |   main.py Spatial Engine      |
                      |  (K-Means / Haversine ISD)    |
                      +---------------+---------------+
                                      |
                    +-----------------+------------------+
                    |                                    |
                    v                                    v
     +--------------+--------------+     +---------------+--------------+
     | proposals_baseline.parquet  |     |  go_workers/isd_guard.exe    |
     +--------------+--------------+     |  go_workers/mr_processor.exe |
                    |                    +---------------+--------------+
                    v                                    |
     +--------------+--------------+                     |
     | export_dashboard_data.py    |<--------------------+
     +--------------+--------------+
                    |
                    v
     +--------------+--------------+
     |    dashboard_data.js        |
     |    airport_data.pkl         |
     +--------------+--------------+
                    |
                    v
+------------------+------------------+  +------------------+
|   FastAPI Server (app.py)          |  |  Output Reports  |
|   Uvicorn + Pydantic V2           |  |  XLSX / Parquet  |
+------------------+------------------+  +------------------+
                    |
                    v
+-----------------------------------------+
|  Leaflet.js Dashboard (dashboard/)      |
|  Dark mode UI · Real-time map · Editor  |
|  Export/Import CSV · Coverage tooltips   |
+-----------------------------------------+
```

**Core Stack:**
- **Backend Server:** Python `FastAPI` + `Uvicorn` (async HTTP)
- **Frontend Interface:** Vanilla JS (`app.js`) + HTML5/CSS3 Dark Mode + Leaflet.js
- **Spatial Engine:** `pandas`, `geopandas`, `shapely`, `scikit-learn`
- **Go Workers:** Concurrent Haversine ISD guard + MR batch processor
- **Storage:** Zero SQL — compressed `.parquet` + JSON + Pickle

---

## 🧠 Optimization Pipeline Logic

The pipeline identifies weak-signal areas (`RSRP < -105 dBm`), clusters them with **K-Means**, and executes a multi-tier fallback sequence for each cluster:

### Step 1A: IBC2M Upgrade (IBS → Macro)
If the closest existing site within 1,300m is an Indoor (IBS) system, it's upgraded to `IBC2M` with a new 65° sector pointed at the cluster.

### Step 1AB: Additional Sector
If the site is already Macro/IBC2M with spare capacity (max 4 sectors), a new 65° sector is added (enforcing 90° min angular separation to prevent co-channel interference).

### Step 1C: High-Gain Antenna (Geometry Squeeze)
If no more sectors can be added but an existing sector is within **16.5°** of the target (half of 33° beamwidth):
- Beamwidth narrowed: **65° → 33°**
- Range extended: `radius × 1.2`
- This is a **Change Antenna** proposal (frontend visual: 360m radius, 33° wedge)

### Step 2: New Site (1,300m ISD Guard)
If existing infrastructure cannot serve the cluster:
- Site placed at cluster centroid (snapped to TLP tower if within 500m)
- **Runway exclusion** enforced (auto-pushes outside buffer zone)
- **1,300m Inter-Site Distance guard** validated via Haversine formula
- 3 × 65° sectors spawned at 120° separation
- Packed into `dashboard_data.js` for the frontend

---

## 📐 Geometry Division Rule

| Layer | Normal Sector | High-Gain Antenna |
|-------|--------------|-------------------|
| **Visual (Leaflet)** | 300m radius, 65° wedge | 360m radius, 33° wedge |
| **Coverage Math** | True clutter radius (636–1200m) | Clutter radius × 1.2 |

The visual wedges are fixed for map readability. The actual pathloss calculation uses the true physical radius.

---

## 🌍 Clutter-Aware Morphology

All 1,333 sites across 30 airports query **morphology.TAB** for clutter classification:

| Clutter Type | Count | Coverage Radius |
|-------------|-------|----------------|
| DENSE URBAN | 547 (41%) | 636m |
| SUB URBAN | 406 (30.5%) | 1,103m |
| URBAN | 258 (19.4%) | 975m |
| RURAL | 122 (9.2%) | 1,200m |

Sites outside the morphology boundary use **nearest-neighbor fallback** to inherit the closest valid classification. **Zero Unknown** entries.

---

## ⚡ Go Workers

| Worker | Function | Technology |
|--------|----------|------------|
| `isd_guard.exe` | 1,300m Inter-Site Distance check | Goroutines + context cancellation + Haversine |
| `mr_processor.exe` | MR CSV grid averaging | Streaming CSV parser + JSON output |

Both are invoked as **subprocesses** from Python — no gRPC, no sidecars, no port conflicts.

---

## 🖥️ Server API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/airports` | GET | List airports with valid data |
| `/api/check_deps` | GET | Check GIS dependencies |
| `/api/get_clutter` | GET | Real-time morphology query by lat/lon |
| `/api/save_edits` | POST | Commit user edits to proposals baseline |
| `/api/autosave` | POST | Auto-save session state |
| `/api/import_csv` | POST | Import sites from CSV |
| `/api/export_csv/{airport}` | GET | Export sites to CSV |
| `/api/regenerate` | POST | Run full pipeline + dashboard regeneration |
| `/api/download/pptx/{airport}` | GET | Generate PPTX report on the fly |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10–3.14
- Go 1.21+ (for building workers from source)
- GIS dependencies for full pipeline mode

### Install & Run

```bash
# Option A: Full pipeline (Python 3.10–3.12)
pip install -r requirements.txt

# Option B: Lite mode — dashboard only (Python 3.13–3.14)
pip install -r requirements-lite.txt

# Launch
python app.py
# Open http://localhost:8000
```

### Rebuild Go Workers
```bash
go build -o go_workers/isd_guard.exe go_workers/isd_guard.go
go build -o go_workers/mr_processor.exe go_workers/mr_processor.go
```

### Generate Proposal Baseline
### Run Full Pipeline (requires full GIS deps)
```bash
python -m src.pipeline.main
python -m src.data.export_dashboard
```

### Or use the Dashboard API
```bash
# Start the server
python -m src.server.app
```

Or click **"Run Full Pipeline"** in the dashboard.

---

## 📦 Deliverable Package Structure

The project has been restructured into a clean, professional layout:

```
RSRP-Improvement-AutomatedPipeline/
├── config.py                     # Local machine paths (gitignored)
├── pyproject.toml                # Project metadata
├── README.md
├── requirements.txt
├── requirements-lite.txt
│
├── src/                          # Python source code
│   ├── pipeline/
│   │   └── main.py              # Pipeline orchestration
│   ├── server/
│   │   └── app.py               # FastAPI dashboard server
│   ├── data/
│   │   ├── csv_handler.py       # CSV import/export
│   │   └── export_dashboard.py  # Dashboard data builder
│   └── utils/
│       └── pptx_generator.py    # PPTX evidence generator
│
├── web/                          # Frontend assets
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── dashboard_data.js
│   ├── leaflet.css
│   └── leaflet.js
│
├── data/
│   ├── input/                   # GIS inputs (user-provided)
│   │   ├── Clutter/
│   │   ├── Runway/
│   │   ├── Territory/
│   │   ├── TLP/
│   │   ├── MR AIRPORT/
│   │   └── airport_border/
│   └── output/                  # Pipeline output (auto-generated)
│       ├── proposals_baseline.parquet
│       ├── All_Airports_Proposals.xlsx
│       ├── Coverage_Stats.json
│       └── evidence/
│
├── workers/                     # Compiled worker binaries
│   ├── mr_processor.go
│   ├── isd_guard.go
│   └── *.exe
│
├── conf/
│   ├── schemas.py               # Pydantic data models
│   └── config.example.py        # Configuration template
│
├── scripts/
│   └── build_deliverable.ps1
│
└── tests/
    └── test_api.py
```

**Excluded from package:**
- `__pycache__/`, `.git/`, `venv/`, `.gemini/`
- `Evidence/` — disabled in production
- `Output/*.pptx` — generated on-demand via API
- `*.zip`, `*.pyc`, system artifacts

---

## 🛡 License & Confidentiality

All file paths are centralized in `config.py` (gitignored). The public Git repository uses `config.example.py` with generic placeholders. Historical raw filenames have been scrubbed from git history.
