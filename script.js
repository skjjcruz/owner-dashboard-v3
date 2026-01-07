/*************************************************
 * Owner Dashboard – Sleeper Compare + Stats + Picks
 * + Weekly Projections + League Transactions
 *************************************************/

const SPORT = "nfl";

// Defaults
const DEFAULT_LEAGUE_SEASON = "2026";
const DEFAULT_STATS_SEASON = "2025";
const DEFAULT_USERNAME = "";

// Seasons
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

// Transactions DOM (added safely)
const elTransactions =
  document.getElementById("transactionsList") ||
  document.getElementById("transactions");

// ===== LocalStorage =====
const LS_LOCKED_USERNAME = "od_locked_username";

// ===== State =====
let state = {
  username: "",
  season: DEFAULT_LEAGUE_SEASON,
  statsSeason: DEFAULT_STATS_SEASON,

  user: null,
  leagues: [],
  leagueId: null,
  league: null,
  users: [],
  rosters: [],
  usersById: {},
  rosterByOwner: {},
  rosterByRosterId: {},

  playersById: null,
  statsByPlayerId: null,
  scoring: {},

  nflState: null,
  week: null,
  projStatsByPlayerId: {},
  _projInFlight: {},
  _projRerenderTimer: null,

  tradedPicks: [],
  picksByOwnerId: {},
  draftRounds: 7,

  transactions: [],
};

// ===== Helpers =====
function setStatus(msg) {
  elStatus.textContent = msg;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function safeName(u) {
  return u?.display_name || u?.username || "Unknown";
}

// ===== Dropdown init =====
function fillSelect(el, values, def) {
  el.innerHTML = "";
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
  el.value = def;
}

function initUsernameLockUI() {
  const locked = localStorage.getItem(LS_LOCKED_USERNAME);

  if (locked) {
    elUsername.value = locked;
    elUsername.disabled = true;
    state.username = locked;
  }

  fillSelect(elSeason, LEAGUE_SEASON_YEARS, DEFAULT_LEAGUE_SEASON);
  fillSelect(elStatsSeason, STATS_SEASON_YEARS, DEFAULT_STATS_SEASON);

  state.season = elSeason.value;
  state.statsSeason = elStatsSeason.value;
}

function lockUsername(u) {
  localStorage.setItem(LS_LOCKED_USERNAME, u);
  elUsername.value = u;
  elUsername.disabled = true;
}

// ===== NFL State =====
async function loadNFLState() {
  try {
    const s = await fetchJSON(`https://api.sleeper.app/v1/state/${SPORT}`);
    state.week = Number(s.week) || 1;
  } catch {
    state.week = 1;
  }
}

// ===== Transactions =====
async function loadTransactions() {
  if (!state.leagueId || !elTransactions) return;

  try {
    const tx = await fetchJSON(
      `https://api.sleeper.app/v1/league/${state.leagueId}/transactions/${state.week || 1}`
    );
    state.transactions = tx || [];
    renderTransactions();
  } catch {
    elTransactions.innerHTML = "<li>No recent activity</li>";
  }
}

function renderTransactions() {
  if (!elTransactions) return;
  elTransactions.innerHTML = "";

  if (!state.transactions.length) {
    elTransactions.innerHTML = "<li>No recent activity</li>";
    return;
  }

  state.transactions.slice(0, 30).forEach(tx => {
    const li = document.createElement("li");
    li.className = "transactionRow";

    const user =
      state.usersById?.[tx.creator] ||
      state.usersById?.[tx.owner_id];

    const name = safeName(user);
    const type = tx.type?.toUpperCase() || "MOVE";

    li.textContent = `${name}: ${type}`;
    elTransactions.appendChild(li);
  });
}

// ===== Load Leagues =====
async function loadLeagues() {
  state.username =
    localStorage.getItem(LS_LOCKED_USERNAME) ||
    elUsername.value.trim();

  if (!state.username) {
    setStatus("Enter a Sleeper username");
    return;
  }

  state.season = elSeason.value;
  state.statsSeason = elStatsSeason.value;

  await loadNFLState();

  state.user = await fetchJSON(
    `https://api.sleeper.app/v1/user/${state.username}`
  );

  if (!localStorage.getItem(LS_LOCKED_USERNAME)) {
    lockUsername(state.username);
  }

  state.leagues = await fetchJSON(
    `https://api.sleeper.app/v1/user/${state.user.user_id}/leagues/${SPORT}/${state.season}`
  );

  elLeagueSelect.innerHTML = "";
  state.leagues.forEach(l => {
    const o = document.createElement("option");
    o.value = l.league_id;
    o.textContent = l.name;
    elLeagueSelect.appendChild(o);
  });

  state.leagueId = elLeagueSelect.value;
}

// ===== Load League Data =====
async function loadLeagueData() {
  if (!state.leagueId) return;

  state.league = await fetchJSON(
    `https://api.sleeper.app/v1/league/${state.leagueId}`
  );

  state.scoring = state.league.scoring_settings || {};

  const [users, rosters] = await Promise.all([
    fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/users`),
    fetchJSON(`https://api.sleeper.app/v1/league/${state.leagueId}/rosters`)
  ]);

  state.users = users;
  state.rosters = rosters;

  state.usersById = {};
  users.forEach(u => (state.usersById[u.user_id] = u));

  state.rosterByOwner = {};
  state.rosterByRosterId = {};
  rosters.forEach(r => {
    state.rosterByOwner[r.owner_id] = r;
    state.rosterByRosterId[r.roster_id] = r;
  });

  if (!state.playersById) {
    state.playersById = await fetchJSON(
      `https://api.sleeper.app/v1/players/${SPORT}`
    );
  }

  const statsRaw = await fetchJSON(
    `https://api.sleeper.app/v1/stats/${SPORT}/regular/${state.statsSeason}`
  );

  state.statsByPlayerId = {};
  Object.entries(statsRaw || {}).forEach(([pid, v]) => {
    state.statsByPlayerId[pid] = v.stats || v;
  });

  renderTeamsList();
  loadTransactions();

  setStatus(
    `Ready ✅ League ${state.season}, Stats ${state.statsSeason}, Week ${state.week}`
  );
}

// ===== Teams List =====
function renderTeamsList() {
  elTeams.innerHTML = "";

  state.rosters.forEach(r => {
    const li = document.createElement("li");
    li.className = "teamRow";

    const name = safeName(state.usersById[r.owner_id]);
    li.textContent = name;
    elTeams.appendChild(li);
  });
}

// ===== Boot =====
async function fullReload() {
  try {
    await loadLeagues();
    await loadLeagueData();
  } catch (e) {
    console.error(e);
    setStatus("Error loading data");
  }
}

elReloadBtn.addEventListener("click", fullReload);
elLeagueSelect.addEventListener("change", loadLeagueData);

// Init
initUsernameLockUI();
fullReload();
