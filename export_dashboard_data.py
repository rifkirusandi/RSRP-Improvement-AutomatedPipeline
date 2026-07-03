import os
import json
import pandas as pd
import geopandas as gpd
from shapely.geometry import Polygon

SITES_CSV = r"Input_Data\sites_footprint.csv"
MR_DIR = r"Input_Data\MR AIRPORT"
PROPOSALS_XLSX = r"Output\All_Airports_Proposals.xlsx"
PROPOSALS_PARQUET = r"Output\proposals_baseline.parquet"
# Prefer Parquet for fast loading; fall back to Excel
PROPOSALS_FILE = PROPOSALS_PARQUET if os.path.exists(PROPOSALS_PARQUET) else PROPOSALS_XLSX
SHP_PATH = r"Input_Data\airport_border\airport_border.shp"
OUT_JSON = r"dashboard\dashboard_data.js"

os.makedirs("dashboard", exist_ok=True)

from shapely.geometry import Point

CLUTTER_PATH = r"Input_Data\Clutter\morphology.TAB"
CLUTTER_RADII = {
    'DENSE URBAN': 636,
    'SUB URBAN': 1103,
    'URBAN': 975,
    'RURAL': 1200
}
global_clutter_gdf = gpd.GeoDataFrame()
try:
    global_clutter_gdf = gpd.read_file(CLUTTER_PATH)
    if global_clutter_gdf.crs and global_clutter_gdf.crs != 'EPSG:4326':
        global_clutter_gdf = global_clutter_gdf.to_crs(epsg=4326)
    _ = global_clutter_gdf.sindex
except Exception as e:
    print(f"Error loading clutter: {e}")
    global_clutter_gdf = gpd.GeoDataFrame()

def get_clutter_radius(lon, lat):
    if global_clutter_gdf.empty: return 975
    pt = Point(lon, lat)
    possible_matches_idx = list(global_clutter_gdf.sindex.query(pt, predicate='intersects'))
    if len(possible_matches_idx) > 0:
        intersecting = global_clutter_gdf.iloc[possible_matches_idx]
        morpho = str(intersecting.iloc[0].get('Morpho', '')).strip().upper()
        for key, radius in CLUTTER_RADII.items():
            if key in morpho:
                return radius
    return 975



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

# Load Proposals
print("Loading proposed sites...")
if PROPOSALS_FILE.endswith('.parquet'):
    df_prop = pd.read_parquet(PROPOSALS_FILE)
else:
    df_prop = pd.read_excel(PROPOSALS_FILE, sheet_name=0)

for airport_name, data in airports.items():
    print(f"Processing {airport_name}...")
    minx, miny, maxx, maxy = data['bbox']
    
    # Existing sites in bounds
    mask_ex = (
        (df_cells['Longitude'] >= minx - 0.05) & 
        (df_cells['Longitude'] <= maxx + 0.05) & 
        (df_cells['Latitude'] >= miny - 0.05) & 
        (df_cells['Latitude'] <= maxy + 0.05)
    )
    for _, row in df_cells[mask_ex].iterrows():
        data['sites'].append({
            'id': str(row.get('Site ID', '')),
            'lon': round(float(row['Longitude']), 5),
            'lat': round(float(row['Latitude']), 5),
            'azimuth': round(float(row.get('Azimuth', 0)), 0),
            'clutter_radius': get_clutter_radius(float(row['Longitude']), float(row['Latitude'])),
            'type': 'existing'
        })
        
    # Proposed sites in bounds
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
        prop_azimuth = round(float(row.get('Azimuth', 0)), 0)
        
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
                    replaced = True
                    break
            if not replaced:
                # Fallback: add as proposed_sector if no matching existing sector found
                data['sites'].append({
                    'id': site_id,
                    'lon': round(float(row['Longitude']), 5),
                    'lat': round(float(row['Latitude']), 5),
                    'azimuth': prop_azimuth,
                    'initial_radius': round(radius_m / 1.2, 0),
                    'radius_m': round(radius_m, 0),
                    'beamwidth': beamwidth,
                    'remark': remark,
                    'isHighGain': True,
                    'type': 'proposed_sector'
                })
        else:
            data['sites'].append({
                'id': site_id,
                'lon': round(float(row['Longitude']), 5),
                'lat': round(float(row['Latitude']), 5),
                'azimuth': prop_azimuth,
                'initial_radius': round(radius_m, 0),
                'radius_m': round(radius_m, 0),
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
    
    # Remove original shapely object
    del data['polygon']

# Compact JSON output (no whitespace)
OUT_JSON = r"dashboard\dashboard_data.js"
print(f"Exporting to {OUT_JSON}...")
with open(OUT_JSON, 'w') as f:
    f.write("const DASHBOARD_DATA = ")
    json.dump(airports, f, separators=(',', ':'))
    f.write(";")

size_mb = os.path.getsize(OUT_JSON) / (1024*1024)
print(f"Export complete! File size: {size_mb:.1f} MB")

import pickle
pkl_out = "airport_data.pkl"
print(f"Exporting to {pkl_out}...")
with open(pkl_out, 'wb') as f:
    pickle.dump(airports, f)
print("PKL export complete!")
