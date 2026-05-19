import { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, onValue, set, update } from "firebase/database";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const ADMIN_PW_KEY = "dcl_admin_pw";
const DEFAULT_PW = "DCL2025";
const getAdminPw = () => localStorage.getItem(ADMIN_PW_KEY) || DEFAULT_PW;

function computeStandings(players, matches) {
  const table = {};
  players.forEach(p => { table[p] = { name: p, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; });
  (matches || []).forEach(m => {
    if (!m.played) return;
    const hs = parseInt(m.homeScore), as_ = parseInt(m.awayScore);
    if (!table[m.home] || !table[m.away]) return;
    table[m.home].p++; table[m.away].p++;
    table[m.home].gf += hs; table[m.home].ga += as_;
    table[m.away].gf += as_; table[m.away].ga += hs;
    table[m.home].gd = table[m.home].gf - table[m.home].ga;
    table[m.away].gd = table[m.away].gf - table[m.away].ga;
    if (hs > as_) { table[m.home].w++; table[m.home].pts += 3; table[m.away].l++; }
    else if (hs < as_) { table[m.away].w++; table[m.away].pts += 3; table[m.home].l++; }
    else { table[m.home].d++; table[m.away].d++; table[m.home].pts++; table[m.away].pts++; }
  });
  return Object.values(table).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}

function generateRoundRobin(players, groupLabel) {
  const matches = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++)
      matches.push({ id: `G${groupLabel}-${i}-${j}`, group: groupLabel, home: players[i], away: players[j], homeScore: null, awayScore: null, played: false });
  return matches;
}

function assignGroups(participants) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const numGroups = shuffled.length <= 12 ? 2 : 4;
  const labels = ["A", "B", "C", "D"].slice(0, numGroups);
  const groups = {};
  labels.forEach(l => (groups[l] = []));
  shuffled.forEach((p, i) => groups[labels[i % numGroups]].push(p));
  return groups;
}

// ─── RULES DATA ───────────────────────────────────────────────────────────────
const RULES = [
  { icon: "⚽", title: "Match Duration", text: "10 minutes per match" },
  { icon: "🔄", title: "Substitutions", text: "6 per match" },
  { icon: "🩹", title: "Injury Selection", text: "ON" },
  { icon: "⏱️", title: "Extra Time & Penalties", text: "OFF" },
  { icon: "🏠", title: "Room Condition", text: "Excellent only" },
  { icon: "🌙", title: "Fixture Window", text: "11:00 PM – 7:00 AM (overnight only)" },
  { icon: "🔢", title: "Max Fixtures Per Day", text: "2 matches per player per day" },
  { icon: "⏰", title: "Match Deadline", text: "Both players must start before 1:00 AM" },
  { icon: "💬", title: "Message Opponent", text: "Contact your opponent before 1:00 AM" },
  { icon: "📸", title: "Screenshots", text: "Drop result screenshot immediately after match. Tag admin + opponent + both club names." },
  { icon: "🤝", title: "No-Show / Refusal", text: "Neither proves fault by 1:00 AM → 0–0 Draw. Proven ghosting → Admin may award 3–0 walkover." },
  { icon: "🚫", title: "Conduct", text: "No abusive language. No external links. No friendly match screenshots. Violations = immediate removal." },
];

const DISCONNECT = [
  { time: "Before 20 mins", rule: "Full replay — 10 min match" },
  { time: "20 – 30 mins", rule: "Full replay — 8 min match" },
  { time: "30 – 40 mins", rule: "Full replay — 6 min match" },
  { time: "40 – 50 mins", rule: "Full replay — 5 min match" },
  { time: "50 – 60 mins", rule: "Half-time replay — 6 min match" },
  { time: "60 – 70 mins", rule: "Half-time replay — 5 min match" },
  { time: "70 – 80 mins", rule: "20-min mark replay — 5 min match" },
  { time: "80 – 90 mins", rule: "Score at disconnect stands as FINAL" },
];

