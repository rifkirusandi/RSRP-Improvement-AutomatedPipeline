import os
import io
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
import numpy as np
from fastapi.responses import Response

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_FILE = os.path.join(SCRIPT_DIR, 'Input_Data', 'EP-Template.xlsx')
SITES_CSV = os.path.join(SCRIPT_DIR, 'Input_Data', 'sites_footprint.csv')
PROPOSALS_XLSX = os.path.join(SCRIPT_DIR, 'Output', 'All_Airports_Proposals.xlsx')
CLUTTER_PATH = os.path.join(SCRIPT_DIR, 'Input_Data', 'Clutter', 'morphology.TAB')

CLUTTER_RADII = {
    'DENSE URBAN': 636,
    'SUB URBAN': 1103,
    'URBAN': 975,
    'RURAL': 1200
}

try:
    global_clutter_gdf = gpd.read_file(CLUTTER_PATH)
    if global_clutter_gdf.crs and global_clutter_gdf.crs != 'EPSG:4326':
        global_clutter_gdf = global_clutter_gdf.to_crs(epsg=4326)
    _ = global_clutter_gdf.sindex
except Exception:
    global_clutter_gdf = gpd.GeoDataFrame()

def get_clutter_radius_and_name(lon, lat):
    if global_clutter_gdf.empty: return 975, 'Unknown'
    pt = Point(lon, lat)
    possible_matches_idx = list(global_clutter_gdf.sindex.query(pt, predicate='intersects'))
    if len(possible_matches_idx) > 0:
        intersecting = global_clutter_gdf.iloc[possible_matches_idx]
        morpho = str(intersecting.iloc[0].get('Morpho', '')).strip().upper()
        for key, radius in CLUTTER_RADII.items():
            if key in morpho:
                return radius, morpho
    return 975, 'Unknown'

