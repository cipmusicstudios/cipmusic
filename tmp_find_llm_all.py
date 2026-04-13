import json, glob, datetime, os

msg_files = glob.glob("/Users/cece/.gemini/antigravity/brain/43e8db39-7380-4062-9af9-4369398e9d52/.system_generated/messages/*.json")
target_start = datetime.datetime(2026, 3, 28, 17, 0).timestamp()
target_end = datetime.datetime(2026, 3, 28, 21, 30).timestamp()

results = []

for f in msg_files:
    try:
        mtime = os.path.getmtime(f)
        if target_start <= mtime <= target_end:
            results.append((mtime, f))
    except Exception as e:
        pass

results.sort(key=lambda x: x[0])
for mtime, f in results:
    dt = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{dt}] Found message: {f}")
