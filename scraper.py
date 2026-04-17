import sqlite3
import requests
from bs4 import BeautifulSoup
import re
import time
import os
import sys
import threading
from queue import Queue

DB_NAME = "data/pvpstats.db"
BASE_URL = "https://wow-mania.org/pvpstats/redemption/battleground.php?id="

def duration_to_seconds(dur_str):
    if not dur_str or dur_str == "Unknown": return 0
    parts = dur_str.split(':')
    try:
        if len(parts) == 3: # H:M:S
            return int(parts[0])*3600 + int(parts[1])*60 + int(parts[2])
        elif len(parts) == 2: # M:S
            return int(parts[0])*60 + int(parts[1])
        else:
            return int(parts[0])
    except:
        return 0

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    
    maps = ['bg_map', 'bracket_map', 'character_map', 'race_map']
    for m in maps:
        c.execute(f'CREATE TABLE IF NOT EXISTS {m} (id INTEGER PRIMARY KEY, name TEXT UNIQUE)')
        c.execute(f"INSERT OR IGNORE INTO {m} (id, name) VALUES (0, 'Unknown')")
        
    # Table for general match data
    c.execute('''CREATE TABLE IF NOT EXISTS matches
                 (id INTEGER PRIMARY KEY, bg_id INTEGER, bracket_id INTEGER, winner_id INTEGER, date TEXT, duration_seconds INTEGER)''')
    # Table for individual player stats
    c.execute('''CREATE TABLE IF NOT EXISTS player_stats
                 (match_id INTEGER, character_id INTEGER, faction_id INTEGER, class_id INTEGER, race_id INTEGER, 
                  kb INTEGER, deaths INTEGER, hk INTEGER, bonus_honor INTEGER, damage INTEGER, healing INTEGER, 
                  attr1 INTEGER, attr2 INTEGER)''')
    conn.commit()
    conn.close()

def parse_html(html_content, bg_id):
    soup = BeautifulSoup(html_content, 'html.parser')
    
    match_row = soup.find('div', class_='row')
    if not match_row:
        return None  # No valid data found
        
    cols = match_row.find_all('div', class_='col-xs-4')
    if len(cols) < 3:
        return None
        
    # Col 1: Bracket and BG Name
    col1_spans = cols[0].find_all('span')
    if len(col1_spans) < 2:
        return None
    bracket = col1_spans[0].text.strip().replace('[', '').replace(']', '')
    if not bracket: bracket = "Unknown"
    bg_name = " ".join(col1_spans[1].text.split())
    if not bg_name: bg_name = "Unknown"
    
    # Col 2: Winner
    winner_span = cols[1].find('span')
    winner = winner_span.text.strip() if winner_span else cols[1].text.strip()
    
    winner_id = 0
    if 'horde' in winner.lower(): winner_id = 1
    elif 'alliance' in winner.lower(): winner_id = 2
    
    # Col 3: Date and Duration
    col3_text = cols[2].text.strip()
    parts = col3_text.split()
    date = parts[0] if len(parts) > 0 else "Unknown"
    duration = parts[1].replace('[', '').replace(']', '') if len(parts) > 1 else "Unknown"
    duration_sec = duration_to_seconds(duration)
    
    match_data = (bg_id, bg_name, bracket, winner_id, date, duration_sec)
    
    # Players
    player_data = []
    table = soup.find('table', id='bg-table')
    if table:
        tbody = table.find('tbody')
        if tbody:
            for tr in tbody.find_all('tr'):
                tds = tr.find_all('td')
                if len(tds) < 10:
                    continue
                
                # TD 0: Character and faction
                char_span = tds[0].find('span')
                character = char_span.text.strip() if char_span else tds[0].text.strip()
                if not character: character = "Unknown"
                
                # Faction by color
                faction_id = 0
                if char_span and char_span.has_attr('style'):
                    style = char_span['style']
                    if 'cd0a0e' in style.lower():
                        faction_id = 1
                    elif '1a67f4' in style.lower():
                        faction_id = 2
                
                # TD 1: Class and Race
                imgs = tds[1].find_all('img')
                class_id = 0
                race_code = "0-0"
                if len(imgs) >= 1:
                    src = imgs[0].get('src', '')
                    m = re.search(r'class/(\d+)\.gif', src)
                    if m: class_id = int(m.group(1))
                if len(imgs) >= 2:
                    src = imgs[1].get('src', '')
                    m = re.search(r'race/([^.]+)\.gif', src)
                    if m:
                        raw_race = m.group(1)
                        if '-' in raw_race:
                            race_code = raw_race.split('-')[0] + '-0'
                        else:
                            race_code = raw_race + '-0'
                    
                def parse_int(text):
                    try: return int(text.strip())
                    except: return 0
                        
                kb = parse_int(tds[2].text)
                deaths = parse_int(tds[3].text)
                hk = parse_int(tds[4].text)
                bonus_honor = parse_int(tds[5].text)
                damage = parse_int(tds[6].text)
                healing = parse_int(tds[7].text)
                attr1 = parse_int(tds[8].text)
                attr2 = parse_int(tds[9].text)
                
                player_data.append((bg_id, character, faction_id, class_id, race_code,
                                    kb, deaths, hk, bonus_honor, damage, healing, attr1, attr2))
                
    return match_data, player_data

