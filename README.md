# WoW-Mania BG Statistics Dashboard

A simple, static data visualization dashboard for WoW-Mania Battlegrounds, leveraging dynamically executed WebAssembly SQL queries.

## Project Architecture
This project is built to act as a **purely static website**, meaning it can be easily hosted on GitHub Pages or any other static HTML host without a backend server. 

Instead of pre-exporting the database, the site downloads the `pvpstats.db` SQLite file locally to your browser and executes SQL via WebAssembly (`sql.js`) to generate charts in real time.

## How to Update the Website Data

### 1. Scrape the Latest Data
Run the multithreaded scraper to download the latest ranked match data and populate your local `pvpstats.db` database.
```bash
python scraper.py <start_id> <end_id>
# Example: python scraper.py 1 28000
```

### 2. Push to GitHub
Commit your updated `pvpstats.db` file and push to your repository.
```bash
git add pvpstats.db
git commit -m "Update DB stats"
git push
```

*(Note: GitHub limits files to 100MB max. If the database grows beyond this, you will need to switch back to JSON exports or use Git LFS).*

## Local Development
To test the visual dashboard locally, start a simple HTTP server in the root directory:
```bash
python -m http.server
```
Then navigate to `http://localhost:8000` in your web browser.