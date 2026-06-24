import os
import glob
import shutil
import comtypes.client
import time

def convert_pptx_to_pdf(folder="Output", dest_folder=r"I:\My Drive\Airport Improvement"):
    # Ensure destination folder exists
    os.makedirs(dest_folder, exist_ok=True)
    
    # Initialize PowerPoint COM object
    powerpoint = None
    try:
        powerpoint = comtypes.client.CreateObject("Powerpoint.Application")
        powerpoint.Visible = 1
        
        # Find all pptx files in Output directory
        pptx_files = glob.glob(os.path.join(folder, "*.pptx"))
        for pptx in pptx_files:
            abs_pptx = os.path.abspath(pptx)
            filename = os.path.basename(pptx)
            pdf_filename = filename.replace(".pptx", ".pdf")
            abs_pdf = os.path.abspath(os.path.join(folder, pdf_filename))
            
            print(f"Converting {filename} to PDF...")
            deck = powerpoint.Presentations.Open(abs_pptx)
            deck.SaveAs(abs_pdf, 32) # 32 is the format code for PDF
            deck.Close()
            
            # Copy to I: drive
            dest_path = os.path.join(dest_folder, pdf_filename)
            print(f"Copying to {dest_path}...")
            shutil.copy2(abs_pdf, dest_path)
            print(f"Successfully copied {pdf_filename} to {dest_folder}")
    except Exception as e:
        print(f"Error during PPTX to PDF conversion: {e}")
    finally:
        if powerpoint:
            powerpoint.Quit()

if __name__ == "__main__":
    convert_pptx_to_pdf()
