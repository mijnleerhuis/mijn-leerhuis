(() => {
  'use strict';
  const C = window.LEERHUIS_CONTENT;
  const L = window.LEERHUIS_LWPS;
  const D = window.LEERHUIS_DOC_SEARCH;
  if (!C) return;
  const $ = (sel, base=document) => base.querySelector(sel);
  const content = $('#dynamic-content');
  const search = $('#question-search');
  const searchResults = $('#search-results');
  const modal = $('#answer-modal');
  const stopWords = new Set(['wat','waar','hoe','welke','de','het','een','ik','mijn','bij','voor','van','met','kan','moet','ben','op','en','of','in','te','er','dat','die','doe','aan','als']);
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const saveStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };
  // Stabiele LWP-sleutels: houd voortgang bij op LWP-nummer, niet op de positie in een lijst.
  // Bij dubbele nummers binnen een fase helpt de titel om de onderdelen te onderscheiden.
  const lwpSlug = value => String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const stableLwpKey = (location,course,section,index) => {
    if(section.startsWith('thema-')) {
      const group = L?.vpChoiceGroups?.[Number(section.slice(6))];
      const item = group?.choices?.[index];
      return `${location}__${course}__thema-${lwpSlug(group?.id||section)}__${lwpSlug(item?.[1]||item?.[0]||index)}`;
    }
    const items = L?.[course]?.[section] || [];
    const item = items[index];
    const number = String(item?.[1] || index);
    const duplicate = items.filter(other => String(other[1]) === number).length > 1;
    return `${location}__${course}__${section}__${lwpSlug(number)}${duplicate?'__'+lwpSlug(item[0]):''}`;
  };
  // Neem eerder opgeslagen v1-statussen één keer over; v2 blijft daarna leidend.
  const migrateLwpStore = (newName,oldName) => {
    const result = readStored(newName, {});
    const legacy = readStored(oldName, {});
    let migrated = false;
    for(const loc of C.locations) for(const course of C.courses) {
      for(const section of ['starter','gevorderd','beroepsbekwaam','overig']) {
        (L?.[course.id]?.[section]||[]).forEach((_,i)=> {
          const former = `${loc.id}__${course.id}__${section}__${i}`;
          const stable = stableLwpKey(loc.id,course.id,section,i);
          if(Object.prototype.hasOwnProperty.call(legacy,former) && !Object.prototype.hasOwnProperty.call(result,stable)) {
            result[stable]=legacy[former]; migrated=true;
          }
        });
      }
      if(course.id==='vp') (L?.vpChoiceGroups||[]).forEach((group,g)=>group.choices.forEach((_,i)=>{
        const former=`${loc.id}__${course.id}__thema-${g}__${i}`;
        const stable=stableLwpKey(loc.id,course.id,`thema-${g}`,i);
        if(Object.prototype.hasOwnProperty.call(legacy,former) && !Object.prototype.hasOwnProperty.call(result,stable)) {
          result[stable]=legacy[former]; migrated=true;
        }
      }));
    }
    if(migrated) saveStored(newName,result);
    return result;
  };
  const saved = readStored('mijnleerhuis-config', {});
  const state = {
    location: C.locations.some(x=>x.id===saved.location) ? saved.location : 'boerhaavehof',
    course: C.courses.some(x=>x.id===saved.course) ? saved.course : 'vig',
    phase: C.phases.some(x=>x.id===saved.phase) ? saved.phase : 'starter',
    view: 'home', week:'vooraf', topic:'alle', taskFeedback:'', tasks:readStored('mijnleerhuis-taken-v1',[]), favorites:readStored('mijnleerhuis-favorieten-v1',[]), checks:readStored('mijnleerhuis-checks-v1',{}), lwpProgress:migrateLwpStore('mijnleerhuis-lwp-progress-v2','mijnleerhuis-lwp-progress-v1'), lwpChosen:migrateLwpStore('mijnleerhuis-lwp-chosen-v2','mijnleerhuis-lwp-chosen-v1'), lwpFilter:'alle', lastFocus:null
  };
  if(!Array.isArray(state.tasks)) state.tasks=[];
  if(!Array.isArray(state.favorites)) state.favorites=[];
  const nameOf = (items,id) => items.find(x=>x.id===id)?.name || id;
  const configKey = id => `${state.location}-${state.course}-${id}`;
  const isChecked = id => Boolean(state.checks[configKey(id)]);
  const totalTasks = () => C.weeks.reduce((n,w)=>n+w.items.length,0);
  const doneTasks = () => C.weeks.reduce((n,w)=>n+w.items.filter(item=>isChecked(item.id)).length,0);
  const normalize = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const scoreQuestion = (q, term) => {
    const needle = normalize(term);
    if(!needle) return 0;
    const tokens = needle.split(' ').filter(x=>x.length>1 && !stopWords.has(x));
    if(!tokens.length) return 0;
    const title = normalize(q.title);
    const keywords = normalize((q.keywords||[]).join(' '));
    const bookTitles = q.bookList ? (C.bookLists?.[state.course]?.groups||[]).flatMap(g=>g.items.map(x=>[x.title,x.isbn].join(' '))).join(' ') : '';
    const body = normalize([q.summary,(q.steps||[]).join(' '),q.where,q.byCourse?.[state.course]||'',bookTitles].join(' '));
    let score = title.includes(needle) ? 12 : 0;
    let count = 0;
    for(const token of tokens){
      if(title.includes(token)){score += 6;count++;}
      else if(keywords.includes(token)){score += 4;count++;}
      else if(body.includes(token)){score += 1;count++;}
    }
    return count ? score + (count===tokens.length ? 5 : 0) : 0;
  };
  const questionApplies = q => (!Array.isArray(q.courses) || q.courses.includes(state.course)) && (!Array.isArray(q.locations) || q.locations.includes(state.location));
  const getMatches = term => C.questions.filter(questionApplies).map(q=>({q,score:scoreQuestion(q,term)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.q);
  // De student vraagt vaak naar een handeling, niet naar een documenttitel.
  // Een duidelijke intentie gaat daarom vóór een losse woordovereenkomst.
  function directedAnswer(term){
    const t=normalize(term);
    const bpvGesprek=/(\bbpv\b.*\bgesprek\b)|(\bgesprek\b.*\bbpv\b)|\bbpvgesprek\b|\bpraktijkgesprek\b/.test(t);
    if(bpvGesprek){
      if(/vervanger|niet.*(kan|komen|aanwezig)|werkbegeleider.*(verhinderd|afwezig)/.test(t))return 'gesprek-vervanger';
      if(/bereid|voorbereid|vooraf|meene|aanlever|documenten|deel|delen|agenda|gereed|klaar|pop|pap|wat moet ik doen|wat regel/.test(t))return 'gesprek-bpv-voorbereiden';
      if(/plan|aanmeld|inschrij|datum|wanneer|uitnodig|wie.*(aanwezig|erbij|komt)/.test(t))return 'gesprek-bpv-plannen';
    }
    return null;
  }
  function bestPracticalAnswer(term){
    const direct=directedAnswer(term);
    if(direct){const q=C.questions.find(q=>q.id===direct && questionApplies(q));if(q)return q;}
    const ranked=getMatches(term);
    const first=ranked[0];
    return first && scoreQuestion(first,term)>=16 ? first : null;
  }
  const questionButton = q => `<button class="faq-btn" type="button" data-question="${q.id}"><span>${escapeHtml(q.title)}</span><small class="faq-category">${escapeHtml(nameOf(C.topics,q.topic))}</small>${icon('chevron')}</button>`;
  const navBack = () => `<button class="back" data-view="home">${icon('arrow')} Terug naar het overzicht</button>`;
  const heading = (eyebrow,title,description) => `<div class="page-heading">${navBack()}<span class="section-kicker">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2>${description?`<p>${escapeHtml(description)}</p>`:''}</div>`;
  const stageCards = () => `<div class="phase-grid">${C.phases.map(p=>`<button type="button" class="phase-card ${state.phase===p.id?'selected':''}" data-stage="${p.id}" aria-pressed="${state.phase===p.id}"><span class="phase-number">${p.number} / 03</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.subtitle)}</p><div class="phase-bottom"><span class="phase-pill">BEKIJK DEZE FASE</span>${icon('arrow')}</div></button>`).join('')}</div>`;
  const topicGroups = [
    {label:'Opleiding & systemen',ids:['start','systemen','lwp']},
    {label:'Leren in de praktijk',ids:['praktijk','gesprekken','skills']},
    {label:'Examens & vakken',ids:['examens','generiek','medisch','keuzedelen']},
    {label:'Hulp & afspraken',ids:['hulp']}
  ];
  const topicsCards = () => `<div class="topic-groups">${topicGroups.map((group,i)=>{
    const matches=C.topics.filter(t=>group.ids.includes(t.id));
    return `<details class="topic-group" ${i===0?'open':''}><summary><span>${escapeHtml(group.label)}</span><span class="topic-group-meta">${matches.length} onderwerpen <span aria-hidden="true">⌄</span></span></summary><div class="topics-grid">${matches.map(t=>`<button type="button" class="topic-card" data-topic="${t.id}"><span class="topic-icon">${icon(t.icon)}</span><span><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.description)}</p><span class="count">${C.questions.filter(q=>q.topic===t.id && questionApplies(q)).length} antwoorden</span></span></button>`).join('')}</div></details>`;
  }).join('')}</div>`;

  // Rechtstreekse kanaallinks, aangeleverd voor de twee leerhuizen.
  // Een student moet met het juiste Landstede-account toegang hebben tot het Team.
  const TEAMS_LINKS = {
    boerhaavehof: 'https://teams.microsoft.com/l/channel/19%3A3f530a1b62f8423a860f227852371b87%40thread.tacv2/General?groupId=8390a01c-a34c-4315-9a77-40ccb3686a01&tenantId=e8e5eb49-74bd-45b9-905a-1193cb5a9913',
    villaverde: 'https://teams.microsoft.com/l/channel/19%3AXKoMIducGUqkQs-aCGfXpZmW3HWJKI3Zow2bsqVCsVo1%40thread.tacv2/General?groupId=d73bb6a8-8d31-4877-8f29-5d2a548614d6&tenantId=e8e5eb49-74bd-45b9-905a-1193cb5a9913'
  };
  const TEAMS_PORTAL = 'https://teams.microsoft.com/';
  const CONNECT_URL = 'https://www.landstede.net/student';
  // LWP-data staat apart in lwp-data.js en is gebaseerd op de vier opleidingsgidsen.
  let lwpOpenSections = new Set(['starter']);
  const EDUARTE_URL = 'https://login.educus.nl/';
  const teamsButton = (className='quick-link') => {
    const url = TEAMS_LINKS[state.location] || TEAMS_PORTAL;
    const specific = Boolean(TEAMS_LINKS[state.location]);
    return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('users')}</span><span><strong>${specific?'Teams van '+escapeHtml(nameOf(C.locations,state.location)):'Open Teams'}</strong><small>${specific?'Naar het Team van jouw leerhuis':'Kies zelf je leerhuis · directe link volgt'}</small></span>${icon('external')}</a>`;
  };
  const shortcutLinks = () => `<div class="shortcut-grid"><a class="quick-link" href="${CONNECT_URL}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('monitor')}</span><span><strong>Connect</strong><small>Naar je studentdashboard</small></span>${icon('external')}</a>${teamsButton()}<a class="quick-link" href="${EDUARTE_URL}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('list')}</span><span><strong>Eduarte</strong><small>Kies Landstede en log in</small></span>${icon('external')}</a><button class="quick-link" type="button" data-view="lwp"><span class="quick-link-icon">${icon('book')}</span><span><strong>Mijn LWP-overzicht</strong><small>Verplicht, keuze en eigen voortgang</small></span>${icon('arrow')}</button><button class="quick-link" type="button" data-view="taken"><span class="quick-link-icon">${icon('check')}</span><span><strong>Mijn taken</strong><small>Mijn persoonlijke to-dolijst</small></span>${icon('arrow')}</button></div>`;
  const lwpKey = (section,index) => stableLwpKey(state.location,state.course,section,index);
  const getLwpProgress = key => state.lwpProgress[key] || 'open';
  const lwpStatusOptions = key => [['open','Nog doen'],['bezig','Mee bezig'],['afgerond','Afgerond']].map(([id,label])=>`<option value="${id}" ${getLwpProgress(key)===id?'selected':''}>${label}</option>`).join('');
  const lwpRequirement = item => item[2]==='locatie' ? (state.location==='villaverde'?'ja':'nee') : item[2];
  const lwpTag = kind => kind==='ja'?'Verplicht':kind==='nee'?'Optioneel':'Keuze';
  const lwpItems = () => Object.entries(L[state.course] || {}).filter(([k])=>['starter','gevorderd','beroepsbekwaam','overig'].includes(k)).flatMap(([phase,items])=>items.map((item,i)=>({phase,index:i,item,key:lwpKey(phase,i),requirement:lwpRequirement(item)})));
  const lwpVisible = row => {
    const f=state.lwpFilter;
    return f==='alle' || (f==='open'&&getLwpProgress(row.key)!=='afgerond') || (f==='verplicht'&&row.requirement==='ja') || (f==='optioneel'&&row.requirement==='nee') || (f==='keuze'&&row.requirement==='keuze');
  };
  const lwpRow = row => `<div class="lwp-track-row" data-lwp-row="${escapeHtml(row.key)}" data-progress="${escapeHtml(getLwpProgress(row.key))}">
      <div class="lwp-track-info"><div class="lwp-track-title">${escapeHtml(row.item[0])}</div><div class="lwp-track-meta"><span>LWP ${escapeHtml(row.item[1])}</span><span class="lwp-status-tag ${row.requirement==='ja'?'required':row.requirement==='nee'?'optional':'choice'}">${lwpTag(row.requirement)}</span>${row.item[3]?`<span>Indicatie: ${row.item[3]} periode(n)</span>`:''}</div>${row.item[4]?`<p>${escapeHtml(row.item[4])}</p>`:''}</div>
      <div class="lwp-progress-control"><label for="lwp-status-${escapeHtml(row.key)}">Mijn voortgang</label><select id="lwp-status-${escapeHtml(row.key)}" data-lwp-status="${escapeHtml(row.key)}">${lwpStatusOptions(row.key)}</select></div>
    </div>`;
  const lwpSection = (phase,title,subtitle) => {
    const items=lwpItems().filter(x=>x.phase===phase);
    const shown=items.filter(lwpVisible);
    const done=items.filter(x=>getLwpProgress(x.key)==='afgerond').length;
    return `<details class="lwp-accordion" data-lwp-section="${phase}" ${lwpOpenSections.has(phase)?'open':''}><summary><span class="lwp-accordion-title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span><span class="lwp-done-count">${done} / ${items.length} afgerond</span><span class="lwp-chevron">⌄</span></summary><div class="lwp-track-list">${shown.length?shown.map(lwpRow).join(''):'<p class="lwp-no-items">Geen LWP’s bij dit filter. Kies ‘Alles’ om alle onderdelen te zien.</p>'}</div></details>`;
  };
  const lwpChoiceSection = (group,i) => {
    const keyGroup='thema-'+i;
    const chosen=group.choices.filter((_,idx)=>Boolean(state.lwpChosen[lwpKey(keyGroup,idx)])).length;
    const rows=group.choices.map((item,idx)=>({item,idx,key:lwpKey(keyGroup,idx)}));
    const visible=state.lwpFilter==='alle'||state.lwpFilter==='keuze'||state.lwpFilter==='open';
    return `<details class="lwp-accordion lwp-choices" data-lwp-section="${keyGroup}" ${lwpOpenSections.has(keyGroup)?'open':''}><summary><span class="lwp-accordion-title"><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.requirement)}</small></span><span class="lwp-done-count">${chosen} van minimaal ${group.min} gekozen</span><span class="lwp-chevron">⌄</span></summary><div class="lwp-track-list"><p class="lwp-choice-note">Je moet minimaal ${group.min} thema’s kiezen. Overleg je keuze met je coach. Een vinkje hier is alleen je eigen planning.</p>${!visible?'<p class="lwp-no-items">Kies filter ‘Keuze’ of ‘Alles’ om de thema’s te zien.</p>':rows.filter(row=>state.lwpFilter!=='open'||getLwpProgress(row.key)!=='afgerond').map(row=>`<div class="lwp-track-row lwp-choice-row"><div class="lwp-track-info"><div class="lwp-track-title">${escapeHtml(row.item[0])}</div><div class="lwp-track-meta"><span>LWP ${escapeHtml(row.item[1])}</span><span class="lwp-status-tag choice">Keuzethema</span></div><label class="lwp-check-choice"><input type="checkbox" data-lwp-chosen="${escapeHtml(row.key)}" ${state.lwpChosen[row.key]?'checked':''}> Dit thema wil ik kiezen</label></div><div class="lwp-progress-control"><label for="lwp-status-${escapeHtml(row.key)}">Mijn voortgang</label><select id="lwp-status-${escapeHtml(row.key)}" data-lwp-status="${escapeHtml(row.key)}">${lwpStatusOptions(row.key)}</select></div></div>`).join('')}</div></details>`;
  };
  const lwpPage = () => {
    if(!L || !L[state.course]) return `<div class="content-start">${heading('LWP’S','Mijn LWP-overzicht','De gegevens zijn niet beschikbaar.')}</div>`;
    const all=lwpItems();
    const done=all.filter(r=>getLwpProgress(r.key)==='afgerond').length;
    const busy=all.filter(r=>getLwpProgress(r.key)==='bezig').length;
    const phaseTitles={starter:['Starter','Je eerste vakken en basisvaardigheden'],gevorderd:['Gevorderd','LWP’s voor de volgende stap'],beroepsbekwaam:['Beroepsbekwaam','Naar de afronding van je opleiding'],overig:['Aanvullende en optionele LWP’s','Afhankelijk van je leerroute en afspraken']};
    const filters=[['alle','Alles'],['open','Nog open'],['verplicht','Verplicht'],['optioneel','Optioneel'],['keuze','Keuzethema’s']];
    const groups=state.course==='vp'?(L.vpChoiceGroups||[]):[];
    return `<div class="content-start lwp-page">${heading('MIJN LWP’S','Mijn LWP-overzicht · '+nameOf(C.courses,state.course),'')}
      <div class="lwp-local-note">${icon('pin')} <span>Dit overzicht hoort bij <strong>${escapeHtml(nameOf(C.courses,state.course))}</strong> in <strong>${escapeHtml(nameOf(C.locations,state.location))}</strong>. Bij wisselen van opleiding of locatie zie je een eigen voortgangslijst.</span></div>
      <div class="lwp-summary"><div><span>Afgerond</span><strong>${done} <small>van ${all.length} LWP’s*</small></strong></div><div><span>Mee bezig</span><strong>${busy}</strong></div><div><span>Nog doen</span><strong>${all.length-done-busy}</strong></div></div>
      <p class="lwp-footnote">* De keuzethema’s voor Verpleegkunde staan afzonderlijk onderaan, met eigen voortgang en keuzevinkjes.</p>
      <div class="lwp-important">${icon('info')}<span>Jouw keuzes worden automatisch bewaard in deze browser op dit apparaat, zonder account. Gebruik dezelfde browser; bij het wissen van websitegegevens of op een ander apparaat kunnen de vinkjes ontbreken. <strong>Dit is geen officiële aftekening: je ILP en resultaten in e-TO zijn leidend.</strong> Controleer verplichtingen en de actuele LWP-lijst met je coach.</span></div>
      <div class="lwp-filter-bar" aria-label="Filter het LWP-overzicht">${filters.map(([id,label])=>`<button type="button" data-lwp-filter="${id}" class="lwp-filter ${state.lwpFilter===id?'active':''}" aria-pressed="${state.lwpFilter===id}">${label}</button>`).join('')}</div>
      <div class="lwp-accordions">${['starter','gevorderd','beroepsbekwaam','overig'].map(phase=>lwpSection(phase,...phaseTitles[phase])).join('')}${groups.map(lwpChoiceSection).join('')}</div>
      <div class="roster-guidance"><strong>Welke LWP kan ik hierna doen?</strong><p>Gebruik het filter ‘Nog open’ en bespreek met je coach welke LWP op dit moment past. Sommige zijn optioneel; voor Verpleegkunde zijn er ook verplichte keuzeblokken. De selectie en volgorde in jouw ILP in e-TO bepalen wat voor jou geldt.</p><button data-question="wat-is-lwp" class="button-primary" type="button">Hoe rond ik een LWP af? ${icon('arrow')}</button></div>
    </div>`;
  };
  // Persoonlijke taken en favorieten blijven uitsluitend in de browser van de student.
  const taskCategories = [{id:'leerhuis',name:'Leerhuis',hint:'Gesprekken, afspraken en voorbereiding'},{id:'school',name:'School',hint:'Opdrachten, LWP’s, toetsen en examens'}];
  const urgencyNames = {hoog:'Hoog',normaal:'Normaal',laag:'Laag'};
  const saveTasks = () => {
    try { localStorage.setItem('mijnleerhuis-taken-v1',JSON.stringify(state.tasks)); return true; }
    catch (_) { return false; }
  };
  const saveFavorites = () => saveStored('mijnleerhuis-favorieten-v1',state.favorites);
  const taskItem = task => `<li class="personal-task ${task.done?'done':''}" data-task-id="${escapeHtml(task.id)}">
      <label class="task-checkbox"><input type="checkbox" data-task-toggle="${escapeHtml(task.id)}" ${task.done?'checked':''} aria-label="${task.done?'Markeer als nog te doen':'Vink af'}: ${escapeHtml(task.title)}"><span class="task-main"><strong>${escapeHtml(task.title)}</strong><span class="task-tag priority-${escapeHtml(task.urgency)}">${escapeHtml(urgencyNames[task.urgency]||'Normaal')} urgentie</span></span></label>
      <button class="task-delete" type="button" data-task-delete="${escapeHtml(task.id)}" aria-label="Verwijder taak: ${escapeHtml(task.title)}" title="Verwijder taak">${icon('close')}</button>
    </li>`;
  const savedAnswers = () => {
    const saved=state.favorites.map(id=>C.questions.find(q=>q.id===id && questionApplies(q))).filter(Boolean);
    return `<section class="saved-answers" aria-labelledby="saved-title"><div class="section-heading"><div><h3 id="saved-title">Mijn bewaarde antwoorden</h3><p>Bewaar een antwoord via het bladwijzerknopje wanneer je het opent.</p></div></div>${saved.length?`<div class="saved-list">${saved.map(q=>`<button type="button" data-question="${escapeHtml(q.id)}">${icon('book')} <span>${escapeHtml(q.title)}</span>${icon('arrow')}</button>`).join('')}</div>`:'<p class="tasks-empty">Je hebt nog geen antwoorden bewaard. Zoek een vraag en klik op ‘Bewaar antwoord’.</p>'}</section>`;
  };
  const tasksPage = () => {
    const current = state.tasks.filter(t=>t && typeof t.id==='string' && typeof t.title==='string');
    const outstanding = current.filter(t=>!t.done).length;
    const urgencyOrder={hoog:0,normaal:1,laag:2};
    const section=cat=>{
      const rows=current.filter(t=>t.category===cat).sort((a,b)=>Number(a.done)-Number(b.done) || (urgencyOrder[a.urgency]??1)-(urgencyOrder[b.urgency]??1) || (b.createdAt||0)-(a.createdAt||0));
      const n=rows.filter(t=>!t.done).length;
      const name=taskCategories.find(t=>t.id===cat).name;
      const hint=taskCategories.find(t=>t.id===cat).hint;
      return `<section class="task-section" aria-labelledby="task-${cat}-title"><div class="task-section-top"><div><h3 id="task-${cat}-title">${name}</h3><p>${hint}</p></div><span class="task-count">${n} open</span></div>${rows.length?`<ul class="task-list">${rows.map(taskItem).join('')}</ul>`:'<p class="tasks-empty">Nog geen taken in deze categorie.</p>'}</section>`;
    };
    return `<div class="content-start tasks-page">${heading('MIJN OVERZICHT','Mijn taken','Schrijf op wat je wilt doen. Kies de urgentie en vink een taak af zodra die klaar is.')}
      <div class="tasks-intro"><div><strong>${outstanding}</strong><span>${outstanding===1?'taak staat':'taken staan'} nog open</span></div><p>Jij bepaalt wat op je lijst staat. We voegen geen opdrachten automatisch toe.</p></div>
      <form id="task-add-form" class="task-form"><h3>Nieuwe taak toevoegen</h3><div class="task-form-grid"><label class="task-field task-field-title"><span>Wat wil je doen?</span><input name="task-title" id="task-title" maxlength="140" required placeholder="Bijvoorbeeld: agenda BPV-gesprek maken" autocomplete="off"></label><label class="task-field"><span>Waar hoort het bij?</span><select name="task-category" id="task-category"><option value="leerhuis">Leerhuis</option><option value="school">School</option></select></label><label class="task-field"><span>Urgentie</span><select name="task-urgency" id="task-urgency"><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="laag">Laag</option></select></label><button class="button-primary task-add" type="submit" data-task-add>Taak toevoegen ${icon('arrow')}</button></div></form>
      ${state.taskFeedback?`<p class="task-feedback" role="status">${icon('check')} ${escapeHtml(state.taskFeedback)}</p>`:''}
      <div class="task-columns">${section('leerhuis')}${section('school')}</div>
      <p class="task-storage-note">${icon('info')} <span>Alleen jij ziet deze taken op dit apparaat in deze browser. Je hoeft niet in te loggen. Wis je je browsergegevens of gebruik je een ander apparaat, dan kunnen je taken verdwijnen. Vermeld hier geen namen of persoonlijke gegevens van cliënten.</span></p>
      </div>`;
  };
  const home = () => {
    return `<div class="content-start">
      <section class="help-route home-zone home-zone-help" aria-labelledby="help-route-title">
        <div class="help-route-heading">
          <h2 id="help-route-title">Kom je er niet uit?</h2>
        </div>
        <ol class="help-route-steps">
          <li class="help-route-step">
            <span class="help-route-num" aria-hidden="true">1</span>
            <div class="help-route-step-text">
              <h3>Vraag een medestudent</h3>
              <p>Vraag je maatje of een andere medestudent om met je mee te denken.</p>
            </div>
          </li>
          <li class="help-route-step">
            <span class="help-route-num" aria-hidden="true">2</span>
            <div class="help-route-step-text">
              <h3>Vraag je docent, coach of praktijkleercoach</h3>
              <p>Kom je er samen niet uit? Stel je vraag aan je docent, coach of praktijkleercoach.</p>
            </div>
          </li>
        </ol>
        <p class="help-route-note">Heb je direct hulp nodig? Je kunt altijd meteen contact opnemen met je docent, coach of praktijkleercoach.</p>
      </section>
      <section class="home-shortcuts home-zone home-zone-shortcuts" aria-labelledby="shortcuts-title"><div class="section-heading"><div><h2 id="shortcuts-title">Alles snel bij de hand.</h2><p>De belangrijkste digitale plekken van je opleiding.</p></div></div>${shortcutLinks()}</section>
      <section class="home-zone home-zone-phases" aria-labelledby="phase-title"><div class="section-heading"><div><h2 id="phase-title">In welke leerfase zit jij?</h2><p>Kies de fase waarin je zit en kijk wat er van je wordt verwacht.</p></div></div>${stageCards()}</section>
      <section class="section-spaced home-zone home-zone-topics" aria-labelledby="topics-title"><div class="section-heading"><div><h2 id="topics-title">Waar wil je meer over weten?</h2></div><button class="text-link" data-view="vragen">Bekijk alle vragen ${icon('arrow')}</button></div>${topicsCards()}</section>
      ${state.favorites.length?`<details class="home-saved"><summary>${icon('book')} Mijn bewaarde antwoorden (${state.favorites.length})</summary>${savedAnswers()}</details>`:''}
      <div class="notice" role="note">${icon('info')}<span>Gebruik deze website om snel op weg te komen. Je persoonlijke leerplan in e-TO en de actuele informatie van school blijven leidend.</span></div>
    </div>`;
  };
  const stageTabs = () => `<div class="stage-tabs" aria-label="Kies je opleidingsfase">${C.phases.map(p=>`<button class="stage-tab ${state.phase===p.id?'active':''}" data-stage="${p.id}" aria-pressed="${state.phase===p.id}">${escapeHtml(p.name)}</button>`).join('')}</div>`;

  // Gevorderde en beroepsbekwame fase: alleen informatie uit de aangeleverde opleidingsgidsen
  // en EPP-/keuzedeeldocumenten. Persoonlijk ILP, officiële cijfers en actuele regels blijven leidend.
  const phaseGuidePage = phaseId => {
    const guide=C.stageGuides?.[phaseId];
    if(!guide) return '<p>Voor deze fase is nog geen informatie beschikbaar.</p>';
    const courseName=nameOf(C.courses,state.course);
    const phaseRows=lwpItems().filter(row=>row.phase===phaseId);
    const required=phaseRows.filter(row=>row.requirement==='ja');
    const done=required.filter(row=>getLwpProgress(row.key)==='afgerond').length;
    const doing=required.filter(row=>getLwpProgress(row.key)==='bezig').length;
    const stillOpen=required.filter(row=>getLwpProgress(row.key)!=='afgerond');
    const nextLwps=[...stillOpen].sort((a,b)=>(getLwpProgress(a.key)==='bezig'?0:1)-(getLwpProgress(b.key)==='bezig'?0:1)).slice(0,5);
    const progressLabel = key => getLwpProgress(key)==='afgerond'?'Afgerond':getLwpProgress(key)==='bezig'?'Mee bezig':'Nog doen';
    const guideCards=guide.cards.map(c=>`<article class="journey-card">
      <span class="journey-card-number">${escapeHtml(c.number)} / 04</span>
      <h3>${escapeHtml(c.title)}</h3>
      <p>${escapeHtml(c.text)}</p>
      <ul>${c.points.map(point=>`<li>${escapeHtml(point)}</li>`).join('')}</ul>
      ${c.action?`<button type="button" class="journey-card-link" data-view="${escapeHtml(c.action)}">${escapeHtml(c.actionLabel)} ${icon('arrow')}</button>`:''}
      ${c.question?`<button type="button" class="journey-card-link" data-question="${escapeHtml(c.question)}">${escapeHtml(c.actionLabel)} ${icon('arrow')}</button>`:''}
    </article>`).join('');
    const branchNote=guide.byCourse?.[state.course]||'';
    const choiceNote=phaseId==='gevorderd'&&state.course==='vp'?`<div class="journey-choice-note"><strong>Verpleegkunde: verplichte keuzeblokken in deze fase</strong><p>Volgens de gids volg je minimaal twee thema’s Klinisch redeneren én kies je twee Verdiepende thema’s met je docent. Dit zijn LWP-keuzethema’s, niet de mbo-keuzedelen.</p><button data-view="lwp" type="button" class="journey-card-link">Bekijk mijn thema’s ${icon('arrow')}</button></div>`:'';
    const lwpList=nextLwps.length?nextLwps.map(row=>`<li class="journey-lwp-item">
      <span class="journey-lwp-title"><strong>${escapeHtml(row.item[0])}</strong><small>LWP ${escapeHtml(row.item[1])}</small></span>
      <span class="journey-progress ${getLwpProgress(row.key)==='bezig'?'is-busy':''}">${escapeHtml(progressLabel(row.key))}</span>
    </li>`).join(''):'<li class="journey-all-done">Volgens jouw eigen voortgangslijst staan er geen verplichte LWP’s meer open in deze fase. Controleer dit altijd in e-TO.</li>';
    const nextSteps=guide.nextSteps.map((item,i)=>`<li><span aria-hidden="true">${i+1}</span>${escapeHtml(item)}</li>`).join('');
    return `<div class="journey-page">
      <section class="journey-hero" aria-labelledby="journey-title"><span class="section-kicker">${escapeHtml(guide.eyebrow)}</span>
        <h3 id="journey-title">${escapeHtml(guide.headline)}</h3>
        <p>${escapeHtml(guide.intro)}</p>
        <div class="journey-context">${icon('pin')} <span><strong>${escapeHtml(courseName)}</strong> · ${escapeHtml(nameOf(C.locations,state.location))}</span></div>
      </section>
      <div class="journey-course-note">${icon('info')}<span>${escapeHtml(branchNote)}</span></div>
      <section class="journey-section" aria-labelledby="journey-steps-title"><div class="section-heading"><div><span class="section-kicker">ZO PAK JE HET AAN</span><h3 id="journey-steps-title">Jouw route in deze fase</h3><p>Je hoeft niet alles tegelijk te doen. Kies samen met je coach wat nu bij jou past.</p></div></div><div class="journey-cards">${guideCards}</div></section>
      <section class="journey-section journey-lwp-section" aria-labelledby="journey-lwps-title">
        <div class="section-heading"><div><span class="section-kicker">JOUW VOLGENDE STAP</span><h3 id="journey-lwps-title">Verplichte LWP’s in deze fase</h3><p>Hier zie je de openstaande LWP’s volgens jouw eigen lijst, niet de officiële schoolvoortgang.</p></div></div>
        <div class="journey-lwp-panel"><div class="journey-lwp-stats"><div><strong>${done} / ${required.length}</strong><span>Afgerond in je eigen overzicht</span></div><div><strong>${doing}</strong><span>Mee bezig</span></div><div><strong>${stillOpen.length}</strong><span>Nog niet afgerond</span></div></div>
        <ul class="journey-lwp-items">${lwpList}</ul><div class="journey-lwp-footer"><button type="button" class="button-primary" data-view="lwp">Open mijn volledige LWP-overzicht ${icon('arrow')}</button><span>In e-TO zie je wat officieel geldt voor jouw ILP.</span></div></div>${choiceNote}
      </section>
      <section class="journey-section journey-next-section" aria-labelledby="journey-next-title"><div class="section-heading"><div><span class="section-kicker">PRAKTISCH OVERZICHT</span><h3 id="journey-next-title">Wat kun je nu oppakken?</h3></div></div><ol class="journey-next-list">${nextSteps}</ol><div class="journey-next-links"><button class="journey-card-link" data-question="gesprek-leermeter" type="button">Leermetergesprek voorbereiden ${icon('arrow')}</button><button class="journey-card-link" data-question="epp-beoordelingen" type="button">Examens in EPP bekijken ${icon('arrow')}</button></div></section>
      <div class="journey-source">${icon('info')}<span>Gebaseerd op de aangeleverde opleidingsinformatie van Landstede Leerhuizen (2026), de EPP-instructie (2025) en het keuzedelenoverzicht (2025–2026). De precieze volgorde, verplichtingen en exameneisen controleer je met je coach en in e-TO/EPP. Oudere documenten zijn geen garantie voor actuele regels.</span></div>
    </div>`;
  };
  const startGuide = () => {
    const phase = C.phases.find(p=>p.id===state.phase);
    let inner = '';
    if(state.phase==='starter'){
      const w = C.weeks.find(x=>x.id===state.week)||C.weeks[0];
      const done = w.items.filter(x=>isChecked(x.id)).length;
      inner = `<div class="week-shell"><div class="week-nav" aria-label="Kies een week">${C.weeks.map((item,i)=>`<button class="week-tab ${item.id===state.week?'active':''}" data-week="${item.id}" aria-pressed="${item.id===state.week}"><span class="week-number">0${i}</span>${escapeHtml(item.short)}</button>`).join('')}</div><div class="week-main"><span class="section-kicker">${escapeHtml(w.label)}</span><h3>${escapeHtml(w.title)}</h3><p class="intro">${escapeHtml(w.intro)}</p><div class="week-progress"><span>Mijn checklist</span><span>${done} van ${w.items.length} gedaan</span></div><div class="checklist">${w.items.map(item=>`<label class="check-row"><input type="checkbox" data-check="${item.id}" ${isChecked(item.id)?'checked':''}><span>${escapeHtml(item.text)}</span></label>`).join('')}</div><div class="week-related"><h4>Handige antwoorden bij deze stap</h4>${w.questionIds.map(id=>C.questions.find(q=>q.id===id)).filter(Boolean).map(q=>`<button data-question="${q.id}">${escapeHtml(q.title)} ${icon('arrow')}</button>`).join('')}</div></div></div>`;
    } else {
      inner = phaseGuidePage(state.phase);
    }
    return `<div class="content-start">${heading('JOUW OPLEIDINGSFASE','Een duidelijk pad, in jouw tempo.','Je kunt altijd naar een andere fase wisselen. Het hoeft niet gelijk te lopen met het studiejaar.')}${stageTabs()}${inner}<div class="notice">${icon('info')}<span>De checklist is een geheugensteun, geen officiële studievoortgang. Je coach en de schoolsystemen blijven leidend.</span></div></div>`;
  };
  const topics = () => `<div class="content-start">${heading('WEGWIJS IN JE OPLEIDING','Alle onderwerpen op één plek.','Kies waar je meer over wilt weten. Heb je een vraag? Gebruik de zoekbalk op de startpagina. De tegel Digitale systemen verwijst naar Connect, Teams, e-TO en Eduarte.')}${topicsCards()}</div>`;
  const questions = () => {
    const selected = state.topic;
    const allowed=C.questions.filter(questionApplies);
    const shown = selected==='alle' ? allowed : allowed.filter(q=>q.topic===selected);
    return `<div class="content-start">${heading('ANTWOORDEN ZONDER ZOEKWERK','Alle veelgestelde vragen.','Korte uitleg, een paar duidelijke stappen en de juiste plek om verder te gaan.')}<div class="topic-filters" aria-label="Filter vragen op onderwerp"><button class="topic-filter ${selected==='alle'?'active':''}" data-filter="alle">Alles (${allowed.length})</button>${C.topics.map(t=>`<button class="topic-filter ${selected===t.id?'active':''}" data-filter="${t.id}">${escapeHtml(t.name)}</button>`).join('')}</div><div class="faq-panel">${shown.map(questionButton).join('')}</div></div>`;
  };
  function render(){
    if(state.view==='lwp' && content.querySelector('.lwp-accordion')) { lwpOpenSections=new Set([...content.querySelectorAll('.lwp-accordion[open]')].map(d=>d.dataset.lwpSection)); }
    content.innerHTML = state.view==='startgids' ? startGuide() : state.view==='onderwerpen' ? topics() : state.view==='vragen' ? questions() : state.view==='lwp' ? lwpPage() : state.view==='taken' ? tasksPage() : home();
    const isHome = state.view==='home';
    document.body.classList.toggle('is-home-view',isHome);
    $('#location-banner').hidden=!isHome;
    $('.hero').hidden=!isHome;
    document.querySelectorAll('.nav-link').forEach(a=>{
      const selected = a.dataset.view===state.view;
      a.classList.toggle('active',selected);
      if(selected) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
    });
    $('#location-select').value=state.location;
    $('#course-select').value=state.course;
    const banner = $('#location-banner');
    const photo = $('#location-banner-image');
    const picture = state.location==='villaverde'
      ? {src:'assets/villa-verde.jpg',alt:'Het gebouw van leerhuis Villa Verde',width:1200,height:800}
      : {src:'assets/boerhaavehof.jpg',alt:'Het gebouw van leerhuis Boerhaavehof',width:651,height:466};
    banner.dataset.leerhuis=state.location;
    if(photo.getAttribute('src')!==picture.src) photo.setAttribute('src',picture.src);
    photo.alt=picture.alt;
    photo.width=picture.width;photo.height=picture.height;
    $('#hero-photo-label').innerHTML='JOUW LEERHUIS <strong>'+escapeHtml(nameOf(C.locations,state.location)).toUpperCase()+'</strong>';
  }
  function goView(view, scroll=true){
    if(!['home','startgids','onderwerpen','vragen','lwp','taken'].includes(view)) view='home';
    state.view=view;
    if(view!=='taken')state.taskFeedback='';
    if(window.location.hash !== `#${view}`) history.replaceState(null,'',`#${view}`);
    render();
    if(scroll) window.scrollTo({top:0,behavior:'smooth'});
  }
  const getDocMatches = term => D ? D.search(term,{course:state.course,location:state.location}) : [];
  const documentResult = r => `<button class="search-doc-hit" type="button" data-document="${escapeHtml(r.id)}"><span class="search-doc-tag">${icon('book')} Extra informatie</span><strong>${escapeHtml(r.heading&&r.heading!=='Guide'?r.heading:r.source.title)}</strong><span class="search-doc-excerpt">${escapeHtml(r.excerpt.slice(0,165))}${r.excerpt.length>165?'…':''}</span><small>${escapeHtml(r.source.title)}${r.page?' · p. '+escapeHtml(r.page):''}</small></button>`;
  const practicalResult = (q,primary=false) => `<button type="button" class="search-direct-hit ${primary?'search-direct-main':''}" data-question="${escapeHtml(q.id)}"><span class="search-direct-label">${icon('chat')} ${primary?'JOUW ANTWOORD':'OOK HANDIG'}</span><strong>${escapeHtml(q.title)}</strong><span>${escapeHtml(q.summary)}</span>${primary?`<small>Bekijk de concrete stappen ${icon('arrow')}</small>`:''}</button>`;
  let searchDocResults=[];
  function showSearch(force=false){
    const term=search.value.trim();
    if(!term && !force){searchResults.hidden=true;search.setAttribute('aria-expanded','false');return;}
    const primary=bestPracticalAnswer(term);
    const questionMatches=getMatches(term).filter(q=>!primary||q.id!==primary.id).slice(0,2);
    searchDocResults=getDocMatches(term);
    const documentMatches=searchDocResults.slice(0,4);
    searchResults.hidden=false;search.setAttribute('aria-expanded','true');
    if(!primary && !questionMatches.length && !documentMatches.length){
      searchResults.innerHTML = `<div class="search-result-top">GEEN PASSEND ANTWOORD GEVONDEN</div><div class="search-none">Probeer een ander woord of vraag je coach. Niet alle documenten zijn al verwerkt.</div>`;
      return;
    }
    let out='';
    if(primary)out+=`<div class="search-result-top">SNEL ANTWOORD OP JE VRAAG</div>${practicalResult(primary,true)}`;
    if(!primary && questionMatches.length)out+=`<div class="search-result-top">MOGELIJKE ANTWOORDEN</div>${questionMatches.map(q=>practicalResult(q)).join('')}`;
    if(primary && questionMatches.length)out+=`<details class="search-other"><summary>Andere vragen over dit onderwerp</summary>${questionMatches.map(q=>practicalResult(q)).join('')}</details>`;
    if(documentMatches.length){
      if(primary || questionMatches.length)out+=`<details class="search-other"><summary>Meer uit de opleidingsdocumenten</summary>${documentMatches.slice(0,3).map(documentResult).join('')}</details>`;
      else out+=`<div class="search-result-top">DIT STAAT IN JE DOCUMENTEN</div>${documentMatches.slice(0,3).map(documentResult).join('')}`;
    }
    searchResults.innerHTML=out;
  }
  const bpvGuidePage=()=>({boerhaavehof:{vig:21,vp:19},villaverde:{vig:20,vp:18}}[state.location]||{})[state.course];
  const bpvGuideCitation=()=>`Opleidingsinformatie ${nameOf(C.courses,state.course)} · ${nameOf(C.locations,state.location)} (2026), p. ${bpvGuidePage()}`;
  function openDocument(id){
    const result=searchDocResults.find(r=>r.id===id);
    if(!result)return;
    state.lastFocus=document.activeElement;
    const old=/202[0-5]|201\d/.test(result.source.year||'');
    const relatedFaq=bestPracticalAnswer(search.value.trim());
    // De bron blijft beknopt; een beschikbaar stappenantwoord krijgt de voorrang.
    const relatedBlock=relatedFaq?`<div class="document-practical"><h3>Zo pak je het aan</h3><p>${escapeHtml(relatedFaq.summary)}</p><button type="button" class="journey-card-link" data-question="${escapeHtml(relatedFaq.id)}">Bekijk de stappen ${icon('arrow')}</button></div>`:'';
    const title=result.heading&&result.heading!=='Guide'?result.heading:'Informatie uit je documenten';
    const citation=`${result.source.title}${result.page?' · p. '+result.page:''}`;
    $('#modal-body').innerHTML=`<div class="modal-inner"><div class="modal-top"><span class="topic-label">Uit je opleidingsdocumenten</span><button class="modal-close" data-action="close-modal" aria-label="Sluit dit antwoord">${icon('close')}</button></div><h2 id="modal-title">${escapeHtml(title)}</h2>${relatedBlock}<p class="document-quote document-short">${escapeHtml(result.excerpt)}</p>${old?`<p class="document-warning"><strong>Let op:</strong> deze bron is ouder. Controleer of de afspraak nog klopt.</p>`:''}<p class="answer-source answer-source-inline">Bron: ${escapeHtml(citation)}. Voor persoonlijke examenafspraken zijn e-TO en je coach leidend.</p></div>`;
    modal.hidden=false;modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
    $('.modal-close',modal).focus();
    searchResults.hidden=true;search.setAttribute('aria-expanded','false');
  }
  const renderBookList = () => {
    const list = C.bookLists?.[state.course];
    if(!list) return '';
    const formatPrice = x => `€ ${escapeHtml(x)}`;
    const priceLabel = item => item.bookPrice && item.ePrice
      ? `Boek + e-learning: ${formatPrice(item.bookPrice)} · alleen e-learning: ${formatPrice(item.ePrice)}`
      : item.ePrice ? `Alleen e-learning: ${formatPrice(item.ePrice)}`
      : item.bookPrice ? `Prijs in bron: ${formatPrice(item.bookPrice)}` : '';
    const groups = list.groups.map(group => `<section class="book-group"><h4>${escapeHtml(group.title)}</h4><p class="book-group-note">${escapeHtml(group.note)}</p><ul class="book-items">${group.items.map(item => `<li class="book-item"><strong>${escapeHtml(item.title)}</strong>${item.isbn?`<span class="book-isbn">ISBN ${escapeHtml(item.isbn)}</span>`:''}${priceLabel(item)?`<span class="book-price">${priceLabel(item)}</span>`:''}${item.note?`<span class="book-item-note">${escapeHtml(item.note)}</span>`:''}</li>`).join('')}</ul></section>`).join('');
    return `<section class="booklist-section" aria-label="Oude boekenlijst"><div class="booklist-warning"><strong>Let op: boekenlijst ${escapeHtml(list.academicYear)}</strong><p>Dit is een historische lijst, niet een door Landstede bevestigde actuele bestellijst. Prijzen zijn afkomstig uit ${escapeHtml(list.academicYear)} en kunnen gewijzigd zijn. Bestel pas als je coach en werkgever de juiste editie, ISBN en licentie hebben bevestigd.</p></div><div class="booklist-heading"><h3>Boekenlijst ${escapeHtml(list.program)}</h3><p>Kies bovenaan een andere opleiding om de bijbehorende lijst te zien. Bij tweedehands boeken kan de unieke e-learningcode al gebruikt zijn.</p></div>${groups}</section>`;
  };
  function openQuestion(id){
    const q=C.questions.find(x=>x.id===id); if(!q || !questionApplies(q)) return;
    state.lastFocus=document.activeElement;
    const topic=C.topics.find(t=>t.id===q.topic);
    const addition=q.byCourse?.[state.course];
    const actionUrl=q.id==='teams-leerhuis' ? (TEAMS_LINKS[state.location] || TEAMS_PORTAL) : (q.urlsByCourse?.[state.course] || q.url);
    $('#modal-body').innerHTML=`<div class="modal-inner"><div class="modal-top"><span class="topic-label">${escapeHtml(topic?.name||'Veelgestelde vraag')}</span><button class="modal-close" data-action="close-modal" aria-label="Sluit dit antwoord">${icon('close')}</button></div><h2 id="modal-title">${escapeHtml(q.title)}</h2><button class="favorite-btn ${state.favorites.includes(q.id)?'is-saved':''}" data-favorite="${escapeHtml(q.id)}" aria-pressed="${state.favorites.includes(q.id)}" type="button">${icon('book')} ${state.favorites.includes(q.id)?'Bewaard ✓':'Bewaar antwoord'}</button><p class="modal-summary">${escapeHtml(q.summary)}</p>${addition?`<div class="answer-addition"><strong>Voor ${escapeHtml(nameOf(C.courses,state.course))}:</strong> ${escapeHtml(addition)}</div>`:''}<h3 class="detail-head">DIT KUN JE DOEN</h3><ol class="answer-steps">${q.steps.map((step,i)=>`<li><span class="step-number">${i+1}</span><span>${escapeHtml(step)}</span></li>`).join('')}</ol>${q.bookList?renderBookList():''}${q.download?`<div class="answer-download"><a class="external-button" href="${escapeHtml(q.download)}" download="${escapeHtml(q.downloadFilename||q.download.split('/').pop())}">${icon('book')} ${escapeHtml(q.downloadLabel||'Download formulier (Word)')}</a><p>Een leeg formulier om zelf in Word in te vullen. Bewaar je ingevulde document op een veilige plek.</p></div>`:''}${q.relatedQuestionId?`<div class="answer-download"><button type="button" class="external-button" data-question="${escapeHtml(q.relatedQuestionId)}">${icon('book')} ${escapeHtml(q.relatedQuestionLabel||'Bekijk extra uitleg')}</button></div>`:''}<div class="answer-note"><strong>${icon('pin')} Waar moet je zijn?</strong><p>${escapeHtml(q.id==='teams-leerhuis' ? 'Microsoft Teams · '+nameOf(C.locations,state.location)+'. Log in met je Landstede-account; je moet toegang hebben tot dit team.' : q.where)}</p></div><div class="answer-footer"><span class="answer-source">Bron: ${escapeHtml(q.id.startsWith('gesprek-bpv-')?bpvGuideCitation():q.source)}. Persoonlijke afspraken: je coach.</span>${actionUrl?`<a class="external-button" href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(q.id==='teams-leerhuis' ? 'Open Teams van '+nameOf(C.locations,state.location) : (q.urlLabel||'Open website'))} ${icon('external')}</a>`:''}</div></div>`;
    modal.hidden=false;
    modal.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    $('.modal-close',modal).focus();
    searchResults.hidden=true;
    search.setAttribute('aria-expanded','false');
  }
  function closeModal(){
    if(modal.hidden)return;
    modal.hidden=true;modal.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    if(state.lastFocus?.isConnected)state.lastFocus.focus();
  }
  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-document],[data-action],[data-question],[data-stage],[data-week],[data-view],[data-topic],[data-filter],[data-lwp-filter],[data-query],[data-task-delete],[data-favorite]');
    if(!btn){if(!e.target.closest('.search-wrapper')){searchResults.hidden=true;search.setAttribute('aria-expanded','false')}return;}
    if(btn.tagName==='A' && btn.dataset.view)e.preventDefault();
    if(btn.dataset.favorite){
      const id=btn.dataset.favorite;
      state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];
      saveFavorites();
      btn.classList.toggle('is-saved',state.favorites.includes(id));
      btn.setAttribute('aria-pressed',String(state.favorites.includes(id)));
      btn.innerHTML=icon('book')+' '+(state.favorites.includes(id)?'Bewaard ✓':'Bewaar antwoord');
      if(state.view==='taken')render();
      return;
    }
    if(btn.dataset.taskDelete){
      const task=state.tasks.find(t=>t.id===btn.dataset.taskDelete);
      if(task && window.confirm('Deze taak verwijderen?')){
        state.tasks=state.tasks.filter(t=>t.id!==btn.dataset.taskDelete);
        const stored=saveTasks();
        state.taskFeedback=stored?'': 'Let op: je browser kon deze wijziging niet blijvend opslaan.';
        render();
      }
      return;
    }
    if(btn.dataset.document){openDocument(btn.dataset.document);return;}
    if(btn.dataset.question){openQuestion(btn.dataset.question);return;}
    if(btn.dataset.action==='close-modal'){closeModal();return;}
    if(btn.dataset.action==='focus-search'){goView('home');search.focus();return;}
    if(btn.dataset.query){ search.value=btn.dataset.query;showSearch(true);search.focus();return; }
    if(btn.dataset.stage){state.phase=btn.dataset.stage; saveStored('mijnleerhuis-config',{location:state.location,course:state.course,phase:state.phase});goView('startgids');return;}
    if(btn.dataset.week){state.week=btn.dataset.week;render();return;}
    if(btn.dataset.topic){state.topic=btn.dataset.topic;goView('vragen');return;}
    if(btn.dataset.filter){state.topic=btn.dataset.filter;render();return;}
    if(btn.dataset.lwpFilter){state.lwpFilter=btn.dataset.lwpFilter;render();return;}
    if(btn.dataset.view){if(btn.dataset.view==='lwp')lwpOpenSections.add(state.phase);goView(btn.dataset.view);return;}
  });
  // Één centrale toevoegfunctie voor klikken en Enter in het formulier.
  // De klik op de knop wordt expliciet opgevangen. Dit voorkomt dat een
  // browserpreview of een andere formulierafhandeling de taak weglaat.
  function addPersonalTask(form) {
    if(!form || state.view!=='taken') return;
    const field=form.querySelector('#task-title');
    const title=String(field?.value||'').trim().replace(/\s+/g,' ').slice(0,140);
    if(!title){ field?.focus(); return; }
    const category=form.querySelector('#task-category')?.value==='school'?'school':'leerhuis';
    const chosenUrgency=form.querySelector('#task-urgency')?.value;
    const urgency=['laag','normaal','hoog'].includes(chosenUrgency)?chosenUrgency:'normaal';
    const now=Date.now();
    const id=`taak-${now}-${Math.random().toString(36).slice(2,10)}`;
    // Werk eerst het scherm bij, onafhankelijk van lokale opslag.
    state.tasks=[{id,title,category,urgency,done:false,createdAt:now},...state.tasks];
    const stored=saveTasks();
    state.taskFeedback=stored
      ? `Toegevoegd aan ${category==='school'?'School':'Leerhuis'}: ${title}`
      : `Toegevoegd aan ${category==='school'?'School':'Leerhuis'}, maar bewaren is niet gelukt. Controleer de browserinstellingen.`;
    render();
    const added=content.querySelector(`[data-task-id="${id}"]`);
    if(added){added.classList.add('task-just-added');added.scrollIntoView({block:'nearest',behavior:'smooth'});}
    $('#task-title',content)?.focus();
  }
  content.addEventListener('click',e=>{
    const button=e.target.closest('[data-task-add]');
    if(!button) return;
    e.preventDefault();
    const form=button.closest('#task-add-form');
    if(form?.reportValidity && !form.reportValidity()) return;
    addPersonalTask(form);
  });
  content.addEventListener('submit',e=>{
    const form=e.target.closest('#task-add-form');
    if(!form) return;
    e.preventDefault();
    addPersonalTask(form);
  });
  content.addEventListener('change',e=>{
    if(e.target.matches('[data-task-toggle]')){
      const task=state.tasks.find(t=>t.id===e.target.dataset.taskToggle);
      if(task){task.done=e.target.checked;const stored=saveTasks();state.taskFeedback=stored?'': 'Let op: je browser kon deze wijziging niet blijvend opslaan.';render();}
      return;
    }
    if(e.target.matches('[data-lwp-status]')){
      state.lwpProgress[e.target.dataset.lwpStatus]=e.target.value;
      saveStored('mijnleerhuis-lwp-progress-v2',state.lwpProgress);
      render();
      return;
    }
    if(e.target.matches('[data-lwp-chosen]')){
      state.lwpChosen[e.target.dataset.lwpChosen]=e.target.checked;
      saveStored('mijnleerhuis-lwp-chosen-v2',state.lwpChosen);
      render();
      return;
    }
    if(e.target.matches('[data-check]')){
      state.checks[configKey(e.target.dataset.check)]=e.target.checked;
      saveStored('mijnleerhuis-checks-v1',state.checks);
      render();
    }
  });
  $('#location-select').addEventListener('change',e=>{state.location=e.target.value;saveStored('mijnleerhuis-config',{location:state.location,course:state.course,phase:state.phase});render();});
  $('#course-select').addEventListener('change',e=>{state.course=e.target.value;saveStored('mijnleerhuis-config',{location:state.location,course:state.course,phase:state.phase});render();});
  search.addEventListener('input',()=>showSearch());
  search.addEventListener('focus',()=>{if(search.value.trim())showSearch();});
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const match=bestPracticalAnswer(search.value.trim());if(match)openQuestion(match.id);else {const docs=getDocMatches(search.value.trim());if(docs.length){searchDocResults=docs;openDocument(docs[0].id);}else showSearch(true);}}if(e.key==='Escape'){searchResults.hidden=true;search.setAttribute('aria-expanded','false');}});
  $('#search-button').addEventListener('click',()=>{const match=bestPracticalAnswer(search.value.trim());if(match)openQuestion(match.id);else {const docs=getDocMatches(search.value.trim());if(docs.length){searchDocResults=docs;openDocument(docs[0].id);}else {showSearch(true);search.focus();}}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeModal();
    if(e.key==='Tab'&&!modal.hidden){const focusable=[...modal.querySelectorAll('button,a[href]')];if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
  });
  window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['home','startgids','onderwerpen','vragen','lwp','taken'].includes(v))goView(v,false);});
  const initial=location.hash.slice(1);goView(['home','startgids','onderwerpen','vragen','lwp','taken'].includes(initial)?initial:'home',false);
})();
