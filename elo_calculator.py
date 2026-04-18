"""
ELO Rating Calculator for WoW-Mania Battleground Analytics
===========================================================
Processes all level-80 bracket matches chronologically and assigns
an ELO rating to every player based on win/loss outcomes.

Formula:
  - Starting rating: 1500
  - K-factor: 40 (<30 matches), 28 (30-100), 20 (100+)
  - Team size adjustment: outnumbered bonus (1.3x) / majority penalty (0.85x)
  - Team rating = average of visible players' ratings
  - Expected = 1 / (1 + 10^((enemy_avg - team_avg) / 400))
  - Δ = K × (result - expected)

No performance weighting, no decay, level 80 only.

Usage:
    python elo_calculator.py
"""

import sqlite3
import json
import time

DB_PATH = "data/pvpstats.db"
START_RATING = 1500.0
HISTORY_LENGTH = 2000  # Increased limit to show full attendance history


def get_k_factor(matches_played):
    """Adaptive K-factor: higher for new players, lower for veterans."""
    if matches_played < 30:
        return 40
    elif matches_played < 100:
        return 28
    else:
        return 20


def expected_score(rating_a, rating_b):
    """Standard ELO expected score."""
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def team_size_factor(my_team_size, enemy_team_size):
    """Adjust K based on team size imbalance."""
    if my_team_size < enemy_team_size:
        return 1.3   # Outnumbered → reward more for win, punish less for loss
    elif my_team_size > enemy_team_size:
        return 0.85   # Advantage → reward less for win, punish more for loss
    return 1.0


