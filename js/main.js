document.addEventListener('DOMContentLoaded', async () => {
    
    // Class Names Mapping
    const classMap = {
        0: 'Unknown',
        1: 'Warrior',
        2: 'Paladin',
        3: 'Hunter',
        4: 'Rogue',
        5: 'Priest',
        6: 'Death Knight',
        7: 'Shaman',
        8: 'Mage',
        9: 'Warlock',
        11: 'Druid'
    };

    const classColors = {
        'Warrior': '#C79C6E',
        'Paladin': '#F58CBA',
        'Hunter': '#ABD473',
        'Rogue': '#FFF569',
        'Priest': '#FFFFFF',
        'Death Knight': '#C41F3B',
        'Shaman': '#0070DE',
        'Mage': '#69CCF0',
        'Warlock': '#9482C9',
        'Druid': '#FF7D0A',
        'Unknown': '#808080'
    };

    // Shared Chart.js Styling Defaults for Dark Mode
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Outfit', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(15, 23, 42, 0.9)';
    Chart.defaults.plugins.tooltip.titleColor = '#f8fafc';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    // Loading State
    document.getElementById('total-matches').innerText = "Loading DB...";

    try {
        const sqlPromise = initSqlJs({
            locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
        });
        const dataPromise = fetch("data/pvpstats.db").then(res => res.arrayBuffer());
        
        const [SQL, buf] = await Promise.all([sqlPromise, dataPromise]);
        const db = new SQL.Database(new Uint8Array(buf));
        
        renderOverview(db);
        renderBgStats(db);
        renderClassStats(db);

    } catch (err) {
        console.error("Failed to load or parse database:", err);
        document.getElementById('total-matches').innerText = "Error loading DB";
    }

    function renderOverview(db) {
        try {
            const resMatches = db.exec("SELECT COUNT(*) as total FROM matches");
            const total_matches = resMatches[0].values[0][0];
            
            const resPlayers = db.exec("SELECT COUNT(*) as total FROM player_stats");
            const total_players = resPlayers[0].values[0][0];

            document.getElementById('total-matches').innerText = total_matches.toLocaleString();
            document.getElementById('total-players').innerText = total_players.toLocaleString();

            const resWins = db.exec(`
                SELECT 
                    winner_id,
                    COUNT(*) as wins
                FROM matches
                WHERE winner_id IN (1, 2)
                GROUP BY winner_id
            `);

            let hordeWins = 0;
            let allianceWins = 0;

            if (resWins.length > 0) {
                resWins[0].values.forEach(row => {
                    if (row[0] === 1) hordeWins = row[1];
                    if (row[0] === 2) allianceWins = row[1];
                });
            }

            document.getElementById('horde-wins').innerText = hordeWins.toLocaleString();
            document.getElementById('alliance-wins').innerText = allianceWins.toLocaleString();

            const total = hordeWins + allianceWins;
            if (total > 0) {
                const hordePct = (hordeWins / total) * 100;
                const alliancePct = (allianceWins / total) * 100;
                document.getElementById('dom-horde-bar').style.width = hordePct + '%';
                document.getElementById('dom-alliance-bar').style.width = alliancePct + '%';
            }
        } catch(e) {
            console.error("Overview Fetch Error:", e);
        }
    }

    function renderBgStats(db) {
        try {
            const res = db.exec(`
                SELECT 
                    bg_map.name,
                    COUNT(*) as total,
                    SUM(CASE WHEN winner_id = 1 THEN 1 ELSE 0 END) as horde_wins,
                    SUM(CASE WHEN winner_id = 2 THEN 1 ELSE 0 END) as alliance_wins
                FROM matches
                LEFT JOIN bg_map ON matches.bg_id = bg_map.id
                GROUP BY matches.bg_id
                ORDER BY total DESC
                LIMIT 10
            `);

            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => d[0]);
            const hordeData = values.map(d => d[2]);
            const allianceData = values.map(d => d[3]);

            const ctx = document.getElementById('bgChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Horde Wins',
                            data: hordeData,
                            backgroundColor: 'rgba(239, 68, 68, 0.8)',
                            borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            label: 'Alliance Wins',
                            data: allianceData,
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderColor: 'rgba(59, 130, 246, 1)',
                            borderWidth: 1,
                            borderRadius: 4
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
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });

        } catch(e) {
            console.error("BG Stats Fetch Error:", e);
        }
    }

    function renderClassStats(db) {
        try {
            const res = db.exec(`
                SELECT 
                    class_id,
                    COUNT(*) as count,
                    AVG(kb) as avg_kb,
                    AVG(damage) as avg_damage,
                    AVG(healing) as avg_healing
                FROM player_stats
                WHERE class_id > 0
                GROUP BY class_id
                ORDER BY count DESC
            `);

            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => classMap[d[0]] || 'Unknown');
            const counts = values.map(d => d[1]);
            const dmgData = values.map(d => Math.round(d[3]));
            const healData = values.map(d => Math.round(d[4]));
            const bgColors = labels.map(l => classColors[l]);

            // Chart 1: Class Popularity
            const ctxClass = document.getElementById('classChart').getContext('2d');
            new Chart(ctxClass, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: counts,
                        backgroundColor: bgColors,
                        borderWidth: 0,
                        hoverOffset: 10
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'right' }
                    },
                    cutout: '65%'
                }
            });

            // Chart 2: Performance
            const ctxPerf = document.getElementById('performanceChart').getContext('2d');
            new Chart(ctxPerf, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Avg Damage',
                            data: dmgData,
                            backgroundColor: 'rgba(239, 68, 68, 0.6)',
                            borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            label: 'Avg Healing',
                            data: healData,
                            backgroundColor: 'rgba(16, 185, 129, 0.6)',
                            borderColor: 'rgba(16, 185, 129, 1)',
                            borderWidth: 1,
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { 
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            beginAtZero: true
                        },
                        x: {
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: { position: 'bottom' }
                    }
                }
            });

        } catch(e) {
            console.error("Class Stats Fetch Error:", e);
        }
    }

});
