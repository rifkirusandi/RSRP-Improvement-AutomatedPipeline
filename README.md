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
```bash
python main.py
python export_dashboard_data.py
```

Or click **"Run Full Pipeline"** in the dashboard.

---

## 📦 Deliverable Package Structure

```
RSRP_Dashboard_Deliverable.zip
├── app.py                      # FastAPI web server
├── main.py                     # Spatial optimization engine
├── export_dashboard_data.py    # Dashboard data exporter
├── csv_handler.py              # CSV import/export + clutter query
├── generate_single_pptx.py     # PPTX report generator (optional)
├── config.py                   # Local path configuration (gitignored)
├── config.example.py           # Public path template
├── schemas.py                  # Pydantic V2 models
├── requirements.txt            # Full dependencies
├── requirements-lite.txt       # Lite dependencies
├── README.md                   # This file
├── dashboard/                  # Frontend assets
│   ├── index.html
│   ├── app.js
│   ├── dashboard_data.js       # Generated site data (~7MB)
│   ├── airport_data.pkl        # Cached airport geometries
│   └── ... (CSS, assets)
├── go_workers/
│   ├── isd_guard.go            # Go ISD guard source
│   ├── isd_guard.exe           # Compiled ISD binary
│   ├── mr_processor.go         # Go MR processor source
│   └── mr_processor.exe        # Compiled MR binary
├── Input_Data/                 # GIS inputs (user-provided)
│   ├── airport_border/
│   ├── Clutter/morphology.TAB
│   ├── Runway/
│   ├── Territory/
│   ├── TLP/
│   └── MR AIRPORT/
└── Output/                     # Pipeline output (auto-generated)
    ├── proposals_baseline.parquet
    ├── All_Airports_Proposals.xlsx
    ├── Coverage_Stats.json
    └── autosave.pkl
```

**Excluded from package:**
- `__pycache__/`, `.git/`, `venv/`, `.gemini/`
- `Evidence/` — disabled in production
- `Output/*.pptx` — generated on-demand via API
- `*.zip`, `*.pyc`, system artifacts

---

## 🛡 License & Confidentiality

All file paths are centralized in `config.py` (gitignored). The public Git repository uses `config.example.py` with generic placeholders. Historical raw filenames have been scrubbed from git history.
