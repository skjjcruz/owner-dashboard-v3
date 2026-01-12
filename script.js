/*************************************************
 * Owner Dashboard – Sleeper Compare + Stats + Picks + Weekly Projections
 * (STABLE TABLE VERSION)
 *
 * Works with your current index.html + style.css:
 * - 3-column layout on iPad/desktop (Teams | Left | Right)
 * - Phone layout handled by CSS (tables stay tables)
 * - Compare is still L/R buttons per team
 * - Recent Activity shows who (owner) + adds/drops
 * - Weekly projections pulled per player and rendered in PROJ column
 *************************************************/

const SPORT = "nfl";

// Defaults
const DEFAULT_LEAGUE_SEASON = "2026";
const DEFAULT_STATS_SEASON = "2025";
const DEFAULT_USERNAME = "";

// Dropdown year range
const LEAGUE_SEASON_YEARS = ["2023", "2024", "2025", "2026"];
const STATS_SEASON_YEARS = ["2023", "2024", "2025"];

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB", "OTHER"];
const PICK_YEARS = [2026, 2027, 2028];

// ===== DOM =====
const elStatus = document.getElementById("status");
const elTeams = document.getElementById("teams");
const elLeftTitle = document.getElementById("leftTitle");
const elRightTitle = document.getElementById("rightTitle");
const leftTBody = document.querySelector("#leftTable tbody");
const rightTBody = document.querySelector("#rightTable tbody");

const elUsername = document.getElementById("usernameInput");
const elSeason = document.getElementById("seasonInput");
const elStatsSeason = document.getElementById("statsSeasonInput");
const elLeagueSelect = document.getElementById("leagueSelect");
const elReloadBtn = document.getElementById("reloadBtn");

// Activity DOM hook
const elActivityList = document.getElementById("activityList");

// ===== LocalStorage keys =====
const LS_LOCKED_USERNAME = "od_locked_username";

// ===== State =====
let state = {
  username: "",
  season: DEFAULT_LEAGUE_SEASON,
  statsSeason: DEFAULT_STATS_SEASON,

  // Sleeper core
  user: null,
  leagues: [],
  leagueId: null,
  league: null,
  users: [],
  rosters: [],
  usersById: {},
  rosterByOwner: {},
  rosterByRosterId: {},

  // Players & stats
  playersById: null,
  statsByPlayerId: null,
  scoring: {},

  // Weekly projections
  nflState: null,
  week: null,
  projStatsByPlayerId: {},
  _projInFlight: {},
  _projRerenderTimer: null,

  // UI state
  currentLeftOwnerId: null,
  currentRightOwnerId: null,

  // Draft picks
  tradedPicks: [],
  picksByOwnerId: {},
  draftRounds: 7,
};

function setStatus(msg) {
  if (elStatus) elStatus.textContent = msg || "";
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function safeName(u) {
  return u?.display_name || u?.username || "Unknown";
}

/* =========================
   Dropdown helpers
========================= */
function fillSelect(el, years, defaultVal) {
  if (!el) return;
  el.innerHTML = "";
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    el.appendChild(opt);
  }
  el.value = defaultVal;
}

/* =========================
   Username lock
========================= */
function initUsernameLockUI() {
  const locked = localStorage.getItem(LS_LOCKED_USERNAME);

  if (locked) {
    state.username = locked;
    if (elUsername) {
      elUsername.value = locked;
      elUsername.disabled = true;
    }
  } else {
    if (elUsername) {
      elUsername.value = DEFAULT_USERNAME;
      elUsername.disabled = false;
    }
  }

  fillSelect(elSeason, LEAGUE_SEASON_YEARS, DEFAULT_LEAGUE_SEASON);
  fillSelect(elStatsSeason, STATS_SEASON_YEARS, DEFAULT_STATS_SEASON);

  state.season = elSeason?.value || DEFAULT_LEAGUE_SEASON;
  state.statsSeason = elStatsSeason?.value || DEFAULT_STATS_SEASON;
}

