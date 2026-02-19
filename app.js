"use strict";

/* ========= state ========= */
const KEY="seminary_app_v1";
const qs=s=>document.querySelector(s);
const load=()=>JSON.parse(localStorage.getItem(KEY)||'{"sessions":[],"active":null}');
const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("seminary_sync") : null;
const save = (s) => {
  localStorage.setItem(KEY, JSON.stringify(s));
  try { bc?.postMessage({ type:"state", ts: Date.now() }); } catch {}
};

const makeId=p=>p+"_"+Date.now()+"_"+Math.random().toString(16).slice(2);
const today=()=>new Date().toISOString().slice(0,10);

function scrollResponsesToBottomIfNeeded(){
  const body = qs(".tableBody");
  if(!body) return;

  // only scroll if overflow exists
  if(body.scrollHeight > body.clientHeight){
    // body.scrollTop = body.scrollHeight;
    body.scrollTo({
      top: body.scrollHeight,
      behavior: "smooth"
    });
  }
}

function escapeHtml(s){
  return String(s??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function ensureRootShape(st){
  if(!st || typeof st !== "object") st = {sessions:[],active:null};
  if(!Array.isArray(st.sessions)) st.sessions = [];
  if(!("active" in st)) st.active = null;
  return st;
}

function ensureSessionShape(sess){
  if(!Array.isArray(sess.teams)) sess.teams=[];
  if(!Array.isArray(sess.categories)) sess.categories=[];

  for(const t of sess.teams){
    if(!Array.isArray(t.members)) t.members=[];
    if(typeof t.points !== "number" || !isFinite(t.points)) t.points = 0;
    if(typeof t.name !== "string") t.name = "Team";
  }
  for(const c of sess.categories){
    if(typeof c.enabled !== "boolean") c.enabled = true;
    if(typeof c.name !== "string") c.name = "Category";
  }

  if(!sess.settings || typeof sess.settings!=="object"){
    sess.settings = { turnSeconds: 30, refLabel: "Verse", turnsPerCategory: 0 };
  }
  if(typeof sess.settings.turnSeconds !== "number" || !isFinite(sess.settings.turnSeconds)) sess.settings.turnSeconds = 30;
  if(typeof sess.settings.refLabel !== "string") sess.settings.refLabel = "Verse";
  if(typeof sess.settings.turnsPerCategory !== "number" || !isFinite(sess.settings.turnsPerCategory)) sess.settings.turnsPerCategory = 0;

  if(!sess.play || typeof sess.play!=="object"){
    sess.play = {
      activeCategoryId: null,
      currentTeamIndex: 0,
      nextMemberIdByTeamId: {},
      paused: true,
      categoryTurnsUsed: 0,
      responses: []
    };
  }
  if(!Array.isArray(sess.play.responses)) sess.play.responses = [];
  if(typeof sess.play.currentTeamIndex !== "number") sess.play.currentTeamIndex = 0;
  if(typeof sess.play.paused !== "boolean") sess.play.paused = true;
  if(typeof sess.play.categoryTurnsUsed !== "number" || !isFinite(sess.play.categoryTurnsUsed)) sess.play.categoryTurnsUsed = 0;
  if(!sess.play.nextMemberIdByTeamId || typeof sess.play.nextMemberIdByTeamId!=="object"){
    sess.play.nextMemberIdByTeamId = {};
  }

  for(const t of sess.teams){
    if(!(t.id in sess.play.nextMemberIdByTeamId)){
      if (t.members && t.members.length) {
        sess.play.nextMemberIdByTeamId[t.id] = t.members[0].id
      }
    }
  }
  for(const k of Object.keys(sess.play.nextMemberIdByTeamId)){
    if(!sess.teams.some(t=>t.id===k)) delete sess.play.nextMemberIdByTeamId[k];
  }

  if(sess.play.activeCategoryId && !sess.categories.some(c=>c.id===sess.play.activeCategoryId)){
    sess.play.activeCategoryId = null;
  }
  if(typeof sess.settings.showTimerConfig !== "boolean") {
    sess.settings.showTimerConfig = false;
  }

  if(typeof sess.play.turnEndsAt !== "number") sess.play.turnEndsAt = 0;
  if(typeof sess.play.lastRemainingMs !== "number") sess.play.lastRemainingMs = 0;

}

function getActiveSession(state){
  const sess = state.sessions.find(x=>x.id===state.active);
  if(sess) ensureSessionShape(sess);
  return sess || null;
}

/* ========= timer ========= */
let timerInterval = null;
let remainingMs = 0;

function formatMMSS(ms){
  const total = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(total/60)).padStart(2,"0");
  const ss = String(total%60).padStart(2,"0");
  return `${mm}:${ss}`;
}
function stopTimer(){
  if(timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}
function setTimerPausedUI(paused){
  qs("#timerBox").classList.toggle("timerPaused", paused);
  qs("#btnPauseResume").textContent = paused ? "Resume" : "Pause";
}

function startTurnTimer(state, sess){
  stopTimer();

  const seconds = Math.max(5, Number(sess.settings.turnSeconds) || 30);
  remainingMs = seconds * 1000;

  // persist timer state so Display View can render accurately
  sess.play.paused = false;
  sess.play.turnEndsAt = Date.now() + remainingMs;
  sess.play.lastRemainingMs = remainingMs;
  save(state);

  setTimerPausedUI(false);
  qs("#timerBig").textContent = formatMMSS(remainingMs);

  // let Display View update immediately
  try{
    bc?.postMessage({
      type: "tick",
      sessionId: state.active,
      remainingMs,
      paused: false
    });
  }catch{}

  timerInterval = setInterval(()=>{
    const st = ensureRootShape(load());
    const s2 = getActiveSession(st);
    if(!s2){
      stopTimer();
      return;
    }

    // if paused, just keep publishing the last-known remaining (optional)
    if(s2.play.paused){
      qs("#timerBig").textContent = formatMMSS(remainingMs);
      try{
        bc?.postMessage({
          type: "tick",
          sessionId: st.active,
          remainingMs,
          paused: true
        });
      }catch{}
      return;
    }

    // compute remaining from stored end time (more robust than decrementing)
    const endAt = Number(s2.play.turnEndsAt) || 0;
    remainingMs = Math.max(0, endAt - Date.now());
    s2.play.lastRemainingMs = remainingMs;

    qs("#timerBig").textContent = formatMMSS(remainingMs);

    try{
      bc?.postMessage({
        type: "tick",
        sessionId: st.active,
        remainingMs,
        paused: false
      });
    }catch{}

    if(remainingMs <= 0){
      remainingMs = 0;
      qs("#timerBig").textContent = "00:00";

      // pause game when timer hits 0
      s2.play.paused = true;
      s2.play.lastRemainingMs = 0;
      s2.play.turnEndsAt = 0;
      save(st);

      setTimerPausedUI(true);
      stopTimer();

      try{
        bc?.postMessage({
          type: "tick",
          sessionId: st.active,
          remainingMs: 0,
          paused: true
        });
      }catch{}

      renderGame();
    }else{
      // persist occasionally so reload doesn't lose the timer
      // (every tick is fine too, but this keeps writes down)
      if((remainingMs % 1000) < 300) save(st);
    }
  }, 250);
}

/* ========= init ========= */
{
  const st = ensureRootShape(load());
  save(st);
}
qs("#sessionDate").value=today();
renderSessions();

/* ========= session creation (copies previous teams/members) ========= */
qs("#btnCreate").onclick=()=>{
  const state = ensureRootShape(load());
  const date = qs("#sessionDate").value || today();
  const title = qs("#sessionTitle").value || "Untitled";

  const existing = [...state.sessions];
  existing.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")) || String(b.id).localeCompare(String(a.id)));
  const prev = existing[0] || null;

  const teams = (prev?.teams || []).map(t=>{
    const newTeamId = makeId("team");
    return {
      id:newTeamId,
      name: t.name || "Team",
      points: 0,
      members: (t.members||[]).map(m=>({ id: makeId("m"), name: m.name || "" }))
    };
  });

  // --- ROTATE TEAM INDEX ---
  let newCurrentTeamIndex = 0;
  if (prev?.teams?.length) {
    const playablePrev = prev.teams.filter(t => (t.members||[]).length > 0);
    if (playablePrev.length > 0) {
      const prevIndex = prev.play?.currentTeamIndex || 0;
      newCurrentTeamIndex = (prevIndex + 1) % playablePrev.length;
    }
  }

  // --- ROTATE MEMBER POINTERS ---
  const nextMemberIdByTeamId = {};
  teams.forEach((team, i) => {
    if (!team.members.length) return;

    // Always rotate member pointer forward by one
    const nextIndex = 1 % team.members.length;
    nextMemberIdByTeamId[team.id] = team.members[nextIndex].id;
  });

  state.sessions.push({
    id: makeId("sess"),
    date,
    title,
    teams,
    categories: [],
    settings:{turnSeconds:30, refLabel:"Verse", turnsPerCategory:0},
    play:{
      activeCategoryId:null,
      currentTeamIndex:newCurrentTeamIndex,
      nextMemberIdByTeamId,
      paused:true,
      categoryTurnsUsed:0,
      responses:[]
    }
  });

  save(state);
  renderSessions();
};

qs("#btnReset").onclick=()=>{ qs("#sessionTitle").value=""; };

qs("#btnToggleTimerCfg").onclick = () => {
  const state = ensureRootShape(load());
  const sess = getActiveSession(state);
  if(!sess) return;
  sess.settings.showTimerConfig = !sess.settings.showTimerConfig;
  save(state);
  qs("#timerConfig").classList.toggle("hidden", !sess.settings.showTimerConfig);
};

function renderSessions(){
  const state=ensureRootShape(load());
  const ul=qs("#sessionList");
  ul.innerHTML="";

  const sessions = [...state.sessions].sort((a,b)=>{
    const d = String(b.date||"").localeCompare(String(a.date||""));
    if(d!==0) return d;
    return String(b.id).localeCompare(String(a.id));
  });

  sessions.forEach(sess=>{
    const li=document.createElement("li");
    li.className="listItem";

    const left=document.createElement("div");
    left.innerHTML=`
      <div style="font-weight:950">${escapeHtml(sess.title)}</div>
      <div class="meta">${escapeHtml(sess.date || "")}</div>
    `;

    const actions=document.createElement("div");
    actions.className="actions";

    const open=document.createElement("button");
    open.textContent="Open";
    open.onclick=()=>openSession(sess.id);

    const print=document.createElement("button");
    print.textContent="Print";
    print.className="ghost";
    print.title="Print report for this session";
    print.onclick=()=>printSessionReport(sess.id);

    const del=document.createElement("button");
    del.textContent="Delete";
    del.className="danger";
    del.title="Delete this session";
    del.onclick=()=>{
      if(!confirm(`Delete session "${sess.title}"? This cannot be undone.`)) return;

      const st = ensureRootShape(load());
      st.sessions = st.sessions.filter(s => s.id !== sess.id);

      // if deleting the active session, clear active
      if(st.active === sess.id) st.active = null;

      save(st);
      renderSessions();
    };

    actions.appendChild(open);
    actions.appendChild(print);
    actions.appendChild(del);

    li.appendChild(left);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

function openSession(id){
  const state=ensureRootShape(load());
  state.active=id;
  const sess=getActiveSession(state);
  save(state);

  qs("#viewSessions").classList.add("hidden");
  qs("#viewGame").classList.remove("hidden");

  renderGame();

  if(sess && sess.play.activeCategoryId && !sess.play.paused){
    qs("#timerBox").classList.remove("hidden");
    startTurnTimer(state, sess);
  }
}

qs("#btnBack").onclick=()=>{
  stopTimer();
  qs("#viewGame").classList.add("hidden");
  qs("#viewSessions").classList.remove("hidden");
  renderSessions();
};

/* ========= report printing ========= */
function compareRefAlphanumeric(a, b){
  const A = String(a.refNumber ?? "").trim();
  const B = String(b.refNumber ?? "").trim();

  // blanks last
  if(!A && !B) return 0;
  if(!A) return 1;
  if(!B) return -1;

  // numeric-aware, case-insensitive, "2" < "10", "2a" after "2"
  return A.localeCompare(B, undefined, { numeric: true, sensitivity: "base" });
}
function printSessionReport(sessionId){
  const state = ensureRootShape(load());
  const sess = state.sessions.find(s=>s.id===sessionId);
  if(!sess) return;
  ensureSessionShape(sess);

  const teamById = new Map(sess.teams.map(t=>[t.id,t]));
  const catById = new Map(sess.categories.map(c=>[c.id,c]));
  const resp = Array.isArray(sess.play?.responses) ? sess.play.responses : [];

  const catAgg = new Map();
  for(const r of resp){
    const catName = catById.get(r.categoryId)?.name ?? "(Deleted category)";
    const teamName = teamById.get(r.teamId)?.name ?? "(Deleted team)";
    const memberName = ((teamById.get(r.teamId)?.members || []).find(m=>m.id===r.memberId)?.name || r.memberName) ?? "(Deleted member)";

    if(!catAgg.has(catName)) catAgg.set(catName, new Map());
    const tmap = catAgg.get(catName);
    if(!tmap.has(teamName)) tmap.set(teamName, []);
    tmap.get(teamName).push({
      memberName,
      refNumber: r.refNumber || "",
      ref: `${r.refNumber||""}`.trim(),
      text: r.text || ""
    });
  }

  const sortedTeams = [...sess.teams].slice().sort((a,b)=>(b.points||0)-(a.points||0));
  const sortedCats = [...sess.categories].slice().sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
  const totalResponses = resp.length;

  const win = window.open("", "_blank");
  if(!win) return;

  const css = `
    <style>
      @page{margin:12mm}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1020}
      h1{margin:0 0 6px 0;font-size:22px}
      .meta{margin:0 0 14px 0;font-size:14px}
      h2{margin:18px 0 8px 0;font-size:18px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #0b1020;padding:6px 8px;vertical-align:top}
      th{background:#0b1020;color:#fff;text-align:left}
      .pill{display:inline-block;border:1px solid #0b1020;border-radius:999px;padding:2px 8px;margin-right:6px;font-size:12px}
      .small{font-size:12px}
      .cat{margin-top:14px}
      .muted{opacity:.75}
      .wrap{white-space:pre-wrap;word-break:break-word}
      .right{text-align:right}
    </style>
  `;

  let html = `
    <html><head><title>Seminary Report</title>${css}</head><body>
      <h1>${escapeHtml(sess.title || "Session")}</h1>
      <div class="meta">
        <span class="pill">Date: ${escapeHtml(sess.date || "")}</span>
        <span class="pill">Teams: ${sess.teams.length}</span>
        <span class="pill">Categories: ${sess.categories.length}</span>
        <span class="pill">Responses: ${totalResponses}</span>
      </div>

      <h2>Points</h2>
      <table>
        <thead><tr><th>Team</th><th class="right">Points</th><th>Members</th></tr></thead>
        <tbody>
          ${sortedTeams.map(t=>`
            <tr>
              <td>${escapeHtml(t.name||"Team")}</td>
              <td class="right">${escapeHtml(String(t.points||0))}</td>
              <td class="wrap">${escapeHtml((t.members||[]).map(m=>m.name).join(", "))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <h2>Categories</h2>
      <table>
        <thead><tr><th>Category</th><th>Status</th><th class="right">Responses</th></tr></thead>
        <tbody>
          ${sortedCats.map(c=>{
            const cnt = resp.filter(r=>r.categoryId===c.id).length;
            return `
              <tr>
                <td class="wrap">${escapeHtml(c.name||"Category")}</td>
                <td>${c.enabled ? "Auto-rotate ON" : "Auto-rotate OFF"}</td>
                <td class="right">${cnt}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>

      <h2>Responses by Category</h2>
  `;

  const catNames = [...catAgg.keys()].sort((a,b)=>String(a).localeCompare(String(b)));
  if(catNames.length === 0){
    html += `<div class="small muted">No responses recorded.</div>`;
  } else {
    for(const catName of catNames){
      const tmap = catAgg.get(catName);
      const teamNames = [...tmap.keys()].sort((a,b)=>String(a).localeCompare(String(b)));
      html += `<div class="cat"><h3 style="margin:0 0 6px 0;font-size:16px">${escapeHtml(catName)}</h3>`;
      html += `<table>
        <thead><tr><th style="width:18%">Team</th><th style="width:18%">Member</th><th style="width:12%">Ref</th><th>Response</th></tr></thead>
        <tbody>
      `;
      for(const teamName of teamNames){
        const entries = (tmap.get(teamName) || []).slice().sort(compareRefAlphanumeric);
        for(const e of entries){
          html += `
            <tr>
              <td>${escapeHtml(teamName)}</td>
              <td>${escapeHtml(e.memberName)}</td>
              <td>${escapeHtml(e.ref)}</td>
              <td class="wrap">${escapeHtml(e.text)}</td>
            </tr>
          `;
        }
      }
      html += `</tbody></table></div>`;
    }
  }

  html += `</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

/* ========= teams/categories/gameplay helpers ========= */
qs("#btnAddTeam").onclick=()=>{
  const name=(qs("#newTeamName").value||"").trim() || "Team";
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;

  sess.teams.push({id:makeId("team"),name,points:0,members:[]});
  sess.play.nextMemberIdByTeamId[sess.teams[sess.teams.length-1].id] = undefined;
  save(state);

  qs("#newTeamName").value="";
  renderGame();
};

qs("#btnAddCategory").onclick=()=>addCategoryFromInput();
qs("#newCategoryName").addEventListener("keydown",(e)=>{ if(e.key==="Enter") addCategoryFromInput(); });
qs("#btnOpenDisplay").onclick = () => {
  const state = ensureRootShape(load());
  const sess = getActiveSession(state);
  if(!sess) return;

  // Normalize anything that render logic might “fix” in-memory
  ensureSessionShape(sess);
  ensureActiveCategoryIsValid(sess);
  getCurrentAndNext(sess); // normalizes currentTeamIndex internally

  // IMPORTANT: persist those fixes so the popout reads the same truth
  save(state);

  const url = `${location.pathname}?display=1&session=${encodeURIComponent(state.active)}`;
  window.open(url, "seminary_display", "noopener,noreferrer,width=1400,height=900");
};


function addCategoryFromInput(){
  const input = qs("#newCategoryName");
  const name = (input.value||"").trim();
  if(!name) return;

  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;

  const exists = sess.categories.some(c => (c.name||"").trim().toLowerCase() === name.toLowerCase());
  if(exists){ input.select(); return; }

  sess.categories.push({id:makeId("cat"), name, enabled:true});
  save(state);

  renderGame();
  requestAnimationFrame(()=>{ input.value=""; input.focus(); });
}

function getPlayableTeams(sess){ return sess.teams.filter(t => (t.members||[]).length > 0); }

function getCurrentAndNext(sess){
  const playable = getPlayableTeams(sess);
  if(playable.length === 0) return { playable, currentTeam:null, currentMember:null, nextByTeam:{} };

  let cti = sess.play.currentTeamIndex || 0;
  cti = ((cti % playable.length) + playable.length) % playable.length;
  sess.play.currentTeamIndex = cti;

  const currentTeam = playable[cti];
  const members = currentTeam.members;
  const nextId = sess.play.nextMemberIdByTeamId[currentTeam.id]; // string | undefined
  let idx = members.findIndex(m => m.id === nextId);
  if (idx < 0) idx = 0;
  const curMember = members.length ? members[idx] : null;

  const nextByTeam = {};
  for (const t of playable) {
    if (!t.members.length) continue;
    const nextId = sess.play.nextMemberIdByTeamId[t.id];
    let mi = t.members.findIndex(m => m.id === nextId);
    if (mi < 0) mi = 0;
    nextByTeam[t.id] = t.members[mi];
  }
  return { playable, currentTeam, currentMember: curMember, nextByTeam };
}

function advanceTurn(sess){
  const playable = getPlayableTeams(sess);
  if(playable.length === 0) return;
  let cti = sess.play.currentTeamIndex || 0;
  cti = ((cti % playable.length) + playable.length) % playable.length;
  const ct = playable[cti];
  if(ct.members.length){
    const currentId = sess.play.nextMemberIdByTeamId[ct.id];
    let idx = ct.members.findIndex(m => m.id === currentId);
    if(idx < 0) idx = 0;
    const nextIdx = (idx + 1) % ct.members.length;
    sess.play.nextMemberIdByTeamId[ct.id] = ct.members[nextIdx].id;
  }
  sess.play.currentTeamIndex =
    (cti + 1) % playable.length;
}

function enabledCategories(sess){ return sess.categories.filter(c=>c.enabled); }
function ensureActiveCategoryIsValid(sess){
  if(!sess.categories.length){ sess.play.activeCategoryId = null; return; }
  const cur = sess.categories.find(c=>c.id===sess.play.activeCategoryId);
  if(cur) return;
  const e = enabledCategories(sess);
  sess.play.activeCategoryId = (e[0]?.id ?? sess.categories[0].id);
}
function rotateToNextEnabledCategory(sess){
  const enabled = enabledCategories(sess);
  if(enabled.length === 0){ sess.play.activeCategoryId = null; return; }
  const curId = sess.play.activeCategoryId;
  let idx = enabled.findIndex(c=>c.id===curId);
  if(idx < 0) idx = 0;
  const next = enabled[(idx + 1) % enabled.length];
  sess.play.activeCategoryId = next?.id ?? enabled[0].id;
  sess.play.categoryTurnsUsed = 0;
}
function maybeRotateByTurns(sess){
  const rounds = Math.max(0, Number(sess.settings.turnsPerCategory) || 0);
  if(rounds <= 0) return;

  const playableCount = getPlayableTeams(sess).length;
  if(playableCount <= 0) return;

  const totalTeamTurnsNeeded = rounds * playableCount;
  if(sess.play.categoryTurnsUsed >= totalTeamTurnsNeeded){
    rotateToNextEnabledCategory(sess);
  }
}
function addPoints(sess, teamId, delta){
  const t = sess.teams.find(t=>t.id===teamId);
  if(!t) return;
  t.points = (Number(t.points)||0) + delta;
}

/* timer controls */
qs("#turnSeconds").addEventListener("change", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;
  sess.settings.turnSeconds = Math.max(5, Number(qs("#turnSeconds").value) || 30);
  save(state);
});
qs("#refLabel").addEventListener("input", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;
  const v = (qs("#refLabel").value||"").trim() || "Verse";
  sess.settings.refLabel = v;
  qs("#refLabelText").textContent = v;
  save(state);
});
qs("#turnsPerCategory").addEventListener("change", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;
  sess.settings.turnsPerCategory = Math.max(0, Number(qs("#turnsPerCategory").value) || 0);
  save(state);
  renderGame();
});
qs("#btnPauseResume").addEventListener("click", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess || !sess.play.activeCategoryId) return;

  sess.play.paused = !sess.play.paused;
  save(state);
  setTimerPausedUI(sess.play.paused);

  if(!sess.play.paused && !timerInterval){
    timerInterval = setInterval(()=>{
      const st = ensureRootShape(load());
      const s2 = getActiveSession(st);
      if(!s2) { stopTimer(); return; }
      if(s2.play.paused){
        qs("#timerBig").textContent = formatMMSS(remainingMs);
        return;
      }
      remainingMs -= 250;
      if(remainingMs <= 0){
        remainingMs = 0;
        qs("#timerBig").textContent = "00:00";
        s2.play.paused = true;
        save(st);
        setTimerPausedUI(true);
        stopTimer();
        renderGame();
        return;
      }
      qs("#timerBig").textContent = formatMMSS(remainingMs);
    }, 250);
  }
});

/* response actions */
qs("#btnSubmitResponse").addEventListener("click", ()=>submitResponse(true));
qs("#responseText").addEventListener("keydown", (e)=>{
  if(e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitResponse(true);
});
qs("#btnSkipNoPoint").addEventListener("click", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess || !sess.play.activeCategoryId) return;

  advanceTurn(sess);
  maybeRotateByTurns(sess);

  sess.play.paused = false;
  save(state);

  renderGame();
  if(sess.play.activeCategoryId) startTurnTimer(state, sess);
  else stopTimer();

  requestAnimationFrame(()=>qs("#refNumber").focus());
});
qs("#btnStopChallenge").addEventListener("click", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess || !sess.play.activeCategoryId) return;

  const { currentTeam } = getCurrentAndNext(sess);
  if(!currentTeam) return;

  addPoints(sess, currentTeam.id, 5);

  const curCat = sess.categories.find(c=>c.id===sess.play.activeCategoryId);
  if(curCat) curCat.enabled = false;

  rotateToNextEnabledCategory(sess);
  advanceTurn(sess);

  sess.play.paused = false;
  save(state);

  renderGame();
  if(sess.play.activeCategoryId){
    qs("#timerBox").classList.remove("hidden");
    startTurnTimer(state, sess);
  } else {
    stopTimer();
  }
  requestAnimationFrame(()=>qs("#refNumber").focus());
});

function submitResponse(awardPoint){
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess || !sess.play.activeCategoryId) return;

  const { currentTeam, currentMember } = getCurrentAndNext(sess);
  if(!currentTeam || !currentMember) return;

  const refLabel = (sess.settings.refLabel || "Verse").trim() || "Verse";
  const refNumber = (qs("#refNumber").value||"").trim();
  const text = (qs("#responseText").value||"").trim();

  if(!refNumber){ qs("#refNumber").focus(); return; }
  if(!text){ qs("#responseText").focus(); return; }

  sess.play.responses.push({
    ts: Date.now(),
    categoryId: sess.play.activeCategoryId,
    teamId: currentTeam.id,
    memberId: currentMember.id,
    memberName: currentMember.name,
    refLabel,
    refNumber,
    text
  });

  if(awardPoint) addPoints(sess, currentTeam.id, 1);

  sess.play.categoryTurnsUsed = (sess.play.categoryTurnsUsed || 0) + 1;
  advanceTurn(sess);
  maybeRotateByTurns(sess);

  qs("#refNumber").value = "";
  qs("#responseText").value = "";

  sess.play.paused = false;
  save(state);

  renderGame();
  scrollResponsesToBottomIfNeeded();
  if(sess.play.activeCategoryId) startTurnTimer(state, sess);
  else stopTimer();

  requestAnimationFrame(()=>qs("#refNumber").focus());
}

/* responses table sorted by verse ref ONLY */
qs("#btnClearResponses").addEventListener("click", ()=>{
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;
  sess.play.responses = [];
  save(state);
  renderGame();
});

function nameById(list, id){
  const x = list.find(o=>o.id===id);
  return x ? (x.name || "") : "";
}
function memberNameById(sess, teamId, memberId){
  const t = sess.teams.find(t=>t.id===teamId);
  const m = t?.members?.find(m=>m.id===memberId);
  return m?.name || "";
}
function parseRefNumber(refNumber){
  const s = String(refNumber||"").trim();
  const m = s.match(/^(\d+)/);
  const n = m ? Number(m[1]) : Number.NaN;
  return { n, s };
}
function renderResponsesTable(sess){
  const tbody = qs("#respTbody");
  tbody.innerHTML = "";

  const activeCatId = sess.play.activeCategoryId;

  if(!activeCatId){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="small" colspan="4">Select a category to start.</td>`;
    tbody.appendChild(tr);
    qs("#respSummary").textContent = `0 for this category • ${sess.play.responses.length} total overall`;
    return;
  }

  const rows = [...(sess.play.responses||[])]
    .filter(r=>r.categoryId === activeCatId)
    .sort(compareRefAlphanumeric);

  qs("#respSummary").textContent = `${rows.length} for this category • ${sess.play.responses.length} total overall`;

  if(rows.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="small" colspan="4">No responses yet for this category.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for(const r of rows){
    const team = nameById(sess.teams, r.teamId) || "—";
    const member = memberNameById(sess, r.teamId, r.memberId) || r.memberName || "—";
    const ref = `${r.refNumber||""}`.trim();

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(team)}</td>
      <td>${escapeHtml(member)}</td>
      <td class="small mono">${escapeHtml(ref)}</td>
      <td class="wrapText">${escapeHtml(r.text||"")}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* categories render */
function renderCategories(sess){
  const wrap = qs("#catsWrap");
  wrap.innerHTML = "";
  qs("#catCount").textContent = `${sess.categories.length} total`;

  sess.categories.forEach(cat=>{
    const row = document.createElement("div");

    const isActive = sess.play.activeCategoryId === cat.id;
    row.className = "catRow"
      + (isActive ? " active" : "")
      + (!cat.enabled && !isActive ? " off" : "");

    const label = document.createElement("div");
    label.className = "catLabel";
    label.textContent = cat.name || "Category";
    label.title = cat.name || "Category";

    const actions = document.createElement("div");
    actions.className = "catActions";

    // checkbox (auto-rotate include)
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!cat.enabled;
    cb.title = "Include in auto-rotation";
    cb.addEventListener("change",(e)=>{
      const st = ensureRootShape(load());
      const s2 = getActiveSession(st);
      if(!s2) return;
      const c2 = s2.categories.find(x=>x.id===cat.id);
      if(!c2) return;
      c2.enabled = !!e.target.checked;
      save(st);
      renderGame();
    });

    // start/active button
    const btnStart = document.createElement("button");
    btnStart.className = "smallBtn";
    btnStart.textContent = isActive ? "Active" : "Start";
    btnStart.onclick = ()=>{
      const st = ensureRootShape(load());
      const s2 = getActiveSession(st);
      if(!s2) return;

      s2.play.activeCategoryId = cat.id;
      s2.play.categoryTurnsUsed = 0;

      const playable = getPlayableTeams(s2);
      if(playable.length === 0){
        s2.play.paused = true;
        save(st);
        renderGame();
        return;
      }

      s2.play.paused = false;
      save(st);

      renderGame();
      qs("#timerBox").classList.remove("hidden");
      startTurnTimer(st, s2);
      requestAnimationFrame(()=>qs("#refNumber").focus());
    };

    // remove button
    const btnRemove = document.createElement("button");
    btnRemove.className = "danger smallBtn";
    btnRemove.textContent = "Remove";
    btnRemove.title = "Delete category";
    btnRemove.onclick = ()=>{
      const st = ensureRootShape(load());
      const s2 = getActiveSession(st);
      if(!s2) return;

      if(s2.play.activeCategoryId === cat.id){
        s2.play.activeCategoryId = null;
        s2.play.paused = true;
        s2.play.categoryTurnsUsed = 0;
        stopTimer();
        remainingMs = 0;
      }
      s2.categories = s2.categories.filter(c=>c.id!==cat.id);
      save(st);
      renderGame();
    };

    actions.appendChild(cb);
    actions.appendChild(btnStart);
    actions.appendChild(btnRemove);

    row.appendChild(label);
    row.appendChild(actions);
    wrap.appendChild(row);
  });
}


/* teams render + points */
function renderPointsBar(sess){
  const bar = qs("#pointsBar");
  bar.innerHTML = "";
  const sorted = [...sess.teams].sort((a,b)=>{
    const ap = Number(a.points)||0, bp=Number(b.points)||0;
    if(bp!==ap) return bp-ap;
    return String(a.name||"").localeCompare(String(b.name||""));
  });
  for(const t of sorted){
    const pill = document.createElement("div");
    pill.className = "pointPill";
    pill.innerHTML = `
      <span class="nm">${escapeHtml(t.name||"Team")}</span>
      <span class="pts">${escapeHtml(String(Number(t.points)||0))}</span>
    `;
    bar.appendChild(pill);
  }
}
function renderTeams(state, sess){
  const wrap=qs("#teamsWrap");
  wrap.innerHTML="";

  const info = getCurrentAndNext(sess);
  const currentTeam = info.currentTeam;
  const currentMember = info.currentMember;
  const nextByTeam = info.nextByTeam;

  sess.teams.forEach(team=>{
    const card=document.createElement("div");
    card.className="teamCard" + ((currentTeam && currentTeam.id===team.id) ? " currentTeam" : "");

    const delTeam=document.createElement("button");
    delTeam.className="cornerX";
    delTeam.textContent="x";
    delTeam.title="Delete team";
    delTeam.onclick=()=>{
      const st = ensureRootShape(load());
      const s2 = getActiveSession(st);
      if(!s2) return;

      // capture current team ID before mutation
      const before = getCurrentAndNext(s2);
      const currentTeamId = before.currentTeam?.id || null;

      // delete team
      s2.teams = s2.teams.filter(t=>t.id!==team.id);
      delete s2.play.nextMemberIdByTeamId[team.id];

      // restore currentTeamIndex by ID (not by old index)
      const p = getPlayableTeams(s2);
      if(p.length === 0){
        s2.play.currentTeamIndex = 0;
        s2.play.paused = true;
      } else if(currentTeamId){
        const idx = p.findIndex(t => t.id === currentTeamId);
        s2.play.currentTeamIndex = idx >= 0 ? idx : Math.min(s2.play.currentTeamIndex, p.length-1);
      } else {
        s2.play.currentTeamIndex = Math.min(s2.play.currentTeamIndex, p.length-1);
      }

      save(st);
      renderGame();
    };

    card.appendChild(delTeam);

    const header=document.createElement("div");
    header.className="teamHeader";

    const nameInput=document.createElement("input");
    nameInput.value=team.name || "Team";
    nameInput.onchange=()=>{
      team.name=(nameInput.value||"").trim() || "Team";
      save(state);
      renderGame();
    };

    const pts = document.createElement("div");
    pts.className="pill";
    pts.title="Points";
    pts.textContent = `pts: ${Number(team.points)||0}`;

    header.appendChild(nameInput);
    header.appendChild(pts);
    card.appendChild(header);

    const grid=document.createElement("div");
    grid.className="membersGrid";

    (team.members||[]).forEach(m=>{
      const row=document.createElement("div");
      row.className="memberRow";

      const isCurrent = !!(currentTeam && currentMember && currentTeam.id===team.id && currentMember.id===m.id);
      const isNextOther = !!(
        sess.play.activeCategoryId &&
        currentTeam && currentTeam.id !== team.id &&
        nextByTeam[team.id] && nextByTeam[team.id].id === m.id
      );
      if(isCurrent) row.classList.add("current");
      else if(isNextOther) row.classList.add("next");

      const nm=document.createElement("div");
      nm.className="nm";
      nm.textContent=m.name || "";
      nm.title=m.name || "";

      const del=document.createElement("button");
      del.className="cornerX";
      del.textContent="x";
      del.title="Remove member";
      del.onclick = ()=>{
        const st = ensureRootShape(load());
        const s2 = getActiveSession(st);
        if(!s2) return;

        const t2 = s2.teams.find(t=>t.id===team.id);
        if(!t2) return;

        const currentId = s2.play.nextMemberIdByTeamId[team.id];

        // remove clicked member
        t2.members = (t2.members || []).filter(x => x.id !== m.id);

        if (!t2.members.length) {
          s2.play.nextMemberIdByTeamId[team.id] = undefined;
        } else {
          // 🔥 preserve current person if still exists
          if (t2.members.some(x => x.id === currentId)) {
            s2.play.nextMemberIdByTeamId[team.id] = currentId;
          } else {
            // current person was deleted — fallback safely
            s2.play.nextMemberIdByTeamId[team.id] = t2.members[0].id;
          }
        }

        save(st);
        renderGame();
      };



      row.appendChild(nm);
      row.appendChild(del);
      grid.appendChild(row);
    });

    card.appendChild(grid);

    const addRow=document.createElement("div");
    addRow.className="row addMemberRow";

    const input=document.createElement("input");
    input.placeholder="Add member";
    input.dataset.team=team.id;

    const btn=document.createElement("button");
    btn.textContent="Add";
    btn.className="smallBtn";

    btn.onclick=()=>{
      const name=input.value.trim();
      if(!name) return;

      team.members.push({id:makeId("m"),name});

      const storedId = sess.play.nextMemberIdByTeamId[team.id];
      if (!team.members.some(m => m.id === storedId)) {
        sess.play.nextMemberIdByTeamId[team.id] = team.members[0]?.id;
      }

      save(state);
      renderGame();
      requestAnimationFrame(()=>{ qs(`input[data-team="${team.id}"]`)?.focus(); });
    };

    input.onkeydown=e=>{ if(e.key==="Enter") btn.click(); };

    addRow.appendChild(input);
    addRow.appendChild(btn);
    card.appendChild(addRow);

    wrap.appendChild(card);
  });
}

/* main render */
function renderGame(){
  const state=ensureRootShape(load());
  const sess=getActiveSession(state);
  if(!sess) return;

  ensureActiveCategoryIsValid(sess);

  qs("#gameSessionTitle").textContent = sess.title || "Session";
  qs("#gameSessionMeta").textContent = `${sess.date || ""} • Teams: ${sess.teams.length} • Categories: ${sess.categories.length}`;
  renderPointsBar(sess);

  qs("#turnSeconds").value = String(sess.settings.turnSeconds ?? 30);
  qs("#refLabel").value = sess.settings.refLabel ?? "Verse";
  qs("#refLabelText").textContent = sess.settings.refLabel ?? "Verse";
  qs("#turnsPerCategory").value = String(sess.settings.turnsPerCategory ?? 0);

  const hasActiveCategory = !!sess.play.activeCategoryId;
  qs("#timerBox").classList.toggle("hidden", !hasActiveCategory);

  if(!hasActiveCategory){
    qs("#responseBox").classList.add("hidden");
    qs("#rightHint").classList.remove("hidden");
  } else {
    qs("#rightHint").classList.add("hidden");
    qs("#responseBox").classList.remove("hidden");
  }

  const activeCat = sess.categories.find(c=>c.id===sess.play.activeCategoryId);
  qs("#currentCategoryHeading").textContent = activeCat?.name || "—";

  if(hasActiveCategory){
    setTimerPausedUI(!!sess.play.paused);
    if(!timerInterval){
      const seconds = Math.max(5, Number(sess.settings.turnSeconds) || 30);
      if(remainingMs <= 0 || remainingMs > seconds*1000) remainingMs = seconds*1000;
      qs("#timerBig").textContent = formatMMSS(remainingMs);
    }

    const rounds = Math.max(0, Number(sess.settings.turnsPerCategory) || 0);
    const playableCount = getPlayableTeams(sess).length;
    const needed = (rounds > 0 && playableCount > 0) ? (rounds * playableCount) : 0;

    qs("#catProgress").textContent = (needed > 0)
      ? `${sess.play.categoryTurnsUsed || 0}/${needed}`
      : "Off";

    qs("#responseCategory").textContent = activeCat ? `Category: ${activeCat.name}` : "Category: —";

    const { currentTeam, currentMember } = getCurrentAndNext(sess);
    if(currentTeam && currentMember){
      qs("#responseWho").innerHTML =
        `Current: <span>${escapeHtml(currentTeam.name)}</span> • <span>${escapeHtml(currentMember.name)}</span>`;
    } else {
      qs("#responseWho").innerHTML = `<span>Add team members to start.</span>`;
    }
  } else {
    qs("#catProgress").textContent = "—";
  }

  qs("#timerConfig").classList.toggle(
    "hidden",
    !sess.settings.showTimerConfig
  );

  renderCategories(sess);
  renderTeams(state, sess);
  renderResponsesTable(sess);

  save(state);
}

function isDisplayMode(){
  return new URLSearchParams(location.search).get("display") === "1";
}

function getDisplaySessionId(){
  return new URLSearchParams(location.search).get("session");
}

function initDisplayView(){
  // show display, hide everything else
  qs("#viewSessions").classList.add("hidden");
  qs("#viewGame").classList.add("hidden");
  qs("#viewDisplay").classList.remove("hidden");

  const sessId = getDisplaySessionId();
  let lastDisplayedCatId = null;
  let lastDisplayedCount = -1;
  const PAGE_DURATION_MS = 5000;
  const FADE_DURATION_MS = 180;
  let currentPage = 0;
  let pageTimer = null;


  function render(){
    const st = ensureRootShape(load());
    const sess = st.sessions.find(s => s.id === sessId) || null;
    if(!sess){
      qs("#dispCategory").textContent = "No session selected";
      return;
    }
    ensureSessionShape(sess);

    // category
    const activeCat = sess.categories.find(c=>c.id===sess.play.activeCategoryId);
    qs("#dispCategory").textContent = activeCat?.name || "—";

    // current team/member (CURRENTLY UP) — use same logic as dashboard
    const info = getCurrentAndNext(sess);
    if(info.playable.length && info.currentTeam && info.currentMember){
      qs("#dispCurrentUp").textContent =
        `Currently: ${info.currentTeam.name} — ${info.currentMember.name || "—"}`;
    } else {
      qs("#dispCurrentUp").textContent = "Currently: —";
    }

// turns left in current category before auto-rotate
(() => {
  const turnsPerCat = Number(sess.settings?.turnsPerCategory || 0);
  const playableCount = info?.playable?.length || 0;
  const activeCatId = sess.play.activeCategoryId;

  let text = "Turns left: —";
  if(turnsPerCat > 0 && activeCatId && playableCount > 0){
    const total = turnsPerCat * playableCount;
    const used = Number(sess.play.categoryTurnsUsed || 0);
    const left = Math.max(0, total - used);
    text = `Turns left: ${left} / ${total}`;
  } else if(turnsPerCat > 0 && activeCatId){
    text = "Turns left: —";
  } else {
    // turnsPerCategory == 0 means “no auto-rotate”
    text = "Turns left: ∞";
  }

  const el = qs("#dispTurnsLeft");
  if(el) el.textContent = text;
})();

    // timer (compute remaining)
    let remaining = 0;
    if(sess.play.paused){
      remaining = Number(sess.play.lastRemainingMs || 0);
      qs("#dispTimerState").textContent = "PAUSED";
      qs("#dispTimerBox").classList.add("dispTimerPaused");
    } else {
      const endAt = Number(sess.play.turnEndsAt || 0);
      remaining = Math.max(0, endAt - Date.now());
      qs("#dispTimerState").textContent = "TIMER";
      qs("#dispTimerBox").classList.remove("dispTimerPaused");
    }
    qs("#dispTimer").textContent = formatMMSS(remaining);

    // scores
    const scoresGrid = qs("#dispScoresGrid");
    scoresGrid.innerHTML = "";
    const teamsSorted = [...sess.teams].sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0));
    for(const t of teamsSorted){
      const el = document.createElement("div");
      el.className = "dispScorePill";
      el.innerHTML = `<span>${escapeHtml(t.name||"Team")}</span><span>${escapeHtml(String(Number(t.points)||0))}</span>`;
      scoresGrid.appendChild(el);
    }

    // who's up next — use same logic as dashboard
    const nextGrid = qs("#dispNextGrid");
    nextGrid.innerHTML = "";

    const playable = info.playable;
    if(playable.length){
      // info.currentTeamIndex is already normalized by getCurrentAndNext via sess.play.currentTeamIndex
      let cti = Number(sess.play.currentTeamIndex || 0);
      cti = ((cti % playable.length) + playable.length) % playable.length;

      // order starting AFTER current team
      const ordered = playable.slice(cti + 1).concat(playable.slice(0, cti + 1));
      const list = ordered.length ? ordered : playable;

      for(const t of list){
        const m = info.nextByTeam?.[t.id] || null;

        const row = document.createElement("div");
        row.className = "dispNextRow";
        row.innerHTML = `
          <span class="team">${escapeHtml(t.name)}</span>
          <span class="who">${escapeHtml(m?.name || "—")}</span>
        `;
        nextGrid.appendChild(row);
      }
    }

    // responses (selected category) — PAGED FADE (stable across 1s re-renders)
    const respBox = qs("#dispResponses");
    const activeCatId = sess.play.activeCategoryId;

    // pager state (kept across render() calls)
    if(!initDisplayView._respPager){
      initDisplayView._respPager = {
        sig: null,
        boxH: -1,
        rowH: 0,
        rowsPerPage: 0,
        totalPages: 0,
        allRows: [],
        currentPage: 0,
        pageTimer: null,
      };
      respBox.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
      respBox.style.opacity = "1";
    }
    const pager = initDisplayView._respPager;

function updateRespPageInfo(){
  const el = qs("#dispRespPageInfo");
  if(!el) return;

  if(!sess.play.activeCategoryId){
    el.textContent = "Page — / —";
    return;
  }

  const cur = (pager.totalPages ? (pager.currentPage + 1) : 1);
  const tot = (pager.totalPages || 1);
  el.textContent = `Page ${cur} / ${tot}`;
}

    function clearPager(){
      if(pager.pageTimer) clearInterval(pager.pageTimer);
      pager.pageTimer = null;
      pager.sig = null;
      pager.boxH = -1;
      pager.rowH = 0;
      pager.rowsPerPage = 0;
      pager.totalPages = 0;
      pager.allRows = [];
      pager.currentPage = 0;
      updateRespPageInfo();
    }

    function buildSig(catId, list){
      // stable signature so the pager doesn't reset every second
      // (include enough fields to catch real changes)
      return (catId||"") + "|" + list.length + "|" + list.map(r=>[
        r.teamId||"", r.memberId||r.memberName||"", (r.refNumber||""), (r.text||"")
      ].join("§")).join("¶");
    }

    function showPage(pageIndex){
      pager.currentPage = pageIndex;
      updateRespPageInfo();
      const start = pageIndex * pager.rowsPerPage;
      const end = start + pager.rowsPerPage;

      // fade out
      respBox.style.opacity = "0";

      // when fully transparent, swap page, then fade in
      setTimeout(()=>{
        respBox.innerHTML = "";
        pager.allRows.slice(start, end).forEach(el => respBox.appendChild(el.cloneNode(true)));
        requestAnimationFrame(()=>{ respBox.style.opacity = "1"; });
      }, FADE_DURATION_MS);
    }

    const rows = (sess.play.responses || [])
      .filter(r => r.categoryId === activeCatId)
      .slice()
      .sort(compareRefAlphanumeric);

    if(!activeCatId){
      clearPager();
      respBox.innerHTML = `<div style="font-size:28px;opacity:.7">Select a category to start.</div>`;
    } else if(rows.length === 0){
      clearPager();
      respBox.innerHTML = `<div style="font-size:28px;opacity:.7">No responses yet.</div>`;
    } else {
      const sig = buildSig(activeCatId, rows);
      const boxH = respBox.clientHeight || 0;

      const needsRebuild = (pager.sig !== sig) || (pager.boxH !== boxH) || (pager.allRows.length === 0);

      if(needsRebuild){
        pager.sig = sig;
        pager.boxH = boxH;

        // build all row elements
        pager.allRows = rows.map(r=>{
          const team = nameById(sess.teams, r.teamId) || "—";
          const member = memberNameById(sess, r.teamId, r.memberId) || r.memberName || "—";
          const ref = `${r.refNumber||""}`.trim();

          const div = document.createElement("div");
          div.className = "dispRespRow";
          div.innerHTML = `
            <div>${escapeHtml(team)}</div>
            <div>${escapeHtml(member)}</div>
            <div class="ref">${escapeHtml(ref)}</div>
            <div>${escapeHtml(r.text||"")}</div>
          `;
          return div;
        });

        // measure row height once per rebuild (depends on font + layout)
        const temp = document.createElement("div");
        temp.style.visibility = "hidden";
        temp.style.position = "absolute";
        temp.style.left = "-99999px";
        temp.appendChild(pager.allRows[0].cloneNode(true));
        document.body.appendChild(temp);
        pager.rowH = temp.firstChild?.offsetHeight || pager.rowH || 60;
        temp.remove();

        pager.rowsPerPage = Math.max(1, Math.floor((respBox.clientHeight || 1) / (pager.rowH || 60)));
        pager.totalPages = Math.max(1, Math.ceil(pager.allRows.length / pager.rowsPerPage));

        // reset paging from the top
        pager.currentPage = 0;

        // show immediately
        respBox.innerHTML = "";
        pager.allRows.slice(0, pager.rowsPerPage).forEach(el => respBox.appendChild(el.cloneNode(true)));
        respBox.style.opacity = "1";

        // (re)start timer only if needed
        if(pager.pageTimer) clearInterval(pager.pageTimer);
        pager.pageTimer = null;

        if(pager.totalPages > 1){
          pager.pageTimer = setInterval(()=>{
            pager.currentPage = (pager.currentPage + 1) % pager.totalPages;
            showPage(pager.currentPage);
          }, PAGE_DURATION_MS);
        }
      }
      // else: unchanged — leave the current page & timer alone
    }
  }


  // fast sync when main app changes state
  try{
    bc?.addEventListener("message", (e)=>{
      if(e?.data?.type === "state") render();
      if(e?.data?.type === "tick") {
        // tick-only update for smooth timer
        if(e.data.sessionId !== sessId) return;
        qs("#dispTimer").textContent = formatMMSS(Number(e.data.remainingMs||0));
        qs("#dispTimerState").textContent = e.data.paused ? "PAUSED" : "TIMER";
        qs("#dispTimerBox").classList.toggle("dispTimerPaused", !!e.data.paused);
      }
    });
  } catch {}

  // fallback polling (reliable even if BroadcastChannel blocked)
  render();
  setInterval(render, 1000);
}

if(isDisplayMode()){
  initDisplayView();
}

if(!isDisplayMode()){
  /* reopen active on refresh */
  (()=>{
    const st=ensureRootShape(load());
    if(st.active && st.sessions.some(x=>x.id===st.active)){
      qs("#viewSessions").classList.add("hidden");
      qs("#viewGame").classList.remove("hidden");
      renderGame();

      const sess=getActiveSession(st);
      if(sess && sess.play.activeCategoryId && !sess.play.paused){
        qs("#timerBox").classList.remove("hidden");
        startTurnTimer(st, sess);
      }
    }
  })();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}
