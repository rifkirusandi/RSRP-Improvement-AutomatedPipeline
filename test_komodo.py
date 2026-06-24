import geopandas as gpd
import pandas as pd
import shapefile
import os

SHP_PATH = r"C:\Request\Airport Improvement\Internasional Airport Border\Internasional Airport Border.shp"
MR_DIR = r"C:\Request\Airport Improvement\MR AIRPORT"

sf = shapefile.Reader(SHP_PATH)
fields = sf.fields[1:]
field_names = [field[0] for field in fields]

poly = None
for shape_rec in sf.iterShapeRecords():
    rec_dict = dict(zip(field_names, shape_rec.record))
    name = rec_dict.get('Airport', '').strip().replace('\\', '')
    if 'Komodo' in name:
        from shapely.geometry import Polygon
        poly = Polygon(shape_rec.shape.points)
        break

gdf = gpd.GeoDataFrame(geometry=[poly], crs="EPSG:3857")
bounds = gdf.to_crs(epsg=4326).total_bounds
l_min, la_min, l_max, la_max = bounds

print("Komodo Bounds:", bounds)

for fname in ["RSRP_Airport_Indoor.csv", "RSRP_Airport_Combine.csv"]:
    fpath = os.path.join(MR_DIR, fname)
    if not os.path.exists(fpath):
        print(f"{fname} NOT FOUND")
        continue
    df = pd.read_csv(fpath)
    df_filtered = df[
        (df['Longitude'] >= l_min) & (df['Longitude'] <= l_max) &
        (df['Latitude'] >= la_min) & (df['Latitude'] <= la_max)
    ].copy()
    print(f"Filtered {fname} length:", len(df_filtered))