function lockUsername(username) {
  localStorage.setItem(LS_LOCKED_USERNAME, username);
  if (elUsername) {
    elUsername.value = username;
    elUsername.disabled = true;
  }
}

/* =========================
   NFL State (week)
========================= */
async function loadNFLState() {
  try {
    const s = await fetchJSON(`https://api.sleeper.app/v1/state/${SPORT}`);
    state.nflState = s;
    state.week = Number(s?.week) || 1;
  } catch (e) {
    state.nflState = null;
    state.week = 1;
  }
}

/* =========================
   Avatar helpers
========================= */
function avatarIdForOwner(ownerId) {
  const r = state.rosterByOwner?.[String(ownerId)];
  const u = state.usersById?.[String(ownerId)];
  const meta = r?.metadata || {};
  return meta.team_avatar || meta.avatar || r?.avatar || u?.avatar || null;
}

function avatarUrlFromId(avatarId) {
  if (!avatarId) return null;
  return `https://sleepercdn.com/avatars/${avatarId}`;
}

function makeAvatarImg(ownerId, size = 22) {
  const id = avatarIdForOwner(ownerId);
  const url = avatarUrlFromId(id);
  if (!url) return null;

  const img = document.createElement("img");
  img.className = "teamAvatar";
  img.src = url;
  img.alt = "";
  img.width = size;
  img.height = size;
  img.onerror = () => (img.style.display = "none");
  return img;
}

