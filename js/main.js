document.addEventListener('DOMContentLoaded', async () => {

    // ===================================
    // Chart.js Global Defaults
    // ===================================
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', 'Outfit', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(11, 17, 32, 0.95)';
    Chart.defaults.plugins.tooltip.titleColor = '#f1f5f9';
    Chart.defaults.plugins.tooltip.titleFont = { family: "'Outfit', sans-serif", weight: 700, size: 13 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'Inter', sans-serif", size: 12 };
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 12;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(139, 92, 246, 0.15)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.elements.bar.borderRadius = 6;
    Chart.defaults.elements.line.borderWidth = 2.5;
    Chart.defaults.elements.point.hoverRadius = 6;
    Chart.defaults.elements.point.hoverBackgroundColor = '#8b5cf6';

    // ===================================
    // Shorthand references
    // ===================================
    const Icons = WoWIcons;
    function $(id) { return document.getElementById(id); }
    let db = null;

    // Icon cache for canvas rendering
    const iconImageCache = {};
    async function getIconImage(path) {
        if (!path) return null;
        if (iconImageCache[path]) return iconImageCache[path];
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                iconImageCache[path] = img;
                resolve(img);
            };
            img.onerror = () => resolve(null);
            img.src = path;
        });
    }

    // Register Plugins Early
    const chartIconPlugin = {
        id: 'chartIconPlugin',
        afterDraw(chart, args, options) {
            const { ctx, scales } = chart;
            const isHorizontal = chart.options.indexAxis === 'y';
            const scale = isHorizontal ? scales.y : scales.x;
            if (!scale) return;

            const ticks = scale.getTicks();
            ticks.forEach((tick, index) => {
                const label = scale.getLabelForValue(tick.value);
                let iconPath = null;

                if (options.type === 'class') {
                    const classId = Object.keys(Icons.classMap).find(id => Icons.classMap[id] === label);
                    iconPath = Icons.getClassIconPath(classId);
                } else if (options.type === 'race') {
                    const raceId = Object.keys(Icons.raceIdToName).find(id => Icons.raceIdToName[id] === label);
                    if (raceId) iconPath = Icons.getRaceIconPath(raceId + '-0');
                } else if (options.type === 'faction') {
                    iconPath = label === 'Horde' ? 'img/horde_min.png' : 'img/alliance_min.png';
                }

                if (iconPath) {
                    const img = iconImageCache[iconPath];
                    if (img && img.complete) {
                        const tickPos = scale.getPixelForTick(index);
                        ctx.save();

                        if (isHorizontal) {
                            ctx.font = '12px "Outfit", sans-serif';
                            const labelWidth = ctx.measureText(label).width;
                            const xPos = scale.right - labelWidth - 32 - 15;
                            const yPos = scale.getPixelForTick(index);
                            ctx.drawImage(img, xPos, yPos - 15, 22, 22);
                        } else {
                            // Vertical mode (labels on bottom)
                            const xPos = tickPos;
                            const yPos = chart.chartArea.bottom + 6; // Between bars and text
                            ctx.drawImage(img, xPos - 11, yPos, 22, 22);
                        }

                        ctx.restore();
                    } else {
                        getIconImage(iconPath).then(() => {
                            if (!chart.animating) chart.draw();
                        });
                    }
                }
            });
        }
    };
    Chart.register(chartIconPlugin);

    function getOrCreateTooltip(chart) {
        let tooltipEl = chart.canvas.parentNode.querySelector('div.chartjs-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.classList.add('chartjs-tooltip');
            tooltipEl.style.opacity = 1;
            tooltipEl.style.pointerEvents = 'none';
            tooltipEl.style.position = 'absolute';
            tooltipEl.style.transition = 'all .1s ease';
            chart.canvas.parentNode.appendChild(tooltipEl);
        }
        return tooltipEl;
    }

    // ===================================
    // State Management
    // ===================================
    const lbState = {
        minMatches: 50,
        mode: 'avg', // 'avg' or 'total'
        boards: {
            active: { offset: 0, limit: 15, exhausted: false },
            wins: { offset: 0, limit: 15, exhausted: false },
            losses: { offset: 0, limit: 15, exhausted: false },
            hk: { offset: 0, limit: 15, exhausted: false },
            kb: { offset: 0, limit: 15, exhausted: false },
            deaths: { offset: 0, limit: 15, exhausted: false },
            damage: { offset: 0, limit: 15, exhausted: false },
            healing: { offset: 0, limit: 15, exhausted: false },
            honor: { offset: 0, limit: 15, exhausted: false },
            wsg_caps: { offset: 0, limit: 15, exhausted: false },
            wsg_rets: { offset: 0, limit: 15, exhausted: false },
            ab_aslt: { offset: 0, limit: 15, exhausted: false },
            ab_def: { offset: 0, limit: 15, exhausted: false },
            av_aslt: { offset: 0, limit: 15, exhausted: false },
            av_def: { offset: 0, limit: 15, exhausted: false },
            eots_caps: { offset: 0, limit: 15, exhausted: false },
            sota_demos: { offset: 0, limit: 15, exhausted: false },
            sota_gates: { offset: 0, limit: 15, exhausted: false },
            ioc_aslt: { offset: 0, limit: 15, exhausted: false },
            ioc_def: { offset: 0, limit: 15, exhausted: false }
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
            renderAnalyticsLanding(db);
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
        // GitHub Pages CDN handles cache invalidation on push — no cache buster needed
        const dataPromise = fetch("data/pvpstats.db").then(res => res.arrayBuffer());

        const [SQL, buf] = await Promise.all([sqlPromise, dataPromise]);

        const loaderSub = document.querySelector('.loader-subtext');
        if (loaderSub) loaderSub.innerText = "Parsing database into memory...";

        db = new SQL.Database(new Uint8Array(buf));

        // Initial rendering
        if (loaderSub) loaderSub.innerText = "Rendering analytics & leaderboards...";
        renderAnalyticsLanding(db);
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

            // Initialize scroll animations after content is visible
            initScrollAnimations();
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
    // SCROLL ANIMATIONS (IntersectionObserver)
    // ===================================
    function initScrollAnimations() {
        const animatedElements = document.querySelectorAll('.card, .leaderboard-panel, .kpi-card, .insight-card, .analytics-divider');

        // Immediately mark elements already in view
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    // Stagger delay for grid siblings
                    const parent = entry.target.parentElement;
                    const siblings = parent ? Array.from(parent.children).filter(c => c.matches('.card, .leaderboard-panel, .kpi-card, .insight-card')) : [];
                    const siblingIndex = siblings.indexOf(entry.target);
                    const delay = Math.min(siblingIndex * 60, 300);

                    setTimeout(() => {
                        entry.target.classList.add('visible');
                    }, delay);
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.05,
            rootMargin: '0px 0px -30px 0px'
        });

        animatedElements.forEach(el => {
            // Skip elements inside profile/match detail (they animate themselves)
            if (el.closest('.player-profile-section') || el.closest('.match-detail-section')) {
                el.classList.add('visible');
                return;
            }
            observer.observe(el);
        });
    }

    // ===================================
    // ANIMATED NUMBER COUNTING
    // ===================================
    function animateCount(element, target, duration = 1200) {
        if (!element) return;
        const isFormatted = typeof target === 'string';
        const numericTarget = isFormatted ? parseFloat(target.replace(/[^0-9.]/g, '')) : target;
        if (isNaN(numericTarget) || numericTarget === 0) {
            element.textContent = target;
            return;
        }

        const suffix = isFormatted ? (target.match(/[A-Za-z]+$/) || [''])[0] : '';
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(eased * numericTarget);

            if (suffix) {
                element.textContent = current.toLocaleString() + suffix;
            } else if (isFormatted) {
                element.textContent = current.toLocaleString();
            } else {
                element.textContent = current.toLocaleString();
            }

            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                element.textContent = isFormatted ? target : numericTarget.toLocaleString();
            }
        }
        requestAnimationFrame(update);
    }

    // ===================================
    // SCROLL-TO-TOP BUTTON
    // ===================================
    const scrollTopBtn = document.getElementById('scroll-to-top');
    if (scrollTopBtn) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 500) {
                scrollTopBtn.classList.add('visible');
            } else {
                scrollTopBtn.classList.remove('visible');
            }
        }, { passive: true });

        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ===================================
    // GLOBAL HEADER STATS
    // ===================================
    function renderOverview(db) {
        try {
            let syncTime = null;
            let syncMatches = 0;
            let label = "Sync Check: ";

            // 1. Fetch from specialized Sync Info table
            try {
                // Ensure table exists safely
                const hasTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_info'");
                if (hasTable.length > 0 && hasTable[0].values.length > 0) {
                    const resSync = db.exec("SELECT run_time, match_count FROM sync_info ORDER BY id DESC LIMIT 1");
                    if (resSync.length > 0 && resSync[0].values.length > 0) {
                        syncTime = resSync[0].values[0][0];
                        syncMatches = parseInt(resSync[0].values[0][1]) || 0;
                    }
                }
            } catch (e) { console.warn("Sync Info table check failed:", e); }

            // Fallback to match date if sync_info was empty or missing
            if (!syncTime) {
                try {
                    const resSyncFallback = db.exec("SELECT date FROM matches ORDER BY id DESC LIMIT 1");
                    if (resSyncFallback.length > 0 && resSyncFallback[0].values.length > 0) {
                        syncTime = resSyncFallback[0].values[0][0];
                    }
                } catch (e) { console.warn("Fallback matches date check failed:", e); }
            }

            // 2. Update Sync Badge
            const syncEl = $('sync-status');
            if (syncEl) {
                if (syncTime) {
                    // Try parsing correctly even if Safari/JS complains about SQLite space ' ' separator
                    let safeTimeStr = syncTime;
                    if (safeTimeStr.length === 19 && safeTimeStr.includes(' ')) {
                        safeTimeStr = safeTimeStr.replace(' ', 'T');
                    }

                    const dateObj = new Date(safeTimeStr);
                    let dateStr = syncTime;

                    if (!isNaN(dateObj.getTime())) {
                        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                        dateStr = dateObj.toLocaleDateString(undefined, options);
                    }

                    let html = `${label}<b>${dateStr}</b>`;
                    if (syncMatches > 0) {
                        html += `<span class="new-indicator" style="margin-left: 6px; color: var(--accent); font-size: 0.85em;">(+${syncMatches} New)</span>`;
                    }
                    syncEl.innerHTML = html;
                } else {
                    syncEl.innerHTML = `${label}<b>Never</b>`;
                }
            }

            // 4. Update Global Totals
            const resMatches = db.exec("SELECT COUNT(*) FROM matches");
            const total_matches = resMatches[0].values[0][0] || 0;
            animateCount($('total-matches'), total_matches, 1400);

            const resPlayers = db.exec("SELECT COUNT(*) FROM character_map WHERE id > 0");
            const total_players = resPlayers[0].values[0][0] || 0;
            animateCount($('total-players'), total_players, 1400);

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

            animateCount($('horde-wins'), hordeWins, 1200);
            animateCount($('alliance-wins'), allianceWins, 1200);

            const total = hordeWins + allianceWins;
            if (total > 0) {
                const hBar = $('dom-horde-bar');
                const aBar = $('dom-alliance-bar');
                if (hBar) hBar.style.width = ((hordeWins / total) * 100) + '%';
                if (aBar) aBar.style.width = ((allianceWins / total) * 100) + '%';
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

    function formatDuration(seconds) {
        if (!seconds) return '0s';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        let res = [];
        if (d > 0) res.push(`${d}d`);
        if (h > 0) res.push(`${h}h`);
        if (m > 0) res.push(`${m}m`);
        if (s > 0 && res.length < 3) res.push(`${s}s`);
        return res.join(' ') || '0s';
    }

    function loadPlayerProfile(charId) {
        if (!db) return;
        try {
            // Get player name
            const nameRes = db.exec(`SELECT name FROM character_map WHERE id = ${charId}`);
            if (nameRes.length === 0) return;
            const playerName = nameRes[0].values[0][0];

            // Get comprehensive aggregate stats
            const statsRes = db.exec(`
                SELECT 
                    COUNT(DISTINCT ps.match_id) as total_matches,
                    SUM(CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END) as wins,
                    SUM(ps.kb) as total_kb,
                    SUM(ps.hk) as total_hk,
                    SUM(ps.deaths) as total_deaths,
                    SUM(ps.damage) as total_damage,
                    SUM(ps.healing) as total_healing,
                    SUM(ps.bonus_honor) as total_honor,
                    SUM(m.duration_seconds) as total_time
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                WHERE ps.character_id = ${charId}
            `);

            if (statsRes.length === 0) return;
            const s = statsRes[0].values[0];
            const [totalMatches, wins, totalKb, totalHk, totalDeaths, totalDmg, totalHeal, totalHonor, rawTime] = s;

            // FIX: Duration is stored in 60ths of a second (server ticks) or similar
            const totalTime = rawTime / 60;
            const losses = totalMatches - wins;
            const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : 0;
            const kd = totalDeaths > 0 ? (totalKb / totalDeaths).toFixed(2) : totalKb.toFixed(2);
            const avgHk = totalMatches > 0 ? (totalHk / totalMatches).toFixed(1) : '0';

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

            // 1. Render Banner
            const banner = $('profile-banner');
            banner.className = 'profile-banner ' + (mainFaction === 1 ? 'horde-banner' : mainFaction === 2 ? 'alliance-banner' : '');

            // 2. Render Avatar (large class icon with glow ring)
            $('profile-avatar').innerHTML = Icons.classIcon(mainClassId, 72);

            // 3. Render Name + Subtitle
            $('profile-name').textContent = playerName;
            $('profile-name').style.color = Icons.getClassColor(mainClassId);
            $('profile-subtitle').textContent = `${Icons.getClassName(mainClassId)} · ${Icons.raceCodeToName(mainRaceCode)} · ${Icons.getFactionName(mainFaction)}`;

            // 4. Render Badge Row (faction + race as small icons)
            $('profile-badges').innerHTML = `
                ${Icons.factionIcon(mainFaction, 24)}
                ${mainRaceCode ? Icons.raceIcon(mainRaceCode, 24) : ''}
            `;

            // 5. Render Recent Form (last 20 matches as W/L dots)
            renderRecentForm(charId);

            // 6. Render 6 Stat KPI Cards
            const wrColor = parseFloat(winRate) >= 55 ? 'var(--accent)' : parseFloat(winRate) >= 45 ? 'var(--accent-warm)' : 'var(--horde-color)';
            $('profile-stats-header').innerHTML = `
                <div class="profile-stat">
                    <div class="profile-stat-value">${totalMatches.toLocaleString()}</div>
                    <div class="profile-stat-label">Matches</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value" style="color: ${wrColor};">${winRate}%</div>
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
                    <div class="profile-stat-value">${avgHk}</div>
                    <div class="profile-stat-label">Avg HK / Match</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${Icons.formatNumber(totalHonor)}</div>
                    <div class="profile-stat-label">Total Honor</div>
                </div>
            `;

            // 7. Render Detailed Stats Table
            const rows = [
                { label: 'Time in Battlegrounds', t: formatDuration(totalTime), a: formatDuration(totalTime / totalMatches) },
                { label: 'Honorable Kills', t: Icons.formatNumber(totalHk), a: (totalHk / totalMatches).toFixed(1) },
                { label: 'Killing Blows', t: Icons.formatNumber(totalKb), a: (totalKb / totalMatches).toFixed(1) },
                { label: 'Deaths', t: Icons.formatNumber(totalDeaths), a: (totalDeaths / totalMatches).toFixed(1) },
                { label: 'Bonus Honor', t: Icons.formatNumber(totalHonor), a: Math.floor(totalHonor / totalMatches).toLocaleString() },
                { label: 'Damage', t: Icons.formatNumber(totalDmg), a: Icons.formatNumber(Math.floor(totalDmg / totalMatches)) },
                { label: 'Healing', t: Icons.formatNumber(totalHeal), a: Icons.formatNumber(Math.floor(totalHeal / totalMatches)) }
            ];

            $('player-detailed-stats').querySelector('tbody').innerHTML = rows.map(r => `
                <tr>
                    <td class="label">${r.label}</td>
                    <td class="value">${r.t}</td>
                    <td class="value">${r.a}</td>
                </tr>
            `).join('');

            // 8. Render Best Match Highlights
            renderBestMatchHighlights(charId);

            // Show profile
            $('player-profile').classList.remove('hidden');
            $('player-profile').scrollIntoView({ behavior: 'smooth', block: 'start' });

            // 9. Render Charts & Breakdowns
            renderPlayerActivityChart(charId);
            renderPlayerBgChart(charId);
            renderPlayerBgWinRates(charId);
            renderPlayerBreakdown(charId, 'map', 'player-map-list');
            renderPlayerBreakdown(charId, 'bracket', 'player-bracket-list');
            renderPlayerMatchHistory(charId);

        } catch (e) {
            console.error("Player profile error:", e);
        }
    }

    // Recent Form (last 20 matches as W/L dots)
    function renderRecentForm(charId) {
        try {
            const res = db.exec(`
                SELECT CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END as won
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                WHERE ps.character_id = ${charId}
                ORDER BY m.id DESC
                LIMIT 20
            `);
            if (res.length === 0) return;

            const results = res[0].values.map(r => r[0]);
            const recentWins = results.filter(r => r === 1).length;
            const total = results.length;

            // Calculate win streak
            let streak = 0;
            let streakType = results[0] === 1 ? 'W' : 'L';
            for (const r of results) {
                if ((r === 1 && streakType === 'W') || (r === 0 && streakType === 'L')) {
                    streak++;
                } else break;
            }

            $('profile-form-dots').innerHTML = results.reverse().map((won, i) =>
                `<div class="form-dot ${won ? 'win' : 'loss'}" title="Match ${i + 1}: ${won ? 'Win' : 'Loss'}"></div>`
            ).join('');

            const streakText = streak > 1 ? ` · ${streak}${streakType} streak` : '';
            $('profile-form-summary').textContent = `${recentWins}W ${total - recentWins}L last ${total}${streakText}`;
        } catch (e) { console.error("Recent form error:", e); }
    }

    // Best Match Highlights
    function renderBestMatchHighlights(charId) {
        try {
            const container = $('profile-highlights');
            if (!container) return;

            // Best damage, best healing, best KB in a single match
            const bestDmg = db.exec(`
                SELECT ps.damage, bg.name, m.date
                FROM player_stats ps JOIN matches m ON ps.match_id = m.id JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                ORDER BY ps.damage DESC LIMIT 1
            `);
            const bestHeal = db.exec(`
                SELECT ps.healing, bg.name, m.date
                FROM player_stats ps JOIN matches m ON ps.match_id = m.id JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                ORDER BY ps.healing DESC LIMIT 1
            `);
            const bestKb = db.exec(`
                SELECT ps.kb, bg.name, m.date
                FROM player_stats ps JOIN matches m ON ps.match_id = m.id JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                ORDER BY ps.kb DESC LIMIT 1
            `);

            let html = '';
            if (bestDmg.length > 0) {
                const [dmg, bg, date] = bestDmg[0].values[0];
                html += `
                    <div class="highlight-card">
                        <div class="highlight-icon">⚔️</div>
                        <div class="highlight-info">
                            <span class="highlight-title">Best Damage</span>
                            <span class="highlight-value">${Icons.formatNumber(dmg)}</span>
                            <span class="highlight-meta">${Icons.getBgShortName(bg)} · ${date}</span>
                        </div>
                    </div>`;
            }
            if (bestHeal.length > 0) {
                const [heal, bg, date] = bestHeal[0].values[0];
                html += `
                    <div class="highlight-card">
                        <div class="highlight-icon">💚</div>
                        <div class="highlight-info">
                            <span class="highlight-title">Best Healing</span>
                            <span class="highlight-value">${Icons.formatNumber(heal)}</span>
                            <span class="highlight-meta">${Icons.getBgShortName(bg)} · ${date}</span>
                        </div>
                    </div>`;
            }
            if (bestKb.length > 0) {
                const [kb, bg, date] = bestKb[0].values[0];
                html += `
                    <div class="highlight-card">
                        <div class="highlight-icon">💀</div>
                        <div class="highlight-info">
                            <span class="highlight-title">Best Killing Blows</span>
                            <span class="highlight-value">${kb}</span>
                            <span class="highlight-meta">${Icons.getBgShortName(bg)} · ${date}</span>
                        </div>
                    </div>`;
            }
            container.innerHTML = html;
        } catch (e) { console.error("Best match highlights error:", e); }
    }

    // Per-BG Win Rate Bars
    function renderPlayerBgWinRates(charId) {
        const container = $('player-bg-winrate-list');
        if (!container) return;
        try {
            const res = db.exec(`
                SELECT bg.name, COUNT(*) as total,
                       SUM(CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END) as wins
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                GROUP BY m.bg_id
                ORDER BY CAST(wins AS FLOAT)/total DESC
            `);
            if (res.length === 0) return;

            container.innerHTML = res[0].values.map(r => {
                const [name, total, w] = r;
                const wr = ((w / total) * 100).toFixed(1);
                const barClass = wr >= 55 ? 'bar-green' : wr >= 45 ? 'bar-yellow' : 'bar-red';
                return `
                    <div class="detail-item">
                        <div class="detail-item-header">
                            <span>${Icons.getBgShortName(name)}</span>
                            <span>${wr}% (${w}W / ${total - w}L)</span>
                        </div>
                        <div class="detail-item-bar-bg">
                            <div class="detail-item-bar-fill ${barClass}" style="width: ${wr}%"></div>
                        </div>
                    </div>`;
            }).join('');
        } catch (e) { console.error("BG Win Rate error:", e); }
    }

    function renderPlayerBreakdown(charId, type, containerId) {
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = '';

        try {
            let query = '';
            if (type === 'map') {
                query = `
                    SELECT bg.name, COUNT(*) as cnt, SUM(ps.attr1) as a1, SUM(ps.attr2) as a2
                    FROM player_stats ps
                    JOIN matches m ON ps.match_id = m.id
                    JOIN bg_map bg ON m.bg_id = bg.id
                    WHERE ps.character_id = ${charId}
                    GROUP BY m.bg_id ORDER BY cnt DESC
                `;
            } else {
                query = `
                    SELECT br.name, COUNT(*) as cnt, 0 as a1, 0 as a2
                    FROM player_stats ps
                    JOIN matches m ON ps.match_id = m.id
                    JOIN bracket_map br ON m.bracket_id = br.id
                    WHERE ps.character_id = ${charId}
                    GROUP BY m.bracket_id ORDER BY cnt DESC
                `;
            }

            const res = db.exec(query);
            if (res.length === 0) return;

            const rows = res[0].values;
            const max = Math.max(...rows.map(r => r[1]));

            container.innerHTML = rows.map(r => {
                const name = r[0];
                const count = r[1];
                const a1 = r[2] || 0;
                const a2 = r[3] || 0;
                const pct = (count / max) * 100;
                const icon = type === 'map' ? '🗺️' : '🏆';

                let objectiveHtml = '';
                if (type === 'map' && (a1 > 0 || a2 > 0)) {
                    objectiveHtml = `<div class="detail-item-objectives">${Icons.formatObjectives(name, a1, a2)} Total</div>`;
                }
                return `
                    <div class="detail-item">
                        <div class="detail-item-header">
                            <div>
                                <span>${icon} ${name === '80' ? 'Level 80' : name}</span>
                                ${objectiveHtml}
                            </div>
                            <span>${count} matches</span>
                        </div>
                        <div class="detail-item-bar-bg">
                            <div class="detail-item-bar-fill" style="width: ${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) { console.error(`Breakdown error (${type}):`, e); }
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
            const gradient = ctx.createLinearGradient(0, 0, 0, 260);
            gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.01)');

            activeCharts.playerActivity = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Matches',
                        data,
                        borderColor: 'rgba(139, 92, 246, 1)',
                        backgroundColor: gradient,
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

    function renderPlayerMatchHistory(charId) {
        try {
            const res = db.exec(`
                SELECT m.date, bg.name, 
                       CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END as won,
                       ps.hk, ps.kb, ps.deaths, ps.damage, ps.healing, m.id, ps.attr1, ps.attr2
                FROM player_stats ps
                JOIN matches m ON ps.match_id = m.id
                JOIN bg_map bg ON m.bg_id = bg.id
                WHERE ps.character_id = ${charId}
                ORDER BY m.id DESC
            `);
            if (res.length === 0) return;

            const tbody = document.querySelector('#player-match-history tbody');
            tbody.innerHTML = res[0].values.map(r => {
                const [date, bgName, won, hk, kb, deaths, dmg, heal, matchId, attr1, attr2] = r;
                return `
                    <tr class="clickable-match-row" data-match-id="${matchId}">
                        <td>${date}</td>
                        <td>${Icons.getBgShortName(bgName)}</td>
                        <td class="${won ? 'result-win' : 'result-loss'}">${won ? '🟢 Win' : '🔴 Loss'}</td>
                        <td>${hk}</td>
                        <td>${kb}</td>
                        <td>${deaths}</td>
                        <td>${Icons.formatNumber(dmg)}</td>
                        <td>${Icons.formatNumber(heal)}</td>
                        <td style="color:var(--text-dim); font-size:0.85em;">${Icons.formatObjectives(bgName, attr1, attr2)}</td>
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
            const row1 = ['active', 'wins', 'losses'];
            const boardLabels = {
                active: 'Matches', wins: 'Wins', losses: 'Losses',
                hk: 'HK', kb: 'KB', deaths: 'Deaths',
                damage: 'Damage', healing: 'Healing', honor: 'Honor',
                wsg_caps: 'Caps', wsg_rets: 'Rets',
                ab_aslt: 'Aslt', ab_def: 'Def',
                av_aslt: 'GV Aslt', av_def: 'GV Def',
                eots_caps: 'Caps',
                sota_demos: 'Demos', sota_gates: 'Gates',
                ioc_aslt: 'Aslt', ioc_def: 'Def'
            };
            const label = boardLabels[key] || key;

            if (row1.includes(key)) {
                th.innerText = label;
            } else {
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

        const row1 = ['active', 'wins', 'losses'];
        const isRow1 = row1.includes(key);
        // Force Sum for row 1 even if global mode is Avg
        const currentAgg = isRow1 ? 'SUM' : aggFunc;

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
            case 'wins':
                query = `
                    SELECT cm.name, SUM(CASE WHEN ps.faction_id = m.winner_id THEN 1 ELSE 0 END) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps 
                    JOIN matches m ON ps.match_id = m.id
                    JOIN character_map cm ON ps.character_id = cm.id
                    WHERE cm.id > 0 AND cm.name != 'Unknown'
                    GROUP BY ps.character_id HAVING val >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                break;
            case 'losses':
                query = `
                    SELECT cm.name, SUM(CASE WHEN m.winner_id > 0 AND ps.faction_id != m.winner_id THEN 1 ELSE 0 END) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps 
                    JOIN matches m ON ps.match_id = m.id
                    JOIN character_map cm ON ps.character_id = cm.id
                    WHERE cm.id > 0 AND cm.name != 'Unknown'
                    GROUP BY ps.character_id HAVING val >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                break;
            case 'deaths':
            case 'damage':
            case 'healing':
            case 'kb':
            case 'hk':
            case 'honor':
                const field = key === 'honor' ? 'bonus_honor' : key;
                query = `
                    SELECT cm.name, CAST(${currentAgg}(ps.${field}) AS ${key === 'damage' || key === 'healing' ? 'INTEGER' : 'FLOAT'}) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps JOIN character_map cm ON ps.character_id = cm.id
                    WHERE ps.class_id > 0 AND cm.name != 'Unknown' AND cm.id > 0
                    GROUP BY ps.character_id HAVING COUNT(*) >= ${min}
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                formatter = v => (isAvg && !isRow1) ? v.toFixed(key === 'honor' || key === 'damage' ? 0 : 1) : Math.round(v).toLocaleString();
                break;
            case 'wsg_caps':
            case 'wsg_rets':
            case 'ab_aslt':
            case 'ab_def':
            case 'av_aslt':
            case 'av_def':
            case 'eots_caps':
            case 'sota_demos':
            case 'sota_gates':
            case 'ioc_aslt':
            case 'ioc_def':
                let filter = "";
                let col = "ps.attr1";
                if (key === 'wsg_caps') { filter = "m.bg_id = 1"; }
                else if (key === 'wsg_rets') { filter = "m.bg_id = 1"; col = "ps.attr2"; }
                else if (key === 'ab_aslt') { filter = "m.bg_id = 2"; }
                else if (key === 'ab_def') { filter = "m.bg_id = 2"; col = "ps.attr2"; }
                else if (key === 'av_aslt') { filter = "m.bg_id = 3"; }
                else if (key === 'av_def') { filter = "m.bg_id = 3"; col = "ps.attr2"; }
                else if (key === 'eots_caps') { filter = "m.bg_id = 4"; }
                else if (key === 'sota_demos') { filter = "m.bg_id = 5"; }
                else if (key === 'sota_gates') { filter = "m.bg_id = 5"; col = "ps.attr2"; }
                else if (key === 'ioc_aslt') { filter = "m.bg_id = 6"; }
                else if (key === 'ioc_def') { filter = "m.bg_id = 6"; col = "ps.attr2"; }

                query = `
                    SELECT cm.name, CAST(${currentAgg}(${col}) AS FLOAT) as val, cm.id, ${classSubquery} as main_class
                    FROM player_stats ps 
                    JOIN matches m ON ps.match_id = m.id
                    JOIN character_map cm ON ps.character_id = cm.id
                    WHERE ${filter} AND cm.id > 0 AND cm.name != 'Unknown'
                    GROUP BY ps.character_id HAVING val > 0
                    ORDER BY val DESC LIMIT ${state.limit} OFFSET ${state.offset}
                `;
                formatter = v => (isAvg && !isRow1) ? v.toFixed(1) : Math.round(v).toLocaleString();
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

            const attrs = Icons.getBgAttributes(bgName);
            const thead = document.querySelector('#match-scoreboard thead');
            thead.innerHTML = `
                <tr>
                    <th>Player</th>
                    <th>KB</th>
                    <th>Deaths</th>
                    <th>HK</th>
                    <th>Damage</th>
                    <th>Healing</th>
                    <th title="${attrs[0]}">${Icons.abbrevObjective(attrs[0])}</th>
                    <th title="${attrs[1]}">${Icons.abbrevObjective(attrs[1])}</th>
                    <th>Honor</th>
                </tr>
            `;

            $('match-detail-info').innerHTML = `
                <h2>${Icons.factionIcon(winnerId, 28)} Match #${id}: ${bgName}</h2>
                <div class="match-meta-row">
                    <span class="match-meta-item">🏁 <strong>${Icons.getFactionName(winnerId)}</strong> Victory</span>
                    <span class="match-meta-item">🗓️ ${date}</span>
                    <span class="match-meta-item">⏱️ ${Icons.formatDuration(duration)}</span>
                    <span class="match-meta-item">🏟️ Bracket: ${bracket}</span>
                </div>
            `;

            // Get player stats for this match
            const playersRes = db.exec(`
                SELECT cm.name, ps.faction_id, ps.class_id, rm.name as race_code,
                       ps.kb, ps.deaths, ps.hk, ps.bonus_honor, ps.damage, ps.healing,
                       cm.id as char_id, ps.attr1, ps.attr2
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
                const [name, factionId, classId, raceCode, kb, deaths, hk, honor, dmg, heal, charId, attr1, attr2] = p;

                // Insert separator between factions
                if (lastFaction !== null && lastFaction !== factionId) {
                    html += `<tr class="faction-separator"><td colspan="11"></td></tr>`;
                }
                lastFaction = factionId;

                const isWinner = factionId === winnerId;
                const factionClass = factionId === 1 ? 'horde-text' : factionId === 2 ? 'alliance-text' : '';

                html += `
                    <tr class="${isWinner ? 'winner-row' : ''} clickable-player-row" data-char-id="${charId || 0}">
                        <td class="player-name ${factionClass}">
                            <div class="lb-player-cell">
                                ${Icons.factionIcon(factionId, 16)}
                                ${Icons.raceIcon(raceCode, 20)}
                                ${Icons.classIcon(classId, 20)}
                                <span class="player-name-text">${escapeHtml(name || 'Unknown')}</span>
                            </div>
                        </td>
                        <td>${kb}</td>
                        <td>${deaths}</td>
                        <td>${hk}</td>
                        <td>${dmg.toLocaleString()}</td>
                        <td>${heal.toLocaleString()}</td>
                        <td>${attr1 || 0}</td>
                        <td>${attr2 || 0}</td>
                        <td>${honor.toLocaleString()}</td>
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
    function renderRaceStats(db) {
        try {
            // 1. Race Popularity
            const resPop = db.exec(`
                SELECT r.name, COUNT(*) as cnt
                FROM player_stats ps
                JOIN race_map r ON ps.race_id = r.id
                WHERE ps.race_id > 0
                GROUP BY ps.race_id ORDER BY cnt DESC
            `);
            if (resPop.length > 0) {
                const values = resPop[0].values;
                const labels = values.map(d => {
                    const name = Icons.raceCodeToName(d[0]);
                    return name.replace(' Male', '').replace(' Female', '');
                });
                const counts = values.map(d => d[1]);

                const ctx = $('raceChart').getContext('2d');
                const raceChart = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels,
                        datasets: [{
                            data: counts,
                            backgroundColor: labels.map(l => l === 'Human' || l === 'Night Elf' || l === 'Dwarf' || l === 'Gnome' || l === 'Draenei' || l === 'Worgen' ? '#3b82f6' : '#ef4444'),
                            borderWidth: 0,
                            hoverOffset: 15
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                enabled: false,
                                external: (ctx) => externalTooltipHandler(ctx, 'race')
                            }
                        },
                        cutout: '65%'
                    }
                });
                renderHtmlLegend(raceChart, 'raceChartLegend', 'race');
            }

            // 2. Race Win Rate %
            const resWR = db.exec(`
                SELECT r.name,
                       COUNT(*) as total,
                       SUM(CASE WHEN (ps.faction_id = m.winner_id) THEN 1 ELSE 0 END) as wins
                FROM player_stats ps 
                JOIN matches m ON ps.match_id = m.id
                JOIN race_map r ON ps.race_id = r.id
                WHERE ps.race_id > 0 AND ps.faction_id > 0
                GROUP BY ps.race_id
                ORDER BY CAST(wins AS FLOAT)/total DESC
            `);
            if (resWR.length > 0) {
                const values = resWR[0].values;
                const labels = values.map(d => {
                    const name = Icons.raceCodeToName(d[0]);
                    return name.replace(' Male', '').replace(' Female', '');
                });
                const wrData = values.map(d => ((d[2] / d[1]) * 100).toFixed(1));

                const ctx = $('raceWinRateChart').getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Win Rate %', data: wrData,
                            backgroundColor: labels.map(l => l === 'Human' || l === 'Night Elf' || l === 'Dwarf' || l === 'Gnome' || l === 'Draenei' || l === 'Worgen' ? 'rgba(59, 130, 246, 0.75)' : 'rgba(239, 68, 68, 0.75)'),
                            borderWidth: 1, borderRadius: 6
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: { padding: { left: 55 } },
                        scales: {
                            x: { grid: { color: 'rgba(255,255,255,0.05)' }, min: 45, max: 60, ticks: { callback: v => v + '%' } },
                            y: {
                                grid: { display: false },
                                ticks: { padding: 8 }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                enabled: false,
                                external: (ctx) => externalTooltipHandler(ctx, 'race')
                            },
                            chartIconPlugin: { type: 'race', padding: 45 }
                        }
                    }
                });
            }
        } catch (e) { console.error("Race Stats Error:", e); }
    }

    function renderFactionCombatStats(db) {
        try {
            const res = db.exec(`
                SELECT 
                    faction_id,
                    SUM(damage) as total_dmg,
                    SUM(healing) as total_heal,
                    SUM(hk) as total_hk
                FROM player_stats
                WHERE faction_id IN (1, 2)
                GROUP BY faction_id
            `);
            if (res.length === 0) return;

            const values = res[0].values; // [[1, dmg, heal, hk], [2, dmg, heal, hk]]
            const factionLabels = ['Horde', 'Alliance'];

            const dmgData = [values.find(v => v[0] === 1)[1], values.find(v => v[0] === 2)[1]];
            const healData = [values.find(v => v[0] === 1)[2], values.find(v => v[0] === 2)[2]];

            const ctx = $('factionCombatChart').getContext('2d');
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: factionLabels,
                    datasets: [
                        {
                            label: 'Total Damage', data: dmgData,
                            backgroundColor: 'rgba(239, 68, 68, 0.75)',
                            borderColor: 'rgba(239, 68, 68, 1)',
                            borderWidth: 1, borderRadius: 4,
                            yAxisID: 'y'
                        },
                        {
                            label: 'Total Healing', data: healData,
                            backgroundColor: 'rgba(16, 185, 129, 0.75)',
                            borderColor: 'rgba(16, 185, 129, 1)',
                            borderWidth: 1, borderRadius: 4,
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { bottom: 35 } },
                    scales: {
                        y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Damage' } },
                        y1: { type: 'linear', position: 'right', grid: { display: false }, title: { display: true, text: 'Healing' } },
                        x: { ticks: { padding: 28 } }
                    },
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'faction')
                        },
                        chartIconPlugin: { type: 'faction' }
                    }
                }
            });
        } catch (e) { console.error("Faction Combat Error:", e); }
    }

    function initMiscCharts(db) {
        renderAnalyticsLanding(db);
        renderActivityChart(db);
        renderFactionWinRatePerBG(db);
        renderFactionBalanceOverTime(db);
        renderBgStats(db);
        renderClassStats(db);
        renderKDChart(db);
        renderClassWinRate(db);
        renderRaceStats(db);
        renderFactionCombatStats(db);
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

            // Create gradient fill
            const gradient = ctx.createLinearGradient(0, 0, 0, 350);
            gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
            gradient.addColorStop(0.5, 'rgba(6, 182, 212, 0.1)');
            gradient.addColorStop(1, 'rgba(139, 92, 246, 0.01)');

            new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Matches per Month',
                        data,
                        borderColor: 'rgba(139, 92, 246, 1)',
                        backgroundColor: gradient,
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
                            grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
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
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: {
                            enabled: false,
                            external: externalTooltipHandler
                        }
                    }
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
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'faction')
                        }
                    }
                }
            });
        } catch (e) { console.error("Faction Win Rate Error:", e); }
    }

    function renderFactionBalanceOverTime(db) {
        try {
            const res = db.exec(`
                SELECT SUBSTR(date,1,7) as month,
                       SUM(CASE WHEN winner_id=1 THEN 1 ELSE 0 END) as horde,
                       SUM(CASE WHEN winner_id=2 THEN 1 ELSE 0 END) as alliance,
                       COUNT(*) as total
                FROM matches WHERE winner_id > 0
                GROUP BY month ORDER BY month
            `);
            if (res.length === 0) return;

            const values = res[0].values;
            const labels = values.map(d => d[0]);
            const hordePct = values.map(d => ((d[1] / d[3]) * 100).toFixed(1));

            const ctx = $('factionBalanceChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Horde Win %', data: hordePct,
                            borderColor: '#fff', borderWidth: 2.5, tension: 0.4,
                            pointRadius: 0, pointHitRadius: 10,
                            fill: 'end', backgroundColor: 'rgba(239, 68, 68, 0.15)'
                        },
                        {
                            label: 'Alliance Win % (Area)', data: hordePct,
                            borderColor: 'transparent', fill: 'origin',
                            backgroundColor: 'rgba(59, 130, 246, 0.15)', tension: 0.4,
                            pointRadius: 0
                        },
                        {
                            label: 'Balance Mark', data: labels.map(() => 50),
                            borderColor: 'rgba(255,255,255,0.3)', borderDash: [5, 5],
                            borderWidth: 1, fill: false, pointRadius: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            min: 30, max: 70,
                            ticks: { callback: v => v + '%' }
                        },
                        x: {
                            grid: { color: 'rgba(255,255,255,0.03)' },
                            ticks: {
                                maxTicksLimit: 12,
                                callback: function (val) {
                                    const label = this.getLabelForValue(val);
                                    return label ? label.substring(0, 4) : ''; // Just show years for cleaner axis
                                }
                            }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'faction-balance')
                        }
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
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'faction')
                        }
                    }
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
            const classChart = new Chart(ctxClass, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{ data: counts, backgroundColor: bgColors, borderWidth: 0, hoverOffset: 10 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'class')
                        }
                    },
                    cutout: '65%'
                }
            });
            renderHtmlLegend(classChart, 'classChartLegend', 'class');

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
                    layout: { padding: { bottom: 4 } },
                    scales: {
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
                        x: {
                            grid: { display: false },
                            ticks: { padding: 28 }
                        }
                    },
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'class')
                        },
                        chartIconPlugin: { type: 'class' }
                    }
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
                    layout: { padding: { left: 55 } },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true, ticks: { callback: v => v.toFixed(1) } },
                        y: {
                            grid: { display: false },
                            ticks: { padding: 8 }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'class')
                        },
                        chartIconPlugin: { type: 'class', padding: 45 }
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
                    layout: { padding: { left: 55 } },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, min: 48, max: 58, ticks: { callback: v => v + '%' } },
                        y: {
                            grid: { display: false },
                            ticks: { padding: 8 }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            enabled: false,
                            external: (ctx) => externalTooltipHandler(ctx, 'class')
                        },
                        chartIconPlugin: { type: 'class', padding: 45 }
                    }
                }
            });
        } catch (e) { console.error("Class Win Rate Error:", e); }
    }

    function renderAnalyticsLanding(db) {
        try {
            // 1. Global KPI Stats
            const kpiRes = db.exec(`
                SELECT 
                    (SELECT COUNT(*) FROM matches) as matches,
                    (SELECT COUNT(*) FROM character_map) as players,
                    SUM(damage) as total_damage,
                    SUM(healing) as total_healing,
                    SUM(hk) as total_hk
                FROM player_stats
            `);
            if (kpiRes.length > 0) {
                const [matches, players, damage, healing, hk] = kpiRes[0].values[0];
                $('stat-matches').textContent = matches.toLocaleString();
                $('stat-players').textContent = players.toLocaleString();
                $('stat-damage').textContent = Icons.formatNumber(damage);
                $('stat-healing').textContent = Icons.formatNumber(healing);
                $('stat-hks').textContent = Icons.formatNumber(hk);
            }

            // 2. Global Faction Win Rate
            const wrRes = db.exec(`
                SELECT 
                    SUM(CASE WHEN winner_id = 1 THEN 1 ELSE 0 END) as horde,
                    SUM(CASE WHEN winner_id = 2 THEN 1 ELSE 0 END) as alliance,
                    COUNT(*) as total
                FROM matches WHERE winner_id IN (1,2)
            `);
            if (wrRes.length > 0) {
                const [horde, alliance, total] = wrRes[0].values[0];
                const hPct = (horde / total * 100).toFixed(1);
                const aPct = (alliance / total * 100).toFixed(1);

                $('horde-global-wr').textContent = hPct + '%';
                $('alliance-global-wr').textContent = aPct + '%';
                $('horde-dominance-bar').style.width = hPct + '%';
                $('alliance-dominance-bar').style.width = aPct + '%';
            }

            // 3. Highlight: Top Class
            const classRes = db.exec(`
                SELECT class_id, COUNT(*) as cnt
                FROM player_stats WHERE class_id > 0
                GROUP BY class_id ORDER BY cnt DESC LIMIT 1
            `);
            if (classRes.length > 0) {
                const topClassId = classRes[0].values[0][0];
                $('insight-top-class').textContent = Icons.getClassName(topClassId);
                $('insight-icon-class').innerHTML = Icons.classIcon(topClassId, 36);
            }

            // 4. Highlight: Top Map
            const mapRes = db.exec(`
                SELECT bg_map.name, COUNT(*) as cnt
                FROM matches JOIN bg_map ON matches.bg_id = bg_map.id
                GROUP BY matches.bg_id ORDER BY cnt DESC LIMIT 1
            `);
            if (mapRes.length > 0) {
                const topMap = mapRes[0].values[0][0];
                $('insight-top-map').textContent = topMap;
                $('insight-icon-map').innerHTML = `<img src="https://wow.zamimg.com/images/wow/icons/large/inv_misc_map02.jpg" style="width:36px;height:36px;border-radius:6px;">`;
            }

            // 5. Total HKs
            $('insight-icon-hks').innerHTML = `<img src="https://wow.zamimg.com/images/wow/icons/large/pve_pvp_icon.jpg" alt="HKs">`;

        } catch (e) {
            console.error("Analytics Landing Error:", e);
        }
    }

    // ===================================
    // Utility & Tooltips
    // ===================================

    function renderHtmlLegend(chart, containerId, type) {
        const container = $(containerId);
        if (!container) return;

        const items = chart.options.plugins.legend.labels.generateLabels(chart);
        container.innerHTML = `<ul class="html-legend">
            ${items.map((item, index) => {
            let iconHtml = '';
            if (type === 'class') {
                const classId = Object.keys(Icons.classMap).find(id => Icons.classMap[id] === item.text);
                if (classId) iconHtml = Icons.classIcon(classId, 22);
            } else if (type === 'race') {
                const raceId = Object.keys(Icons.raceIdToName).find(id => Icons.raceIdToName[id] === item.text);
                if (raceId) iconHtml = Icons.raceIcon(raceId + '-0', 22);
            }

            return `                    <li class="legend-item" data-index="${index}" style="opacity: ${item.hidden ? 0.3 : 1}">
                        <div class="legend-color-box" style="background: ${item.fillStyle}; border-color: ${item.strokeStyle}"></div>
                        ${iconHtml}
                        <span class="legend-label">${item.text}</span>
                    </li>`;
        }).join('')}
        </ul>`;

        container.querySelectorAll('.legend-item').forEach(li => {
            li.addEventListener('click', () => {
                const index = parseInt(li.dataset.index);
                chart.toggleDataVisibility(index);
                chart.update();
                renderHtmlLegend(chart, containerId, type); // Refresh legend state
            });
        });
    }

    function externalTooltipHandler(context, type = 'class') {
        const { chart, tooltip } = context;
        const tooltipEl = getOrCreateTooltip(chart);

        if (tooltip.opacity === 0) {
            tooltipEl.style.opacity = 0;
            return;
        }

        if (tooltip.body) {
            const titleLines = tooltip.title || [];
            const bodyLines = tooltip.body.map(b => b.lines);

            let innerHtml = '<div class="tooltip-container">';

            titleLines.forEach(title => {
                let iconHtml = '';
                // Don't show icon in header for balance chart
                if (type !== 'faction-balance') {
                    const firstBody = bodyLines.length > 0 ? String(bodyLines[0][0]) : '';
                    const findKeyword = (title + ' ' + firstBody);

                    if (type === 'class') {
                        const classId = Object.keys(Icons.classMap).find(id => findKeyword.includes(Icons.classMap[id]));
                        if (classId) iconHtml = Icons.classIcon(classId, 24);
                    } else if (type === 'race') {
                        const raceId = Object.keys(Icons.raceIdToName).find(id => findKeyword.includes(Icons.raceIdToName[id]));
                        if (raceId) iconHtml = Icons.raceIcon(raceId + '-0', 24);
                    } else if (type === 'faction') {
                        const facId = findKeyword.toLowerCase().includes('horde') ? 1 : findKeyword.toLowerCase().includes('alliance') ? 2 : 0;
                        if (facId) iconHtml = Icons.factionIcon(facId, 24);
                    }
                }

                innerHtml += `
                    <div class="tooltip-header">
                        ${iconHtml}
                        <span class="tooltip-title">${title}</span>
                    </div>`;
            });

            innerHtml += '<div class="tooltip-body">';
            bodyLines.forEach((body, i) => {
                const lineText = String(body[0]);

                if (type === 'faction-balance') {
                    // Only process the win % line, skip area and balance mark
                    if (lineText.includes('Horde Win %')) {
                        const val = parseFloat(lineText.split(':')[1]);
                        innerHtml += `
                            <div class="tooltip-row">
                                ${Icons.factionIcon(1, 16)} <span class="tooltip-label" style="margin-left:8px">Horde:</span> <span class="tooltip-value">${val.toFixed(1)}%</span>
                            </div>
                            <div class="tooltip-row">
                                ${Icons.factionIcon(2, 16)} <span class="tooltip-label" style="margin-left:8px">Alliance:</span> <span class="tooltip-value">${(100 - val).toFixed(1)}%</span>
                            </div>
                        `;
                    }
                } else {
                    const colors = tooltip.labelColors[i];
                    const span = `<span class="tooltip-marker" style="background:${colors.backgroundColor}; border-color:${colors.borderColor}"></span>`;
                    innerHtml += `<div class="tooltip-row">${span}${body}</div>`;
                }
            });
            innerHtml += '</div></div>';

            tooltipEl.innerHTML = innerHtml;
        }

        const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;

        tooltipEl.style.opacity = 1;
        tooltipEl.style.left = positionX + tooltip.caretX + 'px';
        tooltipEl.style.top = positionY + tooltip.caretY + 'px';
        tooltipEl.style.font = tooltip.options.bodyFont.string;
        tooltipEl.style.padding = tooltip.options.padding + 'px ' + tooltip.options.padding + 'px';
    };

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

});
