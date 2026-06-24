# RSRP-Improvement-AutomatedPipeline

This tool automates the process of optimizing 4G/LTE cell site coverage (RSRP and RSRQ) within any target Region of Interest (ROI) or boundary polygon. It performs spatial analysis on Drive Test/MDT logs alongside existing infrastructure, identifies coverage gaps, and systematically proposes new site placements and additional sectors, prioritizing solutions that conform to strict inter-site distance parameters and coverage limits.

## Features
- **Spatial Coverage Analysis**: Parses GeoJSON/CSV coordinate data for both MR (Measurement Reports) and MDT to map RSRP and RSRQ metrics in real-time.
- **Dynamic Optimization Engine**: Identifies spatial clusters of "bad spots" (RSRP < -105 dBm) inside the target boundary using the DBSCAN algorithm. Attempts to reach 100% coverage thresholds while strictly respecting distance rules.
- **Strict Morphological Constraints**: Uses MapInfo Clutter (`.TAB`) to automatically enforce terrain-specific inter-site distance (ISD) requirements (e.g., Dense Urban = 500m, Rural = 2000m) preventing sites from being proposed too close together. It also dynamically sets sector footprints based on clutter type (`Dense Urban: 400m, Urban: 600m, Sub Urban: 1000m, Rural: 1500m`).
- **Realistic Site Generation**: Automatically proposes new cell sites (equipped with 3 sectors) placed securely near the target bad spots. A robust spatial index boundary check guarantees sites are never proposed over oceans or unmapped clutter areas. If no valid placement area respects the ISD, the area is safely skipped.
- **Automated Report Generation**: Generates detailed `Evidence` plot visualizations with base maps (OpenStreetMap), sector footprints, and bad spots. Stitches beautifully formatted Matplotlib subplot comparisons (Before vs After) directly into high-quality PowerPoint presentations (`.pptx`) with dynamic tables summarizing the quantitative improvements.

## Prerequisites
- Python 3.8+
- GeoPandas, Shapely, Pandas
- Matplotlib, Contextily, Pyproj
- scikit-learn (for DBSCAN clustering)
- python-pptx (for PowerPoint generation)

## Input Data Requirements
*Note: Due to file sizes and confidentiality, all input paths must be configured directly within the `main.py` Constants section. Inputs are `.gitignore`d.*

The pipeline expects:
1. Target Boundary / ROI shapefile (`.shp`)
2. Territory boundary shapefile (`.shp`)
3. Morphology Clutter data (`.TAB`)
4. Global Sites CSV and MR/MDT CSV logs for each target area containing `Longitude`, `Latitude`, `RSRP`, `RSRQ`, and `Azimuth`.

## Usage
Simply run the main script:
```bash
python main.py
```
The script will loop through all registered polygons in the target shapefile. It processes their data, applies optimization logic dynamically based on morphology, and writes the `Before/After` presentation outputs to the local `Output/` folder.