/* =========================
   Roster title helpers
========================= */
function rosterRecord(roster) {
  const w = roster?.settings?.wins ?? 0;
  const l = roster?.settings?.losses ?? 0;
  const t = roster?.settings?.ties ?? 0;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function ownerDisplayWithRecord(ownerId) {
  const u = state.usersById?.[String(ownerId)];
  const r = state.rosterByOwner?.[String(ownerId)];
  return `${safeName(u)} (${rosterRecord(r)})`;
}

function setRosterTitle(el, ownerId) {
  if (!el) return;
  el.innerHTML = "";

  const span = document.createElement("span");
  span.textContent = ownerDisplayWithRecord(ownerId);
  el.appendChild(span);

  const img = makeAvatarImg(ownerId, 28);
  if (img) {
    img.style.marginLeft = "10px";
    img.style.verticalAlign = "middle";
    el.appendChild(img);
  }
}

/* =========================
   Positions / stats helpers
========================= */
function normalizePos(pos) {
  if (!pos) return "OTHER";
  if (pos === "FB") return "RB";
  if (["DE", "DT", "NT", "OLB"].includes(pos)) return "DL";
  if (["CB", "FS", "SS"].includes(pos)) return "DB";
  if (POS_ORDER.includes(pos)) return pos;
  return "OTHER";
}

function yearsInLeague(playerObj) {
  const y = playerObj?.years_exp;
  if (y === 0) return "R";
  if (typeof y === "number") return String(y + 1);
  return "";
}

function playerStatusClass(roster, playerObj) {
  const pid = String(playerObj?.player_id || "");
  if (!pid || !roster) return "";

  if (Array.isArray(roster.reserve) && roster.reserve.map(String).includes(pid)) return "psIR";
  if (Array.isArray(roster.taxi) && roster.taxi.map(String).includes(pid)) return "psTaxi";
  if (Array.isArray(roster.starters) && roster.starters.map(String).includes(pid)) return "psStarter";
  if (playerObj?.years_exp === 0) return "psRookie";

  return "";
}

function clearTable(tbody) {
  if (tbody) tbody.innerHTML = "";
}

function trRow(cells, className = "") {
  const tr = document.createElement("tr");
  if (className) tr.className = className;

  cells.forEach((c) => {
    const td = document.createElement("td");
    if (c.className) td.className = c.className;
    if (c.noWrap) td.style.whiteSpace = "nowrap";
    if (c.el) td.appendChild(c.el);
    else td.textContent = c.text ?? "";
    tr.appendChild(td);
  });

  return tr;
}

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function format1(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(1);
}

function gamesPlayed(playerStats) {
  if (!playerStats) return 0;
  return toNumber(playerStats.gp || playerStats.g || 0);
}

function ordinal(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fantasyPointsFromScoring(statsObj, scoring) {
  if (!statsObj || !scoring) return 0;
  let pts = 0;
  for (const [key, mult] of Object.entries(scoring)) {
    if (typeof mult !== "number") continue;
    if (statsObj[key] !== undefined) pts += toNumber(statsObj[key]) * mult;
  }
  return pts;
}

/* =========================
   FantasyPros Player Link
========================= */
function fantasyProsUrl(playerObj) {
  if (!playerObj?.full_name) return null;

  const slug = playerObj.full_name
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `https://www.fantasypros.com/nfl/players/${slug}.php`;
}

/* =========================
   Group players by position and sort (TOTAL SEASON POINTS high->low)
========================= */
function groupPlayers(playerIds) {
  const groups = {};
  for (const pid of playerIds || []) {
    const p = state.playersById?.[pid];
    if (!p) continue;
    const pos = normalizePos(p.position);
    groups[pos] ||= [];
    groups[pos].push(p);
  }

  for (const pos of Object.keys(groups)) {
    groups[pos].sort((a, b) => {
      const aStats = state.statsByPlayerId?.[a.player_id] || null;
      const bStats = state.statsByPlayerId?.[b.player_id] || null;

      const aPts = fantasyPointsFromScoring(aStats, state.scoring);
      const bPts = fantasyPointsFromScoring(bStats, state.scoring);
      if (bPts !== aPts) return bPts - aPts;

      const aGp = gamesPlayed(aStats);
      const bGp = gamesPlayed(bStats);
      if (bGp !== aGp) return bGp - aGp;

      return (a.full_name || "").localeCompare(b.full_name || "");
    });
  }

  return groups;
}

/* ===== Group header rows ===== */
function addGroupHeader(tbody, label, count) {
  const tr = document.createElement("tr");
  tr.className = "groupRow";

  const td = document.createElement("td");
  td.colSpan = 7;

  const wrap = document.createElement("div");
  wrap.className = "groupText";
  wrap.innerHTML = `<span>${label}</span><span>(${count})</span>`;

  td.appendChild(wrap);
  tr.appendChild(td);
  tbody.appendChild(tr);
}

/* =========================
   Weekly Projections
========================= */
function projectionEndpoint(playerId) {
  const season = encodeURIComponent(String(state.season));
  const week = encodeURIComponent(String(state.week || 1));
  return `https://api.sleeper.app/projections/${SPORT}/player/${playerId}?season=${season}&season_type=regular&week=${week}`;
}

function scheduleProjectionRerender() {
  if (state._projRerenderTimer) return;
  state._projRerenderTimer = setTimeout(() => {
    state._projRerenderTimer = null;
    renderCompareTables();
  }, 250);
}

async function ensureProjectionForPlayer(playerId) {
  const pid = String(playerId || "");
  if (!pid) return;

  if (state.projStatsByPlayerId[pid]) return;
  if (state._projInFlight[pid]) return;

  state._projInFlight[pid] = (async () => {
    try {
      const obj = await fetchJSON(projectionEndpoint(pid));
      const stats = obj?.stats && typeof obj.stats === "object" ? obj.stats : obj;
      if (stats && typeof stats === "object") {
        state.projStatsByPlayerId[pid] = stats;
        scheduleProjectionRerender();
      }
    } catch (e) {
      // ignore per-player failures
    } finally {
      delete state._projInFlight[pid];
    }
  })();
}

function getProjectionPoints(playerObj) {
  const pid = String(playerObj?.player_id || "");
  if (!pid) return "";

  const projStats = state.projStatsByPlayerId[pid];
  if (!projStats) {
    ensureProjectionForPlayer(pid);
    return "…";
  }

  const pts = fantasyPointsFromScoring(projStats, state.scoring);
  return format1(pts || 0);
}

function primeProjectionsForRoster(roster) {
  if (!roster?.players?.length) return;
  for (const pid of roster.players) ensureProjectionForPlayer(pid);
}

/* =========================
   Picks helpers
========================= */
function detectPickIdMode() {
  const rosterIds = new Set(state.rosters.map((r) => String(r.roster_id)));
  const userIds = new Set(state.users.map((u) => String(u.user_id)));

  let rosterHits = 0, userHits = 0;
  for (const tp of state.tradedPicks || []) {
    const oid = String(tp.owner_id ?? "");
    if (rosterIds.has(oid)) rosterHits++;
    if (userIds.has(oid)) userHits++;
  }
  return rosterHits >= userHits ? "roster" : "user";
}

function ownerUserIdFromPickOwner(ownerField, mode) {
  const v = String(ownerField ?? "");
  if (!v) return null;

  if (mode === "user") return v;

  const roster = state.rosterByRosterId[v];
  return roster?.owner_id ? String(roster.owner_id) : null;
}

function fromOwnerIdFromOriginRoster(originRosterId) {
  const r = state.rosterByRosterId[String(originRosterId)];
  return r?.owner_id ? String(r.owner_id) : null;
}

function buildPicksByOwner() {
  const mode = detectPickIdMode();
  const ownerByKey = {};

  for (const r of state.rosters) {
    const originRosterId = String(r.roster_id);
    const baselineOwnerUserId = String(r.owner_id);

    for (const y of PICK_YEARS) {
      for (let rd = 1; rd <= state.draftRounds; rd++) {
        ownerByKey[`${y}-${rd}-${originRosterId}`] = baselineOwnerUserId;
      }
    }
  }

  for (const tp of state.tradedPicks || []) {
    const y = Number(tp.season);
    if (!PICK_YEARS.includes(y)) continue;

    const rd = Number(tp.round);
    if (!Number.isFinite(rd) || rd < 1 || rd > state.draftRounds) continue;

    const originRosterId = String(tp.roster_id);
    const newOwnerUserId = ownerUserIdFromPickOwner(tp.owner_id, mode);
    if (!newOwnerUserId) continue;

    const key = `${y}-${rd}-${originRosterId}`;
    if (ownerByKey[key] !== undefined) ownerByKey[key] = String(newOwnerUserId);
  }

  const picksByOwnerId = {};
  for (const [key, ownerUserId] of Object.entries(ownerByKey)) {
    const [yStr, rdStr, originRosterId] = key.split("-");
    const fromOwnerId = fromOwnerIdFromOriginRoster(originRosterId);

    picksByOwnerId[ownerUserId] ||= [];
    picksByOwnerId[ownerUserId].push({
      year: Number(yStr),
      round: Number(rdStr),
      fromOwnerId,
    });
  }

  for (const oid of Object.keys(picksByOwnerId)) {
    picksByOwnerId[oid].sort((a, b) => a.year - b.year || a.round - b.round);
  }

  state.picksByOwnerId = picksByOwnerId;
}

function addDraftPicksSection(tbody, ownerId) {
  const picks = state.picksByOwnerId?.[String(ownerId)] || [];

  const byYear = {};
  for (const y of PICK_YEARS) byYear[y] = [];
  for (const p of picks) {
    const y = Number(p.year);
    byYear[y] ||= [];
    byYear[y].push(p);
  }
  for (const y of Object.keys(byYear)) {
    byYear[y].sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0));
  }

  for (const y of PICK_YEARS) {
    const arr = byYear[y] || [];

    if (!arr.length) {
      tbody.appendChild(
        trRow([
          { className: "pos posCell", text: String(y) },
          { className: "player", text: "— none —" },
          { className: "yrs", text: "" },
          { className: "pts", text: "" },
          { className: "gp", text: "" },
          { className: "avg", text: "" },
          { className: "nfl", text: "" },
        ])
      );
      continue;
    }

    for (const p of arr) {
      const fromName = p.fromOwnerId ? safeName(state.usersById[p.fromOwnerId]) : "";
      tbody.appendChild(
        trRow([
          { className: "pos posCell", text: String(y) },
          { className: "player", text: ordinal(p.round) },
          { className: "yrs", text: "" },
          { className: "pts", text: "" },
          { className: "gp", text: "" },
          { className: "avg", text: "" },
          { className: "nfl", text: fromName || "", noWrap: true },
        ])
      );
    }

    tbody.appendChild(
      trRow(
        [{ text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }],
        "sepRow"
      )
    );
  }
}