# Multithreading Settings
task_queue = Queue()
result_queue = Queue()
MAX_THREADS = 10
MAX_RETRIES = 3
running = True

def worker():
    """ Worker thread that continuously fetches and parses pages. """
    while running:
        try:
            item = task_queue.get(timeout=1)
        except:
            continue
            
        bg_id, retries = item
        url = BASE_URL + str(bg_id)
        
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                parsed = parse_html(resp.text, bg_id)
                if parsed:
                    match_data, player_data = parsed
                    result_queue.put(('SUCCESS', bg_id, retries, match_data, player_data))
                else:
                    result_queue.put(('INVALID', bg_id, retries, None, None))
            else:
                result_queue.put(('FAILED', bg_id, retries, None, None))
        except Exception as e:
            result_queue.put(('FAILED', bg_id, retries, None, None))
            
        task_queue.task_done()

def get_map_id(c, table, name):
    if not name:
        name = "Unknown"
    c.execute(f"SELECT id FROM {table} WHERE name=?", (name,))
    res = c.fetchone()
    if res:
        return res[0]
    
    # Insert new
    c.execute(f"INSERT INTO {table} (name) VALUES (?)", (name,))
    c.execute(f"SELECT id FROM {table} WHERE name=?", (name,))
    return c.fetchone()[0]

def db_writer(dynamic_mode=False):
    """ Dedicated writer thread to safely write SQLite operations sequentially. """
    global running
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    inserts_since_commit = 0
    total_inserts = 0
    
    latest_success_id = 0
    max_invalid_id = 0
    
    # Grab current max id to establish baseline
    c.execute("SELECT MAX(id) FROM matches")
    baseline = c.fetchone()[0]
    if baseline:
        latest_success_id = baseline
    
    while running or not result_queue.empty():
        try:
            res = result_queue.get(timeout=1)
        except:
            if inserts_since_commit > 0:
                conn.commit()
                inserts_since_commit = 0
            continue
            
        status, bg_id, retries, match_data, player_data = res
        
        if status == 'SUCCESS':
            if bg_id > latest_success_id:
                latest_success_id = bg_id
                
            real_bg_id = get_map_id(c, 'bg_map', match_data[1])
            bracket_id = get_map_id(c, 'bracket_map', match_data[2])
            
            # Match data incoming is: (bg_id, bg_name, bracket, winner_id, date, duration_sec)
            final_match_data = (match_data[0], real_bg_id, bracket_id, match_data[3], match_data[4], match_data[5])
            
            final_player_data = []
            for p in player_data:
                char_id = get_map_id(c, 'character_map', p[1])
                race_id = get_map_id(c, 'race_map', p[4])
                final_player_data.append((p[0], char_id, p[2], p[3], race_id, p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12]))

            # Remove any existing data cleanly to avoid duplication
            c.execute("DELETE FROM matches WHERE id=?", (bg_id,))
            c.execute("DELETE FROM player_stats WHERE match_id=?", (bg_id,))
            
            # Insert new data
            c.execute("INSERT INTO matches VALUES (?,?,?,?,?,?)", final_match_data)
            c.executemany("INSERT INTO player_stats VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", final_player_data)
            print(f"[SUCCESS] ID {bg_id}: {match_data[1]} ({match_data[2]})")
            inserts_since_commit += 1
            total_inserts += 1
            
        elif status == 'INVALID':
            # Missing or Invalid Page (e.g. 200 response but empty page).
            print(f"[INVALID] ID {bg_id}: No valid data found. Skipping.")
            if bg_id > max_invalid_id:
                max_invalid_id = bg_id
                
        elif status == 'FAILED':
            # Network issue or Error. 
            if retries < MAX_RETRIES:
                print(f"[RETRY] ID {bg_id} failed. Retrying... ({retries + 1}/{MAX_RETRIES})")
                task_queue.put((bg_id, retries + 1))
            else:
                print(f"[FAILED] ID {bg_id}: Reached max network retries.")
                if bg_id > max_invalid_id:
                    max_invalid_id = bg_id
                
        if inserts_since_commit >= 50:
            conn.commit()
            inserts_since_commit = 0
            
        # Stopping mechanism for dynamic mode
        if dynamic_mode and running:
            # If our invalid IDs have pushed 100 entries beyond our last known success, assume dead end.
            if max_invalid_id > latest_success_id + 10:
                print(f"\n[AUTO-STOP] Hit a dead end 100 IDs past latest success ({latest_success_id}). Safely stopping!")
                running = False
            
    conn.commit()
    
    run_ts = time.strftime('%Y-%m-%d %H:%M:%S')
    c.execute("CREATE TABLE IF NOT EXISTS scrape_runs (id INTEGER PRIMARY KEY, timestamp TEXT, matches_added INTEGER)")
    c.execute("INSERT INTO scrape_runs (timestamp, matches_added) VALUES (?, ?)", (run_ts, total_inserts))
    conn.commit()
        
    conn.close()

