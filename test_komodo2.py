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

gdf = gpd.GeoDataFrame(geometry=[poly], crs="EPSG:4326")

fpath = os.path.join(MR_DIR, "RSRP_Airport_Indoor.csv")
df = pd.read_csv(fpath)
pts = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.Longitude, df.Latitude), crs="EPSG:4326")

pts_inside = pts[pts.geometry.within(poly)]
print("Total points:", len(pts))
print("Points inside:", len(pts_inside))