/* =========================
   Teams list
========================= */
function renderTeamsList() {
  if (!elTeams) return;
  elTeams.innerHTML = "";

  const sortedRosters = [...state.rosters].sort((a, b) => {
    const aw = a.settings?.wins ?? 0;
    const al = a.settings?.losses ?? 0;
    const bw = b.settings?.wins ?? 0;
    const bl = b.settings?.losses ?? 0;

    if (bw !== aw) return bw - aw;
    if (al !== bl) return al - bl;
    return 0;
  });

  sortedRosters.forEach((r) => {
    const li = document.createElement("li");

    const nameDiv = document.createElement("div");
    nameDiv.className = "teamName";

    const span = document.createElement("span");
    span.textContent = ownerDisplayWithRecord(r.owner_id);
    nameDiv.appendChild(span);

    const avatarImg = makeAvatarImg(r.owner_id, 20);
    if (avatarImg) {
      avatarImg.style.marginLeft = "8px";
      avatarImg.style.verticalAlign = "middle";
      nameDiv.appendChild(avatarImg);
    }

    const btnWrap = document.createElement("div");
    btnWrap.className = "teamButtons";

    const bL = document.createElement("button");
    bL.className = "btn";
    bL.textContent = "L";
    bL.addEventListener("click", () => {
      state.currentLeftOwnerId = r.owner_id;
      setRosterTitle(elLeftTitle, r.owner_id);
      primeProjectionsForRoster(state.rosterByOwner[r.owner_id]);
      renderCompareTables();
      setStatus(`Ready ✅ (Left loaded) — Week ${state.week || 1}`);
    });

    const bR = document.createElement("button");
    bR.className = "btn";
    bR.textContent = "R";
    bR.addEventListener("click", () => {
      state.currentRightOwnerId = r.owner_id;
      setRosterTitle(elRightTitle, r.owner_id);
      primeProjectionsForRoster(state.rosterByOwner[r.owner_id]);
      renderCompareTables();
      setStatus(`Ready ✅ (Right loaded) — Week ${state.week || 1}`);
    });

    btnWrap.appendChild(bL);
    btnWrap.appendChild(bR);

    li.appendChild(nameDiv);
    li.appendChild(btnWrap);
    elTeams.appendChild(li);
  });
}

