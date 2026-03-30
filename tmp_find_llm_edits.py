import json, glob, datetime, re

msg_files = glob.glob("/Users/cece/.gemini/antigravity/brain/43e8db39-7380-4062-9af9-4369398e9d52/.system_generated/messages/*.json")
target_start = datetime.datetime(2026, 3, 28, 17, 30).timestamp()
target_end = datetime.datetime(2026, 3, 28, 21, 10).timestamp()

results = []

for f in msg_files:
    try:
        with open(f, 'r') as file:
            data = json.load(file)
            
        # The messages might be formatted differently, but typically they contain a "createdAt" or the file modifier time
        import os
        mtime = os.path.getmtime(f)
        if target_start <= mtime <= target_end:
            # check if it wrote to App.tsx
            text_content = json.dumps(data)
            if "App.tsx" in text_content and ("replace_file_content" in text_content or "write_to_file" in text_content):
                results.append((mtime, f))
    except Exception as e:
        pass

results.sort(key=lambda x: x[0])
for mtime, f in results:
    dt = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{dt}] Found code edit in {f}")