def get_db_max_id():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute("SELECT MAX(id) FROM matches")
    res = c.fetchone()[0]
    conn.close()
    return res if res else 0

def start_scraper(start_id=None, end_id=None, threads=10):
    global running
    
    init_db()
    dynamic_mode = False
    
    if start_id is None and end_id is None:
        dynamic_mode = True
        start_id = get_db_max_id() + 1
        print(f"--- DYNAMIC SCRAPING MODE INITIATED ---")
        print(f"Starting from ID {start_id}. Scraper will automatically stop when no more matches exist.")
    else:
        # Traditional ranged checking to enqueue
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        print("Reading local database to check progress...")
        c.execute(f"SELECT id FROM matches WHERE id BETWEEN {start_id} AND {end_id}")
        existing = set(row[0] for row in c.fetchall())
        conn.close()
        
        enqueued = 0
        for bg_id in range(start_id, end_id + 1):
            if bg_id not in existing:
                task_queue.put((bg_id, 0))
                enqueued += 1
                
        if enqueued == 0:
            print("All IDs in range have already been successfully checked! Exiting.")
            return
        else:
            print(f"Loaded {enqueued} matches into queue. Starting {threads} threads...")

    # Start DB Writer thread
    writer_thread = threading.Thread(target=db_writer, args=(dynamic_mode,))
    writer_thread.start()

    # Start Worker threads
    worker_threads = []
    for i in range(threads):
        t = threading.Thread(target=worker)
        t.start()
        worker_threads.append(t)

    def wait_for_input():
        global running
        try:
            line = sys.stdin.readline()
            if line != '' and running:
                running = False
                print("\n[STOP INITIATED] You pressed Enter. Safely shutting down... please wait.")
        except:
            pass

    print("\n>>> PRESS [ENTER] AT ANY TIME TO SAFELY STOP SCRAPING <<<\n")
    input_thread = threading.Thread(target=wait_for_input, daemon=True)
    input_thread.start()

    try:
        
        if dynamic_mode:
            current_id = start_id
            while running:
                # Dynamically feed queue ahead of threads just enough to keep them busy
                while task_queue.qsize() < threads * 3 and running:
                    task_queue.put((current_id, 0))
                    current_id += 1
                time.sleep(1)
        else:
            # Ranged mode
            while running and task_queue.unfinished_tasks > 0:
                time.sleep(1)
                
    except KeyboardInterrupt:
        pass
    finally:
        # Cleanly shutdown
        running = False
        
        print("\nWaiting for threads to finish their current active tasks (~2 seconds)...")
        for t in worker_threads:
            t.join()
            
        writer_thread.join()
        print("Scraping completed and saved.")

if __name__ == '__main__':
    # Parse arguments
    try:
        if len(sys.argv) == 1:
            # Dynamic Mode (no arguments provided)
            start_scraper(threads=MAX_THREADS)
        elif len(sys.argv) == 3:
            s_val = int(sys.argv[1])
            e_val = int(sys.argv[2])
            start_scraper(s_val, e_val, MAX_THREADS)
        elif len(sys.argv) >= 4:
            s_val = int(sys.argv[1])
            e_val = int(sys.argv[2])
            t_val = int(sys.argv[3])
            start_scraper(s_val, e_val, t_val)
        else:
            print("Usage Options:")
            print("  python scraper.py                              (Dynamic Mode: Auto-finds new matches)")
            print("  python scraper.py <start_id> <end_id>          (Ranged Mode: Scrapes specific range)")
            print("  python scraper.py <start_id> <end_id> [threads] (Ranged Mode w/ Thread Control)")
    except ValueError:
        print("Arguments must be numbers!")
