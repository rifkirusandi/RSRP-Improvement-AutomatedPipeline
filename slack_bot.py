import os
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
import urllib.request
import subprocess

# ==========================================
# PASTE YOUR TOKENS HERE
# ==========================================
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN", "")
SLACK_APP_TOKEN = os.environ.get("SLACK_APP_TOKEN", "")

app = App(token=SLACK_BOT_TOKEN)

@app.event("message")
def handle_message_events(body, logger, say):
    event = body.get("event", {})
    files = event.get("files", [])
    
    for f in files:
        if f.get("name", "").endswith(".json") and "Edits" in f.get("name", ""):
            say("I received your edits! Processing your request now... ⚙️")
            download_url = f.get("url_private")
            
            # Download file using bot token
            req = urllib.request.Request(download_url, headers={'Authorization': f'Bearer {SLACK_BOT_TOKEN}'})
            try:
                file_name = f.get("name")
                with urllib.request.urlopen(req) as response, open(file_name, 'wb') as out_file:
                    out_file.write(response.read())
                
                say(f"Downloaded `{file_name}`. Rebuilding the map and generating PowerPoint...")
                
                # Run the pipeline
                subprocess.run(["python", "apply_edits.py", file_name])
                
                # Find the PPTX and send it back
                import glob
                ppt_files = glob.glob("Output/*_Airport_Improvement.pptx")
                
                if ppt_files:
                    # Get the most recently modified PPTX
                    ppt_files.sort(key=os.path.getmtime, reverse=True)
                    latest_pptx = ppt_files[0]
                    
                    app.client.files_upload_v2(
                        channel=event["channel"],
                        initial_comment="✅ **Success!** Here is your updated presentation:",
                        file=latest_pptx
                    )
            except Exception as e:
                say(f"❌ Error processing file: {e}")

if __name__ == "__main__":
    print("Starting Slack Bot in Socket Mode... Waiting for messages!")
    SocketModeHandler(app, SLACK_APP_TOKEN).start()
