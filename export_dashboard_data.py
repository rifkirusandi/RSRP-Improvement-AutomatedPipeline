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

# Load Airports (Komodo & Kulon Progo)
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
        'bbox': [minx, miny, maxx, maxy],
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
df_prop = pd.read_excel(PROPOSALS_XLSX)

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
            'lon': float(row['Longitude']),
            'lat': float(row['Latitude']),
            'azimuth': float(row.get('Azimuth', 0)),
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
        
        data['sites'].append({
            'id': site_id,
            'lon': float(row['Longitude']),
            'lat': float(row['Latitude']),
            'azimuth': float(row.get('Azimuth', 0)),
            'radius_m': radius_m,
            'beamwidth': beamwidth,
            'type': 'proposed_new' if is_new else 'proposed_sector'
        })

        
    # Load MR/MDT Data
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
            
            # Sample if too large
            if len(df_rsrp) > 10000: df_rsrp = df_rsrp.sample(10000, random_state=42)
            if len(df_rsrq) > 10000: df_rsrq = df_rsrq.sample(10000, random_state=42)
            
            for _, row in df_rsrp.iterrows():
                data['mr_data'][env][source]['RSRP'].append({'lon': round(row['Longitude'], 5), 'lat': round(row['Latitude'], 5), 'val': round(row[val_cols['RSRP']], 1), 'r': r_val})
                
            for _, row in df_rsrq.iterrows():
                data['mr_data'][env][source]['RSRQ'].append({'lon': round(row['Longitude'], 5), 'lat': round(row['Latitude'], 5), 'val': round(row[val_cols['RSRQ']], 1), 'r': r_val})
            
    # Remove polygon object to make it JSON serializable
    del data['polygon']

OUT_JSON = r"dashboard\dashboard_data.js"

# ... inside script ...

print(f"Exporting to {OUT_JSON}...")
with open(OUT_JSON, 'w') as f:
    f.write("const dashboardDataRaw = ")
    json.dump(airports, f)
    f.write(";")

print("Export complete!")
