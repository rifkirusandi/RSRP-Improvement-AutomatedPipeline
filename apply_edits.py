import json
import pandas as pd
import os
import sys
import subprocess

def main(json_path):
    if not os.path.exists(json_path):
        print(f"File not found: {json_path}")
        sys.exit(1)
        
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    airport_name = data.get("airport")
    new_sites = data.get("sites", [])
    
    if not airport_name:
        print("Invalid JSON: Missing airport name.")
        sys.exit(1)
        
    print(f"Applying {len(new_sites)} sites for airport: {airport_name}")
    
    excel_path = os.path.join("Output", "All_Airports_Proposals.xlsx")
    
    if os.path.exists(excel_path):
        df = pd.read_excel(excel_path)
    else:
        df = pd.DataFrame()
        
    # Remove old entries for this airport
    if not df.empty and 'Airport' in df.columns:
        df = df[df['Airport'] != airport_name]
        
    # Build new dataframe entries
    new_rows = []
    for site in new_sites:
        new_rows.append({
            'Airport': airport_name,
            'Site ID': site.get('id', ''),
            'Latitude': site.get('lat'),
            'Longitude': site.get('lon'),
            'Site Type': 'Existing Site' if site.get('type') == 'existing' else ('New Site' if site.get('type') == 'proposed_new' else 'Additional Sector'),
            'Azimuth': site.get('azimuth', 0),
            'Radius': site.get('radius_m', 600),
            'Beamwidth': site.get('beamwidth', 65),
            'Remark': site.get('remark', ''),
            'Tower Provider ID': site.get('tlp_id', 'N/A'),
            'Tower Provider Name': site.get('tlp_name', 'N/A')
        })
        
    if new_rows:
        df_new = pd.DataFrame(new_rows)
        df = pd.concat([df, df_new], ignore_index=True)
        
    # Save back to Excel
    df.to_excel(excel_path, index=False)
    print("Updated All_Airports_Proposals.xlsx")
    
    # Run PPTX Generation
    print("Regenerating PPTX...")
    subprocess.run(["python", "generate_single_pptx.py", airport_name])
    
    # Run export for Dashboard base update
    print("Regenerating Dashboard Data...")
    subprocess.run(["python", "export_dashboard_data.py"])
    print("Done!")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python apply_edits.py <path_to_json>")
        sys.exit(1)
    main(sys.argv[1])
