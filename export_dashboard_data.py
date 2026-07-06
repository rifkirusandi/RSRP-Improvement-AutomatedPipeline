import os
import json
import pandas as pd
import geopandas as gpd
from shapely.geometry import Polygon
from config import SITES_CSV, PROPOSALS_XLSX, PROPOSALS_PARQUET, MR_DIR, CLUTTER_PATH, AIRPORT_DIR, TLP_CSV, \
    DASHBOARD_DATA_JS, DASHBOARD_DATA_PKL, OUT_DIR, SCRIPT_DIR

# Prefer Parquet for fast loading; fall back to Excel
PROPOSALS_FILE = PROPOSALS_PARQUET if os.path.exists(PROPOSALS_PARQUET) else PROPOSALS_XLSX
SHP_PATH = os.path.join(AIRPORT_DIR, "airport_border.shp")

os.makedirs("dashboard", exist_ok=True)

from shapely.geometry import Point

from csv_handler import get_clutter_radius_and_name
import math

CLUTTER_RADII = {
    'DENSE URBAN': 636,
    'SUB URBAN': 1103,
    'URBAN': 975,
    'RURAL': 1200
}
# Load Airports
print("Loading Shapefiles...")
import shapefile
sf = shapefile.Reader(SHP_PATH)
fields = sf.fields[1:]
field_names = [field[0] for field in fields]

airports = {}
for shape_rec in sf.iterShapeRecords():
    rec = dict(zip(field_names, shape_rec.record))
    name = rec.get('Airport', 'Unknown').strip().replace('\\', '')
        
    poly = Polygon(shape_rec.shape.points)
    gdf = gpd.GeoDataFrame(geometry=[poly], crs="EPSG:3857").to_crs(epsg=4326)
    minx, miny, maxx, maxy = gdf.total_bounds
    
    airports[name] = {
        'name': name,
        'bbox': [round(minx, 5), round(miny, 5), round(maxx, 5), round(maxy, 5)],
        'polygon': poly, # 3857 poly
        'sites': [],
        'mr_data': {
            'Combine': {
                'MR': {'RSRP': [], 'RSRQ': []},
                'MDT': {'RSRP': [], 'RSRQ': []}
            },
            'Indoor': {
                'MR': {'RSRP': [], 'RSRQ': []},
                'MDT': {'RSRP': [], 'RSRQ': []}
            }
        }
    }

# Load Existing Sites
print("Loading existing sites...")
df_cells = pd.read_csv(SITES_CSV)
df_cells['Longitude'] = pd.to_numeric(df_cells['Longitude'], errors='coerce')
df_cells['Latitude'] = pd.to_numeric(df_cells['Latitude'], errors='coerce')
df_cells = df_cells.dropna(subset=['Longitude', 'Latitude'])
df_cells['Azimuth'] = pd.to_numeric(df_cells['Azimuth'], errors='coerce').fillna(0)
df_cells.drop_duplicates(subset=['Site ID', 'Azimuth'], keep='first', inplace=True)

# Load Proposals
print("Loading proposed sites...")
if PROPOSALS_FILE.endswith('.parquet'):
    df_prop = pd.read_parquet(PROPOSALS_FILE)
else:
    df_prop = pd.read_excel(PROPOSALS_FILE, sheet_name=0)

# Load TLP Data
print("Loading TLP Data...")
df_tlp = pd.read_csv(TLP_CSV, encoding='ISO-8859-1', low_memory=False)
df_tlp['Longitude'] = pd.to_numeric(df_tlp['Longitude'], errors='coerce')
df_tlp['Latitude'] = pd.to_numeric(df_tlp['Latitude'], errors='coerce')
df_tlp = df_tlp.dropna(subset=['Longitude', 'Latitude'])
gdf_tlp = gpd.GeoDataFrame(df_tlp, geometry=gpd.points_from_xy(df_tlp['Longitude'], df_tlp['Latitude']), crs='EPSG:4326')
gdf_tlp_3857 = gdf_tlp.to_crs(epsg=3857)

