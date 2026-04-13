import json, glob, datetime, re, os

msg_files = glob.glob("/Users/cece/.gemini/antigravity/brain/43e8db39-7380-4062-9af9-4369398e9d52/.system_generated/messages/*.json")

# Find the LAST message before 2026-03-28 21:00:00 PST that writes to App.tsx
target_deadline = datetime.datetime(2026, 3, 28, 21, 0).timestamp()

candidates = []

for f in msg_files:
    try:
        mtime = os.path.getmtime(f)
        if mtime <= target_deadline:
            with open(f, 'r') as file:
                text_content = file.read()
                
            if "App.tsx" in text_content and ("replace_file_content" in text_content or "write_to_file" in text_content or "multi_replace_file_content" in text_content):
                candidates.append((mtime, f))
    except Exception as e:
        pass

candidates.sort(key=lambda x: x[0], reverse=True)

if candidates:
    print("Most recent edit to App.tsx BEFORE March 28 21:00 PST was at:")
    mtime, f = candidates[0]
    dt = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
    print(f"[{dt}] {f}")
    
    # Let's print the top 5 just to see the timeline
    print("\nTop 5 before timeline:")
    for mtime, f in candidates[:5]:
        dt = datetime.datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{dt}] {f}")
else:
    print("No prior edits found in this conversation.")
