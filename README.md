# RSRP-Improvement-AutomatedPipeline

This tool automates the process of optimizing 4G/LTE cell site coverage (RSRP and RSRQ) around airports. It performs spatial analysis on Drive Test/MDT logs alongside existing infrastructure, identifies coverage gaps, and systematically proposes new site placements and additional sectors, prioritizing solutions that conform to strict inter-site distance parameters and coverage limits.

## Features
- **Spatial Coverage Analysis**: Parses GeoJSON/CSV coordinate data for both MR (Measurement Reports) and MDT to map RSRP and RSRQ metrics in real-time.
- **Dynamic Optimization Engine**: Identifies spatial clusters of "bad spots" (RSRP < -105 dBm) inside the airport perimeter using the DBSCAN algorithm.
- **Strict Morphological Constraints**: Uses MapInfo Clutter (`.TAB`) to automatically enforce terrain-specific inter-site distance (ISD) requirements (e.g., Dense Urban = 500m, Rural = 2000m) preventing sites from being proposed too close together.
- **Automated Report Generation**: Stitches beautifully formatted Matplotlib subplot comparisons (Before vs After) directly into high-quality PowerPoint presentations (`.pptx`) with dynamic tables summarizing the quantitative improvements.

## Prerequisites
- Python 3.8+
- GeoPandas, Shapely, Pandas
- Matplotlib, Contextily, Pyproj
- scikit-learn (for DBSCAN clustering)
- python-pptx (for PowerPoint generation)

## Input Data Requirements
*Note: Due to file sizes and confidentiality, all inputs must be placed in `C:\Request\Airport Improvement\` or modified directly within the `main.py` paths. Inputs are `.gitignore`d.*

The pipeline expects:
1. `Internasional Airport Border.shp`
2. `Territory IOH 202605 - May v3.shp`
3. `Morphology Indonesia V4.TAB` (Clutter data)
4. `List Site` and `MR AIRPORT` CSV logs for each airport containing `Longitude`, `Latitude`, `RSRP`, `RSRQ`, and `Azimuth`.

## Usage
Simply run the main script:
```bash
python main.py
```
The script will loop through all 28 registered airports. It processes their data, applies optimization logic dynamically based on morphology, and writes the `Before/After` presentation outputs to the local `Output/` folder.
