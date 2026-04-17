/**
 * WoW WotLK Icon & Mapping Module
 * Centralized mappings for class, race, faction icons and metadata.
 * Icons are authentic WotLK game assets scraped from wow-mania.org.
 */

const WoWIcons = (() => {

    // ===========================
    // Class Mappings
    // ===========================
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
        'Unknown': '#808080',
        'Warrior': '#C79C6E',
        'Paladin': '#F58CBA',
        'Hunter': '#ABD473',
        'Rogue': '#FFF569',
        'Priest': '#FFFFFF',
        'Death Knight': '#C41F3B',
        'Shaman': '#0070DE',
        'Mage': '#69CCF0',
        'Warlock': '#9482C9',
        'Druid': '#FF7D0A'
    };

    // Class IDs that have icons in img/{id}.jpg
    const classIconIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];

    // ===========================
    // Race Mappings
    // WotLK race IDs:
    //   1=Human, 2=Orc, 3=Dwarf, 4=NightElf, 5=Undead,
    //   6=Tauren, 7=Gnome, 8=Troll, 10=BloodElf, 11=Draenei
    // Icon files: img/{raceId}-{genderId}.jpg  (0=male, 1=female)
    // ===========================
    const raceIdToName = {
        0: 'Unknown',
        1: 'Human',
        2: 'Orc',
        3: 'Dwarf',
        4: 'Night Elf',
        5: 'Undead',
        6: 'Tauren',
        7: 'Gnome',
        8: 'Troll',
        9: 'Goblin',
        10: 'Blood Elf',
        11: 'Draenei',
        12: 'Worgen'
    };

    // Gender suffix: 0=Male, 1=Female
    const genderMap = { 0: 'Male', 1: 'Female' };

    // Race codes stored in DB (race_map.name) → human readable
    function raceCodeToName(code) {
        if (!code || code === '0-0' || code === 'Unknown') return 'Unknown';
        const parts = code.split('-');
        if (parts.length !== 2) return code;
        const raceId = parseInt(parts[0]);
        const genderId = parseInt(parts[1]);
        const raceName = raceIdToName[raceId] || 'Unknown';
        const gender = genderMap[genderId] || '';
        return `${raceName} ${gender}`.trim();
    }

    // Race code to faction
    const hordRaces = new Set([2, 5, 6, 8, 9, 10]); // Orc, Undead, Tauren, Troll, Goblin, Blood Elf
    const allianceRaces = new Set([1, 3, 4, 7, 11, 12]); // Human, Dwarf, NightElf, Gnome, Draenei, Worgen

    function raceFaction(raceCode) {
        if (!raceCode || raceCode === 'Unknown') return 0;
        const raceId = parseInt(raceCode.split('-')[0]);
        if (hordRaces.has(raceId)) return 1;
        if (allianceRaces.has(raceId)) return 2;
        return 0;
    }

    // Icons that exist on disk
    const existingRaceIcons = new Set([
        '1-0', '1-1', '2-0', '2-1', '3-0', '3-1',
        '4-0', '4-1', '5-0', '5-1', '6-0', '6-1',
        '7-0', '7-1', '8-0', '8-1', '9-0',
        '10-0', '10-1', '11-0', '11-1', '12-0'
    ]);

    // ===========================
    // Faction Mappings
    // ===========================
    const factionMap = {
        0: 'Unknown',
        1: 'Horde',
        2: 'Alliance'
    };

    const factionColors = {
        1: '#ef4444',
        2: '#3b82f6'
    };

    // ===========================
    // BG short names for compact display
    // ===========================
    const bgShortNames = {
        'Warsong Gulch': 'WSG',
        'Arathi Basin': 'AB',
        'Alterac Valley': 'AV',
        'Eye of the Storm': 'EotS',
        'Strand of the Ancients': 'SotA',
        'Isle of Conquest': 'IoC'
    };

    // ===========================
    // BG Attributes (Attr1 / Attr2 from game scoreboard)
    // ===========================
    const bgAttributes = {
        'Warsong Gulch': ['Flag Captures', 'Flag Returns'],
        'Arathi Basin': ['Bases Assaulted', 'Bases Defended'],
        'Alterac Valley': ['Graveyards Assaulted', 'Graveyards Defended'],
        'Eye of the Storm': ['Flag Captures', '—'],
        'Strand of the Ancients': ['Demolishers Destroyed', 'Gates Destroyed'],
        'Isle of Conquest': ['Bases Assaulted', 'Bases Defended'],
        'Battle for Gilneas': ['Bases Assaulted', 'Bases Defended'],
        'Twin Peaks': ['Flag Captures', 'Flag Returns']
    };

    /**
     * Get attribute labels for a specific BG.
     * Fallback to generic names if not mapped.
     */
    function getBgAttributes(fullName) {
        return bgAttributes[fullName] || ['Objective 1', 'Objective 2'];
    }

    /**
     * Get abbreviated term for column headers
     */
    function abbrevObjective(val) {
        if (!val) return '';
        if (val.includes('Captures')) return 'Caps';
        if (val.includes('Returns')) return 'Rets';
        if (val.includes('Assaulted')) return 'Aslt';
        if (val.includes('Defended')) return 'Def';
        if (val.includes('Destroyed') && val.includes('Demolishers')) return 'Demos';
        if (val.includes('Destroyed') && val.includes('Gates')) return 'Gates';
        // If neither, return the last word (e.g. "Points" from "Victory Points")
        const words = val.split(' ');
        return words.length > 1 ? words[1] : words[0];
    }

    /**
     * Get a formatted short string for a player's objectives in a match
     * e.g. "2 Caps, 1 Ret"
     */
    function formatObjectives(fullName, attr1, attr2) {
        if (!attr1 && !attr2) return '—';
        const attrs = getBgAttributes(fullName);
        const parts = [];
        
        if (attr1 > 0) parts.push(`${attr1} ${abbrevObjective(attrs[0])}`);
        if (attr2 > 0) parts.push(`${attr2} ${abbrevObjective(attrs[1])}`);
        
        return parts.length > 0 ? parts.join(', ') : '—';
    }

    // ===========================
    // Public API
    // ===========================

    function getClassName(classId) {
        return classMap[classId] || 'Unknown';
    }

    function getClassColor(classId) {
        const name = getClassName(classId);
        return classColors[name] || '#808080';
    }

    function getClassIconPath(classId) {
        if (classIconIds.includes(parseInt(classId))) {
            return `img/${classId}.jpg`;
        }
        return null;
    }

    /** Returns an <img> HTML string for a class icon */
    function classIcon(classId, size = 24) {
        const path = getClassIconPath(classId);
        const name = getClassName(classId);
        if (!path) return `<span class="icon-placeholder" style="width:${size}px;height:${size}px;" title="${name}">?</span>`;
        return `<img src="${path}" alt="${name}" title="${name}" class="wow-icon class-icon" style="width:${size}px;height:${size}px;" loading="lazy">`;
    }

    function getRaceIconPath(raceCode) {
        if (!raceCode || raceCode === 'Unknown' || raceCode === '0-0') return null;
        if (existingRaceIcons.has(raceCode)) {
            return `img/${raceCode}.jpg`;
        }
        return null;
    }

    /** Returns an <img> HTML string for a race icon */
    function raceIcon(raceCode, size = 24) {
        const path = getRaceIconPath(raceCode);
        const name = raceCodeToName(raceCode);
        if (!path) return `<span class="icon-placeholder" style="width:${size}px;height:${size}px;" title="${name}">?</span>`;
        return `<img src="${path}" alt="${name}" title="${name}" class="wow-icon race-icon" style="width:${size}px;height:${size}px;" loading="lazy">`;
    }

    /** Returns an <img> HTML string for a faction icon */
    function factionIcon(factionId, size = 24) {
        if (factionId === 1) return `<img src="img/horde_min.png" alt="Horde" title="Horde" class="wow-icon faction-icon" style="width:${size}px;height:${size}px;" loading="lazy">`;
        if (factionId === 2) return `<img src="img/alliance_min.png" alt="Alliance" title="Alliance" class="wow-icon faction-icon" style="width:${size}px;height:${size}px;" loading="lazy">`;
        return `<span class="icon-placeholder" style="width:${size}px;height:${size}px;">?</span>`;
    }

    function getFactionColor(factionId) {
        return factionColors[factionId] || '#808080';
    }

    function getFactionName(factionId) {
        return factionMap[factionId] || 'Unknown';
    }

    function getBgShortName(fullName) {
        return bgShortNames[fullName] || fullName;
    }

    /** Format numbers with full precision and commas */
    function formatNumber(n) {
        if (n === null || n === undefined) return '0';
        return Number(n).toLocaleString();
    }

    /** Format seconds to mm:ss or hh:mm:ss */
    function formatDuration(totalSec) {
        if (!totalSec || totalSec <= 0) return '—';
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    return {
        classMap, classColors, classIconIds,
        raceIdToName, raceCodeToName, raceFaction,
        factionMap, factionColors, bgShortNames,
        getClassName, getClassColor, getClassIconPath,
        classIcon, getRaceIconPath, raceIcon,
        factionIcon, getFactionColor, getFactionName,
        getBgShortName, formatNumber, formatDuration,
        getBgAttributes, formatObjectives, abbrevObjective
    };

})();
