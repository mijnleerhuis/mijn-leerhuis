(() => {
  'use strict';
  const C = window.LEERHUIS_CONTENT;
  const L = window.LEERHUIS_LWPS;
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
    view: 'home', week:'vooraf', topic:'alle', checks:readStored('mijnleerhuis-checks-v1',{}), lwpProgress:migrateLwpStore('mijnleerhuis-lwp-progress-v2','mijnleerhuis-lwp-progress-v1'), lwpChosen:migrateLwpStore('mijnleerhuis-lwp-chosen-v2','mijnleerhuis-lwp-chosen-v1'), lwpFilter:'alle', lastFocus:null
  };
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
  const questionButton = q => `<button class="faq-btn" type="button" data-question="${q.id}"><span>${escapeHtml(q.title)}</span><small class="faq-category">${escapeHtml(nameOf(C.topics,q.topic))}</small>${icon('chevron')}</button>`;
  const navBack = () => `<button class="back" data-view="home">${icon('arrow')} Terug naar het overzicht</button>`;
  const heading = (eyebrow,title,description) => `<div class="page-heading">${navBack()}<span class="section-kicker">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>`;
  const stageCards = () => `<div class="phase-grid">${C.phases.map(p=>`<button type="button" class="phase-card ${state.phase===p.id?'selected':''}" data-stage="${p.id}" aria-pressed="${state.phase===p.id}"><span class="phase-number">${p.number} / 03</span><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.subtitle)}</p><div class="phase-bottom"><span class="phase-pill">BEKIJK DEZE FASE</span>${icon('arrow')}</div></button>`).join('')}</div>`;
  const topicsCards = () => `<div class="topics-grid">${C.topics.map(t=>`<button type="button" class="topic-card" data-topic="${t.id}"><span class="topic-icon">${icon(t.icon)}</span><span><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.description)}</p><span class="count">${C.questions.filter(q=>q.topic===t.id && questionApplies(q)).length} antwoorden</span></span></button>`).join('')}</div>`;
  // Rechtstreekse kanaallinks, aangeleverd voor de twee leerhuizen.
  // Een student moet met het juiste Landstede-account toegang hebben tot het Team.
  const TEAMS_LINKS = {
    boerhaavehof: 'https://teams.microsoft.com/l/channel/19%3A3f530a1b62f8423a860f227852371b87%40thread.tacv2/General?groupId=8390a01c-a34c-4315-9a77-40ccb3686a01&tenantId=e8e5eb49-74bd-45b9-905a-1193cb5a9913',
    villaverde: 'https://teams.microsoft.com/l/channel/19%3AXKoMIducGUqkQs-aCGfXpZmW3HWJKI3Zow2bsqVCsVo1%40thread.tacv2/General?groupId=d73bb6a8-8d31-4877-8f29-5d2a548614d6&tenantId=e8e5eb49-74bd-45b9-905a-1193cb5a9913'
  };
  const TEAMS_PORTAL = 'https://teams.microsoft.com/';
  const CONNECT_URL = 'https://www.landstede.net/student';
  const rosters = {
    villaverde: {
      period: 'Periode 2 · 2026–2027', start: '2026-11-10', end:'2027-01-19',
      startLabel:'10 november 2026', endLabel:'19 januari 2027',
      blocks: [
        {label:'Blok 1', time:'09.00 – 10.30', items:['VVT chronisch zieke · Hennie','Klinisch redeneren · Henri'], parallel:true},
        {label:'Blok 2', time:'10.45 – 12.15', items:['Coaching en leermetergesprekken']},
        {label:'Pauze',time:'12.15 – 12.45', items:[]},
        {label:'Blok 3', time:'12.45 – 14.15', items:['Kwaliteit en deskundigheid – de start']},
        {label:'Blok 4', time:'14.30 – 16.00', items:['VTH, reanimatie en EHBO · Henri']}
      ]
    },
    boerhaavehof: {
      period: 'Periode 2 · 2026–2027', start:'2026-11-13', end:'2027-01-22',
      startLabel:'13 november 2026', endLabel:'22 januari 2027',
      blocks: [
        {label:'Blok 1', time:'09.00 – 10.30', items:['VVT geriatrie of kwetsbare ouderen · Hennie','AFGP · Henri'], parallel:true},
        {label:'Blok 2', time:'10.45 – 12.15', items:['Coaching en leermetergesprekken']},
        {label:'Pauze',time:'12.15 – 12.45', items:[]},
        {label:'Blok 3', time:'12.45 – 14.15', items:['GGZ – de start · Gertrude']},
        {label:'Blok 4', time:'14.30 – 16.00', items:['VTH · Henri']}
      ]
    }
  };
  // LWP-data staat apart in lwp-data.js en is gebaseerd op de vier opleidingsgidsen.
  let lwpOpenSections = new Set(['starter']);
  const EDUARTE_URL = 'https://login.educus.nl/';
  const currentPeriodStatus = (r) => {
    const today = new Date(); today.setHours(12,0,0,0);
    const start = new Date(r.start+'T12:00:00');
    const end = new Date(r.end+'T23:59:59');
    return today < start ? 'Komende periode' : today > end ? 'Afgelopen periode · controleer Teams' : 'Periode loopt';
  };
  const rosterRows = (r) => r.blocks.map(b=>`<div class="schedule-row ${b.label==='Pauze'?'is-break':''}"><div class="schedule-time"><strong>${escapeHtml(b.label)}</strong><span>${escapeHtml(b.time)}</span></div><div class="schedule-lessons">${b.items.length?b.items.map(item=>`<div class="schedule-lesson">${escapeHtml(item)}</div>`).join(''):'<span>Pauze</span>'}${b.parallel?'<small>Deze onderdelen staan in hetzelfde lesblok; controleer met je docent welk onderdeel voor jou geldt.</small>':''}</div></div>`).join('');
  const teamsButton = (className='quick-link') => {
    const url = TEAMS_LINKS[state.location] || TEAMS_PORTAL;
    const specific = Boolean(TEAMS_LINKS[state.location]);
    return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('users')}</span><span><strong>${specific?'Teams van '+escapeHtml(nameOf(C.locations,state.location)):'Open Teams'}</strong><small>${specific?'Naar het Team van jouw leerhuis':'Kies zelf je leerhuis · directe link volgt'}</small></span>${icon('external')}</a>`;
  };
  const shortcutLinks = () => `<div class="shortcut-grid"><a class="quick-link" href="${CONNECT_URL}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('monitor')}</span><span><strong>Connect</strong><small>Naar je studentdashboard</small></span>${icon('external')}</a>${teamsButton()}<a class="quick-link" href="${EDUARTE_URL}" target="_blank" rel="noopener noreferrer"><span class="quick-link-icon">${icon('list')}</span><span><strong>Eduarte</strong><small>Kies Landstede en log in</small></span>${icon('external')}</a><button class="quick-link" type="button" data-view="lwp"><span class="quick-link-icon">${icon('book')}</span><span><strong>Mijn LWP-overzicht</strong><small>Verplicht, keuze en eigen voortgang</small></span>${icon('arrow')}</button></div>`;
  const homeRoster = () => {
    const r = rosters[state.location];
    return `<section class="home-roster" aria-labelledby="home-roster-title"><div class="roster-head"><div><span class="section-kicker">JOUW LESSEN</span><h2 id="home-roster-title">Rooster ${escapeHtml(nameOf(C.locations,state.location))}</h2><p>${escapeHtml(r.period)} · ${escapeHtml(r.startLabel)} t/m ${escapeHtml(r.endLabel)}</p></div><span class="period-state">${escapeHtml(currentPeriodStatus(r))}</span></div><div class="schedule-list">${rosterRows(r)}</div><div class="roster-bottom"><span>Bron: aangeleverd perioderooster. Wijzigingen en individuele afspraken vind je in Teams.</span><button data-view="rooster" class="text-link" type="button">Meer over dit rooster ${icon('arrow')}</button></div></section>`;
  };
  const rosterPage = () => {
    const r = rosters[state.location];
    return `<div class="content-start">${heading('ROOSTER','Rooster '+nameOf(C.locations,state.location),r.period+' · '+r.startLabel+' t/m '+r.endLabel)}<div class="roster-page-panel">${rosterRows(r)}</div><div class="roster-guidance"><strong>Let op</strong><p>Dit is het aangeleverde rooster voor periode 2, geen automatische koppeling met Teams. Wijzigingen, lesuitval, locaties en persoonlijke afspraken controleer je altijd in Teams.</p>${teamsButton('quick-link')}</div>${shortcutLinks()}</div>`;
  };
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
    return `<div class="content-start lwp-page">${heading('MIJN LWP’S','Mijn LWP-overzicht · '+nameOf(C.courses,state.course),'Bekijk LWP’s volgens de opleidingsinformatie van 2026, gesorteerd op fase. Kies wat je nog moet doen en houd je voortgang bij.')}
      <div class="lwp-local-note">${icon('pin')} <span>Dit overzicht hoort bij <strong>${escapeHtml(nameOf(C.courses,state.course))}</strong> in <strong>${escapeHtml(nameOf(C.locations,state.location))}</strong>. Bij wisselen van opleiding of locatie zie je een eigen voortgangslijst.</span></div>
      <div class="lwp-summary"><div><span>Afgerond</span><strong>${done} <small>van ${all.length} LWP’s*</small></strong></div><div><span>Mee bezig</span><strong>${busy}</strong></div><div><span>Nog doen</span><strong>${all.length-done-busy}</strong></div></div>
      <p class="lwp-footnote">* De keuzethema’s voor Verpleegkunde staan afzonderlijk onderaan, met eigen voortgang en keuzevinkjes.</p>
      <div class="lwp-important">${icon('info')}<span>Jouw keuzes worden automatisch bewaard in deze browser op dit apparaat, zonder account. Gebruik dezelfde browser; bij het wissen van websitegegevens of op een ander apparaat kunnen de vinkjes ontbreken. <strong>Dit is geen officiële aftekening: je ILP en resultaten in e-TO zijn leidend.</strong> Controleer verplichtingen en de actuele LWP-lijst met je coach.</span></div>
      <div class="lwp-filter-bar" aria-label="Filter het LWP-overzicht">${filters.map(([id,label])=>`<button type="button" data-lwp-filter="${id}" class="lwp-filter ${state.lwpFilter===id?'active':''}" aria-pressed="${state.lwpFilter===id}">${label}</button>`).join('')}</div>
      <div class="lwp-accordions">${['starter','gevorderd','beroepsbekwaam','overig'].map(phase=>lwpSection(phase,...phaseTitles[phase])).join('')}${groups.map(lwpChoiceSection).join('')}</div>
      <div class="roster-guidance"><strong>Welke LWP kan ik hierna doen?</strong><p>Gebruik het filter ‘Nog open’ en bespreek met je coach welke LWP op dit moment past. Sommige zijn optioneel; voor Verpleegkunde zijn er ook verplichte keuzeblokken. De selectie en volgorde in jouw ILP in e-TO bepalen wat voor jou geldt.</p><button data-question="wat-is-lwp" class="button-primary" type="button">Hoe rond ik een LWP af? ${icon('arrow')}</button></div>
    </div>`;
  };
  const home = () => {
    return `<div class="content-start">
      <section class="help-route" aria-labelledby="help-route-title">
        <div class="help-route-heading">
          <span class="section-kicker">VRAGEN? ZO KOM JE VERDER</span>
          <h2 id="help-route-title">Wat doe je als je een vraag hebt?</h2>
          <p>Je hoeft het niet alleen uit te zoeken. Volg deze drie stappen.</p>
        </div>
        <ol class="help-route-steps">
          <li class="help-route-step help-route-featured">
            <span class="help-route-num" aria-hidden="true">1</span>
            <div class="help-route-step-text">
              <h3>Zoek je antwoord in Mijn Leerhuis</h3>
              <p>Typ je vraag in de zoekbalk. Je vindt een kort antwoord of een verwijzing naar de juiste plek.</p>
              <button type="button" class="help-route-cta" data-action="focus-search">Zoek mijn antwoord ${icon('arrow')}</button>
            </div>
          </li>
          <li class="help-route-step">
            <span class="help-route-num" aria-hidden="true">2</span>
            <div class="help-route-step-text">
              <h3>Vraag een medestudent (je maatje)</h3>
              <p>Kom je er niet uit? Je studiemaatje kan je vaak helpen met de systemen en opdrachten.</p>
            </div>
          </li>
          <li class="help-route-step">
            <span class="help-route-num" aria-hidden="true">3</span>
            <div class="help-route-step-text">
              <h3>Vraag je docent</h3>
              <p>Heb je daarna nog vragen? Bespreek ze met je docent of coach.</p>
            </div>
          </li>
        </ol>
        <p class="help-route-note">Is je vraag dringend of maak je je zorgen? Dan mag je natuurlijk meteen hulp vragen aan je docent of coach.</p>
      </section>
      <section class="home-shortcuts" aria-labelledby="shortcuts-title"><div class="section-heading"><div><span class="section-kicker">DIRECT NAAR</span><h2 id="shortcuts-title">Alles snel bij de hand.</h2><p>De belangrijkste digitale plekken van je opleiding.</p></div></div>${shortcutLinks()}</section>
      ${homeRoster()}
      <section aria-labelledby="phase-title"><div class="section-heading"><div><span class="section-kicker">JOUW LEERROUTE</span><h2 id="phase-title">Waar sta jij in je opleiding?</h2><p>Kies de fase waarin jij zit. Je kunt dit altijd veranderen.</p></div></div>${stageCards()}</section>
      <section class="section-spaced" aria-labelledby="topics-title"><div class="section-heading"><div><span class="section-kicker">DIRECT NAAR HET ONDERWERP</span><h2 id="topics-title">Waar wil je meer over weten?</h2></div><button class="text-link" data-view="vragen">Bekijk alle vragen ${icon('arrow')}</button></div>${topicsCards()}</section>
      <div class="notice" role="note">${icon('info')}<span>Dit is een eerste proefversie. De informatie komt uit de opleidingsgidsen van 2026; actuele afspraken, directe schoollinks en locatiespecifieke details moeten nog worden gecontroleerd.</span></div>
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
  const topics = () => `<div class="content-start">${heading('WEGWIJS IN JE OPLEIDING','Alle onderwerpen op één plek.','Kies waar je meer over wilt weten, of typ je vraag in de zoekbalk bovenaan. Open de tegel Digitale systemen voor Connect, Teams, e-TO en Eduarte.')}${topicsCards()}</div>`;
  const questions = () => {
    const selected = state.topic;
    const allowed=C.questions.filter(questionApplies);
    const shown = selected==='alle' ? allowed : allowed.filter(q=>q.topic===selected);
    return `<div class="content-start">${heading('ANTWOORDEN ZONDER ZOEKWERK','Alle veelgestelde vragen.','Korte uitleg, een paar duidelijke stappen en de juiste plek om verder te gaan.')}<div class="topic-filters" aria-label="Filter vragen op onderwerp"><button class="topic-filter ${selected==='alle'?'active':''}" data-filter="alle">Alles (${allowed.length})</button>${C.topics.map(t=>`<button class="topic-filter ${selected===t.id?'active':''}" data-filter="${t.id}">${escapeHtml(t.name)}</button>`).join('')}</div><div class="faq-panel">${shown.map(questionButton).join('')}</div></div>`;
  };
  function render(){
    if(state.view==='lwp' && content.querySelector('.lwp-accordion')) { lwpOpenSections=new Set([...content.querySelectorAll('.lwp-accordion[open]')].map(d=>d.dataset.lwpSection)); }
    content.innerHTML = state.view==='startgids' ? startGuide() : state.view==='onderwerpen' ? topics() : state.view==='vragen' ? questions() : state.view==='rooster' ? rosterPage() : state.view==='lwp' ? lwpPage() : home();
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
    if(!['home','startgids','onderwerpen','vragen','rooster','lwp'].includes(view)) view='home';
    state.view=view;
    if(window.location.hash !== `#${view}`) history.replaceState(null,'',`#${view}`);
    render();
    if(scroll) window.scrollTo({top:0,behavior:'smooth'});
  }
  function showSearch(force=false){
    const term = search.value.trim();
    const matches = getMatches(term).slice(0,8);
    if(!term && !force){ searchResults.hidden=true; search.setAttribute('aria-expanded','false');return;}
    searchResults.hidden=false;
    search.setAttribute('aria-expanded','true');
    if(!matches.length) {
      searchResults.innerHTML = `<div class="search-result-top">GEEN PASSEND ANTWOORD</div><div class="search-none">We hebben nog geen passend antwoord op deze vraag. Vraag het je coach of studiemaatje. Probeer ook een korter zoekwoord.</div>`;
    } else {
      searchResults.innerHTML=`<div class="search-result-top">${matches.length} ${matches.length===1?'ANTWOORD':'ANTWOORDEN'} GEVONDEN</div>${matches.map(q=>`<button class="search-hit" data-question="${q.id}">${icon('chat')}<span>${escapeHtml(q.title)}</span>${icon('chevron')}</button>`).join('')}`;
    }
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
    $('#modal-body').innerHTML=`<div class="modal-inner"><div class="modal-top"><span class="topic-label">${escapeHtml(topic?.name||'Veelgestelde vraag')}</span><button class="modal-close" data-action="close-modal" aria-label="Sluit dit antwoord">${icon('close')}</button></div><h2 id="modal-title">${escapeHtml(q.title)}</h2><p class="modal-summary">${escapeHtml(q.summary)}</p>${addition?`<div class="answer-addition"><strong>Voor ${escapeHtml(nameOf(C.courses,state.course))}:</strong> ${escapeHtml(addition)}</div>`:''}<h3 class="detail-head">ZO PAK JE HET AAN</h3><ol class="answer-steps">${q.steps.map((step,i)=>`<li><span class="step-number">${i+1}</span><span>${escapeHtml(step)}</span></li>`).join('')}</ol>${q.bookList?renderBookList():''}${q.download?`<div class="answer-download"><a class="external-button" href="${escapeHtml(q.download)}" download="${escapeHtml(q.downloadFilename||q.download.split('/').pop())}">${icon('book')} ${escapeHtml(q.downloadLabel||'Download formulier (Word)')}</a><p>Een leeg formulier om zelf in Word in te vullen. Bewaar je ingevulde document op een veilige plek.</p></div>`:''}${q.relatedQuestionId?`<div class="answer-download"><button type="button" class="external-button" data-question="${escapeHtml(q.relatedQuestionId)}">${icon('book')} ${escapeHtml(q.relatedQuestionLabel||'Bekijk extra uitleg')}</button></div>`:''}<div class="answer-note"><strong>${icon('pin')} Waar moet je zijn?</strong><p>${escapeHtml(q.id==='teams-leerhuis' ? 'Microsoft Teams · '+nameOf(C.locations,state.location)+'. Log in met je Landstede-account; je moet toegang hebben tot dit team.' : q.where)}</p></div><div class="answer-footer"><span class="answer-source">Bron: ${escapeHtml(q.source)}. Controleer bij je coach of de afspraken nog actueel zijn.</span>${actionUrl?`<a class="external-button" href="${escapeHtml(actionUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(q.id==='teams-leerhuis' ? 'Open Teams van '+nameOf(C.locations,state.location) : (q.urlLabel||'Open website'))} ${icon('external')}</a>`:''}</div></div>`;
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
    const btn=e.target.closest('[data-action],[data-question],[data-stage],[data-week],[data-view],[data-topic],[data-filter],[data-lwp-filter],[data-query]');
    if(!btn){if(!e.target.closest('.search-wrapper')){searchResults.hidden=true;search.setAttribute('aria-expanded','false')}return;}
    if(btn.tagName==='A' && btn.dataset.view)e.preventDefault();
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
  content.addEventListener('change',e=>{
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
  search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const match=getMatches(search.value.trim())[0];if(match)openQuestion(match.id);else showSearch(true);}if(e.key==='Escape'){searchResults.hidden=true;search.setAttribute('aria-expanded','false');}});
  $('#search-button').addEventListener('click',()=>{const match=getMatches(search.value.trim())[0];if(match)openQuestion(match.id);else {showSearch(true);search.focus();}});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeModal();
    if(e.key==='Tab'&&!modal.hidden){const focusable=[...modal.querySelectorAll('button,a[href]')];if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
  });
  window.addEventListener('hashchange',()=>{const v=location.hash.slice(1);if(['home','startgids','onderwerpen','vragen','rooster','lwp'].includes(v))goView(v,false);});
  const initial=location.hash.slice(1);goView(['home','startgids','onderwerpen','vragen','rooster','lwp'].includes(initial)?initial:'home',false);
})();