for airport_name, data in airports.items():
    print(f"Processing {airport_name}...")
    minx, miny, maxx, maxy = data['bbox']
    
    data['tlp_points'] = []
    
    # --- Pass 1: Morphology lookup for existing sites ---
    temp_existing = []
    mask_ex = (
        (df_cells['Longitude'] >= minx - 0.05) & 
        (df_cells['Longitude'] <= maxx + 0.05) & 
        (df_cells['Latitude'] >= miny - 0.05) & 
        (df_cells['Latitude'] <= maxy + 0.05)
    )
    for _, row in df_cells[mask_ex].iterrows():
        lon = float(row['Longitude'])
        lat = float(row['Latitude'])
        clutter_radius, clutter_name = get_clutter_radius_and_name(lon, lat)
        temp_existing.append({
            'id': str(row.get('Site ID', '')),
            'lon': round(lon, 5),
            'lat': round(lat, 5),
            'azimuth': round(float(row.get('Azimuth', 0)), 0),
            'clutter_radius': clutter_radius,
            'clutter_name': clutter_name,
            'type': 'existing'
        })
    
    # --- Pass 2: Nearest-neighbor fallback for any existing site with Unknown clutter ---
    # Build a list of known-good clutter sites for reference
    known_sites = [s for s in temp_existing if s['clutter_name'] != 'Unknown']
    if len(known_sites) < len(temp_existing):
        for site in temp_existing:
            if site['clutter_name'] == 'Unknown':
                best_dist = float('inf')
                best = None
                for other in known_sites:
                    d = math.sqrt((site['lat']-other['lat'])**2 + (site['lon']-other['lon'])**2)
                    if d < best_dist:
                        best_dist = d
                        best = other
                if best:
                    site['clutter_name'] = best['clutter_name']
                    site['clutter_radius'] = best['clutter_radius']
    data['sites'].extend(temp_existing)
    
    # --- Proposed sites in bounds ---
    mask_pr = (
        (df_prop['Longitude'] >= minx - 0.05) & 
        (df_prop['Longitude'] <= maxx + 0.05) & 
        (df_prop['Latitude'] >= miny - 0.05) & 
        (df_prop['Latitude'] <= maxy + 0.05)
    )
    for _, row in df_prop[mask_pr].iterrows():
        site_id = str(row['Site ID'])
        is_new = ("_ARPT_" in site_id) or ("New Site" in str(row.get('Remark', '')))
        
        radius_m = float(row.get('Radius', 975))
        if pd.isna(radius_m): radius_m = 975
        
        remark = str(row.get('Remark', ''))
        beamwidth = 33 if 'Change Antenna' in remark else 65
        prop_lon = float(row['Longitude'])
        prop_lat = float(row['Latitude'])
        prop_azimuth = round(float(row.get('Azimuth', 0)), 0)
        
        # Query morphology map for proposed sites too
        clutter_radius, clutter_name = get_clutter_radius_and_name(prop_lon, prop_lat)
        
        # Fallback: nearest-neighbor among existing sites with known clutter
        if clutter_name == 'Unknown':
            best_dist = float('inf')
            best = None
            for other in temp_existing:
                if other['clutter_name'] != 'Unknown':
                    d = math.sqrt((prop_lat-other['lat'])**2 + (prop_lon-other['lon'])**2)
                    if d < best_dist:
                        best_dist = d
                        best = other
            if best:
                clutter_name = best['clutter_name']
                clutter_radius = best['clutter_radius']
        
        # For Change Antenna: replace the matching existing sector in-place
        if 'Change Antenna' in remark:
            replaced = False
            for existing in data['sites']:
                if existing['type'] == 'existing' and existing['id'] == site_id and existing['azimuth'] == prop_azimuth:
                    existing['original_azimuth'] = existing['azimuth']
                    if 'initial_radius' not in existing:
                        existing['initial_radius'] = existing.get('clutter_radius', 600)
                    existing['beamwidth'] = 33
                    existing['radius_m'] = round(radius_m, 0)
                    existing['remark'] = remark
                    existing['isHighGain'] = True
                    existing['clutter_name'] = clutter_name
                    replaced = True
                    break
            if not replaced:
                # Fallback: add as proposed_sector if no matching existing sector found
                data['sites'].append({
                    'id': site_id,
                    'lon': round(prop_lon, 5),
                    'lat': round(prop_lat, 5),
                    'azimuth': prop_azimuth,
                    'initial_radius': round(radius_m / 1.2, 0),
                    'radius_m': round(radius_m, 0),
                    'clutter_radius': clutter_radius,
                    'clutter_name': clutter_name,
                    'beamwidth': beamwidth,
                    'remark': remark,
                    'isHighGain': True,
                    'type': 'proposed_sector'
                })
        else:
            data['sites'].append({
                'id': site_id,
                'lon': round(prop_lon, 5),
                'lat': round(prop_lat, 5),
                'azimuth': prop_azimuth,
                'initial_radius': round(radius_m, 0),
                'radius_m': round(radius_m, 0),
                'clutter_radius': clutter_radius,
                'clutter_name': clutter_name,
                'beamwidth': beamwidth,
                'remark': remark,
                'isHighGain': False,
                'type': 'proposed_new' if is_new else 'proposed_sector'
            })

        
    # Load MR/MDT Data with Unified Downsampling
    # Load MR/MDT Data with Unified Downsampling
    val_cols = {'RSRP': 'RSRP(All MRs) (dBm)', 'RSRQ': 'RSRQ(All MRs) (dB)'}
    
    for env in ['Combine', 'Indoor']:
        for source, r_val in [('MR', 25), ('MDT', 10)]:
            # Create buffered polygon (100m) in 4326
            poly_3857 = data['polygon']
            buffered_poly_3857 = poly_3857.buffer(100)
            gdf_buf = gpd.GeoDataFrame(geometry=[buffered_poly_3857], crs="EPSG:3857").to_crs(epsg=4326)
            buffered_poly_4326 = gdf_buf.geometry.iloc[0]

            # RSRP
            fname_rsrp = f"RSRP_Airport_{env}.csv" if source == 'MR' else f"RSRP_Airport_MDT_{env}.csv"
            df_rsrp = pd.read_csv(os.path.join(MR_DIR, fname_rsrp))
            mask = (df_rsrp['Longitude'] >= minx) & (df_rsrp['Longitude'] <= maxx) & (df_rsrp['Latitude'] >= miny) & (df_rsrp['Latitude'] <= maxy)
            df_rsrp = df_rsrp[mask]
            if not df_rsrp.empty:
                gdf_pts = gpd.GeoDataFrame(df_rsrp, geometry=gpd.points_from_xy(df_rsrp['Longitude'], df_rsrp['Latitude']), crs='EPSG:4326')
                df_rsrp = pd.DataFrame(gdf_pts[gdf_pts.geometry.within(buffered_poly_4326)].drop(columns=['geometry']))
            
            # RSRQ
            fname_rsrq = f"RSRQ_Airport_{env}.csv" if source == 'MR' else f"RSRQ_Airport_MDT_{env}.csv"
            df_rsrq = pd.read_csv(os.path.join(MR_DIR, fname_rsrq))
            mask_q = (df_rsrq['Longitude'] >= minx) & (df_rsrq['Longitude'] <= maxx) & (df_rsrq['Latitude'] >= miny) & (df_rsrq['Latitude'] <= maxy)
            df_rsrq = df_rsrq[mask_q]
            if not df_rsrq.empty:
                gdf_pts_q = gpd.GeoDataFrame(df_rsrq, geometry=gpd.points_from_xy(df_rsrq['Longitude'], df_rsrq['Latitude']), crs='EPSG:4326')
                df_rsrq = pd.DataFrame(gdf_pts_q[gdf_pts_q.geometry.within(buffered_poly_4326)].drop(columns=['geometry']))
            
            # Grid size: MR = 50m (~0.00045°), MDT = 20m (~0.00018°)
            # Polygon clipping already keeps the data tight
            grid_size = 0.00045 if source == 'MR' else 0.00018
            MAX_PTS = 5000  # Safety cap per layer per airport
            
            # RSRP: Keep ALL spots clipped to polygon+300m
            if len(df_rsrp) > 0:
                if len(df_rsrp) > MAX_PTS:
                    df_rsrp = df_rsrp.sample(n=MAX_PTS, random_state=42)
                data['mr_data'][env][source]['RSRP'] = df_rsrp[['Longitude', 'Latitude', val_cols['RSRP']]].round({'Longitude': 5, 'Latitude': 5, val_cols['RSRP']: 1}).values.tolist()

            # RSRQ: Keep ALL spots clipped to polygon+300m
            if len(df_rsrq) > 0:
                if len(df_rsrq) > MAX_PTS:
                    df_rsrq = df_rsrq.sample(n=MAX_PTS, random_state=42)
                data['mr_data'][env][source]['RSRQ'] = df_rsrq[['Longitude', 'Latitude', val_cols['RSRQ']]].round({'Longitude': 5, 'Latitude': 5, val_cols['RSRQ']: 1}).values.tolist()
            
    # Convert polygon to GeoJSON format for Leaflet mapping
    import shapely.geometry
    poly_4326 = gpd.GeoSeries([data['polygon']], crs="EPSG:3857").to_crs(epsg=4326).iloc[0]
    data['geojson'] = shapely.geometry.mapping(poly_4326)
    
    # Process TLP Buffer
    buffered_1300m = data['polygon'].buffer(1300)
    tlp_in_buffer = gdf_tlp_3857[gdf_tlp_3857.geometry.within(buffered_1300m)]
    
    for _, row in tlp_in_buffer.iterrows():
        data['tlp_points'].append({
            'lat': round(float(row['Latitude']), 5),
            'lon': round(float(row['Longitude']), 5),
            'name': str(row.get('Tower Provider Name', 'Unknown TLP'))
        })
    
    # Remove original shapely object
    del data['polygon']

# Compact JSON output (no whitespace)
print(f"Exporting to {DASHBOARD_DATA_JS}...")
with open(DASHBOARD_DATA_JS, 'w') as f:
    f.write("const DASHBOARD_DATA = ")
    json.dump(airports, f, separators=(',', ':'))
    f.write(";")

size_mb = os.path.getsize(DASHBOARD_DATA_JS) / (1024*1024)
print(f"Export complete! File size: {size_mb:.1f} MB")

import pickle
pkl_out = DASHBOARD_DATA_PKL
print(f"Exporting to {pkl_out}...")
with open(pkl_out, 'wb') as f:
    pickle.dump(airports, f)
print("PKL export complete!")
