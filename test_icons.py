import os
import sqlite3

conn = sqlite3.connect('data/pvpstats.db')
c = conn.cursor()

# Check race icons
print("=== Race icon check ===")
for r in c.execute("SELECT * FROM race_map WHERE id > 0 ORDER BY id").fetchall():
    fname = f"img/{r[1]}.jpg"
    exists = os.path.exists(fname)
    print(f"  {'OK' if exists else 'MISSING'}: {fname} (id={r[0]})")

# Check class icons
print("\n=== Class icon check ===")
class_ids = [1,2,3,4,5,6,7,8,9,11]
for cid in class_ids:
    fname = f"img/{cid}.jpg"
    exists = os.path.exists(fname)
    print(f"  {'OK' if exists else 'MISSING'}: {fname}")

conn.close()
