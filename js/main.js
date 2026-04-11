document.addEventListener('DOMContentLoaded', async () => {

    // ===================================
    // Chart.js Global Defaults
    // ===================================
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.9)';
    Chart.defaults.plugins.tooltip.titleColor = '#f8fafc';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    // ===================================
    // Shorthand references
    // ===================================
    const Icons = WoWIcons;
    const $ = id => document.getElementById(id);
    let db = null;

    // ===================================
    // State Management
    // ===================================
    const lbState = {
        minMatches: 50,
        mode: 'avg', // 'avg' or 'total'
        boards: {
            active:  { offset: 0, limit: 15, exhausted: false },
            damage:  { offset: 0, limit: 15, exhausted: false },
            healing: { offset: 0, limit: 15, exhausted: false },
            kb:      { offset: 0, limit: 15, exhausted: false },
            hk:      { offset: 0, limit: 15, exhausted: false }
        }
    };

    // Track active Chart instances for cleanup
    const activeCharts = {};
    function destroyChart(key) {
        if (activeCharts[key]) {
            activeCharts[key].destroy();
            delete activeCharts[key];
        }
    }

    // ===================================
    // 1. Tab Management
    // ===================================
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let miscInitialized = false;

    function switchTab(tabName) {
        tabBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabName);
        });
        tabContents.forEach(tc => {
            tc.classList.toggle('active', tc.id === `tab-${tabName}`);
        });

        // Lazy-init misc charts on first visit
        if (tabName === 'misc' && !miscInitialized && db) {
            miscInitialized = true;
            initMiscCharts(db);
        }

        // Update hash
        window.location.hash = tabName;
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Restore tab from hash
    const hashTab = window.location.hash.replace('#', '');
    if (['players', 'matches', 'misc'].includes(hashTab)) {
        switchTab(hashTab);
    }

    // ===================================
    // 2. Database Loading
    // ===================================
    $('total-matches').innerText = "Loading DB...";

    try {
        const sqlPromise = initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        const dataPromise = fetch("data/pvpstats.db").then(res => res.arrayBuffer());

        const [SQL, buf] = await Promise.all([sqlPromise, dataPromise]);
        
        const loaderSub = document.querySelector('.loader-subtext');
        if (loaderSub) loaderSub.innerText = "Parsing database into memory...";
        
        db = new SQL.Database(new Uint8Array(buf));

        // Initial rendering
        if (loaderSub) loaderSub.innerText = "Rendering analytics & leaderboards...";
        renderOverview(db);
        initLeaderboardListeners(db); 
        renderAllLeaderboards(db);    
        renderRecentMatches(db);

        // Finalize
        if (loaderSub) loaderSub.innerText = "Dashboard Ready!";
        
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            const container = document.querySelector('.container');
            
            if (overlay) overlay.classList.add('hidden');
            if (container) container.classList.add('loaded');
        }, 600);

        // If misc tab is active at load, init it now
        if (hashTab === 'misc') {
            miscInitialized = true;
            initMiscCharts(db);
        }

    } catch (err) {
        console.error("Failed to load or parse database:", err);
        $('total-matches').innerText = "Error loading DB";
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    // ===================================
    // 3. Overview Stats
    // ===================================
    function renderOverview(db) {
        try {
            const resMatches = db.exec("SELECT COUNT(*) FROM matches");
            const total_matches = resMatches[0].values[0][0];

            const resPlayers = db.exec("SELECT COUNT(*) FROM character_map WHERE id > 0");
            const total_players = resPlayers[0].values[0][0];

            $('total-matches').innerText = total_matches.toLocaleString();
            $('total-players').innerText = total_players.toLocaleString();

            const resWins = db.exec(`
                SELECT winner_id, COUNT(*) as wins
                FROM matches
                WHERE winner_id IN (1, 2)
                GROUP BY winner_id
            `);

            let hordeWins = 0, allianceWins = 0;
            if (resWins.length > 0) {
                resWins[0].values.forEach(row => {
                    if (row[0] === 1) hordeWins = row[1];
                    if (row[0] === 2) allianceWins = row[1];
                });
            }

            $('horde-wins').innerText = hordeWins.toLocaleString();
            $('alliance-wins').innerText = allianceWins.toLocaleString();

            const total = hordeWins + allianceWins;
            if (total > 0) {
                $('dom-horde-bar').style.width = ((hordeWins / total) * 100) + '%';
                $('dom-alliance-bar').style.width = ((allianceWins / total) * 100) + '%';
            }
        } catch (e) {
            console.error("Overview Error:", e);
        }
    }

    // ===================================
    // 4. Player Search
    // ===================================
    const playerSearchInput = $('player-search');
    const playerSearchResults = $('player-search-results');
    let searchDebounce = null;

    playerSearchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        const query = playerSearchInput.value.trim();
        if (query.length < 2) {
            playerSearchResults.classList.remove('visible');
            return;
        }
        searchDebounce = setTimeout(() => searchPlayers(query), 200);
    });

    playerSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            playerSearchResults.classList.remove('visible');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            playerSearchResults.classList.remove('visible');
        }
    });

    function searchPlayers(query) {
        if (!db) return;
        try {
            const safeName = query.replace(/'/g, "''");
            const res = db.exec(`
                SELECT cm.id, cm.name, 
                       COUNT(DISTINCT ps.match_id) as matches,
                       MAX(ps.class_id) as main_class
                FROM character_map cm
                JOIN player_stats ps ON ps.character_id = cm.id
                WHERE cm.name LIKE '%${safeName}%' AND cm.id > 0
                GROUP BY cm.id
                ORDER BY matches DESC
                LIMIT 20
            `);

            if (res.length === 0 || res[0].values.length === 0) {
                playerSearchResults.innerHTML = '<div class="search-result-item"><span class="search-result-name" style="color:var(--text-dim);">No players found</span></div>';
                playerSearchResults.classList.add('visible');
                return;
            }

            const rows = res[0].values;
            playerSearchResults.innerHTML = rows.map(r => {
                const [charId, name, matches, mainClass] = r;
                return `
                    <div class="search-result-item" data-char-id="${charId}">
                        ${Icons.classIcon(mainClass, 22)}
                        <span class="search-result-name">${escapeHtml(name)}</span>
                        <span class="search-result-meta">${matches} matches</span>
                    </div>
                `;
            }).join('');

            playerSearchResults.querySelectorAll('.search-result-item[data-char-id]').forEach(item => {
                item.addEventListener('click', () => {
                    const charId = parseInt(item.dataset.charId);
                    playerSearchResults.classList.remove('visible');
                    playerSearchInput.value = item.querySelector('.search-result-name').textContent;
                    loadPlayerProfile(charId);
                });
            });

            playerSearchResults.classList.add('visible');
        } catch (e) {
            console.error("Player search error:", e);
        }
    }

    // ===================================
    // 5. Player Profile
    // ===================================
    $('profile-close').addEventListener('click', () => {
        $('player-profile').classList.add('hidden');
    });

    function loadPlayerProfile(charId) {
        if (!db) return;
        try {
            // Get player name
            const nameRes = db.exec(`SELECT name FROM character_map WHERE id = ${charId}`);
            if (nameRes.length === 0) return;
            const playerName = nameRes[0].values[0][0];

            // Get aggregate stats
            const statsRes = db.exec(`
                SELECT 
                    COUNT(DISTINCT ps.match_id) as total_matches,
                    SUM(CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END) as wins,
                    CAST(AVG(ps.damage) AS INTEGER) as avg_damage,
                    CAST(AVG(ps.healing) AS INTEGER) as avg_healing,
                    CAST(AVG(ps.kb) AS INTEGER) as avg_kb,
                    CAST(AVG(ps.deaths) AS INTEGER) as avg_deaths,
                    SUM(ps.kb) as total_kb,
                    SUM(ps.deaths) as total_deaths,
                    SUM(ps.hk) as total_hk,
                    SUM(ps.damage) as total_damage,
                    SUM(ps.healing) as total_healing
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                WHERE ps.character_id = ${charId}
            `);

            if (statsRes.length === 0) return;
            const s = statsRes[0].values[0];
            const [totalMatches, wins, avgDmg, avgHeal, avgKb, avgDeaths, totalKb, totalDeaths, totalHk, totalDmg, totalHeal] = s;
            const losses = totalMatches - wins;
            const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : 0;
            const kd = totalDeaths > 0 ? (totalKb / totalDeaths).toFixed(2) : totalKb.toFixed(2);

            // Get most played class
            const classRes = db.exec(`
                SELECT class_id, COUNT(*) as cnt
                FROM player_stats WHERE character_id = ${charId} AND class_id > 0
                GROUP BY class_id ORDER BY cnt DESC LIMIT 1
            `);
            const mainClassId = classRes.length > 0 ? classRes[0].values[0][0] : 0;

            // Get most frequent race
            const raceRes = db.exec(`
                SELECT rm.name, COUNT(*) as cnt
                FROM player_stats ps
                JOIN race_map rm ON ps.race_id = rm.id
                WHERE ps.character_id = ${charId} AND ps.race_id > 0
                GROUP BY ps.race_id ORDER BY cnt DESC LIMIT 1
            `);
            const mainRaceCode = raceRes.length > 0 ? raceRes[0].values[0][0] : null;

            // Get most frequent faction
            const facRes = db.exec(`
                SELECT faction_id, COUNT(*) as cnt
                FROM player_stats WHERE character_id = ${charId} AND faction_id > 0
                GROUP BY faction_id ORDER BY cnt DESC LIMIT 1
            `);
            const mainFaction = facRes.length > 0 ? facRes[0].values[0][0] : 0;

            // Render profile header
            $('profile-icons').innerHTML = `
                ${Icons.factionIcon(mainFaction, 40)}
                ${Icons.classIcon(mainClassId, 40)}
                ${mainRaceCode ? Icons.raceIcon(mainRaceCode, 40) : ''}
            `;
            $('profile-name').textContent = playerName;
            $('profile-name').style.color = Icons.getClassColor(mainClassId);
            $('profile-subtitle').textContent = `${Icons.getClassName(mainClassId)} · ${Icons.raceCodeToName(mainRaceCode)} · ${Icons.getFactionName(mainFaction)}`;

            // Render stat cards
            $('profile-stats-grid').innerHTML = `
                <div class="profile-stat">
                    <div class="profile-stat-value">${totalMatches.toLocaleString()}</div>
                    <div class="profile-stat-label">Matches</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value" style="color: var(--accent);">${winRate}%</div>
                    <div class="profile-stat-label">Win Rate</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${wins}W / ${losses}L</div>
                    <div class="profile-stat-label">Record</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${kd}</div>
                    <div class="profile-stat-label">K/D Ratio</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${Icons.formatNumber(avgDmg)}</div>
                    <div class="profile-stat-label">Avg Damage</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${Icons.formatNumber(avgHeal)}</div>
                    <div class="profile-stat-label">Avg Healing</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${avgKb}</div>
                    <div class="profile-stat-label">Avg KB</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${Icons.formatNumber(totalHk)}</div>
                    <div class="profile-stat-label">Total HK</div>
                </div>
            `;

            // Show profile
            $('player-profile').classList.remove('hidden');
            $('player-profile').scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Render profile charts
            renderPlayerActivityChart(charId);
            renderPlayerBgChart(charId);
            renderPlayerClassChart(charId);
            renderPlayerMatchHistory(charId);

        } catch (e) {
            console.error("Player profile error:", e);
        }
    }

    function renderPlayerActivityChart(charId) {
        destroyChart('playerActivity');
        try {
            const res = db.exec(`
                SELECT SUBSTR(m.date, 1, 7) as month, COUNT(*) as cnt
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                WHERE ps.character_id = ${charId}
                GROUP BY month ORDER BY month
            `);
            if (res.length === 0) return;

            const labels = res[0].values.map(d => d[0]);
            const data = res[0].values.map(d => d[1]);

            const ctx = $('playerActivityChart').getContext('2d');
            activeCharts.playerActivity = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Matches',
                        data,
                        borderColor: 'rgba(99, 102, 241, 1)',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 2,
                        pointHitRadius: 10,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.03)' },
                            ticks: { maxTicksLimit: 8 }
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            beginAtZero: true
                        }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        } catch (e) { console.error("Player activity chart error:", e); }
    }

    function renderPlayerBgChart(charId) {
        destroyChart('playerBg');
        try {
            const res = db.exec(`
                SELECT bg.name,
                       COUNT(*) as total,
                       SUM(CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END) as wins
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                GROUP BY m.bg_id
                ORDER BY total DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => Icons.getBgShortName(d[0]));
            const wins = values.map(d => d[2]);
            const losses = values.map(d => d[1] - d[2]);

            const ctx = $('playerBgChart').getContext('2d');
            activeCharts.playerBg = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Wins',
                            data: wins,
                            backgroundColor: 'rgba(16, 185, 129, 0.7)',
                            borderColor: 'rgba(16, 185, 129, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            label: 'Losses',
                            data: losses,
                            backgroundColor: 'rgba(239, 68, 68, 0.5)',
                            borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, grid: { display: false } },
                        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                    },
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }
                }
            });
        } catch (e) { console.error("Player BG chart error:", e); }
    }

    function renderPlayerClassChart(charId) {
        destroyChart('playerClass');
        try {
            const res = db.exec(`
                SELECT class_id, COUNT(*) as cnt
                FROM player_stats
                WHERE character_id = ${charId} AND class_id > 0
                GROUP BY class_id ORDER BY cnt DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => Icons.getClassName(d[0]));
            const data = values.map(d => d[1]);
            const colors = values.map(d => Icons.getClassColor(d[0]));

            const ctx = $('playerClassChart').getContext('2d');
            activeCharts.playerClass = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data, backgroundColor: colors, borderWidth: 0, hoverOffset: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } },
                    cutout: '60%'
                }
            });
        } catch (e) { console.error("Player class chart error:", e); }
    }

    function renderPlayerMatchHistory(charId) {
        try {
            const res = db.exec(`
                SELECT m.date, bg.name, 
                       CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END as won,
                       ps.damage, ps.healing, ps.kb, m.id
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                ORDER BY m.id DESC
                LIMIT 50
            `);
            if (res.length === 0) return;

            const tbody = document.querySelector('#player-match-history tbody');
            tbody.innerHTML = res[0].values.map(r => {
                const [date, bgName, won, dmg, heal, kb, matchId] = r;
                return `
                    <tr class="clickable-match-row" data-match-id="${matchId}">
                        <td>${date}</td>
                        <td>${Icons.getBgShortName(bgName)}</td>
                        <td class="${won ? 'result-win' : 'result-loss'}">${won ? 'Win' : 'Loss'}</td>
                        <td>${Icons.formatNumber(dmg)}</td>
                        <td>${Icons.formatNumber(heal)}</td>
                        <td>${kb}</td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('.clickable-match-row').forEach(row => {
                row.addEventListener('click', () => {
                    const matchId = parseInt(row.dataset.matchId);
                    switchTab('matches');
                    loadMatchDetail(matchId);
                });
            });
        } catch (e) { console.error("Player match history error:", e); }
    }

    // ===================================
    // 6. Leaderboards (Endless & Filtered)
    // ===================================
    function initLeaderboardListeners(db) {
        // Mode filter pills (Avg vs Total)
        document.querySelectorAll('#mode-pills .filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const val = pill.dataset.mode;
                if (lbState.mode === val) return;

                document.querySelectorAll('#mode-pills .filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                lbState.mode = val;
                renderAllLeaderboards(db);
            });
        });

        // Min matches filter pills
        document.querySelectorAll('#min-match-pills .filter-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const val = parseInt(pill.dataset.min);
                if (lbState.minMatches === val) return;

                // Update UI
                document.querySelectorAll('#min-match-pills .filter-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                // Update state and re-render
                lbState.minMatches = val;
                renderAllLeaderboards(db);
            });
        });

        // Load more buttons
        document.querySelectorAll('.load-more-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const boardKey = btn.dataset.board;
                loadBoard(boardKey, db);
            });
        });
    }

    function renderAllLeaderboards(db) {
        Object.keys(lbState.boards).forEach(key => {
            loadBoard(key, db, true);
        });
    }

    function loadBoard(key, db, reset = false) {
        if (!db) return;
        const state = lbState.boards[key];
        const mode = lbState.mode;
        const isAvg = mode === 'avg';
        const aggFunc = isAvg ? 'AVG' : 'SUM';

        if (reset) {
            state.offset = 0;
            state.exhausted = false;
            const panel = $(`lb-${key}`);
            panel.querySelector('tbody').innerHTML = '';

            // Update table header based on mode
            const th = panel.querySelector('thead th:last-child');
            if (key !== 'active') {
                const label = key === 'damage' ? 'Damage' :
                    key === 'healing' ? 'Healing' :
                        key === 'kb' ? 'KB' : 'HK';
                th.innerText = `${isAvg ? 'Avg' : 'Total'} ${label}`;
            }

            const btn = document.querySelector(`.load-more-btn[data-board="${key}"]`);
            if (btn) btn.classList.remove('exhausted');
        }

        if (state.exhausted) return;

        const min = lbState.minMatches;
        let query = "";
        let formatter = v => v.toLocaleString();

        // Optimized subquery for main_class to avoid repeated scans
        const classSubquery = `(SELECT ps2.class_id FROM player_stats ps2 WHERE ps2.character_id = cm.id AND ps2.class_id > 0 GROUP BY ps2.class_id ORDER BY COUNT(*) DESC LIMIT 1)`;

        switch (key) {
            case 'active':
                query = `
                    SELECT cm.name, COUNT(DISTINCT ps.match_id) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps JOIN character_map cm ON ps.character_id = cm.id
                    WHERE cm.name != 'Unknown' AND cm.id > 0
                    GROUP BY ps.character_id 
                    HAVING val >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                break;
            case 'damage':
            case 'healing':
                query = `
                    SELECT cm.name, CAST(${aggFunc}(ps.${key}) AS INTEGER) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps JOIN character_map cm ON ps.character_id = cm.id
                    WHERE ps.class_id > 0 AND cm.name != 'Unknown' AND cm.id > 0
                    GROUP BY ps.character_id HAVING COUNT(*) >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                break;
            case 'kb':
            case 'hk':
                query = `
                    SELECT cm.name, CAST(${aggFunc}(ps.${key}) AS FLOAT) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps JOIN character_map cm ON ps.character_id = cm.id
                    WHERE ps.class_id > 0 AND cm.name != 'Unknown' AND cm.id > 0
                    GROUP BY ps.character_id HAVING COUNT(*) >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                formatter = v => isAvg ? v.toFixed(1) : v.toLocaleString();
                break;
        }

        try {
            const res = db.exec(query);
            if (res.length === 0 || res[0].values.length === 0) {
                state.exhausted = true;
                const btn = document.querySelector(`.load-more-btn[data-board="${key}"]`);
                if (btn) btn.classList.add('exhausted');
                return;
            }

            const rows = res[0].values;
            appendLeaderboardRows(`lb-${key}`, rows, state.offset, formatter);

            state.offset += state.limit;
            if (rows.length < state.limit) {
                state.exhausted = true;
                const btn = document.querySelector(`.load-more-btn[data-board="${key}"]`);
                if (btn) btn.classList.add('exhausted');
            }
        } catch (e) {
            console.error(`Error loading board ${key}:`, e);
        }
    }

    function appendLeaderboardRows(tableId, rows, startRank, formatter) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return;

        rows.forEach((row, i) => {
            const tr = document.createElement('tr');
            const rank = startRank + i + 1;
            const medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
            const [name, value, charId, classId] = row;

            const iconHtml = classId ? Icons.classIcon(classId, 20) : '';
            tr.innerHTML = `
                <td>${medal}</td>
                <td><div class="lb-player-cell">${iconHtml}<span>${escapeHtml(name)}</span></div></td>
                <td>${formatter(value)}</td>
            `;
            if (charId) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', () => loadPlayerProfile(charId));
            }
            tbody.appendChild(tr);
        });
    }

    // ===================================
    // 7. Match Search & Detail
    // ===================================
    const matchSearchInput = $('match-search');
    const matchSearchBtn = $('match-search-btn');

    matchSearchBtn.addEventListener('click', () => {
        const id = parseInt(matchSearchInput.value);
        if (id > 0) loadMatchDetail(id);
    });

    matchSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const id = parseInt(matchSearchInput.value);
            if (id > 0) loadMatchDetail(id);
        }
    });

    $('match-close').addEventListener('click', () => {
        $('match-detail').classList.add('hidden');
    });

    function loadMatchDetail(matchId) {
        if (!db) return;
        try {
            // Get match info
            const matchRes = db.exec(`
                SELECT m.id, bg.name, br.name, m.winner_id, m.date, m.duration_seconds
                FROM matches m
                JOIN bg_map bg ON m.bg_id = bg.id
                JOIN bracket_map br ON m.bracket_id = br.id
                WHERE m.id = ${matchId}
            `);

            if (matchRes.length === 0 || matchRes[0].values.length === 0) {
                $('match-detail-info').innerHTML = `<h2>Match #${matchId} not found</h2>`;
                $('match-detail').classList.remove('hidden');
                document.querySelector('#match-scoreboard tbody').innerHTML = '';
                return;
            }

            const [id, bgName, bracket, winnerId, date, duration] = matchRes[0].values[0];

            $('match-detail-info').innerHTML = `
                <h2>${Icons.factionIcon(winnerId, 28)} Match #${id}: ${bgName}</h2>
                <div class="match-meta-row">
                    <span class="match-meta-item">${Icons.factionIcon(winnerId, 18)} <strong>${Icons.getFactionName(winnerId)}</strong> Victory</span>
                    <span class="match-meta-item">🗓️ ${date}</span>
                    <span class="match-meta-item">⏱️ ${Icons.formatDuration(duration)}</span>
                    <span class="match-meta-item">🏟️ Bracket: ${bracket}</span>
                </div>
            `;

            // Get player stats for this match
            const playersRes = db.exec(`
                SELECT cm.name, ps.faction_id, ps.class_id, rm.name as race_code,
                       ps.kb, ps.deaths, ps.hk, ps.bonus_honor, ps.damage, ps.healing,
                       cm.id as char_id
                FROM player_stats ps
                LEFT JOIN character_map cm ON ps.character_id = cm.id
                LEFT JOIN race_map rm ON ps.race_id = rm.id
                WHERE ps.match_id = ${matchId}
                ORDER BY ps.faction_id ASC, ps.damage DESC
            `);

            const tbody = document.querySelector('#match-scoreboard tbody');
            if (playersRes.length === 0 || playersRes[0].values.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);">No player data available</td></tr>';
                $('match-detail').classList.remove('hidden');
                return;
            }

            const players = playersRes[0].values;
            let html = '';
            let lastFaction = null;

            players.forEach(p => {
                const [name, factionId, classId, raceCode, kb, deaths, hk, honor, dmg, heal, charId] = p;

                // Insert separator between factions
                if (lastFaction !== null && lastFaction !== factionId) {
                    html += `<tr class="faction-separator"><td colspan="9"></td></tr>`;
                }
                lastFaction = factionId;

                const isWinner = factionId === winnerId;
                const factionClass = factionId === 1 ? 'horde-text' : factionId === 2 ? 'alliance-text' : '';

                html += `
                    <tr class="${isWinner ? 'winner-row' : ''} clickable-player-row" data-char-id="${charId || 0}">
                        <td class="player-name ${factionClass}">${Icons.factionIcon(factionId, 16)} ${escapeHtml(name || 'Unknown')}</td>
                        <td class="icon-col">${Icons.classIcon(classId, 22)}</td>
                        <td class="icon-col">${Icons.raceIcon(raceCode, 22)}</td>
                        <td>${kb}</td>
                        <td>${deaths}</td>
                        <td>${hk}</td>
                        <td>${honor.toLocaleString()}</td>
                        <td>${dmg.toLocaleString()}</td>
                        <td>${heal.toLocaleString()}</td>
                    </tr>
                `;
            });

            tbody.innerHTML = html;

            // Add click listeners to go to player profile
            tbody.querySelectorAll('.clickable-player-row').forEach(row => {
                const charId = parseInt(row.dataset.charId);
                if (charId > 0) {
                    row.style.cursor = 'pointer';
                    row.addEventListener('click', () => {
                        switchTab('players');
                        loadPlayerProfile(charId);
                    });
                }
            });

            $('match-detail').classList.remove('hidden');
            $('match-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
            matchSearchInput.value = matchId;

        } catch (e) {
            console.error("Match detail error:", e);
        }
    }

    // ===================================
    // 8. Recent Matches
    // ===================================
    function renderRecentMatches(db) {
        try {
            const res = db.exec(`
                SELECT m.id, bg.name, br.name, m.winner_id, m.date, m.duration_seconds
                FROM matches m
                JOIN bg_map bg ON m.bg_id = bg.id
                JOIN bracket_map br ON m.bracket_id = br.id
                ORDER BY m.id DESC
                LIMIT 100
            `);

            if (res.length === 0) return;

            const tbody = document.querySelector('#recent-matches tbody');
            tbody.innerHTML = res[0].values.map(r => {
                const [id, bgName, bracket, winnerId, date, duration] = r;
                return `
                    <tr data-match-id="${id}">
                        <td class="match-id-cell">#${id}</td>
                        <td>${bgName}</td>
                        <td>${bracket}</td>
                        <td><div class="match-winner-cell">${Icons.factionIcon(winnerId, 18)} ${Icons.getFactionName(winnerId)}</div></td>
                        <td>${date}</td>
                        <td>${Icons.formatDuration(duration)}</td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('tr[data-match-id]').forEach(row => {
                row.addEventListener('click', () => {
                    const matchId = parseInt(row.dataset.matchId);
                    loadMatchDetail(matchId);
                });
            });
        } catch (e) {
            console.error("Recent matches error:", e);
        }
    }

    // ===================================
    // 9. Misc / Analytics Charts
    // ===================================
    function initMiscCharts(db) {
        renderActivityChart(db);
        renderFactionWinRatePerBG(db);
        renderFactionBalanceOverTime(db);
        renderBgStats(db);
        renderClassStats(db);
        renderKDChart(db);
        renderClassWinRate(db);
    }

    function renderActivityChart(db) {
        try {
            const resActivity = db.exec(`
                SELECT SUBSTR(date,1,7) as month, COUNT(*) as matches
                FROM matches
                GROUP BY month ORDER BY month
            `);
            if (resActivity.length === 0) return;

            const labels = resActivity[0].values.map(d => d[0]);
            const data = resActivity[0].values.map(d => d[1]);

            const ctx = $('activityChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Matches per Month',
                        data,
                        borderColor: 'rgba(99, 102, 241, 1)',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        fill: true,
                        tension: 0.35,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        borderWidth: 2.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.03)' },
                            ticks: {
                                maxTicksLimit: 16,
                                callback: function (val) {
                                    const label = this.getLabelForValue(val);
                                    if (label && label.endsWith('-01')) return label.substring(0, 4);
                                    return null;
                                }
                            }
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            beginAtZero: true,
                            title: { display: true, text: 'Matches', color: '#94a3b8' }
                        }
                    },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        } catch (e) { console.error("Activity Chart Error:", e); }
    }

    function renderFactionWinRatePerBG(db) {
        try {
            const res = db.exec(`
                SELECT b.name,
                       SUM(CASE WHEN winner_id=1 THEN 1 ELSE 0 END) as horde_wins,
                       SUM(CASE WHEN winner_id=2 THEN 1 ELSE 0 END) as alliance_wins,
                       COUNT(*) as total
                FROM matches m JOIN bg_map b ON m.bg_id = b.id
                WHERE winner_id > 0
                GROUP BY m.bg_id
                ORDER BY CAST(SUM(CASE WHEN winner_id=1 THEN 1 ELSE 0 END) AS FLOAT)/COUNT(*) DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => d[0]);
            const hordeWR = values.map(d => ((d[1] / d[3]) * 100).toFixed(1));
            const allianceWR = values.map(d => -((d[2] / d[3]) * 100).toFixed(1));

            const ctx = $('factionWinRateChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Horde %', data: hordeWR,
                            backgroundColor: 'rgba(239, 68, 68, 0.75)', borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1, borderRadius: 4, borderSkipped: false
                        },
                        {
                            label: 'Alliance %', data: allianceWR,
                            backgroundColor: 'rgba(59, 130, 246, 0.75)', borderColor: 'rgba(59, 130, 246, 1)',
                            borderWidth: 1, borderRadius: 4, borderSkipped: false
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => Math.abs(v) + '%' }, suggestedMin: -70, suggestedMax: 70 },
                        y: { grid: { display: false } }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + Math.abs(ctx.raw) + '%' } }
                    }
                }
            });
        } catch (e) { console.error("Faction Win Rate Error:", e); }
    }

    function renderFactionBalanceOverTime(db) {
        try {
            const res = db.exec(`
                SELECT SUBSTR(date,1,4) as year,
                       SUM(CASE WHEN winner_id=1 THEN 1 ELSE 0 END) as horde,
                       SUM(CASE WHEN winner_id=2 THEN 1 ELSE 0 END) as alliance,
                       COUNT(*) as total
                FROM matches WHERE winner_id > 0
                GROUP BY year ORDER BY year
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => d[0]);
            const hordePct = values.map(d => ((d[1] / d[3]) * 100).toFixed(1));
            const alliancePct = values.map(d => ((d[2] / d[3]) * 100).toFixed(1));

            const ctx = $('factionBalanceChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Horde Win %', data: hordePct,
                            borderColor: 'rgba(239, 68, 68, 1)', backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4,
                            pointBackgroundColor: 'rgba(239, 68, 68, 1)'
                        },
                        {
                            label: 'Alliance Win %', data: alliancePct,
                            borderColor: 'rgba(59, 130, 246, 1)', backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4,
                            pointBackgroundColor: 'rgba(59, 130, 246, 1)'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, min: 30, max: 70, ticks: { callback: v => v + '%' } },
                        x: { grid: { color: 'rgba(255,255,255,0.03)' } }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.raw + '%' } }
                    }
                }
            });
        } catch (e) { console.error("Faction Balance Error:", e); }
    }

    function renderBgStats(db) {
        try {
            const res = db.exec(`
                SELECT bg_map.name, COUNT(*) as total,
                       SUM(CASE WHEN winner_id = 1 THEN 1 ELSE 0 END) as horde_wins,
                       SUM(CASE WHEN winner_id = 2 THEN 1 ELSE 0 END) as alliance_wins
                FROM matches LEFT JOIN bg_map ON matches.bg_id = bg_map.id
                GROUP BY matches.bg_id ORDER BY total DESC LIMIT 10
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const ctx = $('bgChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: values.map(d => d[0]),
                    datasets: [
                        {
                            label: 'Horde Wins', data: values.map(d => d[2]),
                            backgroundColor: 'rgba(239, 68, 68, 0.8)', borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1, borderRadius: 4
                        },
                        {
                            label: 'Alliance Wins', data: values.map(d => d[3]),
                            backgroundColor: 'rgba(59, 130, 246, 0.8)', borderColor: 'rgba(59, 130, 246, 1)',
                            borderWidth: 1, borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                        y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' } }
                    },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        } catch (e) { console.error("BG Stats Error:", e); }
    }

    function renderClassStats(db) {
        try {
            const res = db.exec(`
                SELECT class_id, COUNT(*) as count,
                       AVG(kb) as avg_kb, AVG(damage) as avg_damage, AVG(healing) as avg_healing
                FROM player_stats WHERE class_id > 0
                GROUP BY class_id ORDER BY count DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => Icons.getClassName(d[0]));
            const counts = values.map(d => d[1]);
            const dmgData = values.map(d => Math.round(d[3]));
            const healData = values.map(d => Math.round(d[4]));
            const bgColors = values.map(d => Icons.getClassColor(d[0]));

            // Popularity doughnut
            const ctxClass = $('classChart').getContext('2d');
            new Chart(ctxClass, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data: counts, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 10 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right' } },
                    cutout: '65%'
                }
            });

            // Performance bar
            const ctxPerf = $('performanceChart').getContext('2d');
            new Chart(ctxPerf, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Avg Damage', data: dmgData,
                            backgroundColor: 'rgba(239, 68, 68, 0.6)', borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1, borderRadius: 4
                        },
                        {
                            label: 'Avg Healing', data: healData,
                            backgroundColor: 'rgba(16, 185, 129, 0.6)', borderColor: 'rgba(16, 185, 129, 1)',
                            borderWidth: 1, borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
                        x: { grid: { display: false } }
                    },
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        } catch (e) { console.error("Class Stats Error:", e); }
    }

    function renderKDChart(db) {
        try {
            const res = db.exec(`
                SELECT class_id,
                       SUM(kb) as total_kb, SUM(deaths) as total_deaths,
                       CASE WHEN SUM(deaths) > 0 THEN CAST(SUM(kb) AS FLOAT)/SUM(deaths) ELSE 0 END as kd
                FROM player_stats WHERE class_id > 0
                GROUP BY class_id ORDER BY kd DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => Icons.getClassName(d[0]));
            const kdData = values.map(d => parseFloat(d[3]).toFixed(2));
            const bgColors = values.map(d => Icons.getClassColor(d[0]) + 'CC');
            const borderColors = values.map(d => Icons.getClassColor(d[0]));

            const ctx = $('kdChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'K/D Ratio', data: kdData,
                        backgroundColor: bgColors, borderColor: borderColors,
                        borderWidth: 2, borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true, ticks: { callback: v => v.toFixed(1) } },
                        y: { grid: { display: false } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (ctx) {
                                    const row = values[ctx.dataIndex];
                                    return `K/D: ${parseFloat(row[3]).toFixed(2)} (${row[1].toLocaleString()} KB / ${row[2].toLocaleString()} Deaths)`;
                                }
                            }
                        }
                    }
                }
            });
        } catch (e) { console.error("KD Chart Error:", e); }
    }

    function renderClassWinRate(db) {
        try {
            const res = db.exec(`
                SELECT ps.class_id,
                       COUNT(*) as total,
                       SUM(CASE WHEN (ps.faction_id = m.winner_id) THEN 1 ELSE 0 END) as wins
                FROM player_stats ps JOIN matches m ON ps.match_id = m.id
                WHERE ps.class_id > 0 AND ps.faction_id > 0
                GROUP BY ps.class_id
                ORDER BY CAST(wins AS FLOAT)/total DESC
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => Icons.getClassName(d[0]));
            const wrData = values.map(d => ((d[2] / d[1]) * 100).toFixed(1));
            const bgColors = values.map(d => Icons.getClassColor(d[0]) + 'CC');
            const borderColors = values.map(d => Icons.getClassColor(d[0]));

            const ctx = $('classWinRateChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Win Rate %', data: wrData,
                        backgroundColor: bgColors, borderColor: borderColors,
                        borderWidth: 2, borderRadius: 6
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, min: 48, max: 58, ticks: { callback: v => v + '%' } },
                        y: { grid: { display: false } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (ctx) {
                                    const row = values[ctx.dataIndex];
                                    return `Win Rate: ${((row[2] / row[1]) * 100).toFixed(1)}% (${row[2].toLocaleString()} wins / ${row[1].toLocaleString()} games)`;
                                }
                            }
                        }
                    }
                }
            });
        } catch (e) { console.error("Class Win Rate Error:", e); }
    }

    // ===================================
    // Utility
    // ===================================
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

});
