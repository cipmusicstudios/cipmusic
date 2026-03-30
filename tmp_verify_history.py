import os, glob

base_dirs = [
    "/Users/cece/Library/Application Support/Code/User/History",
    "/Users/cece/Library/Application Support/Cursor/User/History"
]

found = 0
for base_dir in base_dirs:
    if os.path.exists(base_dir):
        files = glob.glob(os.path.join(base_dir, "*", "entries.json"))
        print(f"{base_dir} has {len(files)} entries.json files.")
        found += len(files)
    else:
        print(f"{base_dir} does not exist.")

if found == 0:
    print("No IDE history folders have files in them.")
