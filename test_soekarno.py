import geopandas as gpd
import pandas as pd
import shapefile

SHP_PATH = r"C:\Request\Airport Improvement\Internasional Airport Border\Internasional Airport Border.shp"
MR_DIR = r"C:\Request\Airport Improvement\MR AIRPORT"
import os

sf = shapefile.Reader(SHP_PATH)
fields = sf.fields[1:]
field_names = [field[0] for field in fields]

poly = None
for shape_rec in sf.iterShapeRecords():
    rec_dict = dict(zip(field_names, shape_rec.record))
    name = rec_dict.get('Airport', '').strip().replace('\\', '')
    if 'Soekarno' in name:
        from shapely.geometry import Polygon
        poly = Polygon(shape_rec.shape.points)
        break

gdf = gpd.GeoDataFrame(geometry=[poly], crs="EPSG:3857")
bounds = gdf.to_crs(epsg=4326).total_bounds
l_min, la_min, l_max, la_max = bounds

print("Bounds:", bounds)
fpath = os.path.join(MR_DIR, "RSRP_Airport_Combine.csv")
df = pd.read_csv(fpath)
df_filtered = df[
    (df['Longitude'] >= l_min) & (df['Longitude'] <= l_max) &
    (df['Latitude'] >= la_min) & (df['Latitude'] <= la_max)
].copy()
print("Filtered length:", len(df_filtered))
