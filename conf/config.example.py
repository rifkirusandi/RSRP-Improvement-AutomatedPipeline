"""
Configuration Template for RSRP Improvement Automated Pipeline.
Copy this file to config.py and fill in your actual paths.
config.py is gitignored — it will NOT be committed to GitHub.
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# === Input Data Paths ===
SITES_CSV = os.path.join(SCRIPT_DIR, 'Input_Data', 'sites_footprint.csv')
TLP_CSV = os.path.join(SCRIPT_DIR, 'Input_Data', 'TLP', 'tlp_nationwide.csv')
TEMPLATE_FILE = os.path.join(SCRIPT_DIR, 'Input_Data', 'EP-Template.xlsx')
CLUTTER_PATH = os.path.join(SCRIPT_DIR, 'Input_Data', 'Clutter', 'morphology.TAB')
AIRPORT_SHP = os.path.join(SCRIPT_DIR, 'Input_Data', 'airport_border', 'airport_border.shp')
RUNWAY_SHP = os.path.join(SCRIPT_DIR, 'Input_Data', 'Runway', 'runway_buffer.shp')
TERRITORY_SHP = os.path.join(SCRIPT_DIR, 'Input_Data', 'Territory', 'territory.shp')
MR_DIR = os.path.join(SCRIPT_DIR, 'Input_Data', 'MR AIRPORT')
GO_BINARY = os.path.join(SCRIPT_DIR, 'go_workers', 'mr_processor.exe')

# === Derived Directory Paths ===
AIRPORT_DIR = os.path.join(SCRIPT_DIR, 'Input_Data', 'airport_border')
RUNWAY_DIR = os.path.join(SCRIPT_DIR, 'Input_Data', 'Runway')
TERRITORY_DIR = os.path.join(SCRIPT_DIR, 'Input_Data', 'Territory')

# === Output Paths ===
OUT_DIR = os.path.join(SCRIPT_DIR, 'Output')
EVIDENCE_DIR = os.path.join(SCRIPT_DIR, 'Evidence')
PROPOSALS_XLSX = os.path.join(OUT_DIR, 'All_Airports_Proposals.xlsx')
PROPOSALS_PARQUET = os.path.join(OUT_DIR, 'proposals_baseline.parquet')
AUTOSAVE_PKL = os.path.join(OUT_DIR, 'autosave.pkl')
COVERAGE_STATS = os.path.join(OUT_DIR, 'Coverage_Stats.json')

# === Dashboard ===
DASHBOARD_DATA_JS = os.path.join(SCRIPT_DIR, 'dashboard', 'dashboard_data.js')
DASHBOARD_DATA_PKL = os.path.join(SCRIPT_DIR, 'dashboard', 'airport_data.pkl')

# === Clutter Constants ===
CLUTTER_RADII = {
    'DENSE URBAN': 636,
    'SUB URBAN': 1103,
    'URBAN': 975,
    'RURAL': 1200
}
