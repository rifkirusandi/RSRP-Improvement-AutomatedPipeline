import os
import sys
import subprocess
import pandas as pd
import json
import pickle
import asyncio
from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
import threading
import webbrowser
from schemas import SaveEditsRequest, ProcessLogRequest
import contextlib
import re
import uvicorn
from csv_handler import export_airport_csv, import_airport_csv
from config import PROPOSALS_XLSX, PROPOSALS_PARQUET, DASHBOARD_DATA_JS, AUTOSAVE_PKL, OUT_DIR, MR_DIR, GO_BINARY, SCRIPT_DIR

DASHBOARD_DATA = DASHBOARD_DATA_JS

# Try Parquet first, fall back to Excel
if os.path.exists(PROPOSALS_PARQUET):
    PROPOSALS_FILE = PROPOSALS_PARQUET
else:
    PROPOSALS_FILE = PROPOSALS_XLSX

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # Do NOT run heavy init on startup thread
    threading.Timer(1.25, open_browser).start()
    yield
    pass

app = FastAPI(lifespan=lifespan)



@app.get('/api/airports')
async def get_airports():
    """Return only airports that have valid proposal data."""
    valid_airports = []
    if os.path.exists(DASHBOARD_DATA):
        # Read dashboard_data.js to extract airport keys
        with open(DASHBOARD_DATA, 'r', encoding='utf-8') as f:
            content = f.read()
        # Extract airport names from the JSON object keys
        import re
        # The file format is: const DASHBOARD_DATA = {...};
        # We look for top-level keys
        try:
            json_str = content[content.index('{'):content.rindex('}')+1]
            data = json.loads(json_str)
            for apt_name, apt_data in data.items():
                # Only include if it has sites with data
                sites = apt_data.get('sites', [])
                if sites and len(sites) > 0:
                    valid_airports.append(apt_name)
        except Exception:
            pass
    return JSONResponse({"airports": sorted(valid_airports)})

def save_edits_sync(data: SaveEditsRequest):
    airport_name = data.airport
    edited_sites = data.sites

    if not os.path.exists(PROPOSALS_FILE):
        # Graceful fallback: Generate the baseline proposals dynamically if missing
        print("Proposals file not found. Generating baseline data via main.py...")
        try:
            subprocess.run([sys.executable, "main.py"], cwd=SCRIPT_DIR, check=True, timeout=600)
        except Exception as e:
            raise FileNotFoundError(f"Proposals file not found and auto-generation failed: {e}")
        
    # Read from Parquet if available, otherwise Excel
    if PROPOSALS_FILE.endswith('.parquet'):
        df = pd.read_parquet(PROPOSALS_FILE)
    else:
        df = pd.read_excel(PROPOSALS_FILE)
    
    if 'Airport' in df.columns:
        df_outside = df[df['Airport'] != airport_name]
    else:
        bbox = data.bbox
        if bbox:
            minx, miny, maxx, maxy = bbox
            mask_pr = (
                (df['Longitude'] >= minx - 0.05) & 
                (df['Longitude'] <= maxx + 0.05) & 
                (df['Latitude'] >= miny - 0.05) & 
                (df['Latitude'] <= maxy + 0.05)
            )
            df_outside = df[~mask_pr]
        else:
            df_outside = df

    new_rows = []
    for s in edited_sites:
        if s.type in ['proposed_new', 'proposed_sector', 'existing']:
            new_rows.append({
                'Airport': airport_name,
                'Site ID': s.id,
                'Longitude': s.lon,
                'Latitude': s.lat,
                'Azimuth': s.azimuth,
                'Clutter': 'Unknown',
                'Radius': s.radius_m,
                'Remark': s.remark,
                'Tower Provider ID': s.tlp_id,
                'Tower Provider Name': s.tlp_name
            })

    if new_rows:
        df_new = pd.DataFrame(new_rows)
        df_final = pd.concat([df_outside, df_new], ignore_index=True)
    else:
        df_final = df_outside
        
    # Write to both Parquet (fast) and Excel (compatible)
    try:
        df_final.to_parquet(PROPOSALS_PARQUET, index=False)
    except Exception:
        pass  # Fallback to Excel only if parquet fails
    df_final.to_excel(PROPOSALS_XLSX, index=False)
    return {"status": "success", "message": "Edits saved! Now click Download PPTX!"}

