/* Mijn Leerhuis v1.1: volledig lokale, brongebaseerde zoekfunctie.
   Geen externe dienst, geen studentgegevens verzonden, geen gegenereerde schoolregels.
   De kennisindex bevat uitsluitend geselecteerde tekstpassages, niet de originele documenten. */
(() => {
  'use strict';
  const dataset = window.LEERHUIS_DOCUMENT_INDEX || {sources:[], passages:[]};
  const sourceById = Object.fromEntries(dataset.sources.map(s => [s.id,s]));
  const stop = new Set(('ik je jij jou jouw een de het van voor naar op met bij is zijn wat waar wanneer hoe wie welke welke en of in uit dan dat die dit er als moet moeten kan kunnen heb heeft hebben wil graag weten vind vinden meer over aan via doe doen ga gaat mag mogen om tijdens mijn onze jullie weer er op u ook').split(' '));
  const families = [
    ['lwp','leerwerkprestatie','leerwerkprestaties','leerwerk','leerplan'],
    ['bpv','stage','praktijkleren','praktijkopleiding','werkplekleren','praktijkplaats'],
    ['eto','e-to','ilp','individueel','leerplan','kluis'],
    ['epp','prove2move','examenportfolio','digitaalbeoordelen'],
    ['coach','studieloopbaanbegeleider','begeleider'],
    ['ziekmelden','ziek','verzuim','afmelden','afwezig','afwezigheid'],
    ['examen','examens','examinering','examineren','examentoets'],
    ['herkansing','herkansen','herexamen','tweedekans'],
    ['vrijstelling','vrijstellingen','vrijgesteld'],
    ['rekenen','rekenexamen','rekentoets','rekenniveau','rekenles'],
    ['medischrekenen','medicatieberekening','doseringsberekening','medicatie','infusie'],
    ['reflectie','reflecteren','reflectieverslag','terugblikken','starrt','korthagen','abcd'],
    ['pop','persoonlijkontwikkelplan','ontwikkelplan'],
    ['pap','persoonlijkactiviteitenplan','activiteitenplan'],
    ['studentenraad','medezeggenschap','csr'],
    ['diploma','diplomering','afstuderen','afgerond'],
    ['beoordeling','beoordelen','beoordelaar','examinator'],
    ['lesrooster','rooster','lestijden'],
    ['niveau3','vig','verzorgende','verzorgendeig'],
    ['niveau4','vp','verpleegkunde','verpleegkundige'],
    ['taal','nederlands','engels','generiek'],
    ['gesprek','voortgangsgesprek'],
    ['leermetergesprek','leermeter','ontwikkelmeter'],
    ['bpvgesprek','praktijkgesprek'],
    ['skills','skillslab','vaardigheidslab','verpleegtechnisch','vtv']
  ];
  const aliases = new Map();
  families.forEach(group => group.forEach(w => aliases.set(w, group[0])));
  const normalize = text => String(text||'').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/&/g,' en ')
    .replace(/e[ .-]?to\b/g,' eto ').replace(/prove[ .-]?2[ .-]?move/g,' prove2move ')
    .replace(/leerwerk[ -]?prestaties?/g,' leerwerkprestatie ').replace(/medisch[ -]?rekenen/g,' medischrekenen ')
    .replace(/verzorgende[ -]?ig/g,' verzorgendeig ')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const rawTokens = str => normalize(str).split(' ').filter(x=>x.length>=2 && !stop.has(x));
  const lemma = word => {
    if(aliases.has(word)) return aliases.get(word);
    if(word.length>6 && word.endsWith('en')) return word.slice(0,-2);
    if(word.length>6 && word.endsWith('s')) return word.slice(0,-1);
    return word;
  };
  const tokenize = str => rawTokens(str).map(lemma);
  const passages = dataset.passages.map(p => ({ ...p,
    source:sourceById[p.sourceId],
    norm:normalize(`${p.title||''} ${p.text||''}`),
    tokens:new Set(tokenize(`${p.title||''} ${p.text||''}`)),
    headingTokens:new Set(tokenize(p.title||''))
  })).filter(p=>p.source && p.text && p.text.trim().length>28);
  const df = new Map();
  passages.forEach(p => p.tokens.forEach(t=>df.set(t,(df.get(t)||0)+1)));
  const idf = t => 1 + Math.log(1 + (passages.length+1)/(1+(df.get(t)||0)));
  const isOld = source => /202[0-5]|201\d/.test(source.year||'');
  const applies = (s,opts) => (!s.course || s.course===opts.course) && (!s.location || s.location===opts.location);
  function search(query,opts={}){
    const q=normalize(query);
    if(!q || /\b(rooster|lesrooster|lestijden)\b/.test(q)) return [];
    const queryTokens=[...new Set(tokenize(query))];
    if(!queryTokens.length) return [];
    const askMedical=/\bmedischrekenen\b|\bmedicatie\b|\bdosering\b/.test(q);
    const askGeneric=/\brekenexamen\b|\brekentoets\b|\brekenles\b/.test(q) && !askMedical;
    // Meerwoordige of vakspecifieke termen moeten ook echt in de bronpassage staan.
    // Anders raken bijvoorbeeld leermetergesprekken en gewone gesprekken vermengd.
    const anchors=[];
    if(/leermeter/.test(q)) anchors.push(/leermeter/);
    if(/\bherkans/.test(q)) anchors.push(/herkans|tweede gelegenheid|opnieuw maken/);
    if(/\bbpvgesprek\b|\bpraktijkgesprek\b/.test(q)) anchors.push(/bpv gesprek|bpvgesprek|gesprek.*praktijk|praktijk.*gesprek/);
    if(/\bpop\b|\bpap\b/.test(q)) anchors.push(/\bpop\b|\bpap\b/);
    if(/\bepp\b|\bprove2move\b/.test(q)) anchors.push(/\bepp\b|prove2move|examenmap/);
    const ranked=[];
    for (const p of passages){
      const s=p.source;
      if(!applies(s,opts)) continue;
      if(askMedical && s.kind==='rekenen') continue;
      if(askGeneric && s.kind==='medisch') continue;
      if(anchors.length && !anchors.some(re=>re.test(p.norm))) continue;
      let hits=0, score=0;
      for(const t of queryTokens){
        if(p.tokens.has(t)){
          hits++;score+=idf(t)*(p.headingTokens.has(t)?2.4:1.3);
        } else if(t.length>4 && p.norm.includes(t.slice(0,-1))){
          hits++;score+=idf(t)*0.65;
        }
      }
      if(hits===0) continue;
      // Bij meerdere inhoudelijke woorden zijn losse, toevallige treffers onvoldoende.
      if(queryTokens.length>=3 && hits===1) continue;
      if(queryTokens.length===2 && hits===1) score*=0.42;
      score += 4.5*Math.pow(hits/queryTokens.length,2);
      if(q.length>=6 && p.norm.includes(q)) score+=8;
      if(s.kind==='guide') score*=1.18;
      if(/\bmag\b.*\bexamen\b|\bexamen\b.*\bdoen\b/.test(q) && /deelnemen aan examens|coach of vakdocent.*moment|deelneemt aan examens/.test(p.norm))score+=16;
      if(s.kind==='reglement') score*=1.12;
      if(s.year==='2026–2027') score*=1.13;
      if(isOld(s)) score*=0.78;
      if(askMedical && s.kind==='medisch') score*=1.8;
      if(askGeneric && s.kind==='rekenen') score*=1.55;
      if(/\bexamen\b|\bexamens\b|\bherkansing\b|\bvrijstelling\b/.test(q) && s.kind==='handboek') score*=0.82;
      if(score<2.7) continue;
      ranked.push({p,score});
    }
    ranked.sort((a,b)=>b.score-a.score);
    // Eén zoekresultaat per bron + pagina, zodat de student niet vijf stukjes van dezelfde bladzijde ziet.
    const found=[], seen=new Set(), sourceUsage=new Map();
    for(const hit of ranked){
      const p=hit.p, key=`${p.sourceId}:${p.page||p.title}`;
      if(seen.has(key)) continue;
      const times=sourceUsage.get(p.sourceId)||0;
      if(times>=2 && found.length<5) continue;
      seen.add(key);sourceUsage.set(p.sourceId,times+1);
      const nearby=passages.filter(x=>x.sourceId===p.sourceId && x.page===p.page && x.id!==p.id && Math.abs(Number(x.id.split('-').pop())-Number(p.id.split('-').pop()))<=1 && x.text.length<320).slice(0,1);
      const relevant=nearby.length && !/[.!?]$/.test(p.text.trim()) ? nearby[0] : null;
      const snippet=(p.text.trim()+ (relevant?' '+relevant.text.trim():'')).replace(/\s+/g,' ').slice(0,440);
      found.push({id:p.id,key,source:p.source,page:p.page,heading:p.title,excerpt:snippet,score:hit.score});
      if(found.length>=10)break;
    }
    return found;
  }
  window.LEERHUIS_DOC_SEARCH = {search, sources:dataset.sources, passageCount:passages.length};
})();
