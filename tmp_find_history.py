import os, json, glob
from datetime import datetime

base_dirs = [
    "/Users/cece/Library/Application Support/Code/User/History",
    "/Users/cece/Library/Application Support/Cursor/User/History"
]

target_file = "src/App.tsx"
start_time = datetime(2026, 3, 28, 17, 30).timestamp() * 1000
end_time = datetime(2026, 3, 28, 21, 10).timestamp() * 1000

found_versions = []

for base_dir in base_dirs:
    if not os.path.exists(base_dir): continue
    for entry_file in glob.glob(os.path.join(base_dir, "*", "entries.json")):
        try:
            with open(entry_file) as f:
                data = json.load(f)
            resource = data.get("resource", "")
            if target_file in resource and "aurasounds" in resource:
                for entry in data.get("entries", []):
                    ts = entry.get("timestamp", 0)
                    if start_time <= ts <= end_time:
                        file_path = os.path.join(os.path.dirname(entry_file), entry["id"])
                        found_versions.append({
                            "time": datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d %H:%M:%S'),
                            "path": file_path
                        })
        except:
            pass

found_versions.sort(key=lambda x: x["time"])
for v in found_versions:
    print(f"[{v['time']}] {v['path']}")
