const $ = (id) => document.getElementById(id);
const modal = $('loginModal');
let supabaseClient = null;
let activeProfile = null;
let loginMode = 'officer';
let activeEmail = '';
let disposeAttempt = null;
let activeProjector = null;

function openLogin(mode='officer'){
  loginMode = mode;
  modal.hidden = false;
  document.body.style.overflow='hidden';
  if (activeProfile) { if(!modal.classList.contains('dashboard-modal'))showDashboard(activeProfile, activeEmail); return; }
  $('loginForm').onsubmit=null;
  if(mode==='team'){renderTicketLogin();return;}
  $('loginTitle').innerHTML = mode === 'team' ? 'Team <span>portal.</span>' : 'Officer <span>portal.</span>';
  document.querySelector('.modal-copy').textContent='Sign in with your assigned Officer or President account.';
  document.querySelector('.security-note').textContent='Keep your account password private.';
  modal.classList.remove('dashboard-modal','organizer-dashboard','team-dashboard','team-ticket-screen');
  $('loginForm').innerHTML = '<label for="username">' + (mode === 'team' ? 'Team account email' : 'Officer / President email') + '</label><input id="username" name="email" type="email" autocomplete="username" placeholder="Enter your assigned email" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required><button class="btn btn-primary full" type="submit">Continue securely <span>→</span></button>';
  $('username').placeholder = mode === 'team' ? 'Enter your team account email' : 'Enter your assigned officer email';
  $('loginMessage').textContent = '';
  const forgot=makeEl('button','btn btn-outline full','Forgot password?');forgot.type='button';
  forgot.addEventListener('click',async()=>{const email=$('username').value.trim();if(!email||!$('username').checkValidity()){message('Enter your account email first.',true);return;}forgot.disabled=true;try{const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;message('If this email has an account, a password reset link will be sent.');}catch(e){message(e.message,true);}finally{forgot.disabled=false;}});
  $('loginForm').append(forgot);
  setTimeout(()=>$('username').focus(),50);
}
function renderTicketLogin(){
  modal.classList.add('team-dashboard','team-ticket-screen');
  $('loginTitle').innerHTML='Team <span>ticket login.</span>';modal.classList.remove('dashboard-modal','organizer-dashboard');
  document.querySelector('.modal-copy').textContent='Enter your registration ticket ID, check the team name and event, then confirm to continue.';
  document.querySelector('.security-note').textContent='Your ticket signs in your team. Keep the ticket ID private.';
  const form=$('loginForm');form.replaceChildren();$('loginMessage').textContent='';
  const label=makeEl('label','','Ticket ID'),ticket=makeEl('input');ticket.type='text';ticket.required=true;ticket.maxLength=128;ticket.autocomplete='off';ticket.placeholder='Enter the ticket ID from your registration';ticket.id='teamTicketId';label.append(ticket);
  const find=makeEl('button','btn btn-primary full','Find my team');find.type='submit';const matches=makeEl('div','ticket-matches');
  form.append(label,find,matches);
  form.onsubmit=async e=>{e.preventDefault();if(!supabaseClient){message('The portal is connecting. Try again in a moment.',true);return;}if(ticket.value.trim().length<4){message('Enter your complete ticket ID.',true);return;}find.disabled=true;matches.replaceChildren();message('Checking your ticket…');try{
    const result=await invokeIkarusFunction('ticket-login',{action:'lookup',ticket_id:ticket.value.trim()});message('Check your team and event, then confirm to continue.');
    result.matches.forEach(match=>{const card=makeEl('section','team-stage-card');card.append(makeEl('h3','',match.team_name),makeEl('p','',`${match.competition_code.replace('_',' ')} · Year ${match.year_group}`));const confirm=makeEl('button','btn btn-primary full','Yes, this is my team — continue');confirm.type='button';confirm.addEventListener('click',async()=>{matches.querySelectorAll('button').forEach(b=>b.disabled=true);find.disabled=true;message('Opening your team portal…');try{const result=await invokeIkarusFunction('ticket-login',{action:'confirm',challenge:match.challenge});const {data,error}=await supabaseClient.auth.setSession(result.session);if(error)throw error;await loadProfile(data.user,true);}catch(error){message(error.message,true);matches.querySelectorAll('button').forEach(b=>b.disabled=false);find.disabled=false;}});card.append(confirm);matches.append(card);});
  }catch(error){message(error.message,true);}finally{find.disabled=false;}};
}
function closeLogin(){ if(disposeAttempt)return;if(activeProjector){exitProjector();return;}modal.hidden = true; document.body.style.overflow=''; }
['loginTop','loginHero','loginFooter'].forEach(id=>$(id).addEventListener('click',()=>openLogin('officer')));
['teamLoginTop','teamLoginHero','teamLoginFooter'].forEach(id=>$(id).addEventListener('click',()=>openLogin('team')));
$('closeLogin').addEventListener('click',closeLogin);
modal.addEventListener('click',e=>{if(e.target===modal)closeLogin()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)closeLogin()});
$('menuToggle').addEventListener('click',()=> $('nav').classList.toggle('open'));
document.querySelectorAll('.nav a').forEach(a=>a.addEventListener('click',()=> $('nav').classList.remove('open')));

const message = (text, isError=false) => {
  const el = $('loginMessage');
  el.textContent = text;
  el.style.color = isError ? '#ff9aab' : '';
};

function titleForProfile(profile) {
  if (profile.role === 'president') return 'President Dashboard';
  if (['participant','team_member','team'].includes(profile.role)) return 'Team Dashboard';
  const labels = { TECHLIFT: 'TECHLIFT Officer Dashboard', DATAQUEST: 'DATAQUEST Officer Dashboard', AI_NEXUS: 'AI NEXUS Officer Dashboard' };
  return labels[profile.competition_code] || 'Officer Dashboard';
}

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function normalizeHeader(value) {
  // Normalize Excel headers consistently (BOM, punctuation, spaces, hyphens, casing).
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
function parseMembers(value, rowNumber) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.some(x => typeof x !== 'string')) throw new Error();
      return parsed.map(x => x.trim()).filter(Boolean);
    } catch { throw new Error(`Row ${rowNumber}: members must be a JSON array of names or semicolon-separated names.`); }
  }
  return raw.split(';').map(v => v.trim()).filter(Boolean);
}
const TEAM_IMPORT_ALIASES = {
  team_name: ['team_name','team','teamname','name'],
  registration_number: ['registration_number','registration_id','registration_no','registrationid','registrationno','reg_no','reg_number','registration_number_id','ticket_id','ticketid','ticket_no','ticket_number','registration_ticket_id'],
  competition_code: ['competition_code','competition','event','event_code','event_name'],
  members: ['members','team_members','member_names','participants','lead_name','team_lead','leader_name'],
  status: ['status','registration_status']
};
function inferCompetitionFromFilename(fileName) {
  const name = String(fileName || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (name.includes('techlift')) return 'TECHLIFT';
  if (name.includes('dataquest')) return 'DATAQUEST';
  if (name.includes('ainexus') || name.includes('ainex')) return 'AI_NEXUS';
  return '';
}
function findTeamHeader(matrix) {
  // Registration exports often have title/count rows above the real column headings.
  // Search the first 30 non-empty rows and choose the row with the strongest header match.
  let best = null;
  const scanLimit = Math.min(matrix.length, 30);
  for (let i = 0; i < scanLimit; i++) {
    const headers = (matrix[i] || []).map(normalizeHeader);
    const teamIndex = headers.findIndex(h => TEAM_IMPORT_ALIASES.team_name.includes(h));
    const regIndex = headers.findIndex(h => TEAM_IMPORT_ALIASES.registration_number.includes(h));
    const competitionIndex = headers.findIndex(h => TEAM_IMPORT_ALIASES.competition_code.includes(h));
    const score = (teamIndex >= 0 ? 1 : 0) + (regIndex >= 0 ? 1 : 0) + (competitionIndex >= 0 ? 1 : 0);
    if (teamIndex >= 0 && regIndex >= 0 && (!best || score > best.score)) {
      best = { rowIndex: i, headers, score, competitionIndex };
      if (score === 3) break;
    }
  }
  if (!best) {
    const available = (matrix.find(row => row.some(cell => String(cell ?? '').trim())) || [])
      .map(cell => String(cell ?? '').trim()).filter(Boolean);
    throw new Error(`Could not identify the team import header row. Expected columns such as Team Name and Ticket ID/Registration Number. First visible row: ${available.join(' | ') || '(empty file)'}`);
  }
  return best;
}
function rowsToTeams(matrix, fileName = '') {
  if (!Array.isArray(matrix) || !matrix.length) throw new Error('The file is empty or has no readable rows.');
  const header = findTeamHeader(matrix);
  const headers = header.headers;
  const index = {};
  for (const [target, names] of Object.entries(TEAM_IMPORT_ALIASES)) {
    index[target] = headers.findIndex(h => names.includes(h));
  }
  const filenameCompetition = inferCompetitionFromFilename(fileName);
  if (index.competition_code < 0 && !filenameCompetition) {
    throw new Error('Missing required column: competition_code. Add a Competition/Event column, or use a clearly named file such as dataquest.xlsx, techlift.xlsx, or ainexus.xlsx.');
  }
  const rows = matrix.slice(header.rowIndex + 1)
    .map((row, offset) => ({ row, rowNumber: header.rowIndex + offset + 2 }))
    .filter(item => (item.row || []).some(cell => String(cell ?? '').trim() !== ''));
  if (!rows.length) throw new Error('No team records were found below the detected header row.');
  const seen = new Set();
  const result = [];
  const errors = [];
  for (const item of rows) {
    const cells = item.row || [];
    const get = key => index[key] < 0 ? '' : String(cells[index[key]] ?? '').trim();
    const team_name = get('team_name');
    const registration_number = get('registration_number');
    let competition_code = index.competition_code < 0 ? filenameCompetition : get('competition_code').toUpperCase().replace(/[\s-]+/g, '_');
    const aliasesToCode = { TECH_LIFT: 'TECHLIFT', DATA_QUEST: 'DATAQUEST', AINEXUS: 'AI_NEXUS', AI_NEXUS: 'AI_NEXUS', 'AI NEXUS': 'AI_NEXUS' };
    competition_code = aliasesToCode[competition_code] || competition_code;
    if (!team_name && !registration_number) continue;
    if (!team_name) { errors.push(`Row ${item.rowNumber}: Team Name is blank.`); continue; }
    if (!registration_number) { errors.push(`Row ${item.rowNumber}: Ticket ID/Registration Number is blank.`); continue; }
    if (!['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(competition_code)) {
      errors.push(`Row ${item.rowNumber}: unknown competition “${competition_code}”. Use TECHLIFT, DATAQUEST, or AI_NEXUS.`);
      continue;
    }
    const key = `${competition_code}::${registration_number.toLowerCase()}`;
    if (seen.has(key)) { errors.push(`Row ${item.rowNumber}: duplicate registration number “${registration_number}” in ${competition_code}.`); continue; }
    seen.add(key);
    result.push({
      competition_code,
      team_name,
      registration_number,
      members: parseMembers(get('members'), item.rowNumber),
      status: get('status') || 'registered'
    });
  }
  if (errors.length) {
    const shown = errors.slice(0, 8).join(' ');
    throw new Error(`Found ${errors.length} invalid row(s). ${shown}${errors.length > 8 ? ` And ${errors.length - 8} more.` : ''}`);
  }
  if (!result.length) throw new Error('No valid team records were found below the detected header row.');
  return result;
}
async function parseTeamFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('File exceeds the 5 MB limit. Please split the spreadsheet into smaller files.');
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'csv') {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const matrix = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = !quoted;
      else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); cell = ''; if (row.some(v => v !== '')) matrix.push(row); row = []; }
      else cell += c;
    }
    row.push(cell.trim()); if (row.some(v => v !== '')) matrix.push(row);
    return rowsToTeams(matrix, file.name);
  }
  if (['xlsx','xls'].includes(ext)) {
    if (!window.XLSX) throw new Error('Excel reader did not load. Check your internet connection and reload the page.');
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: false });
    if (!workbook.SheetNames?.length) throw new Error('The workbook has no readable worksheet.');
    // Search every worksheet and use the first one that contains recognizable team headers.
    // This avoids failing when a workbook has an introductory/instructions sheet first.
    const failures = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
      try {
        const teams = rowsToTeams(matrix, file.name);
        return teams;
      } catch (error) {
        failures.push(`${sheetName}: ${error.message}`);
      }
    }
    throw new Error(`Could not import teams from any worksheet. ${failures.join(' | ')}`);
  }
  throw new Error('Unsupported file type. Choose .csv, .xlsx, or .xls.');
}