def export_airport_csv(airport_name: str, bbox: tuple):
    try:
        template_df = pd.read_excel(TEMPLATE_FILE)
        cols = template_df.columns.tolist()
    except Exception as e:
        return Response(content=f"EP-Template.xlsx error: {e}", status_code=500)
        
    df_ex = pd.read_csv(SITES_CSV)
    df_ex['Longitude'] = pd.to_numeric(df_ex['Longitude'], errors='coerce')
    df_ex['Latitude'] = pd.to_numeric(df_ex['Latitude'], errors='coerce')
    minx, miny, maxx, maxy = bbox
    mask_ex = (
        (df_ex['Longitude'] >= minx - 0.05) & 
        (df_ex['Longitude'] <= maxx + 0.05) & 
        (df_ex['Latitude'] >= miny - 0.05) & 
        (df_ex['Latitude'] <= maxy + 0.05)
    )
    df_ex = df_ex[mask_ex].copy()
    
    if os.path.exists(PROPOSALS_XLSX):
        df_pr = pd.read_excel(PROPOSALS_XLSX)
    else:
        df_pr = pd.read_parquet(os.path.join(SCRIPT_DIR, 'Output', 'proposals_baseline.parquet'))
        
    df_pr = df_pr[df_pr['Airport'].astype(str).str.lower() == airport_name.lower()].copy()
    
    existing_list = []
    ex_tac_map = [] # To find nearest TAC
    for _, row in df_ex.iterrows():
        site_type = str(row.get('Site Type', 'MACRO')).upper()
        tac = str(row.get('TAC', ''))
        existing_list.append({
            'Site ID': str(row.get('Site ID', '')),
            'Region': airport_name,
            'Site Type': site_type,
            'Longitude': row['Longitude'],
            'Latitude': row['Latitude'],
            'Height': row.get('Height', 20),
            'Azimuth': row.get('Azimuth', 0),
            'Mechanical Downtilt': row.get('Mechanical Downtilt', 2),
            'Electrical Downtilt': row.get('Electrical Downtilt', 2),
            'Clutter': row.get('Clutter', 'Unknown'),
            'Remark': 'Existing',
            'Radius': 600,
            'TAC': tac
        })
        ex_tac_map.append({'lon': row['Longitude'], 'lat': row['Latitude'], 'tac': tac})
        
    # Apply Proposals
    for _, row in df_pr.iterrows():
        remark = str(row.get('Remark', ''))
        site_id = str(row.get('Site ID', ''))
        azimuth = row.get('Azimuth', 0)
        radius = row.get('Radius', 975)
        
        if remark == 'Change Antenna':
            for ex in existing_list:
                if ex['Site ID'] == site_id and ex['Azimuth'] == azimuth:
                    ex['Remark'] = 'Change Antenna'
                    ex['Radius'] = radius
                    break
        elif remark == 'IBC2M':
            for ex in existing_list:
                if ex['Site ID'] == site_id:
                    ex['Site Type'] = 'MACRO'
                    ex['Remark'] = 'IBC2M'
                    break
            existing_list.append({
                'Site ID': site_id,
                'Region': airport_name,
                'Site Type': 'MACRO',
                'Longitude': row['Longitude'],
                'Latitude': row['Latitude'],
                'Height': 20,
                'Azimuth': azimuth,
                'Mechanical Downtilt': 2,
                'Electrical Downtilt': 2,
                'Clutter': row.get('Clutter', 'Unknown'),
                'Remark': 'IBC2M Sector',
                'Radius': radius,
                'TAC': '' # Will get mapped if needed, or inherited
            })
        else:
            # Find nearest TAC
            nearest_tac = ''
            min_dist = float('inf')
            for ex in ex_tac_map:
                # simple euclidean is fine for picking nearest
                dist = (ex['lon'] - row['Longitude'])**2 + (ex['lat'] - row['Latitude'])**2
                if dist < min_dist:
                    min_dist = dist
                    nearest_tac = ex['tac']
                    
            existing_list.append({
                'Site ID': site_id,
                'Region': airport_name,
                'Site Type': 'MACRO',
                'Longitude': row['Longitude'],
                'Latitude': row['Latitude'],
                'Height': 20,
                'Azimuth': azimuth,
                'Mechanical Downtilt': 2,
                'Electrical Downtilt': 2,
                'Clutter': row.get('Clutter', 'Unknown'),
                'Remark': remark,
                'Radius': radius,
                'TAC': nearest_tac
            })
            
    df_combined = pd.DataFrame(existing_list)
    df_combined = df_combined[df_combined['Site Type'] != 'IBS']
    
    df_combined['Azimuth'] = pd.to_numeric(df_combined['Azimuth'], errors='coerce').fillna(0)
    
    # Remove duplicates (e.g. if the proposals file already contains existing sites because of saving from dashboard)
    # Keeping 'last' ensures the updated 'Remark' or 'Radius' from proposals overwrites the base one
    df_combined.drop_duplicates(subset=['Site ID', 'Azimuth'], keep='last', inplace=True)
    
    df_combined.sort_values(by=['Site ID', 'Azimuth'], inplace=True)
    
    final_rows = []
    current_site = None
    sector_idx = 1
    pci_idx = 0
    
    for _, row in df_combined.iterrows():
        sid = row['Site ID']
        if sid != current_site:
            current_site = sid
            sector_idx = 1
            pci_idx = 0
            
        cname = f"{sid}_{airport_name.replace(' ', '_')}_L9_{sector_idx}"
        
        out = {}
        for c in cols: out[c] = ''
        
        out['Site ID'] = sid
        out['Region'] = row['Region']
        out['Site Type'] = row['Site Type']
        out['Cell Name'] = cname
        out['TAC'] = row.get('TAC', cname[:2])
        out['Cell ID'] = f"9{sector_idx}"
        out['Longitude'] = row['Longitude']
        out['Latitude'] = row['Latitude']
        out['Height'] = row['Height']
        out['Azimuth'] = row['Azimuth']
        out['Mechanical Downtilt'] = row['Mechanical Downtilt']
        out['Electrical Downtilt'] = row['Electrical Downtilt']
        out['PCI'] = pci_idx
        out['Clutter'] = row['Clutter']
        out['Remark'] = row['Remark']
        out['Sector'] = f"S{sector_idx}"
        out['Main Calculation Radius(m)'] = 4000
        
        out['RS Power(dBm)'] = 15.2
        out['DlEarfcn'] = 3652
        out['Bandwidth(MHz)'] = 10
        out['Frequency Band'] = 'L900'
        out['Number of Transmission Antennas'] = 2
        out['Number of Reception Antennas'] = 2
        out['Antenna'] = 'APE4518R12v06_1843_X_CO_M45_00T_LTy1'
        out['Main Propagation Model'] = 'Okumura Dense urban'
        out['PDSCH Actual Load(DL)'] = 1
        out['Actual Load(UL)'] = 1
        out['Neighbour PDCCH Load'] = 0.5
        out['Neighbour PDSCH Load'] = 0.5
        out['Frame Configuration'] = 'SA2'
        out['DwPTS-GP-UpPTS'] = 'SSP7'
        out['Active'] = True
        out['Scene'] = 'Outdoor'
        
        final_rows.append(out)
        sector_idx += 1
        pci_idx += 1
        
    df_out = pd.DataFrame(final_rows, columns=cols)
    df_out.sort_values(by=['Site ID', 'Sector'], inplace=True)
    
    csv_str = df_out.to_csv(index=False)
    return Response(content=csv_str, media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={airport_name}-Proposals.csv"})

def import_airport_csv(airport_name: str, csv_content: bytes):
    df_in = pd.read_csv(io.BytesIO(csv_content))
    added = []
    modified = {}
    
    # Process rows
    for _, row in df_in.iterrows():
        remark = str(row.get('Remark', ''))
        site_id = str(row.get('Site ID', ''))
        az = float(row.get('Azimuth', 0))
        lat = float(row.get('Latitude', 0))
        lon = float(row.get('Longitude', 0))
        
        # Strictly query the Morphology Map for this lat/lon!
        radius_m, clutter_name = get_clutter_radius_and_name(lon, lat)
        
        if remark == 'Change Antenna':
            # Exactly 20% increase for High Gain
            radius_m = radius_m * 1.2
        
        if remark == 'Existing':
            # Ignore completely, don't write to modified
            continue
            
        if remark == 'Change Antenna':
            modified[f"{site_id}_{az}"] = {
                'id': site_id,
                'azimuth': az,
                'remark': 'Change Antenna',
                'isHighGain': True,
                'beamwidth': 33
            }
        elif remark == 'IBC2M':
            # This applies to the site itself. The dashboard logic groups by site ID.
            # Usually we don't have a direct 'IBC2M' edit in customSites modified, 
            # but we can track it as a sector change if needed.
            pass
        elif remark in ['New Site', 'Additional Sector', 'IBC2M Sector']:
            added.append({
                'id': site_id,
                'lat': lat,
                'lon': lon,
                'azimuth': az,
                'remark': remark,
                'type': 'proposed_new' if remark == 'New Site' else 'proposed_sector',
                'radius_m': radius_m,
                'beamwidth': 65,
                'tlp_id': 'N/A',
                'tlp_name': 'N/A'
            })
            
    return added, modified