/* =========================
   Recent Activity (Transactions)
========================= */
async function loadLeagueActivity() {
  if (!state.leagueId || !elActivityList) return;

  elActivityList.innerHTML = "<li class='activityItem muted'>Loading…</li>";

  try {
    if (!state.playersById) {
      state.playersById = await fetchJSON(`https://api.sleeper.app/v1/players/${SPORT}`);
    }

    const startWeek = Number(state.week || 1);
    const weeksToCheck = [];
    for (let w = startWeek; w >= Math.max(1, startWeek - 8); w--) weeksToCheck.push(w);

    const all = [];
    for (const w of weeksToCheck) {
      const arr = await fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/transactions/${w}`);
      if (Array.isArray(arr)) all.push(...arr);
    }

    all.sort((a, b) => (b?.created || 0) - (a?.created || 0));
    elActivityList.innerHTML = "";

    if (!all.length) {
      elActivityList.innerHTML = "<li class='activityItem muted'>No recent activity</li>";
      return;
    }

    const playerName = (pid) => {
      const p = state.playersById?.[String(pid)];
      if (!p) return `Unknown (${pid})`;
      return p.full_name || p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || `Unknown (${pid})`;
    };

    const ownerFromRosterId = (rosterId) => {
      const r = state.rosterByRosterId?.[String(rosterId)];
      if (!r) return "";
      return ownerDisplayWithRecord(r.owner_id);
    };

    const txTypeLabel = (t) => String(t || "transaction").replace(/_/g, " ");

    all.slice(0, 14).forEach((tx) => {
      const li = document.createElement("li");
      li.className = "activityItem";

      const type = txTypeLabel(tx?.type);
      const creatorId = String(tx?.creator || "");
      const creatorName = creatorId && state.usersById[creatorId] ? ownerDisplayWithRecord(creatorId) : "Unknown Owner";
      const time = tx?.created ? new Date(tx.created).toLocaleString() : "";

      const addsObj = tx?.adds && typeof tx.adds === "object" ? tx.adds : null;
      const dropsObj = tx?.drops && typeof tx.drops === "object" ? tx.drops : null;

      const addPids = addsObj ? Object.keys(addsObj) : [];
      const dropPids = dropsObj ? Object.keys(dropsObj) : [];

      const addedNames = addPids.slice(0, 3).map(playerName);
      const droppedNames = dropPids.slice(0, 3).map(playerName);

      // Try to identify “who got the player” by looking at the roster_id mapped for the first add
      let destOwner = "";
      if (addPids.length) {
        const rosterId = addsObj[addPids[0]];
        destOwner = ownerFromRosterId(rosterId);
      }

      const addedText = addedNames.length ? `Added ${addedNames.join(", ")}${addPids.length > 3 ? "…" : ""}` : "";
      const droppedText = droppedNames.length ? `Dropped ${droppedNames.join(", ")}${dropPids.length > 3 ? "…" : ""}` : "";

      const details =
        addedText && droppedText ? `➕ ${addedText} • ❌ ${droppedText}`
        : addedText ? `➕ ${addedText}`
        : droppedText ? `❌ ${droppedText}`
        : "(details unavailable)";

      const whoLine = destOwner && destOwner !== "Unknown Owner" ? destOwner : creatorName;

      li.innerHTML = `
        <div class="activityType">${type}</div>
        <div class="activityMeta">
          <strong>${whoLine}</strong> ${details}
        </div>
        <div class="activityMeta">${time}</div>
      `;

      elActivityList.appendChild(li);
    });
  } catch (err) {
    console.error(err);
    elActivityList.innerHTML = "<li class='activityItem muted'>Failed to load activity</li>";
  }
}

/* =========================
   Render compare tables
========================= */
function renderCompareTables() {
  if (!leftTBody || !rightTBody) return;

  clearTable(leftTBody);
  clearTable(rightTBody);

  const leftRoster = state.currentLeftOwnerId ? state.rosterByOwner[state.currentLeftOwnerId] : null;
  const rightRoster = state.currentRightOwnerId ? state.rosterByOwner[state.currentRightOwnerId] : null;

  if (!leftRoster || !rightRoster) {
    if (!leftRoster) {
      leftTBody.appendChild(
        trRow([
          { className: "pos", text: "" },
          { className: "player", text: "Select a Left team…" },
          { className: "yrs", text: "" },
          { className: "pts", text: "" },
          { className: "gp", text: "" },
          { className: "avg", text: "" },
          { className: "nfl", text: "" },
        ])
      );
    }
    if (!rightRoster) {
      rightTBody.appendChild(
        trRow([
          { className: "pos", text: "" },
          { className: "player", text: "Select a Right team…" },
          { className: "yrs", text: "" },
          { className: "pts", text: "" },
          { className: "gp", text: "" },
          { className: "avg", text: "" },
          { className: "nfl", text: "" },
        ])
      );
    }
    return;
  }

  const leftGroups = groupPlayers(leftRoster.players);
  const rightGroups = groupPlayers(rightRoster.players);
  const positions = POS_ORDER.filter((p) => (leftGroups[p]?.length || 0) + (rightGroups[p]?.length || 0) > 0);

  for (const pos of positions) {
    const L = leftGroups[pos] || [];
    const R = rightGroups[pos] || [];
    const max = Math.max(L.length, R.length);

    addGroupHeader(leftTBody, pos, L.length);
    addGroupHeader(rightTBody, pos, R.length);

    for (let i = 0; i < max; i++) {
      // LEFT
      if (L[i]) {
        const p = L[i];
        const stats = state.statsByPlayerId?.[p.player_id] || null;
        const gp = gamesPlayed(stats);
        const pts = fantasyPointsFromScoring(stats, state.scoring);
        const avg = gp ? pts / gp : 0;
        const proj = getProjectionPoints(p);

        const url = fantasyProsUrl(p);
        const a = document.createElement("a");
        a.textContent = p.full_name || "";
        if (url) {
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.style.color = "inherit";
        a.style.textDecoration = "none";

        leftTBody.appendChild(
          trRow([
            { className: "pos posCell", text: p.position || "" },
            { className: `player ${playerStatusClass(leftRoster, p)}`, el: a },
            { className: "yrs", text: yearsInLeague(p) },
            { className: "pts", text: pts ? format1(pts) : "" },
            { className: "gp", text: gp ? String(gp) : "" },
            { className: "avg", text: gp ? format1(avg) : "" },
            { className: "nfl", text: proj },
          ])
        );
      } else {
        leftTBody.appendChild(
          trRow(
            [{ text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }],
            "emptyRow"
          )
        );
      }

      // RIGHT
      if (R[i]) {
        const p = R[i];
        const stats = state.statsByPlayerId?.[p.player_id] || null;
        const gp = gamesPlayed(stats);
        const pts = fantasyPointsFromScoring(stats, state.scoring);
        const avg = gp ? pts / gp : 0;
        const proj = getProjectionPoints(p);

        const url = fantasyProsUrl(p);
        const a = document.createElement("a");
        a.textContent = p.full_name || "";
        if (url) {
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.style.color = "inherit";
        a.style.textDecoration = "none";

        rightTBody.appendChild(
          trRow([
            { className: "pos posCell", text: p.position || "" },
            { className: `player ${playerStatusClass(rightRoster, p)}`, el: a },
            { className: "yrs", text: yearsInLeague(p) },
            { className: "pts", text: pts ? format1(pts) : "" },
            { className: "gp", text: gp ? String(gp) : "" },
            { className: "avg", text: gp ? format1(avg) : "" },
            { className: "nfl", text: proj },
          ])
        );
      } else {
        rightTBody.appendChild(
          trRow(
            [{ text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }],
            "emptyRow"
          )
        );
      }
    }

    leftTBody.appendChild(
      trRow([{ text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }], "sepRow")
    );
    rightTBody.appendChild(
      trRow([{ text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" }], "sepRow")
    );
  }

  // Draft picks section
  addDraftPicksSection(leftTBody, state.currentLeftOwnerId);
  addDraftPicksSection(rightTBody, state.currentRightOwnerId);
}

/* =========================
   Load leagues dropdown
========================= */
async function loadLeagues() {
  const locked = localStorage.getItem(LS_LOCKED_USERNAME);

  state.username = locked ? locked : (elUsername?.value || "").trim();
  state.season = (elSeason?.value || "").trim() || DEFAULT_LEAGUE_SEASON;
  state.statsSeason = (elStatsSeason?.value || "").trim() || DEFAULT_STATS_SEASON;

  if (!state.username) {
    setStatus("Enter a Sleeper username.");
    return;
  }

  setStatus("Loading current NFL week…");
  await loadNFLState();

  setStatus("Loading Sleeper user…");
  state.user = await fetchJSON(`https://api.sleeper.app/v1/user/${encodeURIComponent(state.username)}`);

  if (!locked) lockUsername(state.username);

  setStatus("Loading leagues…");
  state.leagues = await fetchJSON(
    `https://api.sleeper.app/v1/user/${state.user.user_id}/leagues/${SPORT}/${state.season}`
  );

  if (!elLeagueSelect) return;

  elLeagueSelect.innerHTML = "";
  if (!state.leagues.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(No leagues found)";
    elLeagueSelect.appendChild(opt);
    setStatus("No leagues found for that season.");
    return;
  }

  // Auto-select: "psycho" if present else first
  let auto = state.leagues[0].league_id;
  const psycho = state.leagues.find((l) => (l.name || "").toLowerCase().includes("psycho"));
  if (psycho) auto = psycho.league_id;

  state.leagues.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.league_id;
    opt.textContent = l.name || l.league_id;
    elLeagueSelect.appendChild(opt);
  });

  elLeagueSelect.value = auto;
  state.leagueId = auto;

  setStatus(`League list loaded ✅ — Week ${state.week || 1}`);
}