def calculate_elo():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Find the bracket ID for level 80
    c.execute("SELECT id FROM bracket_map WHERE name = '80'")
    row = c.fetchone()
    if not row:
        print("ERROR: No level 80 bracket found in bracket_map.")
        return
    bracket_80 = row[0]

    # Load all level 80 matches in chronological order
    c.execute("""
        SELECT m.id, m.winner_id, m.date
        FROM matches m
        WHERE m.bracket_id = ?
        ORDER BY m.id ASC
    """, (bracket_80,))
    matches = c.fetchall()
    print(f"Processing {len(matches)} level 80 matches...")

    # Load all player_stats for L80 matches in one batch (performance)
    c.execute("""
        SELECT ps.match_id, ps.character_id, ps.faction_id
        FROM player_stats ps
        JOIN matches m ON ps.match_id = m.id
        WHERE m.bracket_id = ?
        ORDER BY ps.match_id
    """, (bracket_80,))
    all_stats = c.fetchall()

    # Index player stats by match_id for fast lookup
    from collections import defaultdict
    match_players = defaultdict(list)  # match_id → [(char_id, faction_id), ...]
    for match_id, char_id, faction_id in all_stats:
        match_players[match_id].append((char_id, faction_id))

    # Player state: {char_id: {rating, peak, matches, wins, history}}
    players = {}

    def get_player(char_id):
        if char_id not in players:
            players[char_id] = {
                'rating': START_RATING,
                'peak': START_RATING,
                'matches': 0,
                'wins': 0,
                'last_date': None,
                'history': []
            }
        return players[char_id]

    start_time = time.time()
    processed = 0

    for match_id, winner_id, match_date in matches:
        participants = match_players.get(match_id, [])
        if not participants:
            continue

        # Split into factions
        team = defaultdict(list)  # faction_id → [char_ids]
        for char_id, faction_id in participants:
            if faction_id > 0:
                team[faction_id].append(char_id)

        factions = list(team.keys())
        if len(factions) != 2:
            # Skip matches without two clear factions
            continue

        f1, f2 = factions
        team1_ids = team[f1]
        team2_ids = team[f2]

        # Calculate team average ratings
        team1_ratings = [get_player(cid)['rating'] for cid in team1_ids]
        team2_ratings = [get_player(cid)['rating'] for cid in team2_ids]
        avg1 = sum(team1_ratings) / len(team1_ratings)
        avg2 = sum(team2_ratings) / len(team2_ratings)

        # Expected scores
        exp1 = expected_score(avg1, avg2)
        exp2 = expected_score(avg2, avg1)

        # Actual results
        result1 = 1.0 if winner_id == f1 else 0.0
        result2 = 1.0 if winner_id == f2 else 0.0

        # Team sizes
        ts_factor_1 = team_size_factor(len(team1_ids), len(team2_ids))
        ts_factor_2 = team_size_factor(len(team2_ids), len(team1_ids))

        # Update each player in team 1
        for cid in team1_ids:
            p = get_player(cid)
            k = get_k_factor(p['matches']) * ts_factor_1
            delta = k * (result1 - exp1)
            p['rating'] += delta
            p['matches'] += 1
            if result1 == 1.0:
                p['wins'] += 1
            if p['rating'] > p['peak']:
                p['peak'] = p['rating']
            p['last_date'] = match_date
            # Store history snapshot (date, rating)
            p['history'].append([match_date, round(p['rating'], 1)])
            if len(p['history']) > HISTORY_LENGTH:
                p['history'] = p['history'][-HISTORY_LENGTH:]

        # Update each player in team 2
        for cid in team2_ids:
            p = get_player(cid)
            k = get_k_factor(p['matches']) * ts_factor_2
            delta = k * (result2 - exp2)
            p['rating'] += delta
            p['matches'] += 1
            if result2 == 1.0:
                p['wins'] += 1
            if p['rating'] > p['peak']:
                p['peak'] = p['rating']
            p['last_date'] = match_date
            # Store history snapshot (date, rating)
            p['history'].append([match_date, round(p['rating'], 1)])
            if len(p['history']) > HISTORY_LENGTH:
                p['history'] = p['history'][-HISTORY_LENGTH:]

        processed += 1
        if processed % 5000 == 0:
            elapsed = time.time() - start_time
            print(f"  ...processed {processed}/{len(matches)} matches ({elapsed:.1f}s)")

    elapsed = time.time() - start_time
    print(f"Processed {processed} matches in {elapsed:.1f}s")
    print(f"Rated {len(players)} unique players")

    # Write results to database
    c.execute("DROP TABLE IF EXISTS elo_ratings")
    c.execute("""
        CREATE TABLE elo_ratings (
            character_id INTEGER PRIMARY KEY,
            rating REAL DEFAULT 1500,
            peak_rating REAL DEFAULT 1500,
            matches_played INTEGER DEFAULT 0,
            wins INTEGER DEFAULT 0,
            last_match_date TEXT,
            rating_history TEXT
        )
    """)

    rows = []
    for char_id, p in players.items():
        rows.append((
            char_id,
            round(p['rating'], 1),
            round(p['peak'], 1),
            p['matches'],
            p['wins'],
            p['last_date'],
            json.dumps(p['history'])
        ))

    c.executemany(
        "INSERT INTO elo_ratings VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows
    )
    
    # Final cleanup to ensure no WAL files remain and DB is optimized
    print("Finalizing database...")
    c.execute("PRAGMA journal_mode=DELETE")
    c.execute("VACUUM")

    conn.commit()
    conn.close()

    # Print summary statistics
    ratings = [p['rating'] for p in players.values()]
    ratings.sort()
    n = len(ratings)
    print(f"\n--- Rating Distribution ---")
    print(f"  Min:    {ratings[0]:.0f}")
    print(f"  25th:   {ratings[n // 4]:.0f}")
    print(f"  Median: {ratings[n // 2]:.0f}")
    print(f"  75th:   {ratings[3 * n // 4]:.0f}")
    print(f"  Max:    {ratings[-1]:.0f}")

    # Top 10
    top = sorted(players.items(), key=lambda x: x[1]['rating'], reverse=True)[:10]
    print(f"\n--- Top 10 ---")
    for rank, (char_id, p) in enumerate(top, 1):
        c.execute("SELECT name FROM character_map WHERE id = ?", (char_id,))
        name = c.fetchone()[0]
        wr = (p['wins'] / p['matches'] * 100) if p['matches'] > 0 else 0
        print(f"  #{rank} {name}: {p['rating']:.0f} (peak {p['peak']:.0f}, {p['matches']} matches, {wr:.1f}% WR)")

    conn.close()
    print("\nELO ratings saved to database.")


if __name__ == '__main__':
    calculate_elo()
