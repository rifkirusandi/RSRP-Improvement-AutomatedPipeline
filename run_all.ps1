Write-Host "Updating README.md..."
python update_readme.py

Write-Host "Running main pipeline for ALL airports..."
python -u main.py

Write-Host "Installing comtypes for PDF conversion..."
pip install comtypes

Write-Host "Converting PPTX to PDF and copying to I: drive..."
python convert_and_copy.py

Write-Host "Pushing to GitHub..."
git add .
git commit -m "Automated update: processed all airports, generated combined Excel and PDFs"
git push

Write-Host "All tasks completed successfully!"