@app.post('/api/save_edits')
async def save_edits(data: SaveEditsRequest):
    try:
        res = await asyncio.to_thread(save_edits_sync, data)
        return JSONResponse(res)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Proposals Excel not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/api/autosave')
async def autosave(request: Request):
    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail="No data provided")
        
    def save_pickle():
        autosave_path = AUTOSAVE_PKL
        os.makedirs(OUT_DIR, exist_ok=True)
        with open(autosave_path, 'wb') as f:
            pickle.dump(data, f)
            
    await asyncio.to_thread(save_pickle)
    return JSONResponse({"status": "success", "message": "Autosaved successfully"})

@app.post('/api/load_pkl')
async def load_pkl(file: UploadFile = File(...)):
    if not file.filename.endswith('.pkl'):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be .pkl")
        
    def load():
        return pickle.load(file.file)
        
    try:
        data = await asyncio.to_thread(load)
        return JSONResponse({"status": "success", "data": data})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load pickle: {str(e)}")

def are_gis_deps_installed():
    required = ['geopandas', 'shapely', 'matplotlib', 'contextily', 'pptx', 'shapefile', 'pyproj']
    for module_name in required:
        try:
            __import__(module_name)
        except ImportError:
            return False
    return True

@app.get('/api/download/pptx/{airport_name}')
async def download_pptx(airport_name: str):
    if not are_gis_deps_installed():
        raise HTTPException(
            status_code=400, 
            detail="This feature is disabled because the laptop is running in Lite Mode (missing GIS dependencies: fiona, geopandas, contextily, pyproj, python-pptx)."
        )
    def run_gen():
        res = subprocess.run(
            [sys.executable, "generate_single_pptx.py", airport_name],
            cwd=SCRIPT_DIR, capture_output=True, text=True, timeout=300
        )
        return res
        
    try:
        res = await asyncio.to_thread(run_gen)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="PPTX generation timed out after 5 minutes.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start PPTX generator: {str(e)}")
        
    file_path = os.path.join(SCRIPT_DIR, 'Output', f"{airport_name}_Airport_Improvement.pptx")
    if res.returncode != 0 or not os.path.exists(file_path):
        error_msg = res.stderr.strip() if res.stderr else ""
        stdout_msg = res.stdout.strip() if res.stdout else ""
        full_error = (stdout_msg + "\n" + error_msg).strip()
        if not full_error:
            full_error = "Unknown error during PPTX generation"
        raise HTTPException(status_code=500, detail=full_error)
        
    return FileResponse(file_path, filename=f"{airport_name}_Airport_Improvement.pptx")

@app.get('/api/export_csv/{airport_name}')
async def export_csv(airport_name: str):
    # Retrieve bounding box from dashboard data
    try:
        with open(DASHBOARD_DATA, 'r', encoding='utf-8') as f:
            content = f.read()
        json_str = re.search(r'const DASHBOARD_DATA = (\{.*?\});', content, re.DOTALL).group(1)
        data = json.loads(json_str)
        if airport_name not in data:
            raise HTTPException(status_code=404, detail="Airport not found")
        bbox = data[airport_name]['bbox']
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read bbox: {e}")
        
    return export_airport_csv(airport_name, bbox)