// ─── COLOURS & STYLES ────────────────────────────────────────────────────────
const c = {
  gold: "#c9a227", goldFaint: "rgba(201,162,39,0.1)", goldBorder: "rgba(201,162,39,0.3)",
  bg: "#0a0e1a", surface: "#0f1826", surface2: "#111d2e",
  border: "#1a2540", border2: "#131d2a",
  muted: "#4a5568", text: "#e8eaf0", textSub: "#8899aa",
  green: "#4ade80", danger: "#f87171", red: "#7f1d1d",
};

const s = {
  app: { minHeight: "100vh", background: `linear-gradient(160deg,${c.bg} 0%,#0d1525 60%,${c.bg} 100%)`, fontFamily: "'Barlow Condensed',sans-serif", color: c.text, overflowX: "hidden" },
  header: { background: "#0d1525", borderBottom: `2px solid ${c.gold}`, padding: "0 16px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 30px rgba(0,0,0,0.7)" },
  headerInner: { maxWidth: 820, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0" },
  logoMain: { fontSize: 20, fontWeight: 800, letterSpacing: 3, color: c.gold, textTransform: "uppercase", lineHeight: 1.1 },
  logoSub: { fontSize: 10, letterSpacing: 4, color: c.muted, textTransform: "uppercase" },
  badge: { background: c.goldFaint, border: `1px solid ${c.gold}`, color: c.gold, padding: "4px 12px", fontSize: 11, letterSpacing: 3, borderRadius: 2, fontWeight: 700 },
  nav: { background: "#0d1525", borderBottom: `1px solid ${c.border}`, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  navInner: { maxWidth: 820, margin: "0 auto", display: "flex" },
  main: { maxWidth: 820, margin: "0 auto", padding: "20px 16px 60px" },
  card: { background: `linear-gradient(135deg,${c.surface} 0%,${c.surface2} 100%)`, border: `1px solid ${c.border}`, borderRadius: 6, overflow: "hidden", marginBottom: 16 },
  cardHead: { background: `linear-gradient(90deg,#1a2540 0%,${c.surface2} 100%)`, borderBottom: `1px solid ${c.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 13, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: c.gold },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "10px 6px", textAlign: "center", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.muted, borderBottom: `1px solid ${c.border}`, fontWeight: 700 },
  thL: { padding: "10px 12px", textAlign: "left", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: c.muted, borderBottom: `1px solid ${c.border}`, fontWeight: 700 },
  td: { padding: "10px 6px", textAlign: "center", fontSize: 13 },
  tdL: { padding: "10px 12px", textAlign: "left", fontSize: 13, fontWeight: 600 },
  input: { background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4, color: c.text, padding: "9px 12px", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" },
  scoreBox: { width: 56, background: c.bg, border: `1px solid #2d3a4a`, borderRadius: 3, color: c.gold, padding: "8px 4px", fontSize: 28, fontWeight: 800, textAlign: "center", fontFamily: "inherit", outline: "none" },
  fRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${c.border2}`, gap: 8 },
  vs: { padding: "3px 12px", background: c.border2, borderRadius: 3, fontSize: 11, color: c.muted, letterSpacing: 2, minWidth: 70, textAlign: "center" },
  result: { padding: "3px 12px", background: c.goldFaint, border: `1px solid ${c.goldBorder}`, borderRadius: 3, fontSize: 14, fontWeight: 800, color: c.gold, minWidth: 70, textAlign: "center" },
  ruleRow: { display: "flex", gap: 14, padding: "14px 16px", borderBottom: `1px solid ${c.border2}`, alignItems: "flex-start" },
};

const btn = (variant = "primary", extra = {}) => {
  const base = { padding: "9px 18px", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", border: "none", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", ...extra };
  if (variant === "primary") return { ...base, background: c.gold, color: "#0a0e1a" };
  if (variant === "danger")  return { ...base, background: c.red, color: "#fff" };
  if (variant === "ghost")   return { ...base, background: "transparent", color: c.muted, border: `1px solid ${c.border}` };
  if (variant === "sm")      return { ...base, padding: "5px 12px", fontSize: 11, background: c.gold, color: "#0a0e1a" };
  return base;
};

const navBtn = (active) => ({
  padding: "13px 14px", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
  border: "none", background: "transparent", color: active ? c.gold : c.muted,
  borderBottom: active ? `2px solid ${c.gold}` : "2px solid transparent",
  cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.2s", fontFamily: "inherit",
});

const posChip = (i) => ({
  width: 24, height: 24, borderRadius: 3, display: "inline-flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, fontWeight: 800,
  background: i === 0 ? c.gold : i === 1 ? "#374151" : "transparent",
  color: i <= 1 ? "#fff" : c.muted,
});

// ─── SCORE MODAL ──────────────────────────────────────────────────────────────
function ScoreModal({ match, onSave, onClose }) {
  const [h, setH] = useState(match.homeScore ?? "");
  const [a, setA] = useState(match.awayScore ?? "");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#0f1826", border: `1px solid ${c.border}`, borderRadius: 8, padding: 24, width: "100%", maxWidth: 340 }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: c.gold, fontWeight: 700, marginBottom: 20, textTransform: "uppercase" }}>Enter Score</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 20 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}>{match.home}</div>
            <input type="number" min={0} max={99} style={s.scoreBox} value={h} onChange={e => setH(e.target.value)} />
          </div>
          <span style={{ color: c.muted, fontSize: 24, fontWeight: 800, paddingTop: 20 }}>–</span>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, color: c.muted, marginBottom: 8 }}>{match.away}</div>
            <input type="number" min={0} max={99} style={s.scoreBox} value={a} onChange={e => setA(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...btn("ghost"), flex: 1 }} onClick={onClose}>Cancel</button>
          <button style={{ ...btn("primary"), flex: 1 }} onClick={() => { if (h !== "" && a !== "") onSave(parseInt(h), parseInt(a)); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── STANDINGS TABLE ──────────────────────────────────────────────────────────
function StandingsTable({ players, matches, label, advCount, poCount }) {
  const rows = computeStandings(players, matches);
  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <span style={{ fontSize: 18 }}>📊</span>
        <span style={s.cardTitle}>Group {label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: c.muted }}>{(matches||[]).filter(m=>m.played).length}/{(matches||[]).length} played</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.th, width: 30 }}>#</th>
              <th style={s.thL}>Club</th>
              <th style={s.th}>P</th><th style={s.th}>W</th><th style={s.th}>D</th><th style={s.th}>L</th>
              <th style={s.th}>GF</th><th style={s.th}>GA</th><th style={s.th}>GD</th>
              <th style={s.th}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const qual = i < advCount ? "advance" : (poCount && i < advCount + poCount) ? "playoff" : "";
              return (
                <tr key={r.name} style={{ borderBottom: `1px solid ${c.border2}`, background: qual === "advance" ? "rgba(201,162,39,0.06)" : qual === "playoff" ? "rgba(59,130,246,0.05)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)" }}>
                  <td style={s.td}><span style={posChip(i)}>{i+1}</span></td>
                  <td style={s.tdL}>
                    {qual === "advance" && <span style={{ color: c.gold, marginRight: 5, fontSize: 10 }}>▶</span>}
                    {qual === "playoff" && <span style={{ color: "#93c5fd", marginRight: 5, fontSize: 10 }}>●</span>}
                    {r.name}
                  </td>
                  <td style={s.td}>{r.p}</td><td style={s.td}>{r.w}</td><td style={s.td}>{r.d}</td><td style={s.td}>{r.l}</td>
                  <td style={s.td}>{r.gf}</td><td style={s.td}>{r.ga}</td>
                  <td style={{ ...s.td, color: r.gd > 0 ? c.green : r.gd < 0 ? c.danger : c.muted }}>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                  <td style={{ ...s.td, color: c.gold, fontWeight: 800, fontSize: 14 }}>{r.pts}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 16px", display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: c.gold }}>▶ Advance to Knockouts</span>
        {poCount > 0 && <span style={{ fontSize: 10, color: "#93c5fd" }}>● Playoff Spot</span>}
      </div>
    </div>
  );
}

// ─── MATCH ROW ────────────────────────────────────────────────────────────────
function MatchRow({ m, adminMode, onEdit }) {
  return (
    <div style={s.fRow}>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, textAlign: "right", color: m.home === "TBD" ? c.muted : c.text }}>{m.home}</span>
      {m.played
        ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={s.result}>{m.homeScore} – {m.awayScore}</span>
            {adminMode && <button style={btn("ghost", { padding: "4px 8px", fontSize: 11 })} onClick={() => onEdit(m)}>✏️</button>}
          </div>
        : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={s.vs}>VS</span>
            {adminMode && m.home !== "TBD" && m.away !== "TBD" && <button style={btn("sm")} onClick={() => onEdit(m)}>Score</button>}
          </div>
      }
      <span style={{ flex: 1, fontSize: 12, fontWeight: 700, textAlign: "left", color: m.away === "TBD" ? c.muted : c.text }}>{m.away}</span>
    </div>
  );
}

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────
function Loading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
      <div style={{ width: 40, height: 40, border: `3px solid ${c.border}`, borderTop: `3px solid ${c.gold}`, borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <div style={{ fontSize: 12, letterSpacing: 3, color: c.muted, textTransform: "uppercase" }}>Loading Tournament...</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [fbData, setFbData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("standings");
  const [loggedIn, setLoggedIn] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [editingMatch, setEditingMatch] = useState(null);
  const [editingKO, setEditingKO] = useState(null);

  // ── Firebase listener — all participants see live data ──────────────────────
  useEffect(() => {
    const tourneyRef = ref(db, "tournament");
    const unsub = onValue(tourneyRef, (snapshot) => {
      const data = snapshot.val();
      setFbData(data || {
        season: "Season 1",
        participants: [],
        groups: {},
        groupMatches: [],
        knockoutRounds: [],
        playoffMatches: [],
        setupComplete: false,
      });
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const push = (changes) => {
    const next = { ...fbData, ...changes };
    set(ref(db, "tournament"), next);
    // Firebase listener will update state automatically
  };

  if (loading || !fbData) return (
    <div style={s.app}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <Loading />
    </div>
  );

  const { season, participants, groups, groupMatches, knockoutRounds, playoffMatches, setupComplete } = fbData;
  const groupKeys = Object.keys(groups || {});
  const numGroups = groupKeys.length;
  const advCount = numGroups <= 2 ? 4 : 2;
  const poCount  = numGroups <= 2 ? 2 : 1;
  const allGroupsDone = setupComplete && (groupMatches||[]).length > 0 && (groupMatches||[]).every(m => m.played);

  // ── Admin ────────────────────────────────────────────────────────────────────
  const login = () => {
    if (pwInput === getAdminPw()) { setLoggedIn(true); setPwError(""); setPwInput(""); }
    else setPwError("Incorrect password.");
  };

  const changePw = () => {
    if (!newPw || newPw !== confirmPw) { setPwMsg("Passwords don't match."); return; }
    localStorage.setItem(ADMIN_PW_KEY, newPw);
    setNewPw(""); setConfirmPw("");
    setPwMsg("✅ Password updated!");
  };

  // ── Players ───────────────────────────────────────────────────────────────────
  const addPlayer = () => {
    const name = newPlayer.trim();
    if (!name || (participants||[]).includes(name)) return;
    push({ participants: [...(participants||[]), name] });
    setNewPlayer("");
  };

  const removePlayer = (p) => push({ participants: (participants||[]).filter(x => x !== p) });

  // ── Draw ──────────────────────────────────────────────────────────────────────
  const drawGroups = () => {
    if ((participants||[]).length < 4) return;
    const grps = assignGroups(participants);
    const allMatches = [];
    Object.entries(grps).forEach(([label, players]) => allMatches.push(...generateRoundRobin(players, label)));
    push({ groups: grps, groupMatches: allMatches, setupComplete: true, knockoutRounds: [], playoffMatches: [] });
  };

  // ── Score group match ─────────────────────────────────────────────────────────
  const saveGroupScore = (id, hs, as_) => {
    const updated = (groupMatches||[]).map(m => m.id === id ? { ...m, homeScore: hs, awayScore: as_, played: true } : m);
    push({ groupMatches: updated });
    setEditingMatch(null);
  };

  // ── Score KO match ────────────────────────────────────────────────────────────
  const saveKOScore = (ri, mi, hs, as_) => {
    const rounds = JSON.parse(JSON.stringify(knockoutRounds));
    const winner = hs > as_ ? rounds[ri].matches[mi].home : rounds[ri].matches[mi].away;
    rounds[ri].matches[mi] = { ...rounds[ri].matches[mi], homeScore: hs, awayScore: as_, played: true, winner };
    if (ri + 1 < rounds.length) {
      const slot = Math.floor(mi / 2);
      const side = mi % 2 === 0 ? "home" : "away";
      rounds[ri + 1].matches[slot][side] = winner;
    }
    push({ knockoutRounds: rounds });
    setEditingKO(null);
  };

  // ── Generate knockout ─────────────────────────────────────────────────────────
  const generateKnockout = () => {
    const advancers = [], playoffs = [];
    groupKeys.forEach(label => {
      const gm = (groupMatches||[]).filter(m => m.group === label);
      const rows = computeStandings((groups||{})[label] || [], gm);
      advancers.push(...rows.slice(0, advCount).map(r => r.name));
      rows.slice(advCount, advCount + poCount).forEach(r => playoffs.push(r.name));
    });
    const shuffled = advancers.sort(() => Math.random() - 0.5);
    const rounds = [];
    if (shuffled.length >= 8) {
      rounds.push({ name: "Quarter Finals", matches: [
        { home: shuffled[0], away: shuffled[7], played: false },
        { home: shuffled[3], away: shuffled[4], played: false },
        { home: shuffled[1], away: shuffled[6], played: false },
        { home: shuffled[2], away: shuffled[5], played: false },
      ]});
    }
    rounds.push({ name: "Semi Finals", matches: shuffled.length >= 8
      ? [{ home: "TBD", away: "TBD", played: false }, { home: "TBD", away: "TBD", played: false }]
      : shuffled.reduce((acc, _, i) => { if (i%2===0) acc.push({ home: shuffled[i], away: shuffled[i+1]||"TBD", played: false }); return acc; }, [])
    });
    rounds.push({ name: "🏆 Grand Final", matches: [{ home: "TBD", away: "TBD", played: false }] });
    const pMatches = [];
    for (let i = 0; i < playoffs.length - 1; i += 2)
      pMatches.push({ id: `PO-${i}`, home: playoffs[i], away: playoffs[i+1], played: false });
    push({ knockoutRounds: rounds, playoffMatches: pMatches });
  };

  // ── VIEWS ─────────────────────────────────────────────────────────────────────
  const renderStandings = () => {
    if (!setupComplete) return (
      <div style={{ textAlign: "center", padding: "70px 20px" }}>
        <div style={{ fontSize: 72, marginBottom: 16 }}>🏆</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: c.gold, letterSpacing: 4, marginBottom: 8, textTransform: "uppercase" }}>Dynasty Champions League</div>
        <div style={{ fontSize: 13, color: c.muted, letterSpacing: 2 }}>Tournament setup in progress. Check back soon.</div>
      </div>
    );
    return (
      <>
        <div style={{ background: c.goldFaint, border: `1px solid ${c.goldBorder}`, borderRadius: 4, padding: "10px 14px", fontSize: 12, color: c.gold, marginBottom: 16, letterSpacing: 1 }}>
          🏟️ Group Stage · {(participants||[]).length} participants · {numGroups} groups
        </div>
        {groupKeys.map(label => (
          <StandingsTable key={label} players={(groups||{})[label]||[]} matches={(groupMatches||[]).filter(m=>m.group===label)} label={label} advCount={advCount} poCount={poCount} />
        ))}
      </>
    );
  };

  const renderFixtures = () => {
    if (!setupComplete) return <div style={{ padding: 40, textAlign: "center", color: c.muted, fontSize: 13 }}>Tournament not started yet.</div>;
    return (
      <>
        {groupKeys.map(label => {
          const gm = (groupMatches||[]).filter(m => m.group === label);
          return (
            <div key={label} style={s.card}>
              <div style={s.cardHead}>
                <span style={{ fontSize: 18 }}>📋</span>
                <span style={s.cardTitle}>Group {label}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: c.muted }}>{gm.filter(m=>m.played).length}/{gm.length} played</span>
              </div>
              {gm.filter(m=>!m.played).length > 0 && <>
                <div style={{ padding: "8px 16px 2px", fontSize: 10, letterSpacing: 2, color: c.muted, textTransform: "uppercase" }}>Upcoming</div>
                {gm.filter(m=>!m.played).map(m => <MatchRow key={m.id} m={m} adminMode={loggedIn} onEdit={setEditingMatch} />)}
              </>}
              {gm.filter(m=>m.played).length > 0 && <>
                <div style={{ padding: "8px 16px 2px", fontSize: 10, letterSpacing: 2, color: c.muted, textTransform: "uppercase" }}>Results</div>
                {gm.filter(m=>m.played).map(m => <MatchRow key={m.id} m={m} adminMode={loggedIn} onEdit={setEditingMatch} />)}
              </>}
            </div>
          );
        })}
        {(playoffMatches||[]).length > 0 && (
          <div style={s.card}>
            <div style={s.cardHead}><span style={{ fontSize: 18 }}>⚡</span><span style={s.cardTitle}>Playoffs</span></div>
            {(playoffMatches||[]).map(m => <MatchRow key={m.id} m={m} adminMode={loggedIn} onEdit={setEditingMatch} />)}
          </div>
        )}
      </>
    );
  };

  const renderKnockout = () => (
    <>
      {allGroupsDone && (knockoutRounds||[]).length === 0 && loggedIn && (
        <div style={{ background: c.goldFaint, border: `1px solid ${c.goldBorder}`, borderRadius: 4, padding: "12px 16px", fontSize: 13, color: c.gold, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <span>Group stage complete! Generate the knockout bracket.</span>
          <button style={btn()} onClick={generateKnockout}>Generate</button>
        </div>
      )}
      {(knockoutRounds||[]).length === 0
        ? <div style={s.card}>
            <div style={s.cardHead}><span style={{ fontSize: 18 }}>🏆</span><span style={s.cardTitle}>Knockout Stage</span></div>
            <div style={{ padding: 32, textAlign: "center", color: c.muted, fontSize: 13 }}>Bracket appears after all group matches are played.</div>
          </div>
        : (knockoutRounds||[]).map((round, ri) => (
            <div key={ri} style={s.card}>
              <div style={s.cardHead}><span style={{ fontSize: 18 }}>⚔️</span><span style={s.cardTitle}>{round.name}</span></div>
              {round.matches.map((m, mi) => <MatchRow key={mi} m={m} adminMode={loggedIn} onEdit={() => setEditingKO({ m, ri, mi })} />)}
            </div>
          ))
      }
    </>
  );

  const renderRules = () => (
    <>
      <div style={s.card}>
        <div style={s.cardHead}><span style={{ fontSize: 18 }}>📋</span><span style={s.cardTitle}>Match Rules</span></div>
        {RULES.map((r, i) => (
          <div key={i} style={s.ruleRow}>
            <span style={{ fontSize: 20, minWidth: 28 }}>{r.icon}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: c.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>{r.title}</div>
              <div style={{ fontSize: 13, color: c.textSub, lineHeight: 1.5 }}>{r.text}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={s.card}>
        <div style={s.cardHead}><span style={{ fontSize: 18 }}>🔴</span><span style={s.cardTitle}>Disconnection Rules</span></div>
        <div style={{ padding: "10px 16px", fontSize: 12, color: c.muted, borderBottom: `1px solid ${c.border2}` }}>
          ⚠️ 2 disconnections by the same player = Automatic win for opponent, regardless of score.
        </div>
        {DISCONNECT.map((r, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: `1px solid ${c.border2}`, background: i%2===0?"transparent":"rgba(255,255,255,0.01)" }}>
            <span style={{ fontSize: 12, color: c.gold, fontWeight: 700 }}>{r.time}</span>
            <span style={{ fontSize: 12, color: c.textSub, textAlign: "right", maxWidth: "55%" }}>{r.rule}</span>
          </div>
        ))}
        <div style={{ padding: 14, fontSize: 11, color: c.muted, lineHeight: 1.6 }}>
          Ensure stable network, enough data, and sufficient battery before every match. Admin decisions on all disputes are final.
        </div>
      </div>
    </>
  );

  const renderAdmin = () => {
    if (!loggedIn) return (
      <div style={{ maxWidth: 360, margin: "60px auto 0" }}>
        <div style={s.card}>
          <div style={s.cardHead}><span style={{ fontSize: 18 }}>🔐</span><span style={s.cardTitle}>Admin Login</span></div>
          <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <input style={s.input} type="password" placeholder="Enter admin password" value={pwInput}
              onChange={e => setPwInput(e.target.value)} onKeyDown={e => e.key==="Enter" && login()} />
            {pwError && <div style={{ color: c.danger, fontSize: 12 }}>{pwError}</div>}
            <button style={btn()} onClick={login}>Login</button>
          </div>
        </div>
      </div>
    );
    return (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: c.gold, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase" }}>⚡ Admin Panel</div>
          <button style={btn("ghost")} onClick={() => setLoggedIn(false)}>Logout</button>
        </div>

        {/* Season */}
        <div style={s.card}>
          <div style={s.cardHead}><span>🏷️</span><span style={s.cardTitle}>Season Name</span></div>
          <div style={{ padding: "12px 16px" }}>
            <input style={s.input} value={season||""} onChange={e => push({ season: e.target.value })} placeholder="e.g. Season 1" />
          </div>
        </div>

        {/* Password */}
        <div style={s.card}>
          <div style={s.cardHead}><span>🔑</span><span style={s.cardTitle}>Change Password</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <input style={s.input} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
            <input style={s.input} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
            {pwMsg && <div style={{ fontSize: 12, color: pwMsg.startsWith("✅") ? c.green : c.danger }}>{pwMsg}</div>}
            <button style={btn()} onClick={changePw}>Update Password</button>
          </div>
        </div>

        {/* Participants */}
        <div style={s.card}>
          <div style={s.cardHead}><span>👥</span><span style={s.cardTitle}>Participants ({(participants||[]).length})</span></div>
          <div style={{ padding: 16 }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input style={s.input} placeholder="Player / Club name" value={newPlayer}
                onChange={e => setNewPlayer(e.target.value)} onKeyDown={e => e.key==="Enter" && addPlayer()} />
              <button style={{ ...btn(), whiteSpace: "nowrap" }} onClick={addPlayer}>Add</button>
            </div>
            {(participants||[]).length === 0
              ? <div style={{ color: c.muted, fontSize: 13 }}>No participants added yet.</div>
              : (participants||[]).map((p, i) => (
                  <div key={p} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", background: c.bg, borderRadius: 4, border: `1px solid ${c.border}`, marginBottom: 6 }}>
                    <span style={{ fontSize: 13 }}><span style={{ color: c.muted, marginRight: 10 }}>{i+1}</span>{p}</span>
                    <button style={btn("danger", { padding: "4px 10px", fontSize: 11 })} onClick={() => removePlayer(p)}>Remove</button>
                  </div>
                ))
            }
          </div>
        </div>

        {/* Draw */}
        <div style={s.card}>
          <div style={s.cardHead}><span>🎲</span><span style={s.cardTitle}>Group Draw</span></div>
          <div style={{ padding: 16 }}>
            {(participants||[]).length < 4
              ? <div style={{ color: c.muted, fontSize: 13 }}>Need at least 4 participants to draw groups.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 13, color: c.textSub, lineHeight: 1.6 }}>
                    {(participants||[]).length} players → {(participants||[]).length <= 12 ? "2" : "4"} groups, randomly drawn.
                    {setupComplete && <span style={{ color: c.danger }}> ⚠️ Redrawing resets ALL results.</span>}
                  </div>
                  <button style={btn(setupComplete ? "danger" : "primary")} onClick={drawGroups}>
                    {setupComplete ? "🎲 Redraw Groups (Resets Everything)" : "🎲 Draw Groups & Start Tournament"}
                  </button>
                </div>
            }
          </div>
        </div>

        {/* Knockout control */}
        {setupComplete && (
          <div style={s.card}>
            <div style={s.cardHead}><span>⚔️</span><span style={s.cardTitle}>Knockout Stage</span></div>
            <div style={{ padding: 16 }}>
              {!allGroupsDone
                ? <div style={{ fontSize: 13, color: c.muted }}>Complete all group fixtures first.</div>
                : (knockoutRounds||[]).length === 0
                ? <button style={btn()} onClick={generateKnockout}>Generate Knockout Bracket</button>
                : <div style={{ fontSize: 13, color: c.green }}>✅ Bracket active. Manage scores in the Knockout tab.</div>
              }
            </div>
          </div>
        )}
      </>
    );
  };

  const VIEWS = [
    { key: "standings", label: "Table" },
    { key: "fixtures",  label: "Fixtures" },
    { key: "knockout",  label: "Knockout" },
    { key: "rules",     label: "Rules" },
    { key: "admin",     label: "⚙ Admin" },
  ];

  return (
    <div style={s.app}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap" rel="stylesheet" />

      <header style={s.header}>
        <div style={s.headerInner}>
          <div>
            <div style={s.logoMain}>Dynasty Champions League</div>
            <div style={s.logoSub}>{season} · eFootball™ Tournament</div>
          </div>
          <div style={s.badge}>DCL</div>
        </div>
      </header>

      <nav style={s.nav}>
        <div style={s.navInner}>
          {VIEWS.map(v => <button key={v.key} style={navBtn(view===v.key)} onClick={() => setView(v.key)}>{v.label}</button>)}
        </div>
      </nav>

      <main style={s.main}>
        {view === "standings" && renderStandings()}
        {view === "fixtures"  && renderFixtures()}
        {view === "knockout"  && renderKnockout()}
        {view === "rules"     && renderRules()}
        {view === "admin"     && renderAdmin()}
      </main>

      {editingMatch && <ScoreModal match={editingMatch} onSave={(hs,as_) => saveGroupScore(editingMatch.id, hs, as_)} onClose={() => setEditingMatch(null)} />}
      {editingKO    && <ScoreModal match={editingKO.m}  onSave={(hs,as_) => saveKOScore(editingKO.ri, editingKO.mi, hs, as_)} onClose={() => setEditingKO(null)} />}
    </div>
  );
}
