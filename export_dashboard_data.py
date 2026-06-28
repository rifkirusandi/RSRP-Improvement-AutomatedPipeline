import os
import json
import pandas as pd
import geopandas as gpd
from shapely.geometry import Polygon

SITES_CSV = r"C:\Request\Airport Improvement\sites covering airport in all huawei foot-print v1.csv"
MR_DIR = r"C:\Request\Airport Improvement\MR AIRPORT"
PROPOSALS_XLSX = r"Output\All_Airports_Proposals.xlsx"
SHP_PATH = r"C:\Request\Airport Improvement\Internasional Airport Border\Internasional Airport Border.shp"
OUT_JSON = r"dashboard\dashboard_data.js"

os.makedirs("dashboard", exist_ok=True)

import fiona
from shapely.geometry import Point

CLUTTER_PATH = r"C:\Request\Airport Improvement\Clutter\Morphology Indonesia V4.TAB"
CLUTTER_RADII = {
    'DENSE URBAN': 400,
    'SUB URBAN': 1000,
    'URBAN': 600,
    'RURAL': 2000
}
global_clutter_gdf = gpd.GeoDataFrame()
try:
    with fiona.open(CLUTTER_PATH) as src:
        features = list(src)
        if features:
            geoms = [Polygon(f['geometry']['coordinates'][0]) if f['geometry']['type'] == 'Polygon' else Point(0,0) for f in features if f['geometry'] is not None]
            # Actually fiona geometry can be directly passed to shapely.geometry.shape
            from shapely.geometry import shape
            geoms = [shape(f['geometry']) for f in features if f['geometry'] is not None]
            props = [f['properties'] for f in features if f['geometry'] is not None]
            global_clutter_gdf = gpd.GeoDataFrame(props, geometry=geoms, crs=src.crs).to_crs(epsg=4326)
            # Create spatial index
            _ = global_clutter_gdf.sindex
except Exception as e:
    print(f"Error loading clutter: {e}")



def get_clutter_radius(lon, lat):
    if global_clutter_gdf.empty: return 600
    pt = Point(lon, lat)
    possible_matches_idx = list(global_clutter_gdf.sindex.query(pt, predicate='intersects'))
    if len(possible_matches_idx) > 0:
        intersecting = global_clutter_gdf.iloc[possible_matches_idx]
        morpho = str(intersecting.iloc[0].get('Morpho', '')).strip().upper()
        for key, radius in CLUTTER_RADII.items():
            if key in morpho:
                return radius
    return 600



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
df_prop = pd.read_excel(PROPOSALS_XLSX, sheet_name=0)

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
        is_new = "_ARPT_" in site_id
        
        radius_m = float(row.get('Radius', 600))
        if pd.isna(radius_m): radius_m = 600
        
        remark = str(row.get('Remark', ''))
        beamwidth = 33 if 'Change Antenna' in remark else 65
        prop_azimuth = round(float(row.get('Azimuth', 0)), 0)
        
        # For Change Antenna: replace the matching existing sector in-place
        if 'Change Antenna' in remark:
            replaced = False
            for existing in data['sites']:
                if existing['type'] == 'existing' and existing['id'] == site_id and existing['azimuth'] == prop_azimuth:
                    existing['original_azimuth'] = existing['azimuth']
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
                'radius_m': round(radius_m, 0),
                'beamwidth': beamwidth,
                'remark': remark,
                'type': 'proposed_new' if is_new else 'proposed_sector'
            })

        
    # Load MR/MDT Data with Unified Downsampling
    val_cols = {'RSRP': 'RSRP(All MRs) (dBm)', 'RSRQ': 'RSRQ(All MRs) (dB)'}
    
    for env in ['Combine', 'Indoor']:
        for source, r_val in [('MR', 25), ('MDT', 10)]:
            # RSRP
            fname_rsrp = f"RSRP_Airport_{env}.csv" if source == 'MR' else f"RSRP_Airport_MDT_{env}.csv"
            df_rsrp = pd.read_csv(os.path.join(MR_DIR, fname_rsrp))
            mask = (df_rsrp['Longitude'] >= minx) & (df_rsrp['Longitude'] <= maxx) & (df_rsrp['Latitude'] >= miny) & (df_rsrp['Latitude'] <= maxy)
            df_rsrp = df_rsrp[mask]
            
            # RSRQ
            fname_rsrq = f"RSRQ_Airport_{env}.csv" if source == 'MR' else f"RSRQ_Airport_MDT_{env}.csv"
            df_rsrq = pd.read_csv(os.path.join(MR_DIR, fname_rsrq))
            mask_q = (df_rsrq['Longitude'] >= minx) & (df_rsrq['Longitude'] <= maxx) & (df_rsrq['Latitude'] >= miny) & (df_rsrq['Latitude'] <= maxy)
            df_rsrq = df_rsrq[mask_q]
            
            # Grid size for precise placement (to prevent overlap)
            grid_size = 0.00045 if source == 'MR' else 0.00018
            grid_size_sparse = 0.0022 # 250m for good spots
            
            # RSRP: Keep ALL spots for MDT, but ONLY bad spots for MR
            if len(df_rsrp) > 0:
                if source == 'MR':
                    df_rsrp_target = df_rsrp[df_rsrp[val_cols['RSRP']] < -105].copy()
                else:
                    df_rsrp_target = df_rsrp.copy()
                
                final_rsrp = []
                if len(df_rsrp_target) > 0:
                    df_rsrp_target['grid_lon'] = (df_rsrp_target['Longitude'] / grid_size).round() * grid_size
                    df_rsrp_target['grid_lat'] = (df_rsrp_target['Latitude'] / grid_size).round() * grid_size
                    df_target_grouped = df_rsrp_target.groupby(['grid_lon', 'grid_lat'])[val_cols['RSRP']].mean().reset_index()
                    final_rsrp.extend([[round(row['grid_lon'], 5), round(row['grid_lat'], 5), round(row[val_cols['RSRP']], 1)] for _, row in df_target_grouped.iterrows()])
                    
                data['mr_data'][env][source]['RSRP'] = final_rsrp

            # RSRQ: Keep ALL spots for both MDT and MR inside bbox
            if len(df_rsrq) > 0:
                df_rsrq_target = df_rsrq.copy()
                
                final_rsrq = []
                if len(df_rsrq_target) > 0:
                    df_rsrq_target['grid_lon'] = (df_rsrq_target['Longitude'] / grid_size).round() * grid_size
                    df_rsrq_target['grid_lat'] = (df_rsrq_target['Latitude'] / grid_size).round() * grid_size
                    df_target_grouped = df_rsrq_target.groupby(['grid_lon', 'grid_lat'])[val_cols['RSRQ']].mean().reset_index()
                    final_rsrq.extend([[round(row['grid_lon'], 5), round(row['grid_lat'], 5), round(row[val_cols['RSRQ']], 1)] for _, row in df_target_grouped.iterrows()])
                    
                data['mr_data'][env][source]['RSRQ'] = final_rsrq
            
    # Remove polygon object to make it JSON serializable
    del data['polygon']

# Compact JSON output (no whitespace)
print(f"Exporting to {OUT_JSON}...")
with open(OUT_JSON, 'w') as f:
    f.write("const DASHBOARD_DATA = ")
    json.dump(airports, f, separators=(',', ':'))
    f.write(";")

size_mb = os.path.getsize(OUT_JSON) / (1024*1024)
print(f"Export complete! File size: {size_mb:.1f} MB")