/* =========================
   Load league + users + rosters + stats
========================= */
async function loadLeagueData() {
  if (!elLeagueSelect) return;

  state.leagueId = elLeagueSelect.value;
  if (!state.leagueId) return;

  setStatus("Loading league…");
  state.league = await fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}`);
  state.scoring = state.league?.scoring_settings || {};

  const rounds = state.league?.settings?.draft_rounds ?? state.league?.draft_settings?.rounds ?? 7;
  state.draftRounds = Number(rounds) || 7;

  // reset projections cache when league changes
  state.projStatsByPlayerId = {};
  state._projInFlight = {};

  setStatus("Loading users + rosters…");
  const [users, rosters] = await Promise.all([
    fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/users`),
    fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/rosters`),
  ]);

  state.users = users;
  state.rosters = rosters;

  // Build lookup maps
  state.usersById = {};
  users.forEach((u) => (state.usersById[u.user_id] = u));

  state.rosterByOwner = {};
  state.rosterByRosterId = {};
  rosters.forEach((r) => {
    state.rosterByOwner[r.owner_id] = r;
    state.rosterByRosterId[String(r.roster_id)] = r;
  });

  // Recent activity (needs roster maps)
  await loadLeagueActivity();

  setStatus("Loading traded picks…");
  try {
    state.tradedPicks = await fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/traded_picks`);
  } catch (e) {
    state.tradedPicks = [];
  }
  buildPicksByOwner();

  if (!state.playersById) {
    setStatus("Loading player database (first time is slow)…");
    state.playersById = await fetchJSON(`https://api.sleeper.app/v1/players/${SPORT}`);
  }

  setStatus(`Loading season stats (${state.statsSeason})…`);
  let statsRaw = null;
  try {
    statsRaw = await fetchJSON(`https://api.sleeper.app/v1/stats/${SPORT}/regular/${state.statsSeason}`);
  } catch (e) {
    statsRaw = null;
  }

  state.statsByPlayerId = {};
  if (Array.isArray(statsRaw)) {
    for (const item of statsRaw) {
      const pid = item.player_id;
      if (!pid) continue;
      state.statsByPlayerId[pid] = item.stats || item;
    }
  } else if (statsRaw && typeof statsRaw === "object") {
    for (const [pid, val] of Object.entries(statsRaw)) {
      state.statsByPlayerId[pid] = val?.stats || val;
    }
  }

  state.currentLeftOwnerId = null;
  state.currentRightOwnerId = null;

  if (elLeftTitle) elLeftTitle.textContent = "Left Roster";
  if (elRightTitle) elRightTitle.textContent = "Right Roster";

  renderTeamsList();
  renderCompareTables();

  setStatus(`Ready ✅ (Tap L / R on a team) — League ${state.season}, Stats ${state.statsSeason}, Week ${state.week || 1}`);
}

/* =========================
   Boot / reload wiring
========================= */
async function fullReload() {
  try {
    await loadLeagues();
    await loadLeagueData();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
  }
}

if (elReloadBtn) elReloadBtn.addEventListener("click", fullReload);

if (elLeagueSelect) {
  elLeagueSelect.addEventListener("change", async () => {
    try {
      await loadLeagueData();
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  });
}

// Re-render on rotation / resize (keeps sticky headers stable)
let _resizeTimer = null;
window.addEventListener("resize", () => {
  if (_resizeTimer) return;
  _resizeTimer = setTimeout(() => {
    _resizeTimer = null;
    renderCompareTables();
  }, 150);
});

// Boot
initUsernameLockUI();
fullReload();
