# RSRP Improvement & Automated Planning Pipeline (v0.2)

An enterprise-grade, high-performance spatial optimization engine and interactive planning dashboard designed to detect, analyze, and resolve RSRP/RSRQ coverage holes at airport terminals. 

This tool operates completely offline, crunching spatial data and serving a live web portal where radio frequency (RF) engineers can review system-proposed upgrades, simulate manual overrides (rotating azimuths, toggling high-gain, adding/deleting sectors), and export engineering PPTX/Excel reports.

---

## 🛠️ System Architecture

The application is split into a high-performance **Python Spatial Cruncher** (batch optimization) and a **FastAPI + Leaflet.js Interactive Dashboard** (real-time visualization & session planning).

```
                      +-----------------------------+
                      |      Input GIS Data         |
                      |  (Shapefiles, TLP, MR CSV)  |
                      +--------------+--------------+
                                     |
                                     v
                       +-------------+-------------+
                       |    main.py Spatial Engine |
                       |   (DBSCAN / Pathloss GDF) |
                       +-------------+-------------+
                                     |
                                     v
                       +-------------+-------------+
                       | proposals_baseline.parquet|  <--- Extremely fast loading
                       +-------------+-------------+
                                     |
                                     v
                       +-------------+-------------+
                       |  export_dashboard_data.py |
                       +-------------+-------------+
                                     |
                                     v
                       +-------------+-------------+
                       |    dashboard_data.js      |
                       +-------------+-------------+
                                     |
                                     v
+------------------+   +-------------+-------------+   +-------------------+
|  Leaflet Web UI  | < |      FastAPI Web Server   | > |   Output Reports  |
|  (app.js Client) |   |         (app.py)          |   |   (PPTX / XLSX)   |
+------------------+   +---------------------------+   +-------------------+
```

* **Backend Server:** Python `FastAPI` powered by `Uvicorn`.
* **Frontend Interface:** Pure vanilla JS (`app.js`) + HTML5 / CSS3 (Dark Mode) + Leaflet mapping engine.
* **Database:** Zero SQL dependencies. High-speed file-based in-memory processing via vectorised `pandas` and `geopandas` DataFrames saved directly to compressed `.parquet` formats for instantaneous loading.

---

## 🧠 Proposal Logic & Algorithms

The pipeline automatically identifies weak-signal coverage areas (`RSRP < -105 dBm`) and clusters them using the **DBSCAN** (Density-Based Spatial Clustering of Applications with Noise) algorithm. For each resolved cluster, the system executes a strict multi-tier fallback sequence:

### Step 1A: IBS Upgrade (IBC2M)
If the closest existing site to a coverage hole is an indoor system (IBS) and falls within the clutter radius limits, the system upgrades it to a Macro site (`IBC2M`) and places a new standard 65° sector pointing directly at the cluster center.

### Step 1B: Additional Sector Insertion
If it's already a Macro tower, the system checks if the site has spare capacity:
- Enforces a maximum of 4 sectors per Macro site.
- Ensures the proposed sector has at least a **90° angular separation** from all existing sectors to eliminate self-interference.
- If passed, a standard 65° sector is added.

### Step 1C: High-Gain Antenna Upgrade (Unified Math)
If a site cannot host another sector, the system audits existing sector directions:
- If an existing sector is already pointing within a **33° angular window** of the coverage hole, the system proposes swapping the hardware to a **High-Gain Antenna**.
- **Geometry Squeeze:** The beamwidth is narrowed from 65° to **33°** to concentrate signal power.
- **Coverage Stretch:** The math calculation dynamically extends the coverage evaluation radius using `max(Baseline_Radius * 1.2, closest_dist + 50)` so the pathloss calculation actively resolves the distant coverage hole.

### Step 2: New Site Placement & Runway Exclusion
If existing infrastructure is too distant (>1,300 meters) or cannot be upgraded, a new site is planned:
- **Location:** Placed at the mathematical center of the remaining bad spots.
- **TLP Co-location:** If a third-party Tower Provider (TLP) structure is found within 500m, the new site snaps to the TLP coordinates to minimize infrastructure costs.
- **Runway Exclusion (Safety Guardrail):** The site is checked against the runway Shapefile. If it intersects the buffer, a vector loop pushes the coordinate continuously outwards until it is **100% outside** the runway zone before spawning 3 standard sectors.

---

## 📐 The Geometry Division Rule: Visual vs. Coverage

To prevent map clutter while maintaining absolute calculation integrity, the tool strictly separates the **Visual Presentation Layer** from the **Signal Coverage Math**:

1. **Visual presentation (Leaflet UI & Report PPTXs):**
   - Normal Sector: Fixed at **300m radius** with a **65° wedge**.
   - High-Gain Upgrade: Fixed at **360m radius** (exactly +20% visual extension) with a **33° wedge**.
   - _Why?_ Standardizing the wedges keeps the map clean and makes upgraded sectors instantly recognizable.

2. **RSRP Coverage Math (Backend Pathloss & Frontend Grid):**
   - Uses the true physical radius (typically 600m to 1200m based on clutter type: Urban, Suburban, Rural, etc.) multiplied by the `1.2x` High-Gain extension to determine which measurement points turn green.
   - You get clean, static 300m/360m wedges on your map, but the points underneath turn green based on the real-world 1.2km signal reach.

---

## 🖥️ Server Endpoints (`app.py`)

* `GET /api/airports` - Scans the generated proposals baseline and returns the dropdown list of active airports with valid data.
* `POST /api/save_edits` - Accepts user modifications (JSON), merges them with `proposals_baseline.parquet`, and saves the updated overrides to `All_Airports_Proposals.xlsx`.
* `GET /api/download/pptx/{airport_name}` - Runs `generate_single_pptx.py` on the fly to compile a customized PowerPoint deck using the user's latest edited coordinates.
* `POST /api/autosave` - Periodically saves the user's current session state to a pickle file (`autosave.pkl`) to prevent data loss.

---

## 🚀 How to Run the Tool

### 1. Prerequisites
Install Python and make sure `pip` is updated.
- **Full Mode (Recommended):** Python 3.10 to 3.12 (fully supports GIS binary compilation).
- **Lite Mode:** Python 3.13+ / 3.14 (supports UI dashboard and Excel saving only).

### 2. Setup Environment & Install Dependencies
Open a terminal in the folder and run:

```bash
# Create Virtual Environment
python -m venv venv

# Activate Virtual Environment
# Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

# Install requirements:
# OPTION A: For Python 3.10-3.12 (Full pipeline + PPTX)
pip install -r requirements.txt

# OPTION B: For Python 3.14 / Lite Mode (No compilation errors)
pip install -r requirements-lite.txt
```

> **💡 Lite Mode Info:** If you install `requirements-lite.txt`, you will bypass compiling heavy geospatial C-libraries (like `fiona`, `pyproj`, `contextily`, or `geopandas`) which do not have precompiled wheels for Python 3.14 yet. 
> The Leaflet Dashboard, Excel saving, and live point-mapping will run flawlessly. Only the backend re-simulation (`main.py`) and PPTX exporter will be disabled.

### 3. Launch the Server
```bash
python app.py
```
Open your browser and navigate to **`http://localhost:8000`**.

### 4. Recalculating the Master Pipeline (Optional)
If you modify the input shapefiles or source data, you can trigger a full pipeline recalculation by clicking **"Run Full Pipeline"** in the dashboard, or running:
```bash
python main.py
python export_dashboard_data.py
```
