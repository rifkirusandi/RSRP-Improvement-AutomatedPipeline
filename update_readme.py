import os

README_PATH = "README.md"
content = """# RSRP-Improvement-AutomatedPipeline

Automated pipeline to propose new cell sites and additional sectors to improve RSRP coverage around airports.

## Updates
- Processes all airports dynamically without filtering.
- Generated `All_Airports_Proposals.xlsx` containing combined proposals for new sites and additional sectors.
- Automatically generates coverage evidence plots and PPTX decks.
- Automatically exports presentations to PDF and syncs to Google Drive.
- Fixed azimuth orientations to lock to increments of 5 degrees.
"""

with open(README_PATH, "w") as f:
    f.write(content)

print("Updated README.md")