function renderPresidentTools(profile, form) {
  const panel = makeEl('section', 'admin-tools');
  panel.append(makeEl('h3', '', 'President management console'));
  panel.append(makeEl('p', 'resource-intro', 'Register spot teams, monitor live scores, and manage competition stages.'));
  renderSpotRegistration(profile,panel);
  renderProjectorScoreboard(profile,panel);
  renderQualificationConsole(profile,panel);

  const overview = makeEl('section', 'admin-panel');
  overview.append(makeEl('h4', '', 'Competitions and stages'));
  const refresh = makeEl('button', 'btn btn-outline', 'Load / refresh overview'); refresh.type = 'button';
  const overviewText = makeEl('div', 'admin-data', 'Select refresh to load records allowed by your database policies.');
  refresh.addEventListener('click', async () => {
    overviewText.textContent = 'Loading…';
    const [comps, stages, teams] = await Promise.all([
      supabaseClient.from('competitions').select('code,name,year_group,event_date').order('code'),
      supabaseClient.from('stages').select('competition_code,stage_number,name,starts_at,ends_at').order('competition_code').order('stage_number'),
      supabaseClient.from('teams').select('id,competition_code,team_name,registration_number,status').order('competition_code').order('team_name')
    ]);
    const errors = [comps, stages, teams].filter(r=>r.error).map(r=>r.error.message);
    overviewText.replaceChildren();
    if (errors.length) overviewText.append(makeEl('p', 'resource-error', 'Some records could not be loaded: ' + errors.join(' · ') + '. Check RLS policies.'));
    const date=(v,opts)=>v&&!isNaN(new Date(v).getTime())?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',...opts}).format(new Date(v)):'Not scheduled';
    overviewText.append(makeEl('p','resource-intro','Schedules in Indian Standard Time (IST). Open an event to view its rounds and teams.'));
    (comps.data||[]).sort((a,b)=>Number(a.year_group)-Number(b.year_group)).forEach(c=>{
      const card=makeEl('details','overview-event');
      const eventTeams=(teams.data||[]).filter(t=>t.competition_code===c.code);
      const summary=makeEl('summary');summary.append(makeEl('strong','',({TECHLIFT:'TechLift',DATAQUEST:'DataQuest',AI_NEXUS:'AI Nexus'})[c.code]||c.name),makeEl('span','resource-intro','Year '+c.year_group+' / '+date(c.event_date,{day:'numeric',month:'short',year:'numeric'})+' / '+eventTeams.length+' teams'));card.append(summary);
      const schedule=makeEl('div','overview-schedule');
      (stages.data||[]).filter(st=>st.competition_code===c.code).sort((a,b)=>a.stage_number-b.stage_number).forEach(st=>{const row=makeEl('div','overview-round');row.append(makeEl('span','section-kicker','ROUND '+st.stage_number),makeEl('strong','',st.name),makeEl('span','overview-time',date(st.starts_at,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})+' / '+date(st.ends_at,{hour:'numeric',minute:'2-digit'})));schedule.append(row);});card.append(schedule);
      const roster=makeEl('details','overview-roster');roster.append(makeEl('summary','','Registered teams ('+eventTeams.length+')'));
      eventTeams.forEach(t=>{const row=makeEl('div','overview-team');row.append(makeEl('strong','',t.team_name),makeEl('code','',t.registration_number),makeEl('span','',t.status));roster.append(row);});card.append(roster);overviewText.append(card);
    });
  });
  overview.append(refresh, overviewText);
  panel.append(overview);
  const accounts=makeEl('section','admin-panel');accounts.append(makeEl('h4','','Create officer account'));
  accounts.append(makeEl('p','resource-intro','Officers sign in with email and password. Teams sign in with their registration ticket IDs.'));
  const controls={};
  [['email','Account email','email'],['full_name','Team / officer display name','text'],['password','Initial password (12–128 characters)','password']].forEach(([key,text,type])=>{const label=makeEl('label','',text),input=makeEl('input','quiz-title-input');input.type=type;input.autocomplete=type==='password'?'new-password':'off';input.maxLength=key==='full_name'?160:key==='email'?254:128;label.append(input);accounts.append(label);controls[key]=input;});
  const role=makeEl('select','quiz-type-select'),competition=makeEl('select','quiz-type-select');
  [['officer','Officer']].forEach(([value,text])=>{const o=makeEl('option','',text);o.value=value;role.append(o);});
  ['TECHLIFT','DATAQUEST','AI_NEXUS'].forEach(code=>{const o=makeEl('option','',code);o.value=code;competition.append(o);});
  role.setAttribute('aria-label','Account role');competition.setAttribute('aria-label','Assigned competition');
  const create=makeEl('button','btn btn-primary','Create account');create.type='button';const state=makeEl('p','resource-intro','');
  create.addEventListener('click',async()=>{if(!controls.email.checkValidity()||!controls.email.value||!controls.full_name.value.trim()||controls.password.value.length<12){state.textContent='Enter a valid email, display name, and password of at least 12 characters.';return;}create.disabled=true;state.textContent='Creating account…';try{const result=await invokeIkarusFunction('manage-accounts',{email:controls.email.value.trim(),password:controls.password.value,full_name:controls.full_name.value.trim(),role:role.value,competition_code:competition.value});state.textContent=`Account created (${result.user_id}). The assigned login can now sign in.`;controls.password.value='';}catch(e){state.textContent=e.message;}finally{create.disabled=false;}});
  accounts.append(role,competition,create,state);panel.append(accounts);
  form.append(panel);
}