@app.post('/api/import_csv/{airport_name}')
async def import_csv(airport_name: str, file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be .csv")
    content = await file.read()
    try:
        added, modified = import_airport_csv(airport_name, content)
        
        # Load current autosave state to merge
        autosave_path = os.path.join(SCRIPT_DIR, 'Output', 'autosave.pkl')
        custom_sites = {}
        if os.path.exists(autosave_path):
            with open(autosave_path, 'rb') as f:
                custom_sites = pickle.load(f)
                
        if airport_name not in custom_sites:
            custom_sites[airport_name] = {'added': [], 'deleted': [], 'modified': {}}
            
        # Overwrite exactly as requested
        custom_sites[airport_name]['added'] = added
        custom_sites[airport_name]['modified'] = modified
        custom_sites[airport_name]['deleted'] = []
        
        # Save back to autosave.pkl
        with open(autosave_path, 'wb') as f:
            pickle.dump(custom_sites, f)
            
        return JSONResponse({
            "status": "success", 
            "message": f"Successfully imported {len(added)} new sites and {len(modified)} modifications.",
            "added": added,
            "modified": modified
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Import failed: {e}")

@app.post('/api/regenerate')
async def regenerate():
    if not are_gis_deps_installed():
        raise HTTPException(
            status_code=400, 
            detail="Pipeline regeneration is disabled because the laptop is running in Lite Mode (missing GIS dependencies: fiona, geopandas, contextily, pyproj)."
        )
    def run_regen():
        subprocess.run([sys.executable, "main.py"], cwd=SCRIPT_DIR, check=True)
        subprocess.run([sys.executable, "export_dashboard_data.py"], cwd=SCRIPT_DIR, check=True)
    try:
        await asyncio.to_thread(run_regen)
        return JSONResponse({"status": "success", "message": "Pipeline completed successfully!"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def open_browser():
    webbrowser.open_new('http://127.0.0.1:8000')

@app.get('/api/check_deps')
async def check_deps():
    required = {
        'pandas': 'pandas',
        'geopandas': 'geopandas',
        'shapely': 'shapely',
        'matplotlib': 'matplotlib',
        'contextily': 'contextily',
        'pptx': 'python-pptx',
        'shapefile': 'pyshp',
        'pyproj': 'pyproj',
        'openpyxl': 'openpyxl',
    }
    missing = []
    installed = []
    for module_name, pip_name in required.items():
        try:
            __import__(module_name)
            installed.append(pip_name)
        except ImportError:
            missing.append(pip_name)
    
    return JSONResponse({
        "status": "ok" if not missing else "missing_deps",
        "missing": missing,
        "installed": installed,
        "install_command": f"pip install {' '.join(missing)}" if missing else None
    })

def _legacy_process_backup(file_path, grid_size=0.00045, val_col='RSRP(All MRs) (dBm)'):
    df = pd.read_csv(file_path)
    df = df.dropna(subset=['Longitude', 'Latitude', val_col])
    
    df['grid_lon'] = (df['Longitude'] / grid_size).round() * grid_size
    df['grid_lat'] = (df['Latitude'] / grid_size).round() * grid_size
    
    df_grouped = df.groupby(['grid_lon', 'grid_lat'])[val_col].mean().reset_index()
    res = df_grouped[['grid_lon', 'grid_lat', val_col]].round({'grid_lon': 5, 'grid_lat': 5, val_col: 1}).values.tolist()
    return res

def process_log_data(file_path, grid_size=0.00045, val_col='RSRP(All MRs) (dBm)'):
    go_binary = GO_BINARY
    try:
        res = subprocess.check_output(
            [go_binary, file_path, str(grid_size), val_col],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=10
        )
        return json.loads(res.strip())
    except Exception as e:
        print(f"[WARNING] Go worker failed or timed out: {e}. Falling back to Python legacy processor.")
        return _legacy_process_backup(file_path, grid_size, val_col)

@app.post('/api/process_log')
async def handle_process_log(data: ProcessLogRequest):
    file_path = data.file_path
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
        
    result = await asyncio.to_thread(process_log_data, file_path)
    return JSONResponse({"status": "success", "data_length": len(result)})

# Mount static files at root level so index.html and its relative assets resolve cleanly
app.mount("/", StaticFiles(directory=os.path.join(SCRIPT_DIR, 'dashboard'), html=True), name="dashboard")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