// Private references are available only to organizers; questions are managed directly.
function renderSpotRegistration(profile,host){
  const box=makeEl('section','admin-panel');box.append(makeEl('h4','','Spot registration'));
  const nameLabel=makeEl('label','','Team name'),name=makeEl('input','quiz-title-input');name.maxLength=160;nameLabel.append(name);
  const compLabel=makeEl('label','','Competition'),comp=makeEl('select','quiz-type-select');[['TECHLIFT','TechLift · Year 1'],['DATAQUEST','DataQuest · Year 2'],['AI_NEXUS','AI Nexus · Year 3']].forEach(([value,label])=>{const o=makeEl('option','',label);o.value=value;comp.append(o);});compLabel.append(comp);
  const memberLabel=makeEl('label','','Member / lead names (separate with semicolons)'),members=makeEl('input','quiz-title-input');members.maxLength=1600;memberLabel.append(members);
  const create=makeEl('button','btn btn-primary','Register team & generate ticket');create.type='button';const result=makeEl('div','spot-registration-result');
  create.addEventListener('click',async()=>{if(!name.value.trim()){result.textContent='Enter a team name.';return;}create.disabled=true;result.textContent='Registering team…';try{const data=await invokeIkarusFunction('manage-accounts',{action:'create_team',team_name:name.value.trim(),competition_code:comp.value,members:members.value.split(';').map(x=>x.trim()).filter(Boolean)});result.replaceChildren(makeEl('h4','',data.team.team_name),makeEl('p','',data.team.competition_code.replace('_',' ')),makeEl('code','spot-ticket',data.team.ticket_id),makeEl('p','resource-intro','Give this ticket ID to the team. They can use Team portal, confirm their team name, and continue.'));const copy=makeEl('button','btn btn-outline','Copy ticket ID');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(data.team.ticket_id);copy.textContent='Copied';}catch{copy.textContent='Select and copy the ticket ID above';}});result.append(copy);name.value='';members.value='';}catch(e){result.textContent=e.message;}finally{create.disabled=false;}});
  box.append(nameLabel,compLabel,memberLabel,create,result);host.append(box);
}
function exitProjector(){if(!activeProjector)return;activeProjector.classList.remove('is-projecting');activeProjector=null;if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});}
function motionAllowed(){return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
function celebrate(host){
  if(!motionAllowed())return;
  const layer=makeEl('div','celebration-particles');layer.setAttribute('aria-hidden','true');
  for(let i=0;i<36;i++){const part=makeEl('i');part.style.setProperty('--x',`${(i*37)%100}%`);part.style.setProperty('--delay',`${(i%9)*.05}s`);part.style.setProperty('--spin',`${i*43}deg`);part.style.background=['#ffc83d','#b994ff','#73e7cb','#ff8aa7'][i%4];layer.append(part);}host.append(layer);setTimeout(()=>layer.remove(),3200);
}
function renderAnimatedScores(host,data){
  const prior=new Map([...host.querySelectorAll('tr[data-team]')].map(row=>[row.dataset.team,{row,top:row.getBoundingClientRect?.().top||0,score:row.dataset.score}]));
  let table=host.querySelector('table');
  if(!table){table=makeEl('table','scoreboard-table');const head=makeEl('thead'),tr=makeEl('tr');['Rank','Team','Round 1','Round 2','Round 3','Total','Status'].forEach(label=>tr.append(makeEl('th','',label)));head.append(tr);table.append(head,makeEl('tbody'));host.append(table);}
  const body=table.querySelector('tbody'),keep=new Set();
  data.rows.forEach((team,i)=>{
    const key=team.team_key||team.team_name,old=prior.get(key),row=old?.row||makeEl('tr');keep.add(key);row.dataset.team=key;row.dataset.score=String(team.score);row.className=team.is_winner?'winner-row':team.rank&&team.rank<=3?`podium-row podium-${team.rank}`:'';row.style.setProperty('--entry-delay',`${Math.min(i,12)*45}ms`);
    const values=[team.rank===null?'—':`#${team.rank}`,team.team_name,...['Stage 1','Stage 2','Stage 3'].map(round=>Object.hasOwn(team.round_scores,round)?team.round_scores[round]===null?'Judging':String(team.round_scores[round]):'—'),team.has_score?`${team.score} / ${data.max_score}`:'—',team.is_winner?'★ WINNER':team.qualified===true?'FINALIST · '+team.status:team.status];
    row.replaceChildren();values.forEach(value=>row.append(makeEl('td','',value)));body.append(row);
    if(!old)row.classList.add('score-enter');else if(old.score!==String(team.score))row.classList.add('score-updated');
  });
  prior.forEach((old,key)=>{if(!keep.has(key))old.row.remove();});
  if(motionAllowed())prior.forEach(old=>{if(!old.row.isConnected||!old.row.animate)return;const delta=old.top-old.row.getBoundingClientRect().top;if(delta)old.row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.22,1,.36,1)'});});
}
function renderQualificationConsole(profile,host){
  const panel=makeEl('section','qualification-console admin-panel');panel.append(makeEl('span','section-kicker','THE ROAD TO THE FINAL'),makeEl('h3','','Top 5 qualification & winner'));
  panel.append(makeEl('p','resource-intro','Round 1 + Round 2 scores select up to five finalists. Equal totals use faster combined submission time. Only confirmed finalists can enter Round 3. The highest Round 3 score determines the winner.'));
  const comp=makeEl('select','quiz-type-select');[['TECHLIFT','TechLift · Year 1'],['DATAQUEST','DataQuest · Year 2'],['AI_NEXUS','AI Nexus · Year 3']].forEach(([v,label])=>{const o=makeEl('option','',label);o.value=v;comp.append(o);});comp.setAttribute('aria-label','Qualification competition');const refresh=makeEl('button','btn btn-outline','Refresh qualification');refresh.type='button';
  const state=makeEl('p','resource-intro','Loading qualification…'),content=makeEl('div');panel.append(comp,refresh,state,content);host.append(panel);
  let previewVersion=0;
  const load=async()=>{const request=++previewVersion,competition=comp.value;refresh.disabled=true;content.replaceChildren();state.textContent='Loading qualification?';try{
    const data=await invokeIkarusFunction('manage-qualification',{action:'preview',competition_code:competition});if(request!==previewVersion||!panel.isConnected)return;content.replaceChildren();state.textContent=data.promotion?`${data.promotion.finalists.length} finalists confirmed. Preliminary scores are locked.`:data.preliminary.blocking||`${data.preliminary.candidates.length} team(s) have completed both preliminary rounds.`;
    const candidates=data.promotion?.finalists||data.preliminary.candidates,table=makeEl('table','scoreboard-table'),body=makeEl('tbody');candidates.forEach(c=>{const row=makeEl('tr');[c.team_name,`${c.score} points`,`${(c.elapsed_ms/1000).toFixed(2)} seconds`].forEach(value=>row.append(makeEl('td','',value)));body.append(row);});table.append(body);content.append(table);
    if(!data.promotion){
      const selected=[];
      if(data.preliminary.tie?.length){content.append(makeEl('p','resource-warning',`Exact score and time tie: select ${data.preliminary.tie_slots} team(s) after judging review.`));data.preliminary.tie.forEach(c=>{const label=makeEl('label','qualification-tie'),input=makeEl('input');input.type='checkbox';input.addEventListener('change',()=>{const i=selected.indexOf(c.identity);if(input.checked&&i<0)selected.push(c.identity);else if(!input.checked&&i>=0)selected.splice(i,1);});label.append(input,document.createTextNode(c.team_name));content.append(label);});}
      const checkLabel=makeEl('label','qualification-tie'),check=makeEl('input');check.type='checkbox';checkLabel.append(check,document.createTextNode(' Preliminary judging is complete. Teams missing either round will not qualify; confirming closes Rounds 1 and 2.'));
      const confirm=makeEl('button','btn btn-primary','Confirm top 5 & unlock Round 3');confirm.type='button';confirm.disabled=!!data.preliminary.blocking||!data.preliminary.candidates.length;
      confirm.addEventListener('click',async()=>{if(!check.checked){state.textContent='Confirm that preliminary judging is complete first.';return;}confirm.disabled=true;try{await invokeIkarusFunction('manage-qualification',{action:'finalists',competition_code:competition,version:data.preliminary.version,tie_ids:selected});await load();}catch(e){state.textContent=e.message;confirm.disabled=false;}});content.append(checkLabel,confirm);
    }else if(data.winner){const card=makeEl('div','winner-banner');card.append(makeEl('span','winner-crown','★'),makeEl('span','section-kicker','ROUND 3 CHAMPION'),makeEl('h3','',data.winner.winner.team_name),makeEl('p','',`${data.winner.winner.score} points in Round 3`));content.append(card);}
    else{
      content.append(makeEl('h4','','Round 3 winner'),makeEl('p','resource-intro',data.final.blocking||`${data.final.candidates.length} graded finalist(s). The highest Round 3 score wins.`));
      const leaders=data.final.candidates.filter(c=>c.score===data.final.candidates[0]?.score),winnerSelect=makeEl('select','quiz-type-select');leaders.forEach(c=>{const o=makeEl('option','',`${c.team_name} · ${c.score} points`);o.value=c.identity;winnerSelect.append(o);});
      if(leaders.length>1)content.append(makeEl('p','resource-warning','The highest Round 3 score is tied. Select the winner after judging review.'));content.append(winnerSelect);
      const label=makeEl('label','qualification-tie'),check=makeEl('input');check.type='checkbox';label.append(check,document.createTextNode(' Final judging is complete. Absent finalists will not be considered; declaring the winner locks Round 3 scores.'));
      const declare=makeEl('button','btn btn-primary','Declare Round 3 winner');declare.type='button';declare.disabled=!!data.final.blocking||!leaders.length;declare.addEventListener('click',async()=>{if(!check.checked){state.textContent='Confirm final judging is complete first.';return;}declare.disabled=true;try{await invokeIkarusFunction('manage-qualification',{action:'winner',competition_code:competition,version:data.final.version,winner_id:winnerSelect.value,judging_complete:true});await load();celebrate(panel);}catch(e){state.textContent=e.message;declare.disabled=false;}});content.append(label,declare);
    }
  }catch(e){if(request===previewVersion)state.textContent=e.message;}finally{if(request===previewVersion)refresh.disabled=false;}};comp.addEventListener('change',load);refresh.addEventListener('click',load);load();
}
function renderProjectorScoreboard(profile,host){
  const board=makeEl('section','projector-board');const heading=makeEl('div','projector-heading');heading.append(makeEl('span','section-kicker','IKARUS 2026'),makeEl('h2','','Live competition scoreboard'));
  const controls=makeEl('div','projector-controls'),comp=makeEl('select','quiz-type-select'),stage=makeEl('select','quiz-type-select');
  [['TECHLIFT','TechLift · Year 1'],['DATAQUEST','DataQuest · Year 2'],['AI_NEXUS','AI Nexus · Year 3']].forEach(([value,label])=>{const o=makeEl('option','',label);o.value=value;comp.append(o);});
  [['','All-round points'],['qualification','Qualification - Rounds 1 + 2'],['Stage 1','Round 1'],['Stage 2','Round 2'],['Stage 3','Round 3']].forEach(([value,label])=>{const o=makeEl('option','',label);o.value=value;stage.append(o);});comp.setAttribute('aria-label','Scoreboard competition');stage.setAttribute('aria-label','Scoreboard round');
  const refresh=makeEl('button','btn btn-outline','Refresh'),project=makeEl('button','btn btn-primary','Projector fullscreen'),exit=makeEl('button','btn btn-outline','Exit projector');refresh.type=project.type=exit.type='button';exit.classList.add('exit-projector');
  controls.append(stage,refresh,project,exit);const state=makeEl('p','resource-intro','Loading live scores…'),rows=makeEl('div','scoreboard-table-wrap');
  const eventTabs=makeEl('div','event-tabs');eventTabs.setAttribute('role','tablist');eventTabs.setAttribute('aria-label','Competition leaderboards');
  [['TECHLIFT','TechLift','Year 1','techlift-logo.png'],['DATAQUEST','DataQuest','Year 2','dataquest-logo.png'],['AI_NEXUS','AI Nexus','Year 3','ai-nexus-logo.png']].forEach(([value,title,year,asset],index)=>{const tab=makeEl('button','event-tab');tab.type='button';tab.dataset.event=value;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(index===0));const logo=makeEl('img');logo.src='assets/'+asset;logo.alt='';const text=makeEl('span');text.append(makeEl('strong','',title),makeEl('small','',year));tab.append(logo,text);tab.addEventListener('click',()=>{comp.value=value;rows.replaceChildren();winnerHero.hidden=true;shownWinner=null;state.textContent='Loading '+title+' teams?';eventTabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-selected',String(button===tab)));load(true);});eventTabs.append(tab);});
  board.append(heading,eventTabs,controls,makeEl('p','scoreboard-note','Round 1 + Round 2 determine the five finalists. The highest Round 3 score determines the winner.'),state,rows);host.append(board);
  const winnerHero=makeEl('div','winner-banner');winnerHero.hidden=true;board.insertBefore(winnerHero,state);
  let busy=false,version=0,shownWinner=null;
  const load=async(force=false)=>{if(busy&&!force)return;busy=true;const request=++version;try{const data=await invokeIkarusFunction('live-scoreboard',{competition_code:comp.value,stage_name:stage.value||null});if(request!==version||!board.isConnected)return;renderAnimatedScores(rows,data);if(data.winner){winnerHero.hidden=false;winnerHero.replaceChildren(makeEl('span','winner-crown','\u2605'),makeEl('span','section-kicker','ROUND 3 CHAMPION'),makeEl('h3','',data.winner.team_name),makeEl('p','',`${data.winner.score} points - Competition winner`));if(shownWinner!==data.winner.identity){shownWinner=data.winner.identity;celebrate(board);}}else winnerHero.hidden=true;state.textContent=`${data.competition_code.replace('_',' ')} · ${data.stage_name} · ${data.rows.length} teams · Updated ${new Date(data.updated_at).toLocaleTimeString()} · Refreshes every 10 seconds`;}catch(e){if(request===version)state.textContent=`Scoreboard update failed: ${e.message}`;}finally{if(request===version)busy=false;}};
  comp.addEventListener('change',()=>load(true));stage.addEventListener('change',()=>load(true));refresh.addEventListener('click',()=>load(true));
  project.addEventListener('click',async()=>{activeProjector=board;board.classList.add('is-projecting');if(board.requestFullscreen)try{await board.requestFullscreen();}catch{}});exit.addEventListener('click',exitProjector);
  const fullscreenChange=()=>{if(activeProjector===board&&!document.fullscreenElement){board.classList.remove('is-projecting');activeProjector=null;}};
  document.addEventListener('fullscreenchange',fullscreenChange);
  const poll=setInterval(()=>{if(!board.isConnected){clearInterval(poll);document.removeEventListener('fullscreenchange',fullscreenChange);return;}load();},10000);load();
}

function describeStorageError(error, item) {
  const raw = String(error?.message || error || 'Unknown Storage error');
  const lower = raw.toLowerCase();
  if (lower.includes('object not found') || lower.includes('not found') || lower.includes('404')) {
    return `PDF not found in private bucket “competition-materials”. Expected object path: ${item.path}. The uploaded file may be at the bucket root or under a different folder. Upload/move it to the expected path, then retry. This is a Storage path issue—not an OCR issue.`;
  }
  if (lower.includes('unauthorized') || lower.includes('permission') || lower.includes('row-level') || lower.includes('403')) {
    return `Supabase Storage denied access to ${item.path}. Check the signed-in user's competition role and Storage RLS SELECT policy for bucket “competition-materials”. Original error: ${raw}`;
  }
  if (lower.includes('bucket') && (lower.includes('not found') || lower.includes('does not exist'))) {
    return `Supabase bucket “competition-materials” does not exist or is named differently. Create/verify this private bucket. Original error: ${raw}`;
  }
  if (lower.includes('jwt') || lower.includes('token') || lower.includes('auth')) {
    return `Your Supabase session may have expired or is not authorized to access this PDF. Sign out, sign in again, and verify the Storage RLS policy. Original error: ${raw}`;
  }
  return `Could not create a secure link for ${item.path}. Check the private bucket, object path, network, and Storage RLS policy. Original error: ${raw}`;
}

async function createPrivatePdfSignedUrl(item, expiresInSeconds) {
  const storage = supabaseClient.storage.from('competition-materials');
  const { data, error } = await storage.createSignedUrl(item.path, expiresInSeconds);
  if (error) {
    const wrapped = new Error(describeStorageError(error, item));
    wrapped.cause = error;
    throw wrapped;
  }
  if (!data?.signedUrl) throw new Error(`Supabase did not return a signed URL for ${item.path}. Check Storage configuration and permissions.`);
  return data;
}

function renderQuizReview(profile, material, questions, extractionMeta, host, existing = null) {
  host.replaceChildren();
  const box = makeEl('section', 'quiz-review-panel');
  box.append(makeEl('h4', '', `Stage editor · ${material.competition} · ${material.stage}`));
  box.append(makeEl('p', 'resource-intro', `Review all question text, choices, answer keys, marks and schedule before publishing.`));
  const objectiveQuestions=questions.filter(q=>!['subjective','code','activity'].includes(q.type));
  if(objectiveQuestions.some(q=>!String(q.correct_answer||'').trim()))box.append(makeEl('p','resource-warning','Enter and verify the correct answer for every objective question before publishing.'));
  else box.append(makeEl('p','resource-intro',objectiveQuestions.length?'Objective answer keys are entered. Review them before publishing.':'Manually judged round. Reference answers and rubrics guide the judges; automatic scoring is not used.'));
  if(existing?.quiz_payload?.organizer_reference){const reference=makeEl('details','judge-reference');reference.append(makeEl('summary','','Organizer answer guide and judging rubric'),makeEl('pre','submission-answer',existing.quiz_payload.organizer_reference));box.append(reference);}
  const titleLabel = makeEl('label', '', 'Quiz title');
  const titleInput = makeEl('input', 'quiz-title-input'); titleInput.value = `${material.competition} · ${material.stage}`; titleInput.maxLength = 160;
  titleLabel.append(titleInput); box.append(titleLabel);
  const durationLabel = makeEl('label', '', 'Duration (minutes)');
  const duration = makeEl('input', 'quiz-title-input'); duration.type = 'number'; duration.min = '1'; duration.max = '240'; duration.value = material.competition === 'DATAQUEST' ? '20' : '25'; durationLabel.append(duration); box.append(durationLabel);
  titleInput.value = existing?.title || material.title || titleInput.value;
  duration.value = String(existing?.duration_minutes || duration.value);
  const localDate = value => { if(!value)return ''; const d=new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
  const schedule = makeEl('div','quiz-actions');
  const opensAt = makeEl('input','quiz-title-input'); opensAt.type='datetime-local'; opensAt.value=localDate(existing?.opens_at);
  const closesAt = makeEl('input','quiz-title-input'); closesAt.type='datetime-local'; closesAt.value=localDate(existing?.closes_at);
  [['Opens (your local time)',opensAt],['Closes (your local time)',closesAt]].forEach(([text,input])=>{const label=makeEl('label','',text);label.append(input);schedule.append(label);});
  box.append(schedule);
  let draftId=existing?.id || null;
  const list = makeEl('div', 'quiz-question-list');
  const appendQuestion = (q, idx) => {
    const card = makeEl('article', 'quiz-question-editor');
    card.append(makeEl('h5', '', `Question ${idx + 1} (source number ${q.number})`));
    const qText = makeEl('textarea', 'quiz-edit-text'); qText.value = q.text; qText.rows = 3; qText.setAttribute('aria-label', `Question ${idx+1} text`); card.append(qText);
    const typeSelect = makeEl('select', 'quiz-type-select');
    [['mcq','Multiple choice'],['true_false','True / False'],['subjective','Written response / manual evaluation'],['code','Coding challenge / manual judging'],['activity','Tech activity submission / manual judging']].forEach(([v,l])=>{ const o=makeEl('option','',l); o.value=v; typeSelect.append(o); });
    typeSelect.value = q.type; card.append(typeSelect);
    const optionsBox = makeEl('div','quiz-option-editor');
    const optionInputs = [];
    const initialOptions = q.options?.length ? q.options : (q.type==='true_false' ? [{label:'A',text:'True'},{label:'B',text:'False'}] : []);
    initialOptions.forEach((opt,j)=>{ const inp=makeEl('input','quiz-title-input'); inp.value=opt.text; inp.placeholder=`Option ${String.fromCharCode(65+j)}`; inp.dataset.label=String.fromCharCode(65+j); optionInputs.push(inp); optionsBox.append(inp); });
    const addOption = makeEl('button','btn btn-outline','+ Add option'); addOption.type='button';
    addOption.addEventListener('click',()=>{ if(optionInputs.length>=8)return; const inp=makeEl('input','quiz-title-input'); inp.placeholder=`Option ${String.fromCharCode(65+optionInputs.length)}`; inp.dataset.label=String.fromCharCode(65+optionInputs.length); optionInputs.push(inp); optionsBox.insertBefore(inp,addOption); });
    optionsBox.append(addOption); card.append(optionsBox);
    const correctLabel=makeEl('label','',['subjective','code','activity'].includes(q.type)?'Judge reference answer or rubric':'Correct answer (option letter or True/False)'); const correct=makeEl('textarea','quiz-edit-text'); correct.rows=3;correct.value=q.correct_answer||''; correct.placeholder='Leave blank until verified'; correctLabel.append(correct); card.append(correctLabel);
    const marksLabel=makeEl('label','','Marks'); const marks=makeEl('input','quiz-title-input'); marks.type='number'; marks.min='0'; marks.max='10000'; marks.step='0.25'; marks.value=String(q.marks??1); marksLabel.append(marks); card.append(marksLabel);
    if(q.warning) card.append(makeEl('p','resource-warning',q.warning));
    const remove=makeEl('button','btn btn-outline','Remove question'); remove.type='button'; remove.addEventListener('click',()=>card.remove()); card.append(remove);
    card.dataset.questionIndex=String(idx); card._questionControls={qText,typeSelect,optionInputs,correct,marks,original:q}; list.append(card);
  };
  questions.forEach(appendQuestion);
  box.append(list);
  const addQuestion=makeEl('button','btn btn-outline','+ Add question');addQuestion.type='button';
  addQuestion.addEventListener('click',()=>appendQuestion({text:'',type:'mcq',options:[{text:''},{text:''}],marks:1},list.children.length));box.append(addQuestion);
  const status=makeEl('p','resource-intro','Review all extracted content before saving. Drafts are stored in Supabase only after the database migration is applied.');
  const save=makeEl('button','btn btn-primary','Save Draft'); save.type='button';
  const publish=makeEl('button','btn btn-outline','Publish Quiz'); publish.type='button';
  const actions=makeEl('div','quiz-actions'); actions.append(save);if(profile.role==='president')actions.append(publish);else box.append(makeEl('p','resource-intro','Save your draft for review. Only the President can publish and unlock this round.')); box.append(status,actions);
  const gather=()=>[...list.querySelectorAll('.quiz-question-editor')].map((el,i)=>{ const c=el._questionControls; return {...c.original,position:i+1,source_number:Number(el.dataset.questionIndex)+1,text:c.qText.value.trim(),type:c.typeSelect.value,options:c.optionInputs.map((input,j)=>({label:String.fromCharCode(65+j),text:input.value.trim()})).filter(o=>o.text),correct_answer:c.correct.value.trim(),marks:Number(c.marks.value)}; });
  const persist=async publishNow=>{
    if(publishNow&&profile.role!=='president'){status.textContent='Only the President can publish rounds.';return;}
    const qs=gather();
    if(!titleInput.value.trim() || !Number.isInteger(Number(duration.value)) || Number(duration.value)<1 || Number(duration.value)>240){status.textContent='Enter a title and a whole-number duration from 1 to 240 minutes.';return;}
    if(!qs.length) {status.textContent='Cannot save an empty quiz.';return;}
    if(qs.some(q=>!q.text||!Number.isFinite(q.marks)||q.marks<0)){status.textContent='Each question needs text and valid non-negative marks.';return;}
    if(publishNow && qs.some(q=>!['subjective','code','activity'].includes(q.type) && !q.correct_answer)){status.textContent='Publishing blocked: enter and verify every objective answer first.';return;}
    if(publishNow && qs.some(q=>q.type==='mcq' && (!q.options || q.options.length < 2))) { status.textContent='Each multiple-choice question needs at least two options before publishing.'; return; }
    save.disabled=publish.disabled=true; status.textContent='Saving draft…';
    try {
      if((opensAt.value&&!closesAt.value)||(!opensAt.value&&closesAt.value)){status.textContent='Set both opening and closing times, or leave both blank.';return;}
      if(opensAt.value&&closesAt.value&&new Date(closesAt.value)<=new Date(opensAt.value)){status.textContent='Closing time must be later than opening time.';return;}
      const openIso=opensAt.value?new Date(opensAt.value).toISOString():null;
      const closeIso=closesAt.value?new Date(closesAt.value).toISOString():null;
      const payload={...existing?.quiz_payload,title:titleInput.value.trim(),competition_code:material.competition,stage_name:material.stage,source_pdf:material.path,duration_minutes:Number(duration.value),opens_at:openIso,closes_at:closeIso,questions:qs,answer_key_verified:publishNow||existing?.quiz_payload?.answer_key_verified===true,extraction:{page_count:extractionMeta.pageCount,pages_with_text:extractionMeta.pagesWithText,answer_key_found:objectiveQuestions.length?qs.filter(q=>!['subjective','code','activity'].includes(q.type)).every(q=>!!q.correct_answer):false}};
      const values={title:payload.title,stage_name:material.stage,duration_minutes:payload.duration_minutes,opens_at:openIso,closes_at:closeIso,quiz_payload:payload,updated_at:new Date().toISOString()};
      const query=draftId ? supabaseClient.from('quiz_drafts').update(values).eq('id',draftId).eq('status','draft') : supabaseClient.from('quiz_drafts').insert({...values,competition_code:material.competition,source_path:material.path,status:'draft',created_by:profile.id,published_at:null});
      const {data,error}=await query.select('id').single();
      if(error) throw error;
      draftId=data.id;
      if (publishNow) {
        status.textContent='Draft saved. Publishing securely…';
        const publishResult=await invokeIkarusFunction('publish-quiz',{quiz_id:data.id});
        if(!publishResult?.success) throw new Error(`Draft saved as ${data.id}, but publishing was not confirmed: ${publishResult?.error||'unknown server response'}`);
        status.textContent=`Quiz published securely (ID ${data.id}). Student delivery must use the get-published-quiz function; answer keys are not returned by that endpoint.`;
        box.querySelectorAll('input,textarea,select,button').forEach(control=>control.disabled=true);
      } else {
        status.textContent=`Draft saved in Supabase (quiz ID ${data.id}). It remains unpublished and can be reviewed before publishing.`;
      }
    } catch(e) { status.textContent=`${e.message}. If this is a missing-table error, apply quiz-engine-migration.sql in the correct Supabase project, then reload the schema cache and refresh this page.`; }
    finally {if(!box.querySelector('input:disabled'))save.disabled=publish.disabled=false;}
  };
  save.addEventListener('click',()=>persist(false)); publish.addEventListener('click',()=>persist(true));
  host.append(box);
}

function workspaceQuestions(payload) {
  const fields=payload.workspace||{};
  const allowed=['language','problem_statement','constraints','sample_tests','starter_code','challenge_brief','deliverables','evaluation_rubric','presentation_format','challenge_statement','dataset_requirements','analysis_tasks','case_brief','investigation_tasks','evidence_and_rubric'];
  const text=allowed.filter(key=>fields[key]).map(key=>`${key.replaceAll('_',' ').toUpperCase()}\n${fields[key]}`).join('\n\n') || payload.source_content || '';
  return [{position:1,text,type:payload.document_type==='coding_environment'?'code':'activity',options:[],correct_answer:'',marks:100}];
}

function renderDraftManager(profile, host) {
  const panel=makeEl('section','admin-panel round-manager');
  const header=makeEl('div','round-manager-header');header.append(makeEl('div','', 'Competition rounds'));
  const refresh=makeEl('button','btn btn-outline','Refresh rounds');refresh.type='button';header.append(refresh);
  panel.append(header,makeEl('p','resource-intro','Choose an event to manage its rounds. Only the President can publish and unlock a round.'));
  const events=[['TECHLIFT','TechLift','Year 1','techlift-logo.png'],['DATAQUEST','DataQuest','Year 2','dataquest-logo.png'],['AI_NEXUS','AI Nexus','Year 3','ai-nexus-logo.png']].filter(([code])=>profile.role==='president'||profile.competition_code===code);
  let selected=events[0]?.[0],drafts=[];
  const tabs=makeEl('div','event-tabs round-event-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Competition rounds');
  const state=makeEl('p','resource-intro','Loading rounds...'),list=makeEl('div','draft-list'),editor=makeEl('div','quiz-review-host');
  list.setAttribute('role','tabpanel');list.id='roundManagerList';
  const meta={pageCount:0,pagesWithText:0,answerKeyFound:false};
  const edit=draft=>{
    const questions=draft.quiz_payload?.questions||workspaceQuestions(draft.quiz_payload||{});
    renderQuizReview(profile,{competition:draft.competition_code,stage:draft.stage_name,path:draft.source_path,title:draft.title},questions,draft.quiz_payload?.extraction?{...meta,pageCount:draft.quiz_payload.extraction.page_count||0,pagesWithText:draft.quiz_payload.extraction.pages_with_text||0}:meta,editor,draft);
  };
  const draw=()=>{
    list.replaceChildren();const visible=drafts.filter(d=>d.competition_code===selected&&['draft','published'].includes(d.status)).sort((a,b)=>(Number(a.stage_name.match(/\d+/)?.[0])||99)-(Number(b.stage_name.match(/\d+/)?.[0])||99)||a.title.localeCompare(b.title));
    const published=visible.filter(d=>d.status==='published').length;state.textContent=visible.length+' rounds / '+published+' published / '+(visible.length-published)+' awaiting publication';
    if(!visible.length)list.append(makeEl('p','resource-intro','No rounds saved for this event.'));
    visible.forEach(draft=>{
      const row=makeEl('article','round-manager-card');row.dataset.round=draft.stage_name;
      const number=draft.stage_name.match(/\d+/)?.[0];row.append(makeEl('span','round-number',number?number.padStart(2,'0'):'--'));
      const body=makeEl('div','round-card-body'),top=makeEl('div','round-card-heading');
      top.append(makeEl('span','section-kicker',number?'ROUND '+number:draft.stage_name),makeEl('span','round-publication '+(draft.status==='published'?'is-published':'is-draft'),draft.status==='published'?'Published':'Awaiting publication'));
      const title=draft.title.replace(/^.*?(?:Stage|Round)\s*\d+\s*[-—·:]\s*/i,'');
      body.append(top,makeEl('h4','',title));
      const questions=draft.quiz_payload?.questions||[],marks=questions.reduce((total,q)=>total+Number(q.marks||0),0);
      body.append(makeEl('p','round-card-meta',draft.duration_minutes+' minutes / '+questions.length+' questions or tasks / '+marks+' marks'));
      if(number==='3')body.append(makeEl('p','round-access-note','Only confirmed top-five finalists can enter.'));
      if(draft.quiz_payload?.organizer_notes)body.append(makeEl('p','resource-warning',draft.quiz_payload.organizer_notes));
      row.append(body);const actions=makeEl('div','round-card-actions');
      if(draft.status==='draft'){
        const open=makeEl('button','btn btn-outline','Edit draft');open.type='button';open.addEventListener('click',()=>edit(draft));actions.append(open);
        if(profile.role==='president'){
          const publish=makeEl('button','btn btn-primary','Publish round');publish.type='button';publish.setAttribute('aria-label','Publish '+draft.competition_code+' '+draft.stage_name);
          publish.addEventListener('click',async()=>{publish.disabled=true;state.textContent='Publishing '+draft.title+'...';try{await invokeIkarusFunction('publish-quiz',{quiz_id:draft.id});editor.replaceChildren();await load();}catch(e){state.textContent=e.message;publish.disabled=false;}});actions.append(publish);
        }
      }else actions.append(makeEl('span','round-live-label','Ready for eligible teams'));
      row.append(actions);list.append(row);
    });
  };
  events.forEach(([code,title,year,asset])=>{
    const tab=makeEl('button','event-tab');tab.type='button';tab.dataset.event=code;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(code===selected));tab.setAttribute('aria-controls',list.id);
    const logo=makeEl('img');logo.src='assets/'+asset;logo.alt='';const label=makeEl('span');label.append(makeEl('strong','',title),makeEl('small','',year));tab.append(logo,label);
    tab.addEventListener('click',()=>{selected=code;editor.replaceChildren();tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-selected',String(button===tab)));draw();});tabs.append(tab);
  });
  const tools=makeEl('details','new-round-tools');tools.append(makeEl('summary','','Create an additional draft'));
  const controls=makeEl('div','quiz-actions'),stage=makeEl('select','quiz-type-select');['Stage 1','Stage 2','Stage 3'].forEach(name=>{const option=makeEl('option','',name.replace('Stage','Round'));option.value=name;stage.append(option);});stage.setAttribute('aria-label','New draft round');
  const create=makeEl('button','btn btn-outline','Create draft');create.type='button';create.addEventListener('click',()=>renderQuizReview(profile,{competition:selected,stage:stage.value,path:'uploads/'+selected+'/manual-stage.pdf'},[{text:'',type:stage.value==='Stage 1'?'mcq':stage.value==='Stage 2'?'code':'activity',options:[],marks:stage.value==='Stage 1'?1:100}],meta,editor));controls.append(stage,create);tools.append(controls);
  const load=async()=>{refresh.disabled=true;try{const {data,error}=await supabaseClient.from('quiz_drafts').select('id,title,competition_code,stage_name,source_path,status,duration_minutes,opens_at,closes_at,quiz_payload').order('stage_name',{ascending:true});if(error)throw error;drafts=data||[];draw();}catch(e){state.textContent='Could not load rounds: '+e.message;}finally{refresh.disabled=false;}};
  refresh.addEventListener('click',load);panel.append(tabs,state,list,tools,editor);host.append(panel);load();
}


function organizeDashboard(form,heading,identity,note,logout){
  const tools=form.querySelector('.admin-tools');
  const sections=[];
  const add=(label,element)=>{if(element)sections.push({label,element});};
  add('Judging & results',form.querySelector('.results-console'));
  add('Competition rounds',form.querySelector('.round-manager'));
  add('Live scoreboard',form.querySelector('.projector-board'));
  if(tools){const panels=[...tools.children].filter(e=>e.classList.contains('admin-panel'));panels.forEach(element=>{const title=element.querySelector('h4,h3')?.textContent||'';add(/Spot registration/.test(title)?'Spot registration':/scoreboard/i.test(title)?'Live scoreboard':/qualification/i.test(title)?'Qualification & winner':/Competitions and stages/.test(title)?'Teams & schedules':/officer account/.test(title)?'Officer accounts':title,element);});}
  add('Private materials',form.querySelector('.resource-library'));
  const shell=makeEl('div','organizer-shell'),sidebar=makeEl('aside','organizer-sidebar');
  sidebar.append(makeEl('span','section-kicker','IKARUS 2026'),makeEl('h3','',activeProfile.role==='president'?'President console':'Officer console'),identity);
  const nav=makeEl('nav','organizer-nav');nav.setAttribute('aria-label','Dashboard sections');sidebar.append(nav,logout);
  const main=makeEl('main','organizer-main'),header=makeEl('header','organizer-header');
  const title=makeEl('h2','','Judging & results');header.append(makeEl('span','section-kicker','COMPETITION MANAGEMENT'),title);
  const body=makeEl('div','organizer-content');main.append(header,body);shell.append(sidebar,main);
  sections.forEach(({label,element},i)=>{element.classList.add('dashboard-page');element.hidden=i!==0;body.append(element);const button=makeEl('button','organizer-nav-item',label);button.type='button';button.setAttribute('aria-current',i===0?'page':'false');button.addEventListener('click',()=>{sections.forEach(s=>s.element.hidden=s.element!==element);[...nav.children].forEach(b=>b.setAttribute('aria-current',b===button?'page':'false'));title.textContent=label;main.scrollTop=0;});nav.append(button);});
  form.replaceChildren(shell);
}

function showDashboard(profile, email) {
  if(disposeAttempt)disposeAttempt();
  modal.classList.toggle('organizer-dashboard',['president','officer'].includes(profile.role));
  modal.classList.toggle('team-dashboard',['participant','team_member','team'].includes(profile.role));
  modal.classList.remove('team-ticket-screen');
  activeProfile = profile;
  activeEmail = email;
  document.querySelector('.modal-copy').textContent=['team','team_member','participant'].includes(profile.role)?'Your assigned competition, timed rounds, and results in one place.':'Manage your assigned event, review submissions, and follow the live standings.';
  const form = $('loginForm');
  form.onsubmit=null;
  form.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = titleForProfile(profile);
  const identity = document.createElement('p');
  identity.textContent = `${profile.full_name || email} · ${profile.role}${profile.competition_code ? ' · ' + profile.competition_code : ''}`;
  const note = document.createElement('p');
  note.textContent = ['participant','team_member','team'].includes(profile.role)
    ? 'Open an assigned stage below to begin or resume your attempt.'
    : profile.role === 'president'
    ? 'Manage teams and stage drafts, review submissions, and approve official results.'
    : `Manage stages and review submissions for ${profile.competition_code || 'your assigned competition'}.`;
  const logout = document.createElement('button');
  logout.className = 'btn btn-primary full';
  logout.type = 'button';
  logout.textContent = 'Sign out';
  logout.addEventListener('click', async () => {
    if(disposeAttempt)disposeAttempt();
    await supabaseClient.auth.signOut();
    activeProfile = null;
    location.reload();
  });
  form.append(heading, identity, note);
  if (profile.role === 'president') renderPresidentTools(profile, form);
  if (['participant','team_member','team'].includes(profile.role)) renderTeamPortal(profile, form);
  if (['president','officer'].includes(profile.role)) renderResultsConsole(profile, form);
  if (['president','officer'].includes(profile.role)) renderDraftManager(profile, form);

  if (['president','officer'].includes(profile.role)) {
    const library = document.createElement('section');
    library.className = 'resource-library';
    const libraryTitle = document.createElement('h3');
    libraryTitle.textContent = 'Private competition materials';
    const libraryIntro = document.createElement('p');
    libraryIntro.className = 'resource-intro';
    libraryIntro.textContent = 'Organizer PDFs and question banks. Files are requested from the private Supabase Storage bucket; they are not served from the public website folder.';
    library.append(libraryTitle, libraryIntro);

    const materials = [
      {competition:'TECHLIFT',stage:'Stage 1',title:'Technical Quiz Question Bank',path:'uploads/TECHLIFT/techlift-stage-1-quiz.pdf'},
      {competition:'TECHLIFT',stage:'Stage 2',title:'Beginner Coding Challenge',path:'uploads/TECHLIFT/techlift-stage-2-coding-challenge.pdf'},
      {competition:'TECHLIFT',stage:'Stage 3',title:'Tech Mission',path:'uploads/TECHLIFT/techlift-stage-3-tech-mission.pdf'},
      {competition:'DATAQUEST',stage:'Stage 1',title:'Data Science Quiz Question Bank',path:'uploads/DATAQUEST/dataquest-stage-1-quiz.pdf'},
      {competition:'DATAQUEST',stage:'Stage 2',title:'Data Challenge + Organizer Answer Key',path:'uploads/DATAQUEST/dataquest-stage-2-data-challenge.pdf'},
      {competition:'DATAQUEST',stage:'Stage 3',title:'Data Detective + Organizer Answer Guide',path:'uploads/DATAQUEST/dataquest-stage-3-data-detective.pdf'},
      {competition:'AI_NEXUS',stage:'Stage 1',title:'Advanced Technical Quiz',path:'uploads/AI_NEXUS/ai-nexus-stage-1-quiz.pdf'},
      {competition:'AI_NEXUS',stage:'Stage 2',title:'Advanced Coding Challenge + Solutions',path:'uploads/AI_NEXUS/ai-nexus-stage-2-coding-challenge.pdf'},
      {competition:'AI_NEXUS',stage:'Stage 3',title:'Innovation Challenge Modules',path:'uploads/AI_NEXUS/ai-nexus-stage-3-innovation-challenge.pdf'}
    ];
    const visibleMaterials = profile.role === 'president'
      ? materials
      : materials.filter(item => item.competition === profile.competition_code);
    const cards = document.createElement('div');
    cards.className = 'resource-grid';
    const drawMaterials=items=>{cards.replaceChildren();items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'resource-card';
      const tag = document.createElement('span');
      tag.className = 'resource-tag';
      tag.textContent = `${item.competition.replace('_',' ')} · ${item.stage}`;
      const title = document.createElement('strong');
      title.textContent = item.title;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline resource-open';
      button.textContent = 'Open PDF ↗';
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Preparing secure link…';
        try {
          const data = await createPrivatePdfSignedUrl(item, 60);
          window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
          button.textContent = 'Open PDF ↗';
        } catch (err) {
          button.textContent = 'Open PDF ↗';
          const detail = document.createElement('small');
          detail.className = 'resource-error';
          detail.textContent = err.message || 'Could not open the private PDF.';
          if (!card.querySelector('.resource-error')) card.appendChild(detail);
        } finally {
          button.disabled = false;
        }
      });
      card.append(tag, title, button);
      cards.appendChild(card);
    });};drawMaterials(visibleMaterials);
    supabaseClient.from('quiz_drafts').select('competition_code,stage_name,title,source_path').eq('status','published').order('published_at',{ascending:false}).then(({data,error})=>{if(error||!data?.length)return;const latest=new Map();data.forEach(q=>{const key=q.competition_code+'|'+q.stage_name;if(!latest.has(key))latest.set(key,{competition:q.competition_code,stage:q.stage_name,title:q.title,path:q.source_path});});drawMaterials([...latest.values()]);});
    library.appendChild(cards);
    const warning = document.createElement('p');
    warning.className = 'resource-warning';
    warning.textContent = 'Confidential: several PDFs include answers or organizer solutions. Do not upload them to a public/static assets folder. Signed links work only after the private bucket and access policies are configured.';
    library.appendChild(warning);
    form.appendChild(library);
  }

  if(['president','officer'].includes(profile.role))organizeDashboard(form,heading,identity,note,logout);
  else form.append(logout);
  $('loginTitle').innerHTML = profile.role === 'president' ? 'President <span>dashboard.</span>' : ['participant','team_member','team'].includes(profile.role) ? 'Team <span>portal.</span>' : 'Officer <span>portal.</span>';
  modal.classList.add('dashboard-modal');
  $('closeLogin').setAttribute('aria-label', 'Close dashboard');
  $('loginMessage').textContent = '';
  $('loginMessage').style.color = '';
  $('loginMessage').append(document.createTextNode('Signed in successfully.'));
}

async function initSupabase() {
  if (!window.supabase || !window.IKARUS_SUPABASE_URL || !window.IKARUS_SUPABASE_PUBLISHABLE_KEY) {
    message('Could not load Supabase configuration. Check your internet connection and supabase-config.js.', true);
    return;
  }
  supabaseClient = window.supabase.createClient(window.IKARUS_SUPABASE_URL, window.IKARUS_SUPABASE_PUBLISHABLE_KEY);
  const recovery=location.hash.includes('type=recovery');
  supabaseClient.auth.onAuthStateChange(event=>{
    if(event==='PASSWORD_RECOVERY')queueMicrotask(renderPasswordRecovery);
    if(event==='SIGNED_OUT'){
      if(disposeAttempt)disposeAttempt();activeProfile=null;activeEmail='';
      if(!modal.hidden)openLogin(loginMode);
    }
  });
  try{const {data:{session},error}=await supabaseClient.auth.getSession();if(error)throw error;if(session){if(recovery)renderPasswordRecovery();else await loadProfile(session.user);}}
  catch(e){message(`Could not restore your session: ${e.message}`,true);}
}

function renderPasswordRecovery(){
  modal.hidden=false;document.body.style.overflow='hidden';modal.classList.remove('dashboard-modal');
  $('loginTitle').textContent='Set a new password';
  const form=$('loginForm');form.replaceChildren();
  const label=makeEl('label','','New password (at least 12 characters)'),input=makeEl('input');input.type='password';input.minLength=12;input.autocomplete='new-password';label.append(input);
  const save=makeEl('button','btn btn-primary full','Update password');save.type='button';
  save.addEventListener('click',async()=>{if(input.value.length<12){message('Use at least 12 characters.',true);return;}save.disabled=true;try{const {error}=await supabaseClient.auth.updateUser({password:input.value});if(error)throw error;history.replaceState(null,'',location.pathname);await supabaseClient.auth.signOut();openLogin(loginMode);message('Password updated. Sign in with your new password.');}catch(e){message(e.message,true);save.disabled=false;}});
  form.append(label,save);
}

async function loadProfile(user, enforceLoginMode = false) {
  message('Checking your account and competition assignment…');
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('id, full_name, role, competition_code')
    .eq('id', user.id)
    .maybeSingle();
  if (error) {
    message('Could not verify your profile. Check the profiles table RLS policy and that profiles.id matches your Auth user ID.', true);
    return;
  }
  const allowedRoles = ['president','officer','participant','team_member','team'];
  if (!profile || !allowedRoles.includes(profile.role)) {
    await supabaseClient.auth.signOut();
    message('This account has no authorized IKARUS profile. Contact the event administrator.', true);
    return;
  }
  if (enforceLoginMode && loginMode === 'team' && !['participant','team_member','team'].includes(profile.role)) {
    await supabaseClient.auth.signOut();
    message('This account is not configured as a team/participant account. Use Officer Login instead.', true);
    return;
  }
  if (enforceLoginMode && loginMode === 'officer' && ['participant','team_member','team'].includes(profile.role)) {
    await supabaseClient.auth.signOut();
    message('This is a team account. Please use Team Login.', true);
    return;
  }
  if (profile.role !== 'president' && !['TECHLIFT','DATAQUEST','AI_NEXUS'].includes(profile.competition_code)) {
    await supabaseClient.auth.signOut();
    message('Your officer profile has no valid competition assignment. Contact the project administrator.', true);
    return;
  }
  showDashboard(profile, user.email || '');
}

$('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(activeProfile || !$('username') || !$('password'))return;
  if (!supabaseClient) { message('Supabase is not ready. Refresh the page and try again.', true); return; }
  const email = $('username').value.trim();
  const password = $('password').value;
  const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;
  message('Signing in…');
  try{
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await loadProfile(data.user, true);
  }catch(error){message(`Sign-in failed: ${error.message}`,true);}
  finally{if(submit.isConnected)submit.disabled=false;}
});

// Event starts at 09:30 IST on 30 October 2026.
const start = new Date('2026-10-30T09:30:00+05:30').getTime();
function tick(){
  const now=Date.now(), diff=start-now;
  if(diff<=0){ $('days').textContent='00';$('hours').textContent='00';$('minutes').textContent='00';$('seconds').textContent='00';return; }
  const d=Math.floor(diff/86400000),h=Math.floor(diff%86400000/3600000),m=Math.floor(diff%3600000/60000),s=Math.floor(diff%60000/1000);
  $('days').textContent=String(d).padStart(2,'0');$('hours').textContent=String(h).padStart(2,'0');$('minutes').textContent=String(m).padStart(2,'0');$('seconds').textContent=String(s).padStart(2,'0');
}
tick();setInterval(tick,1000);
initSupabase();


async function invokeIkarusFunction(name, body = {}) {
  if (!supabaseClient) throw new Error('Supabase is not connected.');
  const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(12000):undefined;
  let { data, error } = await supabaseClient.functions.invoke(name, { body, signal });
  // Campus networks sometimes cannot reach the Supabase domain. Use the portal's
  // own origin as a second route, forwarding the same authenticated team session.
  const recoverable = error && (/Failed to (send|fetch)|network|fetch failed|relay|timeout|aborted/i.test(error.message||'') || [502,503,504].includes(error.context?.status));
  if (recoverable && ['start-quiz','save-quiz-progress','submit-quiz','report-quiz-event','list-published-quizzes','get-published-quiz'].includes(name)) {
    try {
      const {data:sessionData} = await supabaseClient.auth.getSession();
      if (sessionData?.session?.access_token) {
        const response = await fetch('/api/'+name, {method:'POST',headers:{'Content-Type':'application/json',apikey:window.IKARUS_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+sessionData.session.access_token},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
        const payload = await response.json();
        if(response.ok){data=payload;error=null;}else{error=new Error(payload.error||'Request failed.');error.status=response.status;}
      }
    } catch (_) { /* Preserve the original error when both routes fail. */ }
  }
  if (error) {
    let detail = error.message || 'Request failed.';
    if (error.context && typeof error.context.json === 'function') {
      try { const payload = await error.context.json(); if (payload.error) detail = payload.error; } catch (_) {}
    }
    const failure=new Error(detail);
    failure.retryable=/Failed to (send|fetch)|network|fetch failed|relay|timeout|aborted|Connection interrupted/i.test(detail)||[502,503,504].includes(error.status||error.context?.status);
    throw failure;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function enterQuizFullscreen(){
  if(document.documentElement.requestFullscreen && !document.fullscreenElement){
    try{await document.documentElement.requestFullscreen();}
    catch{throw new Error('Allow fullscreen to start or resume the quiz. Use the stage button again after allowing it.');}
  }
}

function parseResponseParts(value){
  const text=String(value??''),matches=[...text.matchAll(/^--- Section: (\w+) ---\r?\n/gm)],parts={};
  matches.forEach((match,i)=>{let body=text.slice(match.index+match[0].length,i+1<matches.length?matches[i+1].index:text.length);if(i+1<matches.length)body=body.replace(/\r?\n\r?\n$/,'');parts[match[1]]=body;});return parts;
}
function splitResponseEvidence(value){
  let text=String(value??'');const result={text,documents:'',video:''};
  text=text.replace(/\n\nGoogle Drive folder: ([^\n]*)/g,(_,url)=>{result.documents=url.trim();return '';});
  text=text.replace(/\n\nPresentation video: ([^\n]*)/g,(_,url)=>{result.video=url.trim();return '';});result.text=text;return result;
}
function renderTeamPortal(profile, host) {
  if(disposeAttempt)disposeAttempt();
  host.querySelectorAll('.team-portal').forEach(existing => existing.remove());
  const panel = makeEl('section','team-portal');
  const welcome=makeEl('div','participant-welcome');welcome.append(makeEl('span','section-kicker','YOUR TEAM · YOUR MOMENT'),makeEl('h2','',profile.full_name||'Ready for the challenge'),makeEl('p','',`${profile.competition_code?.replace('_',' ')||'Your competition'} · Three rounds. One champion.`));panel.append(welcome);
  panel.append(makeEl('h3','dashboard-section-title','Your competition stages'));
  panel.append(makeEl('p','resource-intro','Published stages assigned to your competition appear here. Starting a stage begins a server-timed attempt. Each account may submit each stage once.'));
  panel.append(makeEl('p','resource-warning','Objective quizzes open fullscreen. Switching tabs, changing apps, or exiting fullscreen locks quiz answers until you return; the timer continues and focus changes are recorded. Coding and activity rounds may use the external tools permitted in their instructions.'));
  const list = makeEl('div','team-stage-list');
  const status = makeEl('p','resource-intro','Loading published stages…');
  panel.append(status,list);
  host.append(panel);

  const showQuiz = (data, mount) => {
    const quiz = data.quiz;
    const focusRestricted=quiz.questions.some(q=>['mcq','true_false'].includes(q.type));
    const sectionMode=!focusRestricted;
    const responseCount=sectionMode?quiz.questions.reduce((n,q)=>n+(q.response_parts?.length||1),0):quiz.questions.length;
    modal.classList.add('quiz-active');modal.hidden=false;
    const attempt = makeEl('section','live-quiz');attempt.classList.toggle('section-round',sectionMode);
    const head = makeEl('div','live-quiz-head');
    head.append(makeEl('div','',`${quiz.competition_code.replace('_',' ')} · ${quiz.stage_name}`));
    head.append(makeEl('h3','',quiz.title));
    const timer = makeEl('strong','quiz-timer','--:--');
    head.append(timer);
    head.append(makeEl('p','quiz-summary',`${quiz.questions.length} question${quiz.questions.length===1?'':'s'} · ${quiz.questions.reduce((total,q)=>total+Number(q.marks||0),0)} marks · ${quiz.duration_minutes} minutes`));
    const progress=makeEl('div','quiz-progress'),progressText=makeEl('span','quiz-progress-label',''),track=makeEl('div','quiz-progress-track'),fill=makeEl('div','quiz-progress-fill');track.setAttribute('role','progressbar');track.setAttribute('aria-label','Questions answered');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(responseCount));track.append(fill);progress.append(progressText,track);head.append(progress);
    attempt.append(head);
    if(quiz.instructions){const brief=makeEl('details','stage-brief');brief.open=true;brief.append(makeEl('summary','','Stage instructions & brief'),makeEl('div','stage-instructions',quiz.instructions));attempt.append(brief);}
    if(quiz.dataset_csv){
      const dataset=makeEl('details','stage-brief');dataset.open=true;dataset.append(makeEl('summary','',`Dataset: ${quiz.dataset_filename}`),makeEl('pre','dataset-preview',quiz.dataset_csv));
      const download=makeEl('button','btn btn-outline','Download dataset CSV');download.type='button';download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([quiz.dataset_csv],{type:'text/csv;charset=utf-8'})),link=makeEl('a');link.href=url;link.download=quiz.dataset_filename||'dataset.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});dataset.append(download);attempt.append(dataset);
    }
    const quizForm = makeEl('div','quiz-question-list');
    const questionCards=[];
    quiz.questions.forEach((q,idx)=>{
      const card=makeEl('article','quiz-question');
      if(q.type==='code')card.classList.add('code-question');
      if(q.section_title)card.append(makeEl('h3','team-section-heading',q.section_title));
      card.append(makeEl('h4','question-protected',`${idx+1}. ${q.text}`));
      card.append(makeEl('p','question-marks',`${q.marks} mark${q.marks===1?'':'s'}`));
      if(q.marking_criteria?.length){const allocation=makeEl('ul','public-marking-criteria');q.marking_criteria.forEach(c=>allocation.append(makeEl('li','',c.label+' - '+c.marks+' marks')));card.append(allocation);}
      if(['subjective','code','activity'].includes(q.type)){
        const answer=makeEl('textarea','quiz-answer');
        answer.rows=q.type==='code'?14:6;answer.maxLength=30000;answer.dataset.position=String(q.position);
        answer.placeholder=q.type==='code'?'Paste your source code here. Include the language and any run instructions. Code is submitted for judge review; it is not executed by this portal.':q.type==='activity'?'Describe your solution, approach, deliverables, and evidence for the activity.':'Enter your answer…';
        if(q.type==='code'){answer.classList.add('code-submission');answer.spellcheck=false;answer.wrap='off';}
        if(q.type==='activity')answer.placeholder='Describe your team’s solution, steps taken, output, and evidence or demo link if requested.';
        if(q.requires_evidence_link||q.requires_video_link)answer.maxLength=25000;
        if(q.response_parts?.length){q.response_parts.forEach(part=>{const label=makeEl('label','response-part-label',part.label+' / '+part.marks+' marks'),field=makeEl('textarea','quiz-answer');field.dataset.position=String(q.position);field.dataset.part=part.key;field.maxLength=Math.floor((q.requires_evidence_link||q.requires_video_link?24000:29000)/q.response_parts.length);field.rows=part.type==='code'?12:6;field.placeholder='Response for '+part.label;if(part.type==='code'){field.classList.add('code-submission');field.spellcheck=false;field.wrap='off';}label.append(field);card.append(label);});}else card.append(answer);
        if(q.requires_evidence_link||q.requires_video_link){
          card.append(makeEl('p','resource-warning','Include all files required for this section. Set Google Drive folders and files to Anyone with the link - Viewer, and test document and video links in a signed-out/private browser window.'));
          [['documents','Google Drive documents / submission folder link',q.requires_evidence_link],['video','Presentation / demo video link',q.requires_video_link]].forEach(([kind,title,enabled])=>{if(!enabled)return;const label=makeEl('label','submission-link-label',title),link=makeEl('input','quiz-title-input quiz-evidence-link');link.type='url';link.maxLength=2048;link.dataset.position=String(q.position);link.dataset.kind=kind;link.placeholder=kind==='documents'?'https://drive.google.com/drive/folders/...':'https://... (accessible presentation video)';label.append(link);card.append(label);});
        }
      } else {
        const opts=q.type==='true_false' && !q.options?.length ? [{label:'True',text:'True'},{label:'False',text:'False'}] : q.options;
        const group=makeEl('div','quiz-options');
        opts.forEach((o,j)=>{
          const label=makeEl('label','quiz-option question-protected');
          const radio=makeEl('input','');radio.type='radio';radio.name=`q-${q.position}`;radio.value=o.label||o.text;
          label.append(radio,document.createTextNode(` ${o.label ? o.label+'. ' : ''}${o.text}`));
          group.append(label);
        });
        card.append(group);
      }
      questionCards.push(card);quizForm.append(card);
    });
    const submit=makeEl('button','btn btn-primary full','Submit stage');
    submit.type='button';
    const notice=makeEl('p','resource-intro','Do not close this window before submitting. The server deadline is authoritative. Coding and tech-activity responses are submitted for manual judge review; this portal does not execute code.');
    const guard=makeEl('div','quiz-focus-guard');guard.hidden=true;guard.setAttribute('role','alertdialog');guard.setAttribute('aria-label','Return to your quiz');
    const guardCard=makeEl('section','quiz-focus-card');guardCard.append(makeEl('h3','','Return to your quiz'),makeEl('p','','Answers are locked because you left the quiz. Your timer is still running. This focus change has been recorded for the organizers.'));
    const returnButton=makeEl('button','btn btn-primary','Return to fullscreen quiz');returnButton.type='button';guardCard.append(returnButton);guard.append(guardCard);
    const workspace=makeEl('div','quiz-workspace'),questionPane=makeEl('div','quiz-question-pane');
    const questionStatus=makeEl('p','question-location');questionStatus.setAttribute('aria-live','polite');
    const paging=makeEl('div','quiz-paging');
    const previous=makeEl('button','btn btn-outline','Previous'),review=makeEl('button','btn btn-outline','Mark for review'),next=makeEl('button','btn btn-primary','Next');
    previous.type=review.type=next.type='button';paging.append(previous,review,next);
    paging.hidden=sectionMode;questionPane.append(questionStatus,quizForm,paging);
    const navigator=makeEl('aside','question-navigator');navigator.setAttribute('aria-label','Question navigator');
    const navTitle=makeEl('h4','',sectionMode?'Sections and marks':'Question navigator'),counts=makeEl('div','question-counts'),palette=makeEl('div','question-palette');
    navigator.append(navTitle,counts,palette,makeEl('p','resource-intro','Select a question number to jump to it. Marked answers are included when you submit.'));
    if(sectionMode){palette.classList.add('section-palette');navigator.lastElementChild.textContent='All sections and answer boxes are shown. Select a section title to jump to it.';}
    workspace.append(questionPane,navigator);attempt.append(workspace,submit,notice);
    attempt.append(guard);
    mount.replaceChildren(attempt);
    const quizScroller=modal.querySelector('.login-modal');if(quizScroller)quizScroller.scrollTop=0;modal.scrollTop=0;window.requestAnimationFrame?.(()=>{if(quizScroller)quizScroller.scrollTop=0;});
    const answerKey='ikarus-answers:'+String(profile.id||profile.full_name||profile.competition_code)+':'+quiz.id+':'+data.deadline_at;
    let initialAnswers=data.saved_answers||{};
    try{const local=JSON.parse(window.localStorage?.getItem(answerKey)||'null');if(local&&typeof local.answers==='object'&&!Array.isArray(local.answers)&&Date.parse(data.deadline_at)>Date.parse(data.server_now||new Date().toISOString()))initialAnswers={...initialAnswers,...local.answers};}catch{}
    quiz.questions.forEach((q,idx)=>{const pos=String(q.position||idx+1),saved=initialAnswers[pos];if(saved===undefined)return;const radio=quizForm.querySelector(`input[name="q-${CSS.escape(pos)}"][value="${CSS.escape(String(saved))}"]`);if(radio)radio.checked=true;else{const response=splitResponseEvidence(saved),parts=parseResponseParts(response.text),fields=[...quizForm.querySelectorAll('textarea')].filter(field=>field.dataset.position===pos);fields.forEach((field,i)=>{field.value=field.dataset.part?(parts[field.dataset.part]??(!Object.keys(parts).length&&i===0?response.text:'')):response.text;});quizForm.querySelectorAll('.quiz-evidence-link').forEach(link=>{if(link.dataset.position===pos)link.value=response[link.dataset.kind]||'';});}});
    let sending=false;
    const collectAnswers=()=>{const answers={};quiz.questions.forEach((q,idx)=>{const pos=String(q.position||idx+1),selected=[...quizForm.querySelectorAll(`input[name="q-${CSS.escape(pos)}"]`)].find(input=>input.checked),fields=[...quizForm.querySelectorAll('textarea')].filter(field=>field.dataset.position===pos);if(selected)answers[pos]=selected.value;else if(fields.length){let value=q.response_parts?.length?(fields.some(field=>field.value.trim())?fields.map(field=>'--- Section: '+field.dataset.part+' ---\n'+field.value).join('\n\n'):''):fields[0].value;quizForm.querySelectorAll('.quiz-evidence-link').forEach(link=>{if(link.dataset.position===pos&&link.value.trim())value+='\n\n'+(link.dataset.kind==='documents'?'Google Drive folder: ':'Presentation video: ')+link.value.trim();});answers[pos]=value;}});return answers;};
    const persistAnswers=()=>{try{window.localStorage?.setItem(answerKey,JSON.stringify({answers:collectAnswers()}));}catch{}};
    quizForm.addEventListener('input',persistAnswers);quizForm.addEventListener('change',persistAnswers);
    const reviewKey='ikarus-review:'+String(profile.id||profile.full_name||profile.competition_code)+':'+quiz.id+':'+data.deadline_at;
    let current=0;const marked=new Set();
    try{const saved=JSON.parse(window.localStorage?.getItem(reviewKey)||'null');if(saved){current=Math.max(0,Math.min(quiz.questions.length-1,Math.trunc(Number(saved.current))||0));(saved.marked||[]).forEach(p=>marked.add(String(p)));}}catch{}
    const persistNavigation=()=>{try{window.localStorage?.setItem(reviewKey,JSON.stringify({current,marked:[...marked]}));}catch{}};
    const navButtons=quiz.questions.map((q,idx)=>{const button=makeEl('button','question-number',sectionMode?(q.section_title||'Section '+(idx+1))+' / '+q.marks+' marks':String(idx+1));button.type='button';button.addEventListener('click',()=>goTo(idx));palette.append(button);return button;});
    const updateProgress=()=>{
      const answers=collectAnswers();let answered=0,reviewCount=0;
      quiz.questions.forEach((q,idx)=>{
        const pos=String(q.position||idx+1),parts=sectionMode&&q.response_parts?.length?[...quizForm.querySelectorAll('textarea')].filter(field=>field.dataset.position===pos):null,completedParts=parts?parts.filter(field=>field.value.trim()).length:0,hasAnswer=parts?completedParts===parts.length:String(answers[pos]??'').trim().length>0,isMarked=marked.has(pos),button=navButtons[idx];
        answered+=parts?completedParts:(hasAnswer?1:0);if(isMarked)reviewCount++;
        const label=isMarked?(hasAnswer?'Answered, marked for review':'Not answered, marked for review'):(hasAnswer?'Answered':'Not answered');
        button.classList.toggle('is-answered',hasAnswer);button.classList.toggle('is-review',isMarked);button.setAttribute('aria-label','Question '+(idx+1)+': '+label);button.setAttribute('aria-current',idx===current?'step':'false');
        questionCards[idx].hidden=!sectionMode&&idx!==current;
      });
      progressText.textContent=answered+' of '+responseCount+(sectionMode?' response sections completed':' answered');fill.style.width=(responseCount?answered/responseCount*100:0)+'%';track.setAttribute('aria-valuenow',String(answered));
      counts.replaceChildren(makeEl('span','count-answered',answered+' Answered'),makeEl('span','count-unanswered',(responseCount-answered)+' Not answered'),makeEl('span','count-review',reviewCount+' Marked for review'));
      questionStatus.textContent=sectionMode?'All questions and response sections are shown below. Complete each section and include its required evidence links.':'Question '+(current+1)+' of '+quiz.questions.length;
      previous.disabled=current===0;next.disabled=current===quiz.questions.length-1;
      const isMarked=marked.has(String(quiz.questions[current]?.position||current+1));review.textContent=isMarked?'Unmark review':'Mark for review';review.setAttribute('aria-pressed',String(isMarked));
    };
    const goTo=index=>{if(sending||!guard.hidden||expired)return;current=Math.max(0,Math.min(quiz.questions.length-1,index));updateProgress();persistNavigation();(sectionMode?questionCards[current]:questionStatus).scrollIntoView?.({block:'nearest'});};
    previous.addEventListener('click',()=>goTo(current-1));next.addEventListener('click',()=>goTo(current+1));
    review.addEventListener('click',()=>{if(sending||!guard.hidden||expired)return;const pos=String(quiz.questions[current]?.position||current+1);if(marked.has(pos))marked.delete(pos);else marked.add(pos);updateProgress();persistNavigation();});
    quizForm.addEventListener('input',updateProgress);quizForm.addEventListener('change',updateProgress);updateProgress();
    let autosaveInterval=null;
    let interval=null, debounce=null, savePromise=null, disposed=false, expired=false, submissionPending=false, retryAt=0;
    const clockOffset=data.server_now?new Date(data.server_now).getTime()-Date.now():0;
    const deadline=new Date(data.deadline_at).getTime();
    const saveProgress=async()=>{
      if(sending||disposed||expired)return;
      persistAnswers();
      if(savePromise)return savePromise;
      savePromise=invokeIkarusFunction('save-quiz-progress',{quiz_id:quiz.id,answers:collectAnswers()});
      try{await savePromise;if(!disposed){notice.textContent='Progress saved securely.';notice.className='resource-intro';}}
      catch(err){if(!disposed){notice.textContent=`Autosave: ${err.message}`;notice.className='resource-error';}}
      finally{savePromise=null;}
    };
    const questionSelection=()=>{try{const selection=window.getSelection?.();if(!selection?.rangeCount)return false;return [...attempt.querySelectorAll('.question-protected')].some(node=>{for(let i=0;i<selection.rangeCount;i++)if(selection.getRangeAt(i).intersectsNode(node))return true;return false;});}catch{return false;}};
    const preventQuestionCopy=e=>{if(e.target?.closest?.('textarea,[contenteditable="true"]'))return;if(e.target?.closest?.('.question-protected')||questionSelection())e.preventDefault();};
    const preventQuestionContext=e=>{if(e.target?.closest?.('.question-protected'))e.preventDefault();};
    document.addEventListener('copy',preventQuestionCopy);document.addEventListener('cut',preventQuestionCopy);
    attempt.addEventListener('contextmenu',preventQuestionContext);attempt.addEventListener('dragstart',preventQuestionContext);
    const beforeUnload=e=>{if(!disposed){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    const focusLost=reason=>{
      if(!focusRestricted||disposed||expired||!guard.hidden)return;
      guard.hidden=false;quizForm.inert=true;workspace.inert=true;submit.disabled=true;
      invokeIkarusFunction('report-quiz-event',{quiz_id:quiz.id,reason}).catch(()=>{notice.textContent='Focus change could not be synced. Reconnect before submitting.';});
    };
    const onVisibility=()=>{if(document.visibilityState==='hidden')focusLost('tab_hidden');};
    const onBlur=()=>focusLost('window_blur');
    const onFullscreen=()=>{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)focusLost('fullscreen_exit');};
    document.addEventListener('visibilitychange',onVisibility);document.addEventListener('fullscreenchange',onFullscreen);window.addEventListener('blur',onBlur);
    returnButton.addEventListener('click',async()=>{returnButton.disabled=true;try{await enterQuizFullscreen();guard.hidden=true;quizForm.inert=false;workspace.inert=false;submit.disabled=sending;}catch(e){notice.textContent=e.message;}finally{returnButton.disabled=false;}});
    const cleanup=()=>{document.removeEventListener('copy',preventQuestionCopy);document.removeEventListener('cut',preventQuestionCopy);attempt.removeEventListener('contextmenu',preventQuestionContext);attempt.removeEventListener('dragstart',preventQuestionContext);disposed=true;clearInterval(interval);clearInterval(autosaveInterval);clearTimeout(debounce);window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('visibilitychange',onVisibility);document.removeEventListener('fullscreenchange',onFullscreen);window.removeEventListener('blur',onBlur);modal.classList.remove('quiz-active');if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});if(disposeAttempt===cleanup)disposeAttempt=null;};
    disposeAttempt=cleanup;
    quizForm.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(saveProgress,700);});
    const submitAttempt=async(auto=false)=>{
      if(sending||disposed)return;sending=true;submit.disabled=true;submit.setAttribute('aria-busy','true');submit.textContent=auto?'Time expired — submitting…':'Submitting…';
      persistAnswers();submissionPending=true;
      try{
        if(savePromise)await savePromise.catch(()=>{});
        const result=await invokeIkarusFunction('submit-quiz',{quiz_id:quiz.id,answers:collectAnswers()});
        cleanup();try{window.localStorage?.removeItem(reviewKey);window.localStorage?.removeItem(answerKey);}catch{}
        attempt.classList.add('submission-success');attempt.replaceChildren(makeEl('div','submission-check','✓'),makeEl('span','section-kicker','ROUND COMPLETE'),makeEl('h3','', 'Stage submitted successfully'),makeEl('p','',`${result.message} ${result.score===null?'Awaiting judging.':`Score: ${result.score} / ${result.max_score}.`}${result.rank?` Current round position: #${result.rank}.`:''}`));celebrate(attempt);
        if(result.manual_review_required)attempt.append(makeEl('p','resource-intro','Your event Officer or President will grade this submission. Your score and round position will appear after judging.'));
        const refresh=makeEl('button','btn btn-outline','Back to stages');refresh.type='button';refresh.addEventListener('click',()=>renderTeamPortal(profile,host));attempt.append(refresh);
      }catch(err){if(/already.*submitted|already.*finalized/i.test(err.message||'')){cleanup();try{window.localStorage?.removeItem(answerKey);}catch{}renderTeamPortal(profile,host);return;}submissionPending=err.retryable===true||/network|Failed to (send|fetch)|Connection interrupted|timeout/i.test(err.message||'');retryAt=Date.now()+8000;notice.textContent=submissionPending?'Connection interrupted. Keep this tab open. Your answers are kept on this device; submission will retry automatically.':err.message||'Submission failed. Contact an organizer.';notice.className='resource-error';submit.disabled=!guard.hidden;submit.setAttribute('aria-busy','false');submit.textContent='Retry submission';sending=false;}
    };
    submit.addEventListener('click',()=>submitAttempt(false));
    const updateTimer=()=>{
      if(disposed)return;
      if(submissionPending&&!sending&&Date.now()>=retryAt)submitAttempt(expired);
      const remain=deadline-(Date.now()+clockOffset);
      timer.classList.toggle('timer-warning',remain>0&&remain<=120000);
      if(remain<=0){timer.textContent='00:00';timer.classList.add('expired');quizForm.querySelectorAll('input,textarea').forEach(input=>input.disabled=true);if(!expired){expired=true;submitAttempt(true);}return;}
      const mins=Math.floor(remain/60000),secs=Math.floor((remain%60000)/1000);
      timer.textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    };
    interval=setInterval(updateTimer,1000);
    autosaveInterval=setInterval(saveProgress,12000);
    updateTimer();
  };

  let firstStageLoad=true;
  const load=async()=>{
    try{
      const data=await invokeIkarusFunction('list-published-quizzes');
      if(data.competition_code!==profile.competition_code)throw Error('Your event assignment has changed. Sign in again with your ticket ID.');
      data.quizzes=data.quizzes.filter(q=>!q.competition_code||q.competition_code===profile.competition_code);
      status.textContent=data.quizzes.length?`Competition: ${data.competition_code.replace('_',' ')} · ${data.quizzes.length} round(s)`:'No rounds are available for your competition yet.';
      list.replaceChildren();
      list.classList.toggle('stage-entry',firstStageLoad);firstStageLoad=false;
      data.quizzes.forEach((q,index)=>{
        const card=makeEl('article','team-stage-card');
        card.style.setProperty('--entry-delay',`${index*110}ms`);
        const top=makeEl('div','team-stage-top');
        top.append(makeEl('span','stage-pill',q.stage_name),makeEl('span','stage-status',q.publication_status==='draft'?'Awaiting publication':q.attempt_status.replace('_',' ')));
        card.append(top,makeEl('h4','',q.title),makeEl('p','',`${q.duration_minutes} minutes · ${q.attempt_status==='not_started'?'Not started':q.attempt_status==='in_progress'?'Attempt in progress':'Attempt submitted'}`));
        if(q.can_start===false&&['not_started','in_progress'].includes(q.attempt_status)){
          card.classList.add('stage-locked');card.append(makeEl('p','eligibility-note',q.eligibility_message||'This round is locked.'));const locked=makeEl('button','btn btn-outline','Locked');locked.type='button';locked.disabled=true;card.append(locked);
        }else if(q.attempt_status==='not_started'){
          if(/stage\s*3/i.test(q.stage_name)&&q.eligibility_message?.includes('Qualified')){card.classList.add('stage-qualified');card.append(makeEl('span','finalist-badge','★ CONFIRMED FINALIST'));}
          const start=makeEl('button','btn btn-primary','Start stage');start.type='button';
          start.addEventListener('click',async()=>{start.disabled=true;start.textContent='Starting securely…';try{await enterQuizFullscreen();const started=await invokeIkarusFunction('start-quiz',{quiz_id:q.id});showQuiz(started,panel);}catch(err){if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});status.textContent=err.message||'Could not start stage.';start.disabled=false;start.textContent='Start stage';}});
          card.append(start);
        }else if(q.attempt_status==='in_progress'){
          const resume=makeEl('button','btn btn-primary','Resume attempt');resume.type='button';
          resume.addEventListener('click',async()=>{resume.disabled=true;try{await enterQuizFullscreen();const started=await invokeIkarusFunction('start-quiz',{quiz_id:q.id});showQuiz(started,panel);}catch(err){if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{});status.textContent=err.message;resume.disabled=false;}});
          card.append(resume);
        }else{
          card.append(makeEl('p','resource-intro',q.score===null?'Round completed. Awaiting judging.':`Score: ${q.score} / ${q.max_score}${q.rank?` · Round position: #${q.rank}`:''}`));
        }
        list.append(card);
      });
    }catch(err){status.className='resource-error';status.textContent=`Could not load stages: ${err.message}. Check that the Edge Functions are deployed and the competition account has a valid profile.`;}
  };
  load();
  const refreshResults=setInterval(()=>{if(!panel.isConnected){clearInterval(refreshResults);return;}if(panel.querySelector('.team-stage-list'))load();},10000);
}

function sectionPlanForAttempt(a){
  if(Array.isArray(a.grading_sections)&&a.grading_sections.length)return a.grading_sections;
  const manual=(a.questions||[]).filter(q=>['code','subjective','activity'].includes(q.type));
  return manual.map(q=>({position:q.position,title:q.section_title||'Question '+q.position,marks:Number(q.marks??(manual.length===1?Number(a.max_score)-Number(a.score||0):0)),instructions:q.grading_instructions||'',criteria:(q.grading_criteria?.length?q.grading_criteria:[{key:'total',label:'Question / section total',marks:q.marks??(manual.length===1?Number(a.max_score)-Number(a.score||0):0)}]).map(c=>({key:q.position+':'+c.key,label:c.label,marks:Number(c.marks),guidance:c.guidance||''}))}));
}
function responseEvidenceLinks(text){
  const links=[];for(const match of String(text||'').matchAll(/https:\/\/[^\s<>"']+/g)){try{const url=new URL(match[0].replace(/[),.;]+$/,''));if(url.protocol==='https:'&&!links.some(link=>link.href===url.href))links.push({href:url.href,host:url.hostname});}catch{}}return links;
}
function renderResultsConsole(profile,host){
  const panel=makeEl('section','results-console');panel.append(makeEl('h3','dashboard-section-title','Submissions & result approvals'),makeEl('p','resource-intro','Choose an event, round and team. Review each response and its evidence, enter marks beside each section, then save. Only the President can approve and publish.'));
  const reload=makeEl('button','btn btn-outline','Refresh submissions');reload.type='button';const state=makeEl('p','resource-intro','Loading submissions...'),rows=makeEl('div','results-list');state.setAttribute('aria-live','polite');
  const events=profile.role==='president'?['TECHLIFT','DATAQUEST','AI_NEXUS']:[profile.competition_code];let selectedEvent=events[0],attempts=[],selectedAttempt=null;const gradeDrafts=new Map();
  const tabs=makeEl('div','event-tabs round-event-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Judging competition');
  const rounds=makeEl('select','quiz-type-select');rounds.setAttribute('aria-label','Judging round');[['','All rounds'],['1','Round 1 - Quiz'],['2','Round 2 - Coding'],['3','Round 3 - Activity']].forEach(([v,t])=>{const o=makeEl('option','',t);o.value=v;rounds.append(o);});
  const status=makeEl('select','quiz-type-select');status.setAttribute('aria-label','Judging status');[['','All submissions'],['pending','Awaiting judging'],['reviewed','Graded'],['approved','Approved'],['published','Published']].forEach(([v,t])=>{const o=makeEl('option','',t);o.value=v;status.append(o);});
  const filters=makeEl('div','judging-filters');filters.append(rounds,status,reload);panel.append(tabs,filters,state,rows);host.append(panel);
  const act=(action,attempt_id,extra={})=>invokeIkarusFunction('manage-results',{action,attempt_id,...extra});
  const render=()=>{
    rows.replaceChildren();const eventAttempts=attempts.filter(a=>a.competition_code===selectedEvent),filtered=eventAttempts.filter(a=>(!rounds.value||Number((a.stage_name.match(/(?:stage|round)\s*(\d+)/i)||[])[1])===Number(rounds.value))&&(!status.value||(status.value==='pending'?a.manual_review_required&&a.reviewed_score==null:a.status===status.value)));
    state.className='resource-intro';state.textContent=filtered.length+' submissions / '+eventAttempts.filter(a=>a.manual_review_required&&a.reviewed_score==null).length+' awaiting judging in this event';
    if(!filtered.length){selectedAttempt=null;rows.append(makeEl('p','judging-empty','No submissions for this selection yet.'));return;}
    if(!filtered.some(a=>a.id===selectedAttempt))selectedAttempt=filtered[0].id;
    const selection=makeEl('div','judging-selection-layout'),teamList=makeEl('nav','team-submission-list'),detail=makeEl('section','selected-submission');teamList.setAttribute('aria-label','Select a team submission');teamList.append(makeEl('h4','','Team submissions'),makeEl('p','resource-intro','Choose a team to review its answers and enter section marks.'));
    filtered.forEach(a=>{const b=makeEl('button','judging-team-option');b.type='button';b.dataset.attempt=a.id;b.setAttribute('aria-current',String(a.id===selectedAttempt));const label=a.manual_review_required&&a.reviewed_score==null?'Awaiting judging':a.status==='reviewed'?'Graded':a.status==='approved'?'Approved':a.status==='published'?'Published':'Submitted';b.append(makeEl('strong','',a.participant_name),makeEl('span','team-submission-round',a.stage_name.replace(/stage/i,'Round')),makeEl('span','team-grading-state',label));const dirty=makeEl('small','team-draft-badge','Unsaved marks');dirty.hidden=!gradeDrafts.has(a.id);b.append(dirty);b.addEventListener('click',()=>{selectedAttempt=a.id;render();});teamList.append(b);});
    const index=filtered.findIndex(a=>a.id===selectedAttempt),navigation=makeEl('div','team-review-navigation'),previous=makeEl('button','btn btn-outline','Previous team'),next=makeEl('button','btn btn-outline','Next team');previous.type=next.type='button';previous.disabled=index===0;next.disabled=index===filtered.length-1;previous.addEventListener('click',()=>{selectedAttempt=filtered[index-1].id;render();});next.addEventListener('click',()=>{selectedAttempt=filtered[index+1].id;render();});navigation.append(previous,makeEl('span','resource-intro','Submission '+(index+1)+' of '+filtered.length),next);detail.append(navigation);selection.append(teamList,detail);rows.append(selection);
    const a=filtered[index],plan=sectionPlanForAttempt(a),editable=['submitted','reviewed'].includes(a.status),draft=gradeDrafts.get(a.id),inputs=new Map();
    const card=makeEl('article','result-card');card.append(makeEl('div','result-meta',a.competition_code.replace('_',' ')+' / '+a.stage_name+' / '+a.status),makeEl('h4','result-team-name',a.participant_name),makeEl('p','resource-intro',a.quiz_title+' / '+a.max_score+' marks'));
    if(a.organizer_notes)card.append(makeEl('p','resource-warning',a.organizer_notes));
    if(a.organizer_reference){const guide=makeEl('details','judge-reference');guide.append(makeEl('summary','','Full organizer answer guide and judging rubric'),makeEl('pre','submission-answer',a.organizer_reference));card.append(guide);}
    card.append(makeEl('p',a.focus_events?.length?'resource-warning':'resource-intro','Recorded focus changes: '+(a.focus_events?.length||0)));
    if(a.focus_events?.length){const events=makeEl('details');events.append(makeEl('summary','','View focus changes'));a.focus_events.forEach(e=>events.append(makeEl('p','',String(e.reason||'').replaceAll('_',' ')+' / '+new Date(e.created_at).toLocaleString())));card.append(events);}
    const workspace=makeEl('div','judging-workspace'),responses=makeEl('details','submission-responses');responses.open=true;responses.append(makeEl('summary','','1. Review and mark each section'));
    (a.questions||[]).forEach((q,i)=>{
      const section=plan.find(s=>s.position===q.position),item=makeEl('section','quiz-question judge-answer-section');item.dataset.position=String(q.position);item.append(makeEl('span','section-kicker',(q.section_title||section?.title||'Question '+(i+1))+' / '+(q.marks??section?.marks??0)+' marks'),makeEl('h4','',q.text));
      if(q.options?.length)item.append(makeEl('p','',q.options.map(o=>o.label+': '+o.text).join(' / ')));
      const markHosts=new Map();
      if(q.response_parts?.length){const text=splitResponseEvidence(a.answers?.[String(q.position)]).text,parts=parseResponseParts(text);q.response_parts.forEach((part,i)=>{const block=makeEl('div','judge-response-part');block.append(makeEl('h5','response-heading',part.label+' / '+part.marks+' marks'),makeEl('pre',part.type==='code'?'code-submission':'submission-answer',parts[part.key]??(!Object.keys(parts).length&&i===0?text:'(No response)')));item.append(block);markHosts.set(q.position+':'+part.key,block);});}
      else item.append(makeEl('h5','response-heading','Team response'),makeEl('pre',q.type==='code'?'code-submission':'submission-answer',String(a.answers?.[String(q.position)]??'(No answer)')));
      const links=responseEvidenceLinks(a.answers?.[String(q.position)]);if(links.length){const evidence=makeEl('div','judge-evidence-links');evidence.append(makeEl('strong','','Submitted documents / video / evidence'));links.forEach(link=>{const anchor=makeEl('a','btn btn-outline','Open evidence - '+link.host);anchor.href=link.href;anchor.target='_blank';anchor.rel='noopener noreferrer';evidence.append(anchor);});evidence.append(makeEl('p','resource-intro','Open the files and video to verify access and assess the submitted evidence.'));item.append(evidence);}else if(q.requires_evidence_link)item.append(makeEl('p','resource-warning','No document or video link was submitted for this section.'));
      const submittedLinks=splitResponseEvidence(a.answers?.[String(q.position)]);if(q.requires_evidence_link&&!submittedLinks.documents)item.append(makeEl('p','resource-warning','Document folder field was left blank. Check any links in the written response.'));if(q.requires_video_link&&!submittedLinks.video)item.append(makeEl('p','resource-warning','Presentation video field was left blank.'));
      if(section){
        const instructions=[section.instructions,q.correct_answer?'Reference answer:\n'+q.correct_answer:''].filter(Boolean).join('\n\n');
        if(instructions){const guide=makeEl('details','section-evaluation-guide');guide.open=instructions.length<1200;guide.append(makeEl('summary','','Evaluation instructions - judges only'),makeEl('pre','submission-answer',instructions));item.append(guide);}
        const marking=makeEl('div','section-marking');marking.append(makeEl('h5','','Marks for this section (maximum '+section.marks+')'));
        section.criteria.forEach(c=>{const label=makeEl('label','section-mark-label',c.label+' (out of '+c.marks+')'),input=makeEl('input','result-score section-score');input.type='number';input.min='0';input.max=String(c.marks);input.step='0.25';input.dataset.criterion=c.key;input.setAttribute('aria-label','Marks: '+section.title+' / '+c.label+' (out of '+c.marks+')');input.value=draft?.scores?.[c.key]??(a.section_scores?.[c.key]==null?'':String(a.section_scores[c.key]));input.disabled=!editable;label.append(input);if(c.guidance)label.append(makeEl('span','grading-hint',c.guidance));(markHosts.get(c.key)||marking).append(label);inputs.set(c.key,{input,criterion:c});});if(marking.children.length>1)item.append(marking);
      }else if(q.correct_answer)item.append(makeEl('p','', 'Answer key: '+q.correct_answer));responses.append(item);
    });
    const grading=makeEl('aside','grading-panel'),total=makeEl('output','section-calculated-total'),completion=makeEl('p','resource-intro');grading.append(makeEl('h4','','2. Check total and save'));
    const notes=makeEl('textarea','result-notes');notes.rows=3;notes.maxLength=3000;notes.value=draft?.notes??a.reviewer_notes??'';notes.disabled=!editable;const notesLabel=makeEl('label','grading-label','Reviewer notes');notesLabel.append(notes);
    const valid=({input,criterion})=>input.value.trim()!==''&&Number.isFinite(Number(input.value))&&Number(input.value)>=0&&Number(input.value)<=criterion.marks&&input.checkValidity();
    const summarize=()=>{const entered=[...inputs.values()].filter(valid),sum=Number(a.score||0)+entered.reduce((n,c)=>n+Number(c.input.value),0);total.textContent='Calculated total: '+Math.round(sum*100)/100+' / '+a.max_score;completion.textContent=entered.length+' of '+inputs.size+' marking fields completed. Enter 0 for an unanswered section.';};
    const remember=()=>{const scores=Object.fromEntries([...inputs].map(([key,c])=>[key,c.input.value]));if([...inputs].every(([key,c])=>c.input.value===(a.section_scores?.[key]==null?'':String(a.section_scores[key])))&&notes.value===(a.reviewer_notes||''))gradeDrafts.delete(a.id);else gradeDrafts.set(a.id,{scores,notes:notes.value});const badge=[...teamList.querySelectorAll('.judging-team-option')].find(b=>b.dataset.attempt===a.id)?.querySelector('.team-draft-badge');if(badge)badge.hidden=!gradeDrafts.has(a.id);const approve=grading.querySelector('.grade-approve');if(approve)approve.disabled=Boolean(a.manual_review_required&&(a.reviewed_score==null||gradeDrafts.has(a.id)));summarize();};
    inputs.forEach(c=>c.input.addEventListener('input',remember));notes.addEventListener('input',remember);
    if(a.manual_review_required){grading.append(makeEl('p','resource-intro','Enter marks beside each answer. The server calculates the final total; it cannot be edited separately.'),total,completion,notesLabel);
      if(a.reviewed_score!=null&&!Object.keys(a.section_scores||{}).length)grading.append(makeEl('p','resource-warning','This older grade has only a saved total. Complete all section fields to replace it; the saved grade is retained until then.'));
      if(editable){const save=makeEl('button','btn btn-primary','Save grade');save.type='button';save.addEventListener('click',async()=>{const invalid=[...inputs.values()].find(c=>!valid(c));if(invalid||!inputs.size){state.textContent='Enter valid marks for every section, including 0 for unanswered sections.';invalid?.input.focus();return;}save.disabled=true;notes.disabled=true;inputs.forEach(c=>c.input.disabled=true);try{const result=await act('grade',a.id,{section_scores:Object.fromEntries([...inputs].map(([key,c])=>[key,Number(c.input.value)])),reviewer_notes:notes.value});gradeDrafts.delete(a.id);await load();state.textContent='Section marks saved for '+a.participant_name+(result.reviewed_score==null?'':': '+result.reviewed_score+' / '+a.max_score);}catch(e){state.textContent=e.message;save.disabled=false;notes.disabled=false;inputs.forEach(c=>c.input.disabled=false);}});grading.append(save);}
    }
    grading.append(makeEl('p','result-score-line',a.manual_review_required&&a.reviewed_score==null?'Awaiting judging':'Saved final score: '+(a.reviewed_score??a.score)+' / '+a.max_score));
    if(profile.role==='president'&&editable){const approve=makeEl('button','btn btn-outline grade-approve','Approve result');approve.type='button';approve.disabled=Boolean(a.manual_review_required&&(a.reviewed_score==null||gradeDrafts.has(a.id)));approve.addEventListener('click',async()=>{approve.disabled=true;try{await act('approve',a.id);await load();}catch(e){state.textContent=e.message;approve.disabled=false;}});grading.append(approve);}
    if(profile.role==='president'&&a.status==='approved'){const publish=makeEl('button','btn btn-primary','Publish result');publish.type='button';publish.addEventListener('click',async()=>{publish.disabled=true;try{await act('publish',a.id);await load();}catch(e){state.textContent=e.message;publish.disabled=false;}});grading.append(publish);}
    grading.append(makeEl('p','grading-flow',profile.role==='president'?'Mark each section / Save grade / Approve / Publish':'Mark each section / Save grade / President approval'));summarize();workspace.append(responses,grading);card.append(workspace);detail.append(card);
  };
  const load=async()=>{reload.disabled=true;state.textContent='Loading submissions...';try{const data=await invokeIkarusFunction('manage-results',{action:'list'});attempts=data.attempts||[];render();}catch(e){rows.replaceChildren();state.className='resource-error';state.textContent='Could not load results: '+e.message;}finally{reload.disabled=false;}};
  events.forEach(code=>{const b=makeEl('button','event-tab',({TECHLIFT:'TechLift',DATAQUEST:'DataQuest',AI_NEXUS:'AI Nexus'})[code]||code);b.type='button';b.dataset.event=code;b.setAttribute('aria-pressed',String(code===selectedEvent));b.addEventListener('click',()=>{selectedEvent=code;[...tabs.children].forEach(button=>button.setAttribute('aria-pressed',String(button===b)));render();});tabs.append(b);});rounds.addEventListener('change',render);status.addEventListener('change',render);reload.addEventListener('click',load);load();
}

let publicResultsLoading=false;
async function loadPublicResults() {
  const host=document.getElementById('publicResults');
  if(!host||publicResultsLoading||!modal.hidden||document.visibilityState==='hidden')return;
  publicResultsLoading=true;
  try{
    const response=await fetch(`${window.IKARUS_SUPABASE_URL}/functions/v1/public-results`,{signal:window.AbortSignal?.timeout?.(10000),headers:{apikey:window.IKARUS_SUPABASE_PUBLISHABLE_KEY}});
    if(!response.ok)throw new Error('Results are not available yet');
    const data=await response.json();host.replaceChildren();
    const groups=(data.results||[]).filter(x=>x.results?.length);
    if(!groups.length){host.append(makeEl('p','resource-intro','Official results will appear here after the President approves and publishes them.'));return;}
    groups.forEach(g=>{
      const card=makeEl('article','public-result-card');card.append(makeEl('h3','',`${g.competition_code.replace('_',' ')} · ${g.stage_name}`),makeEl('p','',g.title));
      const table=makeEl('div','public-result-table');
      g.results.slice(0,10).forEach(r=>{const row=makeEl('div','public-result-row');row.append(makeEl('strong','',`#${r.rank}`),makeEl('span','',r.participant_name),makeEl('b','',`${r.score}/${r.max_score}`));table.append(row);});
      card.append(table);host.append(card);
    });
  }catch(_){if(!host.querySelector('.public-result-card'))host.replaceChildren(makeEl('p','resource-intro','Official results will appear here after the results service is configured.'));}
  finally{publicResultsLoading=false;}
}

// Public leaderboard only shows results explicitly approved and published by the President.
loadPublicResults();
setInterval(loadPublicResults,10000);
