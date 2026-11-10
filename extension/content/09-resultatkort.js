  // ---- mulig sentral kampanje: spør brukeren ------------------------------------------------
  // Svaret gjelder varen (alle rabattprosenter) på alle bonger i datagrunnlaget, så alle flaggede bonger med varen oppdateres.
  async function setCamp(key, status, n) {
    if (status) campDec[key] = status; else delete campDec[key];
    store(K.camp, campDec);
    var before = Object.keys(anomMap).length;
    if (ctlRes) { await runChecks(lastMode); if (checkState.at) renderCheck(); }
    if (document.querySelector('.kvr-camp-dlg')) openCampDialog();
    var bongs = n ? ' Gjelder alle ' + n + ' bongene med varen' + (before !== Object.keys(anomMap).length ? ' (' + before + ' → ' + Object.keys(anomMap).length + ' flaggede bonger)' : '') + '.' : '';
    say(status === 'kampanje' ? 'Merket som sentral kampanje, uansett rabattprosent. Rabatten flagges ikke lenger.' + bongs : status === 'ikke' ? 'Merket som ikke kampanje.' + bongs : 'Svaret er angret.');
  }

  function campText(c) { return '«' + c.name + '» med ' + c.rateText + ' rabatt'; }

  // Spørsmålet under en flagget bong: kan det være en sentral kampanje?
  function campQuestion(c) {
    return el('div', { class: 'kvr-camp' }, [
      el('span', { text: 'Kan være sentral kampanje: ' + campText(c) + ' er på ' + c.n + ' bonger hos ' + c.cashiers + ' kasserere. Stemmer det?' }),
      el('div', { class: 'kvr-row' }, [btn('Ja, kampanje', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm kvr-primary'), btn('Nei, ikke kampanje', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')]),
      el('span', { class: 'kvr-hint', text: 'Svaret gjelder varen, uansett rabattprosent, og oppdaterer alle flaggede bonger med den.' })
    ]);
  }

  function campTable(list) {
    return tbl(['Vare', 'Rabatt', 'Bonger', 'Kasserere', 'Butikker', 'Dager', 'Svar'], list.map(function (c) {
      var ans = !c.status ? el('span', { class: 'kvr-row' }, [btn('Ja', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm kvr-primary'), btn('Nei', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')])
        : c.status === 'auto' ? el('span', {}, [document.createTextNode('Kampanjevare (automatisk) '), btn('Ikke kampanje', function () { setCamp(c.key, 'ikke', c.n); }, 'kvr-sm')])
        : el('span', {}, [document.createTextNode((c.status === 'kampanje' ? 'Kampanje ' : 'Ikke kampanje ')), btn('Angre', function () { setCamp(c.key, '', c.n); }, 'kvr-sm')]);
      return [{ node: el('span', { title: 'EAN ' + c.c }, [document.createTextNode(c.name || c.c)]) }, c.rateText || '–', c.n, c.cashierN, c.storeN, c.dayN, { node: ans }];
    }));
  }

  function openCampDialog() {
    var D = ctlRes && ctlRes.disc;
    var list = D && D.camp ? D.camp.items : [];
    var body = el('div', { class: 'kvr-camp-dlg kvr-secbody' }, [
      hintEl('Samme vare med rabatt på flere bonger hos flere kasserere kan bety en kampanje fra sentralt hold. Bongene er tatt med i analysen. Svaret gjelder varen, uansett rabattprosent, og oppdaterer alle flaggede bonger med den. Svarer du Ja, flagges rabatten ikke lenger. Svarer du Nei, flagges den som vanlig, uten notat. Svarene huskes og er med i revisjonsrapporten.')
    ]);
    if (!list.length) body.appendChild(hintEl('Ingen mulige kampanjer akkurat nå.'));
    else body.appendChild(campTable(list));
    openModal('Mulige sentrale kampanjer', body, [btn('Lukk', closeModal)]);
  }

  function renderDiscCard(D) {
    var box = ui.ctlDisc;
    if (!D || !D.scanned) { box.appendChild(metaEl('Ingen skannede salg med rabattdata i omfanget. Skann på nytt (eldre skanninger mangler rabattdata) og kjør analysen igjen.')); return; }
    var T = D.total;
    box.appendChild(metaEl('Rabattdata for ' + D.scanned + ' av ' + D.sales + ' salg. ' + T.withDisc + ' bonger har rabattlinje (' + fmt(T.disc) + ' kr), ' + T.withNR + ' av dem uten årsak (' + fmt(T.nr) + ' kr). ' + T.withCpn + ' bonger har kupong/kampanje (' + T.cpn + ' kuponger).'));
    var rows = D.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.n, r.withDisc, fmt(r.disc), { t: r.withNR, bad: r.flag }, fmt(r.nr), { t: pct(r.share), bad: r.flag }, { t: r.withW, bad: r.flagW }, r.withCpn, r.cpn];
    });
    rows.push(['Butikk', T.n, T.withDisc, fmt(T.disc), T.withNR, fmt(T.nr), pct(T.share), T.withW, T.withCpn, T.cpn]);
    box.appendChild(tbl(['Kasserer', 'Bonger', 'Med rabatt', 'Rabatt kr', 'Uten årsak', 'Uten årsak kr', 'Andel', 'Overvåket', 'Med kupong', 'Kuponger'], rows));
    box.appendChild(hintEl(D.watch.length ? 'Overvåkede årsaker: ' + D.watch.join(', ') + '. Bongen flagges ved rabatt med årsak på ' + (ctlCfg.discWatchPct || 0) + (ctlCfg.discWatchPctTo ? '–' + ctlCfg.discWatchPctTo : ' eller mer') + ' % og minst ' + ctlCfg.discWatchKr + ' kr; kassereren markeres ved minst ' + (ctlCfg.discWatchN || '–') + ' bonger. Rabatt flagges bare når linjen har årsak; en kampanjevare kan ha rabatt uten årsak. Endres under Innstillinger → Rabatt.' : 'Overvåking av rabattårsaker er av (tom liste under Innstillinger → Rabatt).'));
    // hurtigfilter: rabatt med årsak i det overvåkede spennet og høy rabatt med årsak
    var rangeBtn = function (label, from, to) {
      return btn(label, function () { filters.disc = 'reason'; filters.discFrom = String(from); filters.discTo = String(to); writeForm(); apply(); say('Viser bonger med rabatt med årsak på ' + from + '–' + to + ' %.'); }, 'kvr-ent');
    };
    var qb = [];
    if (D.watch.length) qb.push(rangeBtn('Vis overvåket (' + (ctlCfg.discWatchPct || 0) + '–' + (ctlCfg.discWatchPctTo || 100) + ' %)', ctlCfg.discWatchPct || 0, ctlCfg.discWatchPctTo || 100));
    if (ctlCfg.discHiFrom) qb.push(rangeBtn('Vis høy rabatt (' + ctlCfg.discHiFrom + '–' + (ctlCfg.discHiTo || 100) + ' %)', ctlCfg.discHiFrom, ctlCfg.discHiTo || 100));
    if (qb.length) box.appendChild(el('div', { class: 'kvr-row' }, qb));
    if (D.reasons.length) {
      var pick = function (name) { return name === 'Uten årsak' ? 'noreason' : L.DISC_REASONS.indexOf(name) !== -1 ? 'r:' + name : null; };
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Rabatt per årsak' }));
      box.appendChild(tbl(['Årsak', 'Linjer', 'Bonger', 'Rabatt kr', 'Snitt %', 'Overvåket'], D.reasons.map(function (r) {
        var v = pick(r.name);
        var nm = v ? { node: btn(r.name, function () { filters.disc = v; writeForm(); apply(); say('Viser kvitteringer med årsak «' + r.name + '».'); }, 'kvr-ent') } : r.name + ' (ukjent)';
        return [nm, r.lines, r.bongs, fmt(r.sum), r.avgPct === null ? '–' : String(r.avgPct).replace('.', ','), D.watch.indexOf(r.name) !== -1 ? 'ja' : ''];
      })));
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Kasserer × årsak (antall rabattlinjer)' }));
      var mx = D.reasons.map(function (r) { return r.name; });
      box.appendChild(tbl(['Kasserer'].concat(mx), D.matrix.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }].concat(mx.map(function (n) { return r.counts[n] || '·'; }));
      })));
    }
    if (D.campaigns.length) {
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Kuponger (flest først)' }));
      box.appendChild(tbl(['Kupong-id', 'Navn', 'Bonger', 'Sum kr'], D.campaigns.slice(0, 10).map(function (c) { return [c.id, c.name, c.n, fmt(c.sum)]; })));
    }
    if (D.camp) {
      box.appendChild(el('b', { class: 'kvr-subh', text: ctlCfg.campAuto ? 'Kampanjevarer' : 'Mulige sentrale kampanjer' }));
      if (D.camp.pending) box.appendChild(el('div', { class: 'kvr-notice' }, [el('span', { text: D.camp.pending + (D.camp.pending === 1 ? ' vare venter' : ' varer venter') + ' på svar: er det en kampanje fra sentralt hold?' }), btn('Svar nå', openCampDialog, 'kvr-sm kvr-primary')]));
      if (D.camp.items.length) box.appendChild(campTable(D.camp.items.slice(0, 30)));
      if (D.camp.days.length) box.appendChild(tbl(['Kampanjedag', 'Butikk', 'Dag', 'Andel', 'Bonger'], D.camp.days.slice(0, 8).map(function (d) { return ['Mange bonger med rabatt', sLabel(d.store), d.day, pct(d.share), d.withDisc + ' av ' + d.n]; })));
      if (ctlCfg.campAuto) box.appendChild(metaEl(D.camp.auto + ' varer er klassifisert som kampanjevare: minst ' + ctlCfg.campCashiers + ' kasserere har solgt varen med rabatt, på minst ' + (ctlCfg.campBongs || '–') + ' bonger til sammen (én bong hos hver av to kasserere er nok). Rabatten på dem flagges ikke. Trykk «Ikke kampanje» for å flagge som vanlig. Slå av under Innstillinger → Rabatt for å bli spurt i stedet.'));
      var S = D.camp.scan, popTodo = popScanTodo();
      box.appendChild(metaEl('Kampanjesjekken ser ' + S.scanned + ' av ' + S.sales + ' salg i grunnlaget (' + S.cashiers + ' av ' + S.cashiersAll + ' kasserere har skannede bonger). En vare blir bare kampanjevare når de skannede bongene viser den hos flere kasserere.' +
        (ctlCfg.campCoupon ? ' ' + D.camp.coupon + ' rabattlinjer står i en kupong på samme bong og regnes som kampanje.' : '') +
        (ctlCfg.campMulti ? ' ' + D.camp.multi + ' rabattlinjer er like varer med samme rabatt på samme bong (multipakk) og regnes som kampanje.' : '')));
      if (popTodo.length) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann hele grunnlaget (' + popTodo.length + ')', scanPopulation, 'kvr-sm')]));
      if (D.camp.others.length) {
        box.appendChild(el('b', { class: 'kvr-subh', text: 'Rabatt uten årsak på varer som ikke er kampanjevare' }));
        var whyText = function (c) {
          return c.why === 'bonger' ? 'bare ' + plur(c.n, 'bong', 'bonger') + ' (grense ' + ctlCfg.campBongs + ')'
            : c.why === 'kasserere' ? 'bare ' + plur(c.cashierN, 'kasserer', 'kasserere') + ' (grense ' + ctlCfg.campCashiers + ')' : c.why === 'av' ? 'kampanjesjekken er av' : '';
        };
        box.appendChild(tbl(['Vare', 'Rabatt', 'Bonger', 'Uten årsak', 'Kasserere', 'Hvorfor ikke', ''], D.camp.others.map(function (c) {
          return [{ node: el('span', { title: (L.isCampCode(c.c) && c.c.length < 8 ? 'PLU ' : 'EAN ') + c.c }, [document.createTextNode(c.name || c.c)]) }, c.rateText, c.n, c.nr, c.cashierN,
            whyText(c), { node: btn('Kampanjevare', function () { setCamp(c.key, 'kampanje', c.n); }, 'kvr-sm') }];
        })));
        box.appendChild(hintEl((D.camp.otherN > D.camp.others.length ? 'Viser ' + D.camp.others.length + ' av ' + D.camp.otherN + ' varer, flest bonger uten årsak først. ' : '') + '«Kampanjevare» merker varen som kampanje uansett rabattprosent, og rabatten på den flagges ikke lenger. Valget huskes og kan angres i tabellen over.'));
      }
      box.appendChild(hintEl('Samme vare med rabatt på minst ' + (ctlCfg.campBongs || '–') + ' bonger hos minst ' + ctlCfg.campCashiers + ' kasserere (over alle dager og butikker) kan være en kampanje fra sentralt hold. Uten automatisk kampanjevare tas bongene med i analysen med et notat, og du blir spurt. Svaret gjelder varen, uansett rabattprosent. Svar Ja: rabatten flagges ikke lenger og telles ikke mot kassereren (' + D.camp.confirmed + ' bekreftet). Svar Nei: flagges som vanlig (' + D.camp.denied + ' avvist). En dag der minst ' + (ctlCfg.campDay || '–') + ' % av minst 30 salg har rabatt får bare notat.'));
    }
    box.appendChild(metaEl('Rabatt = linjen «Rabatt: Kr x (y %)» på en vare med årsak 1 Datovare, 2 Feil pris, 3 Prisløfte, 4 Reserveløsning kupong, 5 Annen rabattårsak eller 6 Best før (tom = ingen årsak valgt). Klikk en årsak for å filtrere listen. Kupong = linjen «Kupong (id - navn)», antatt lagt inn sentralt (CN/VPI); beløpet er ofte 0,00, så den viser at kampanjen er knyttet til bongen, ikke at den er innløst. Rødt = andel bonger med rabatt uten årsak er minst ' + ctlCfg.profFactor + '× butikkens (minst ' + ctlCfg.profMin + ' bonger). Funn «Rabatt uten årsak» ' + (ctlCfg.discPct ? 'krever minst ' + ctlCfg.discPct + ' % rabatt' : 'er av') + '. «Høy rabattprosent» flagger rabatt med årsak på ' + (ctlCfg.discHiFrom ? ctlCfg.discHiFrom + '–' + ctlCfg.discHiTo + ' %' : 'ingenting (av)') + '. «Varen solgt av én kasserer» ' + (ctlCfg.discOneN ? 'flagger rabatt med årsak når færre enn ' + ctlCfg.discOneN + ' kasserere solgte varen i butikken den dagen' + (D.oneSkip ? ' (' + D.oneSkip + ' linjer sto over fordi under 80 % av dagens salg var skannet)' : '') : 'er av') + '. «Rabatt uten treff» krever minst ' + (ctlCfg.discMatchPct || '–') + ' % og at ingen andre bonger samme dag har varen med samme rabatt. Søk på rabatt-prosent under Skann.'));
  }

  function renderMemberCard(M) {
    var box = ui.ctlMember;
    if (!M || !M.members) { box.appendChild(metaEl('Ingen bonger med medlemsnr blant de innlastede bongene i valgte butikker.')); return; }
    box.appendChild(hintEl(M.members + ' ulike medlemsnr på ' + M.sales + ' salg i valgte butikker. Viser de ' + Math.min(15, M.rows.length) + ' med flest funn og bruk (d = dager, b = butikker, kasserer med andel av bongene). Trenger ikke skanning.'));
    var short = { 'flere butikker': 'butikker', 'samme dag': 'dag', 'mye brukt': 'mye', 'én kasserer': 'kasserer', 'eget nummer': 'eget', 'ansatt': 'ansatt' };
    var vText = { 'høy': 'sterk indikasjon', middels: 'mulig, sjekk', lav: 'trolig uskyldig' };
    box.appendChild(tbl(['Medlemsnr', 'Bonger', 'Kasserer', 'Funn', 'Vurdering'], M.rows.slice(0, 15).map(function (r) {
      var bad = r.flags.length > 0 && r.verdict !== 'lav';
      return [{ node: btn(r.id, function () { filters.member = r.id; writeForm(); apply(); say('Viser kvitteringer med medlemsnr ' + r.id + '.'); }, 'kvr-ent') }, { t: r.n + ' (' + r.days + ' d, ' + r.stores + ' b)', bad: bad },
        { node: el('span', {}, [entLink('kasserer', r.cashier, r.cashier), document.createTextNode(' (' + pct(r.share) + ')')]), bad: r.flags.indexOf('én kasserer') !== -1 }, { t: r.flags.map(function (f) { return short[f] || f; }).join(', ') || '–', bad: bad },
        { t: r.verdict ? vText[r.verdict] : '–', bad: r.verdict === 'høy' }];
    })));
    box.appendChild(hintEl('Vurdering: pluginen veier tegn på misbruk (eget nummer, nesten bare hos én kasserer, flere bonger på samme kasse med under 15 min mellom, mange bonger på én dag) mot tegn på en fast kunde eller en husstand som deler nummer (mange ulike kasserere, jevnt fordelt over mange dager). «Trolig uskyldig» vises, men gir ikke poeng.'));
    box.appendChild(hintEl('Funn: to butikker innen ' + (ctlCfg.memberStoreMin || '–') + ' min, minst ' + (ctlCfg.memberDayN || '–') + ' bonger samme dag, totalt ' + (ctlCfg.memberN || '–') + ', og nesten bare hos én kasserer (minst ' + (ctlCfg.memberCashN || '–') + ' bonger, over ' + ctlCfg.memberCashShare + ' % og minst ' + ctlCfg.profFactor + '× kassererens vanlige andel). ' +
      (ctlCfg.empMembers ? 'Ansattliste er på.' : 'Legg inn ansattes medlemsnr under Innstillinger for å fange eget nummer direkte.') + ' Mange bruk av ett nummer kan være en trofast kunde: vurder sammen med hvem som taster det.'));
  }

  function renderMiscCard(R) {
    var box = ui.ctlMisc, P = R.price, K = R.ku, E = R.ev;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Pris per vare' }));
    box.appendChild(metaEl(P.scanned + ' av ' + P.sales + ' salg har enhetspris (ny skanning), ' + P.lines + ' varelinjer. ' + P.groups + ' vare/butikk/dag-grupper har klar vanlig pris. ' + P.deviating + ' varelinjer i omfanget avviker minst ' + (ctlCfg.priceDevPct || '–') + ' %.' + (P.coverage < 1 ? ' Eldre skanninger mangler enhetspris: skann på nytt for full dekning.' : '')));
    if (P.rows.length) box.appendChild(tbl(['Kasserer', 'Avvikende linjer'], P.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.n]; })));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Kjøpeutbytte' }));
    box.appendChild(metaEl(K.members + ' medlemssalg, ' + K.scanned + ' skannet med ny skanning, ' + K.withTable + ' med Kjøpeutbytte-tabell. ' +
      (K.applicable ? 'Tabellen finnes på de fleste medlemsbonger, så fravær regnes som avvik.' : 'Tabellen finnes ikke på nok medlemsbonger (eller for få er skannet) til at fravær regnes som avvik.') +
      (K.ratio !== null ? ' Vanlig forhold grunnlag/varesum: ' + Math.round(K.ratio * 100) + ' %.' : '')));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Hendelsesord' }));
    box.appendChild(metaEl(E.hits + ' av ' + E.scanned + ' skannede bonger har ord som annullert, parkert, manuell eller spør pris. Slike hendelser er ikke observert i ekte data ennå.' + (E.covered ? ' ' + E.covered + ' av dem har bare ord som allerede har egne tester (spør pris, manuell kvittering) og flagges der.' : '') +
      (R.copies ? ' ' + R.copies + ' bongkopier («Bong kopi») flagges bare her og er holdt utenfor de andre testene.' : '')));
    box.appendChild(el('div', { class: 'kvr-row' }, [btn('Diagnostikk: ukjente linjer…', openDiag)]));
    var ML = R.ml;
    if (ML) {
      box.appendChild(el('b', { class: 'kvr-subh', text: 'Maskinlæring: uvanlige bonger' }));
      box.appendChild(metaEl(!ML.applicable ? 'Ikke kjørt: ' + ML.n + ' skannede salg, minst ' + ML.minN + ' trengs (Innstillinger → Maskinlæring).' :
        ML.topPct === null ? 'Uvanlighet er regnet for ' + ML.n + ' skannede salg, men flagging er av (Innstillinger → Maskinlæring).' :
        'Modellen har lært av ' + ML.n + ' skannede salg i datagrunnlaget og flagger ' + ML.flagged + ' bonger i omfanget blant de ' + String(ML.topPct).replace('.', ',') + ' % mest uvanlige (uvanlighet minst ' + Math.round(Math.max(ML.cut, (Number(ctlCfg.mlMinScore) || 60) / 100) * 100) + ' av 100, og minst én egenskap som under 1 % av bongene har). ' +
        (ML.ctx && ML.ctx.on ? 'Hver bong sammenlignes med samme kasse, samme tid på døgnet og kassererens egne bonger, og en egenskap må være uvanlig i minst to av de tre. Grupper med minst ' + ML.ctx.min + ' bonger: ' +
          plur(ML.ctx.ws, 'kasse', 'kasser') + ', ' + plur(ML.ctx.tod, 'tidsrom', 'tidsrom') + ' og ' + plur(ML.ctx.ca, 'kasserer', 'kasserere') + '; mindre grupper sammenlignes med butikken (' + ML.ctx.rows + ' av ' + ML.n + ' bonger har minst to egne grupper). ' :
          'Hver bong sammenlignes med alle bongene (sammenligning med samme kasse, tid og kasserer er av). ') +
        'Den kjører lokalt, uten kall mot CW, og bruker ikke medlemsnummer. Samme data gir samme resultat.'));
      var LN = mlLearnNow();
      box.appendChild(metaEl(!LN.on ? 'Lær av vurderingene er av.' : LN.trained ? 'Lært av ' + LN.pos + ' bonger «Til oppfølging» og ' + LN.neg + ' «Sjekket». Treffsikkerhet på bonger modellen ikke har trent på: ' + (LN.auc === null ? 'for få til å måle' : 'AUC ' + String(Math.round(LN.auc * 100) / 100).replace('.', ',') + ' (0,5 = tilfeldig, 1 = perfekt)' + (LN.auc < 0.65 ? '. Ikke bedre enn tilfeldig ennå: fortsett å merke bonger' : '')) + '. «Sjekk først» kan sorteres etter den.' :
        'Lær av vurderingene: ' + LN.pos + ' «Til oppfølging» og ' + LN.neg + ' «Sjekket» så langt; minst ' + LN.minL + ' av hver trengs.'));
      var SF = R.self, auc = function (v) { return String(Math.round(v * 100) / 100).replace('.', ','); };
      if (SF) box.appendChild(metaEl(!SF.on ? 'Ligner sikre funn er av.' : !SF.applicable ? 'Ligner sikre funn: ' + SF.pos + ' sikre funn og ' + SF.neg + ' rene bonger; minst ' + SF.minPos + ' sikre funn og 30 rene trengs.' :
        'Ligner sikre funn: trent på ' + SF.pos + ' sikre funn og ' + SF.neg + ' rene bonger' + (SF.user ? ' (' + SF.user + ' vurdert av deg)' : '') + ', treffsikkerhet ' + (SF.auc === null ? 'ikke målt' : 'AUC ' + auc(SF.auc)) + '. ' +
        (SF.auc === null || SF.auc < SF.aucMin ? 'Under grensen ' + auc(SF.aucMin) + ', så ingen funn.' : SF.flagged + ' bonger flagget.')));
    }
  }

  // Nettverk: grupper av kort og medlemsnummer som henger sammen, med kassererne kjøpene går gjennom. Klikk en gruppe for diagram.
  var netPick = null;
  function renderNetCard(N) {
    var box = ui.ctlNet;
    if (!N) return;
    box.innerHTML = '';
    if (!N.scanned) { box.appendChild(metaEl('Ingen skannede salg med kortdata. Kort leses fra skanning versjon 6.')); return; }
    box.appendChild(metaEl(N.scanned + ' av ' + N.sales + ' salg er skannet med kortdata. ' + plur(N.groups.length, 'gruppe', 'grupper') + ' med minst tre ledd (medlemsnr og kort). ' + N.links + ' koblinger kort–medlemsnr er brukt; ' + N.weak + ' kort uten utstedernr som bare står én gang med et medlemsnr, er ikke koblet (kan være et annet kort med like siste fire siffer).'));
    if (!N.groups.length) return;
    var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
    box.appendChild(tbl(['Medlemsnr', 'Kort', 'Bonger', 'Mest hos kasserer', 'Retur til kortene', 'Funn'], N.groups.slice(0, 15).map(function (g) {
      var bad = g.flags.length > 0;
      return [{ node: btn(g.members.length + ': ' + g.members.slice(0, 3).join(', ') + (g.members.length > 3 ? ' …' : ''), function () { netPick = g.id; renderNetCard(N); }, 'kvr-ent'), bad: g.members.length >= (Number(ctlCfg.netMembers) || Infinity) },
        g.cards.length + ': ' + g.cards.slice(0, 2).join(', ') + (g.cards.length > 2 ? ' …' : ''), g.n,
        g.top ? { node: el('span', {}, [entLink('kasserer', g.top, g.top), document.createTextNode(' (' + Math.round(g.topShare * 100) + ' %)')]) } : '–',
        { t: g.refunds ? g.refunds + ' (' + fmt(g.refundSum) + ' kr)' : '–', bad: g.refunds > 0 && bad }, { t: uniq(g.flags).join(', ') || '–', bad: bad }];
    })));
    var g = N.groups.filter(function (x) { return x.id === netPick; })[0];
    if (!g) { box.appendChild(hintEl('Klikk et medlemsnr i tabellen for å se gruppen som diagram.')); return; }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Gruppe: ' + g.members.length + ' medlemsnr, ' + g.cards.length + ' kort, ' + g.n + ' bonger' }));
    box.appendChild(netDiagram(g));
    box.appendChild(el('div', { class: 'kvr-row' }, [
      btn('Velg bongene (' + g.ids.length + ')', function () { var byId = {}; allRecs().forEach(function (r) { byId[r.item.transactionId] = r.item; }); g.ids.forEach(function (id) { if (byId[id]) selected[id] = byId[id]; }); apply(); say('Valgt ' + g.ids.length + ' bonger i gruppen.'); }),
      btn('Lukk diagram', function () { netPick = null; renderNetCard(N); })
    ]));
  }
  // Diagram i tre kolonner: kasserere, medlemsnr og kort. Strekene er bonger (tykkere = flere); rødt = retur til kortet.
  function netDiagram(g) {
    var count = function (list) { var o = {}; list.forEach(function (x) { if (x) o[x] = (o[x] || 0) + 1; }); return o; };
    var ks = count(g.edges.map(function (e) { return String(e.k); })), ms = count(g.edges.map(function (e) { return e.m; })), cs = count([].concat.apply([], g.edges.map(function (e) { return e.c; })));
    var top = function (o) { return Object.keys(o).sort(function (a, b) { return o[b] - o[a] || a.localeCompare(b, 'nb', { numeric: true }); }).slice(0, 14); };
    var K = top(ks), M = top(ms), C = top(cs), rows = Math.max(K.length, M.length, C.length, 1), W = 560, H = 30 + rows * 26, X = [70, 280, 490];
    var y = function (list, v) { var i = list.indexOf(v); return i === -1 ? null : 30 + i * 26 + (rows - list.length) * 13; };
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': 'Nettverk for gruppen', class: 'kvr-net' });
    [['Kasserer', X[0]], ['Medlemsnr', X[1]], ['Kort', X[2]]].forEach(function (h) { svg.appendChild(sv('text', { x: h[1], y: 14, 'text-anchor': 'middle', class: 'kvr-net-h', text: h[0] })); });
    var lines = {};
    var link = function (x1, y1, x2, y2, refund) { if (y1 === null || y2 === null) return; var k = [x1, y1, x2, y2, refund ? 1 : 0].join(','); lines[k] = (lines[k] || 0) + 1; };
    g.edges.forEach(function (e) {
      var yk = y(K, String(e.k)), ym = e.m ? y(M, e.m) : null;
      if (ym !== null) link(X[0], yk, X[1], ym, e.refund);
      e.c.forEach(function (c) { var yc = y(C, c); if (ym !== null) link(X[1], ym, X[2], yc, e.refund); else link(X[0], yk, X[2], yc, e.refund); });
    });
    Object.keys(lines).forEach(function (k) {
      var p = k.split(',').map(Number), n = lines[k];
      svg.appendChild(sv('line', { x1: p[0] + 40, y1: p[1], x2: p[2] - 40, y2: p[3], class: p[4] ? 'kvr-net-ret' : 'kvr-net-l', 'stroke-width': String(Math.min(6, 1 + Math.log2(n))) }, [sv('title', { text: n + (n === 1 ? ' bong' : ' bonger') + (p[4] ? ' (retur til kort)' : '') })]));
    });
    var node = function (list, o, x) {
      list.forEach(function (v) {
        var yy = y(list, v), emp = x === X[1] && g.emp.indexOf(v) !== -1;
        svg.appendChild(sv('rect', { x: x - 40, y: yy - 10, width: 80, height: 20, rx: 6, class: 'kvr-net-n' + (emp ? ' kvr-net-emp' : '') }));
        svg.appendChild(sv('text', { x: x, y: yy + 4, 'text-anchor': 'middle', class: 'kvr-net-t', text: (v.length > 12 ? v.slice(0, 11) + '…' : v) }, [sv('title', { text: v + ': ' + o[v] + (o[v] === 1 ? ' bong' : ' bonger') + (emp ? ' (ansattnummer)' : '') })]));
      });
    };
    node(K, ks, X[0]); node(M, ms, X[1]); node(C, cs, X[2]);
    return el('div', { class: 'kvr-net-wrap' }, [svg, hintEl('Strekene er bonger (tykkere = flere). Rødt = retur til kortet' + (g.emp.length ? '; mørk ramme = ansattnummer' : '') + '. Høyst 14 per kolonne.')]);
  }

  // Modellen som lærer av vurderingene (status på bongene). Regnes på nytt når statusene endres; det tar millisekunder.
  var mlLearnCache = null;
  function mlLearnNow() {
    if (!ctlRes || !ctlRes.ml) return { on: false, trained: false, pos: 0, neg: 0, p: {}, why: {} };
    var key = Object.keys(notes).filter(function (id) { return notes[id] && notes[id].status; }).sort().map(function (id) { return id + notes[id].status; }).join('|') + '#' + ctlRes.at + '#' + ctlCfg.mlLearnMin;
    if (mlLearnCache && mlLearnCache.key === key) return mlLearnCache.res;
    var cand = Object.keys(anomMap);
    Object.keys(ctlRes.ml.raw || {}).forEach(function (id) { if (!anomMap[id]) cand.push(id); });
    mlLearnCache = { key: key, res: L.mlLearn(cand, anomMap, notes, ctlRes.ml, ctlCfg) };
    return mlLearnCache.res;
  }

  // Aldri «100 %» hvis noe ikke stemmer: rundes ned til én desimal.
  function pctOf(a, b) {
    if (!b) return '–';
    if (a === b) return '100 %';
    var v = Math.min(99.9, Math.floor(a / b * 1000) / 10);
    return (v % 1 === 0 ? String(v) : v.toFixed(1).replace('.', ',')) + ' %';
  }

  function calText(name, c, tol) {
    return name + ': ' + c.n + ' bonger vurdert, ' + pctOf(c.ok, c.n) + ' stemmer. ' +
      (c.applicable ? 'Kontrollen er aktiv.' : 'Kontrollen er ikke aktiv: færre enn 10 bonger, eller under 80 % stemmer, så regnskapsmåten på bongen er ikke bevist og avvik regnes ikke som funn.');
  }

  function oldScans() {
    return recs.filter(function (r) { var sc = scanMap[r.item.transactionId]; return r.base && r.item.receiptType === 1 && sc && !L.hasV7(sc); });
  }

  function rescanOld() {
    var todo = oldScans();
    if (!todo.length || scanning) return;
    var sec = Math.round(todo.length * 1.1), est = sec >= 60 ? Math.round(sec / 60) + ' min' : sec + ' s';
    confirmBox('Skann på nytt', todo.length + ' bonger har eldre skanning uten topptekst, bunn, kortdata, Totalt, MVA og betalingsreferanse. Skanner dem på nytt (ca. ' + est + '). Hver bong åpnes i CWs visningsfelt, ett oppslag per bong.', 'Skann på nytt', function () {
      scanList(todo).then(function () { apply(); });
    });
  }

  // Kampanjesjekken trenger skannede bonger fra alle kasserere, ikke bare omfanget.
  function popScanTodo() { return todoFor(recs.filter(function (r) { return storeOK(r.item) && r.item.receiptType === 1; })); }
  function scanPopulation() {
    var todo = popScanTodo();
    if (!todo.length || scanning) return;
    confirmBox('Skann hele grunnlaget', todo.length + ' salg i valgte butikker er ikke skannet. Kampanjesjekken ser da bare kassererne i omfanget. Skanner dem (ca. ' + Math.max(1, Math.round(todo.length * 1.1)) + ' s) og kjører analysen på nytt.', 'Skann', async function () {
      await scanList(todo);
      if (ctlRes) { await runChecks(lastMode); if (checkState.at) renderCheck(); }
      apply();
    });
  }

  function rescanReturns() {
    var todo = recs.filter(function (r) { return r.base && r.item.receiptType === 1 && L.maybeReturn(scanMap[r.item.transactionId]); });
    if (!todo.length || scanning) return;
    confirmBox('Skann returbonger på nytt', todo.length + ' bonger med retur er skannet med en eldre versjon som ikke leser returårsaken. Skanner bare dem på nytt (ca. ' + Math.max(1, Math.round(todo.length * 1.1)) + ' s). Kjør analysen på nytt etterpå.', 'Skann', function () {
      scanList(todo).then(function () { apply(); });
    });
  }

  function plur(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function renderLappCard(R) {
    var box = ui.ctlLapp, P = R.lapp;
    if (!P.scanned) { box.appendChild(metaEl('Ingen skannede salg i valgte butikker. Skann og kjør analysen på nytt.')); return; }
    box.appendChild(metaEl(P.scanned + ' av ' + P.sales + ' salg er skannet. Pantemaskin (kode 399): ' + P.mach.n + ' pantelapper, ' + fmt(P.mach.sum) + ' kr. Manuelt innlagt (kode 99): ' + P.man.n + ' pantelapper, ' + fmt(P.man.sum) + ' kr. Slettet: ' + P.del + '. Gjenbrukt: ' + P.reuse + '.'));
    var rows = P.rows.filter(function (r) { return r.bongs || r.del || r.reuse; }).map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.bongs, r.mach.n + ' · ' + fmt(r.mach.sum), { t: r.man.n + ' · ' + fmt(r.man.sum), bad: r.flag }, { t: pct(r.share), bad: r.flag }, r.del, r.reuse];
    });
    if (rows.length) {
      box.appendChild(tbl(['Kasserer', 'Bonger', 'Maskin 399', 'Manuell 99', 'Andel manuell', 'Slettet', 'Gjenbruk'], rows));
      box.appendChild(hintEl('Maskin og manuell vises som antall · kr. Maskin = «399 PANTELAPP», lest fra pantemaskinen. Manuell = «99 PANTELAPP», lagt inn for hånd. Rødt = minst ' + (ctlCfg.lappManualN || '–') + ' bonger med manuell pantelapp og andel over butikkens (' + pct(P.storeShare) + ') × ' + ctlCfg.profFactor + '. Slettet = en pantelapp og en motlinje med samme beløp på samme bong. Gjenbruk = samme sum (minst ' + ctlCfg.pantMin + ' kr) på ulike bonger innen ' + (ctlCfg.lappReuseMin || '–') + ' min, eller samme lappnummer hvis bongen viser det. Flaskepant fra andre butikker gir noen tilfeldige treff.'));
    } else box.appendChild(metaEl('Ingen pantelapper i omfanget.'));
  }

  function renderLinesCard(R) {
    var box = ui.ctlLines, V = R.voids, S = R.special, A = R.ask, C = R.card, M = R.manual;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Slettede og makulerte linjer' }));
    box.appendChild(metaEl(V.scanned + ' av ' + V.sales + ' salg skannet. ' + plur(V.voided, 'varelinje', 'varelinjer') + ' slettet på ' + plur(V.bongs, 'bong', 'bonger') + ', ' + V.combos + ' av dem med pant og kontant tilbake. ' +
      (V.applicable ? 'Makulerte EAN-varer: ' + V.resold + ' solgt på nytt ' + (ctlCfg.voidResaleDay ? 'i butikken samme dag' : 'innen ' + (ctlCfg.voidResaleMin || '–') + ' min') + ', ' + V.unresolved + ' ikke' + (V.inShrink ? ' (' + V.inShrink + ' av dem registrert som svinn samme dag)' : '') + '.' : 'Gjensalg vurderes ikke: under 80 % av salgene er skannet.')));
    var vrows = V.rows.filter(function (r) { return r.lines; }).map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.sales, { t: r.lines, bad: r.flag }, r.unresolved, r.combos]; });
    if (vrows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Slettet', 'Uten gjensalg', 'Pant+kontant'], vrows));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Spesialbetalinger' }));
    if (!S.words.length) box.appendChild(metaEl('Av: ordlisten er tom under Innstillinger.'));
    else {
      box.appendChild(metaEl(S.hits + ' av ' + S.scanned + ' skannede bonger har ett av ordene: ' + S.words.join(', ') + '.'));
      var wr = Object.keys(S.byWord).map(function (w) { return [{ node: btn(w.charAt(0).toUpperCase() + w.slice(1), function () { filters.special = w; writeForm(); apply(); say('Viser kvitteringer med «' + w + '».'); }, 'kvr-ent') }, S.byWord[w].bongs, fmt(S.byWord[w].sum)]; });
      if (wr.length) box.appendChild(tbl(['Ord', 'Bonger', 'Beløp kr'], wr));
      if (S.rows.length) box.appendChild(tbl(['Kasserer', 'Bonger'], S.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, { t: r.n, bad: r.flag }]; })));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Spør pris' }));
    box.appendChild(metaEl('Spør pris: ' + plur(A.lines, 'linje', 'linjer') + ' funnet (' + A.noRef + ' uten sammenligningsgrunnlag samme dag), ' + A.deviating + ' avviker minst ' + (ctlCfg.askDevPct || '–') + ' % fra dagens salg. ' + A.evOnly + ' bonger har ordet «spør pris» uten at linjen er identifisert. Formatet er ikke bekreftet i ekte data.'));
    if (A.rows.length) box.appendChild(tbl(['Kasserer', 'Bonger', 'Avvikende'], A.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, { t: r.n, bad: r.flag }, r.dev]; })));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Returer på samme kort' }));
    if (!C.scanned) box.appendChild(metaEl('Ingen salg med kortdata. Kortnummer leses først i skanning versjon 6: bruk «Skann på nytt» under Bongregnskap.'));
    else {
      box.appendChild(metaEl(C.returns + ' returer blant ' + C.scanned + ' skannede salg, ' + C.withCard + ' med kort på bongen. Samme kort = samme leverandør og samme kortnummer slik det er trykt (siste fire siffer, eventuelt utsteder). Formatet er ikke bekreftet i ekte data.'));
      var cr = C.rows.filter(function (r) { return r.n > 1; }).slice(0, 10).map(function (r) { return [r.label, { t: r.n, bad: r.flag }, r.best, fmt(r.sum), Object.keys(r.cashiers).map(function (k) { return k + ' ×' + r.cashiers[k]; }).join(', ')]; });
      if (cr.length) box.appendChild(tbl(['Kort', 'Returer', 'Innen ' + ctlCfg.cardRetDays + ' d', 'Sum kr', 'Kasserer'], cr));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Retur til kort per leverandør' }));
    var rk = Object.keys(C.refunds).sort(function (a, b) { return C.refunds[b].n - C.refunds[a].n; });
    box.appendChild(hintEl((C.open.schemes.length ? 'Åpen retur (hver retur flagges): ' + C.open.schemes.map(L.schemeLabel).join(', ') + '. ' + plur(C.open.n, 'retur', 'returer') + ' til slike kort, ' + fmt(C.open.sum) + ' kr. ' : 'Åpen retur er av (Innstillinger → Kort: returer). ') +
      'Leverandøren leses fra kortlinjen på bongen eller fra betalingsmåten. Velg en rad for å vise bongene.'));
    if (rk.length) box.appendChild(tbl(['Leverandør', 'Returer', 'Sum kr'], rk.map(function (k) {
      var open = C.open.schemes.indexOf(k) !== -1;
      return [{ node: btn(L.schemeLabel(k) + (open ? ' (åpen retur)' : ''), function () { filters.cardRet = k || '?'; writeForm(); apply(); say('Viser returer til ' + L.schemeLabel(k) + '.'); }, 'kvr-ent') }, { t: C.refunds[k].n, bad: open }, fmt(C.refunds[k].sum)];
    })));
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Manuell kvittering og til gode-lapp' }));
    box.appendChild(metaEl(M.words.length ? M.manual + ' bonger med ordene «' + M.words.join('», «') + '» blant ' + M.scanned + ' skannede; ' + M.findings.length + ' har samme beløp som en annen bong innen ' + ctlCfg.manualDays + ' dager. Ordene er ikke bekreftet i ekte data; se Diagnostikk.' : 'Av: ordlisten er tom under Innstillinger.'));
    renderTempo(box, R.tempo);
    renderWatch(box, R.watch);
    renderRetReason(box, R.retR);
    renderRetEan(box, R.retEan);
    box.appendChild(metaEl('Kortdata krever ny skanning: bruk «Skann på nytt» under Bongregnskap og referanser. Ukjente linjer og ord finner du i Diagnostikk under Pris, kjøpeutbytte og hendelser.'));
  }

  function renderTempo(box, T) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Tempo: tid mellom bonger' }));
    if (!T.sales) { box.appendChild(metaEl('Ingen salg med klokkeslett i omfanget.')); return; }
    var how = T.secOK
      ? 'Listen viser sekunder (' + pct(T.secShare) + ' av bongene). ' + (T.gapOn ? T.series + ' serier på ' + T.inSeries + ' bonger: minst ' + ctlCfg.paceN + ' bonger på samme kasse med høyst ' + ctlCfg.paceSec + ' s mellom.' : 'Serietesten er av.') + (T.minGap !== null ? ' Kortest tid mellom to bonger: ' + T.minGap + ' s.' : '')
      : 'Listen viser bare hele minutter (' + pct(T.secShare) + ' har sekunder). ' + (T.gapOn ? T.series + ' minutter med minst ' + ctlCfg.paceMinuteN + ' bonger på samme kasse.' : 'Testen er av.');
    box.appendChild(metaEl(T.sales + ' salg. ' + how + ' ' + T.zero + ' bonger har sum 0,00 kr.'));
    if (T.rows.length) box.appendChild(tbl(['Kasserer', 'Serier', 'Bonger i serie', '0-kr-bonger'], T.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.series, r.inSeries, { t: r.zero, bad: r.zeroFlag }]; })));
    box.appendChild(hintEl('Raske serier kan være kø med få varer, selvbetjening eller opprydding etter en feil. Se bongene før du konkluderer. Rødt = minst ' + (ctlCfg.zeroN || '–') + ' bonger på 0,00 kr.'));
  }

  function renderWatch(box, W) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Overvåkede varer' }));
    if (!W.terms.length) { box.appendChild(metaEl('Av: legg inn EAN eller del av navn under Innstillinger → Overvåkede varer (for eksempel tobakk, gavekort, energidrikk).')); return; }
    box.appendChild(metaEl(W.bongs + ' av ' + W.scanned + ' skannede salg har varene: ' + W.terms.join(', ') + '.'));
    var tr = Object.keys(W.byTerm).map(function (t) {
      var b = W.byTerm[t];
      return [{ node: btn(t, function () { filters.item = t; writeForm(); apply(); say('Viser kvitteringer med «' + t + '».'); }, 'kvr-ent') }, b.bongs, b.lines, fmt(b.sale), fmt(b.ret), fmt(b.del)];
    });
    if (tr.length) box.appendChild(tbl(['Treff', 'Bonger', 'Linjer', 'Salg kr', 'Retur kr', 'Slettet kr'], tr));
    if (W.rows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Med vare', 'Andel', 'Butikk', 'Retur', 'Slettet'], W.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.sales, { t: r.n, bad: r.flag }, { t: pct(r.share), bad: r.flag }, pct(r.storeShare), r.ret, r.del];
    })));
    box.appendChild(hintEl('Siffer i listen matcher starten på EAN, tekst matcher del av varenavnet. Retur = negativ linje uten motlinje; slettet = linje og motlinje med samme beløp. Rødt = minst ' + (ctlCfg.watchN || '–') + ' bonger og over butikkens andel med ' + ctlCfg.profFactor + '×.'));
  }

  function renderRetReason(box, E) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Retur per årsak' }));
    var oldTxt = E.old ? ' ' + E.old + ' bonger med mulig retur er skannet med en eldre versjon som ikke leser årsaken.' : '';
    if (E.old) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann returbonger på nytt (' + E.old + ')', rescanReturns)]));
    if (!E.bongs) { box.appendChild(metaEl('Ingen returer av varer (utenom pant) blant ' + E.scanned + ' skannede salg.' + oldTxt)); return; }
    box.appendChild(metaEl(E.bongs + ' bonger med ' + E.lines + ' returlinjer (' + fmt(E.sum) + ' kr) blant ' + E.scanned + ' skannede salg. ' +
      (E.words.length ? E.watched + ' bonger har overvåket årsak (' + E.words.join(', ') + ').' : 'Ingen overvåkede årsaker.') + oldTxt));
    box.appendChild(tbl(['Årsak', 'Bonger', 'Linjer', 'Kr', 'Kasserere'], E.reasons.slice(0, 15).map(function (r) {
      var name = r.name === L.NO_RET_REASON ? { t: r.name } : { node: btn(r.name + (r.known ? '' : ' (ukjent årsak)'), function () { filters.text = r.name; writeForm(); apply(); say('Viser kvitteringer med «' + r.name + '».'); }, 'kvr-ent') };
      if (r.watched) name.bad = true;
      return [name, r.bongs, r.lines, fmt(r.sum), r.cashiers.slice(0, 4).map(function (c) { return c.id + ' ×' + c.n; }).join(', ') + (r.cashiers.length > 4 ? ' …' : '')];
    })));
    if (E.words.length && E.rows.length) box.appendChild(tbl(['Kasserer', 'Salg', 'Med retur', 'Overvåket årsak', 'Andel', 'De andre'], E.rows.map(function (r) {
      return [{ node: entLink('kasserer', r.id) }, r.n, r.ret, { t: r.withW, bad: r.flag }, { t: pct(r.share), bad: r.flag }, r.others === null ? '–' : pct(r.others)];
    })));
    box.appendChild(hintEl('Årsaken står på linjen «RETUR VARE» over varen. Klikk en årsak for å vise bongene i listen. Rødt = overvåket årsak, eller kasserer med minst ' + (ctlCfg.retWatchN || '–') + ' slike bonger og minst ' + (ctlCfg.profFactor || '–') + ' ganger andelen hos de andre. Mange returer med matvaregaranti kan være helt i orden; se på bongene, tidspunkt og betaling før du konkluderer.'));
  }

  function renderRetEan(box, E) {
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Retur av vare uten kjøp' }));
    if (!E.on) { box.appendChild(metaEl('Av: se Innstillinger → Retur av vare uten kjøp.')); return; }
    if (!E.applicable) { box.appendChild(hintEl('Ikke vurdert: bare ' + pct(E.coverage) + ' av salgene er skannet (krever minst 80 %). Skann alle salgene og kjør analysen på nytt.')); return; }
    box.appendChild(metaEl(E.returns + ' returer med ' + E.lines + ' vare-linjer vurdert. ' + E.flagged + ' uten kjøp av samme vare (kort ' + E.byCard + ', medlem ' + E.byMember + ', samme dag ' + E.byDay + '). ' + E.short + ' ikke vurdert fordi mindre enn ' + (ctlCfg.retEanDays || '–') + ' dager er lastet før returen, ' + E.unlinked + ' uten kjøp å sammenligne med.'));
    if (E.rows.length) box.appendChild(tbl(['Når', 'Kasserer', 'Grunnlag', 'Linjer', 'Beløp kr'], E.rows.slice(0, 12).map(function (r) { return [r.when, { node: entLink('kasserer', r.cashier) }, r.basis, r.n, fmt(r.amt)]; })));
    box.appendChild(hintEl('Kortet eller medlemmet har andre kjøp i perioden, men ikke denne varen (EAN). Kunden kan ha kjøpt varen før perioden, kontant eller i en annen butikk, så dette er en indikasjon, ikke bevis.'));
  }

  function renderAcctCard(R) {
    var box = ui.ctlAcct, G = R.ledger;
    box.appendChild(metaEl(G.scanned + ' av ' + G.sales + ' salg har ny skanning (' + G.withTot + ' med Totalt). Eldre skanninger mangler Totalt, MVA og betalingsreferanse.'));
    box.appendChild(metaEl(calText('Linjer mot Totalt', G.lines)));
    box.appendChild(metaEl(calText('Betaling mot Totalt', G.pay)));
    box.appendChild(metaEl(calText('MVA-tabell (' + G.vat.tables + ' tabeller)', G.vat) + ' Ugyldig sats flagges uansett.'));
    box.appendChild(metaEl(G.refs.n + ' betalingsreferanser lest, ' + G.refs.dup + ' brukt på flere bonger.'));
    var H = R.hdr;
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Topptekst og bunn' }));
    if (!H.scanned) box.appendChild(metaEl('Ingen salg med topptekst og bunn. Bruk «Skann på nytt» (versjon 7).'));
    else {
      box.appendChild(metaEl(H.withHdr + ' av ' + H.scanned + ' skannede salg har lest topptekst (' + Object.keys(H.fields).map(function (k) {
        var f = H.fields[k];
        return f.name + ': ' + (f.n ? f.ok + ' av ' + f.n + ' stemmer med listen (' + pct(f.rate) + ')' + (f.trusted ? '' : ', ikke kalibrert') : 'ingen lest');
      }).join('; ') + '). ' + H.withFt + ' har tekst fra kortterminalen, ' + H.withAuth + ' med autorisasjonskode, ' + H.auth + ' koder brukt på flere bonger.'));
      box.appendChild(metaEl('Feltet kontrolleres bare når minst 90 % av minst 10 bonger stemmer fra før. Formatet er ikke bekreftet i ekte data: se Diagnostikk for linjene som ikke gjenkjennes.'));
    }
    var old = oldScans().length;
    if (old) box.appendChild(el('div', { class: 'kvr-row' }, [btn('Skann på nytt (' + old + ' eldre)', rescanOld)]));
  }

  // Tilleggsdata fra CW og svinn: innhold per kasserer, innlogging, bongkopi og svinn/internt forbruk.
  function renderCwxCard(R) {
    var box = ui.ctlCwx, C = R.cw, S = R.shift, P = R.copy, W = R.shrink;
    var getBtn = function () { return el('div', { class: 'kvr-row' }, [btn('Hent tilleggsdata fra CW', function () { fetchCwExtra(); }), btn('Til Hent', function () { ui.go('cw'); }, 'kvr-sm')]); };
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Innhold og betaling ifølge CWs filtre' }));
    if (!C.on) { box.appendChild(metaEl('Ikke hentet. «Hent tilleggsdata fra CW» bruker CWs egne filtre på søket i listen og merker bongene med innhold og betaling. Kjør analysen på nytt etterpå.')); box.appendChild(getBtn()); }
    else {
      box.appendChild(metaEl(C.tagged + ' av ' + C.sales + ' salg er merket av CWs filtre. ' + C.combos + ' bonger har en kombinasjon som flagges.' + (cwx && cwx.runs[0] && cwx.runs[0].cut ? ' Søket var kuttet ved 1000 bonger; tallene gjelder bongene i listen.' : '')));
      if (C.tags.length) box.appendChild(tbl(['Innhold', 'Bonger', 'Andel av salg'], C.tags.map(function (t) { return [t.tag.replace(/^Betaling: /, 'Betaling: '), t.n, pct(C.sales ? t.n / C.sales : 0)]; })));
      var cols = C.tags.filter(function (t) { return t.rate; }).slice(0, 6).map(function (t) { return t.tag; });
      var rows = C.rows.filter(function (r) { return cols.some(function (t) { return r.cells[t].n; }); });
      if (cols.length && rows.length) box.appendChild(tbl(['Kasserer', 'Salg'].concat(cols.map(function (t) { return t.replace(/^Betaling: /, ''); })), rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.sales].concat(cols.map(function (t) { var e = r.cells[t]; return e.n ? { t: e.n + ' (' + pct(e.rate) + ')', bad: e.flag } : '–'; }));
      })));
      box.appendChild(hintEl('Rødt = minst ' + (ctlCfg.cwRateN || '–') + ' bonger og minst ' + ctlCfg.profFactor + '× andelen hos de andre kassererne i samme kanal (eller i butikken). Kontant, kreditt, finansiering og skannet pant sammenlignes ikke. Merkingen er CWs egen; se bongene før du konkluderer.'));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Innlogging og utlogging' }));
    if (!S.hasLogins) box.appendChild(metaEl('Ingen innlogginger i grunnlaget. De hentes med «Hent tilleggsdata fra CW».' + (S.dual ? ' ' + S.dual + ' kasserere har salg på to betjente kasser om hverandre (se funn).' : '')));
    else {
      box.appendChild(metaEl(S.logins + ' innlogginger og ' + S.logouts + ' utlogginger gir ' + S.sessions.length + ' økter. ' + S.short + ' korte innlogginger med retur eller sletting, ' + S.dual + ' kasserere med salg på to betjente kasser om hverandre.'));
      if (S.rows.length) box.appendChild(tbl(['Kasserer', 'Økter', 'Tid innlogget', 'Korteste', 'Kasser', 'Kort med retur/sletting'], S.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.sessions, (r.minutes / 60).toFixed(1).replace('.', ',') + ' t', r.shortest === null ? '–' : r.shortest + ' min', r.kasser.join(', '), { t: r.short, bad: r.short > 0 }];
      })));
      box.appendChild(hintEl('En økt varer fra innlogging til utlogging eller neste innlogging på samme kasse. Kort = høyst ' + (ctlCfg.shortMin || '–') + ' min med høyst ' + ctlCfg.shortSales + ' salg.'));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Bongkopier' }));
    if (!P.n) box.appendChild(metaEl('Ingen bongkopier i grunnlaget. De hentes med «Hent tilleggsdata fra CW».'));
    else {
      box.appendChild(metaEl(P.n + ' bongkopier. ' + P.found + ' av de opprinnelige bongene står i listen. ' + P.ret + ' kopier er fulgt av en retur.'));
      box.appendChild(tbl(['Når', 'Kasse', 'Kasserer', 'Kopi av bong', 'Opprinnelig', 'Retur etterpå'], P.copies.slice(0, 15).map(function (x) {
        var o = x.orig;
        return [x.copy.endDateTime.slice(5), x.copy.workstationNumber, { node: entLink('kasserer', x.copy.cashierNumber) }, x.ref || '–',
          o ? o.endDateTime.slice(5) + ' · kasserer ' + o.cashierNumber + ' · ' + fmt(o.totalAmount) : 'ikke i listen',
          x.ret ? { t: x.ret.endDateTime.slice(11) + ' · ' + fmt(x.ret.totalAmount), bad: true } : '–'];
      })));
    }
    box.appendChild(el('b', { class: 'kvr-subh', text: 'Synlig svinn og internt forbruk' }));
    if (!W.n) box.appendChild(metaEl('Ingen bonger med synlig svinn eller internt forbruk i omfanget. I CW hører de til bongtypen Varetransaksjoner.'));
    else {
      box.appendChild(metaEl(W.n + ' registreringer, til sammen ' + fmt(W.kr) + ' kr (' + Object.keys(W.byType).map(function (k) { return k.toLowerCase() + ' ' + W.byType[k].n + ' · ' + fmt(W.byType[k].kr) + ' kr'; }).join(', ') + '). ' + W.scanned + ' av ' + W.n + ' er skannet; varene leses bare fra skannede bonger.'));
      box.appendChild(tbl(['Registrert av', 'Bonger', 'Kr', 'Varelinjer', 'Flagget'], W.rows.map(function (r) { return [{ node: entLink('kasserer', r.id) }, r.n, fmt(r.kr), r.lines, { t: r.flags, bad: r.flags > 0 }]; })));
      if (W.items.length) box.appendChild(tbl(['Vare', 'EAN', 'Linjer', 'Kr'], W.items.slice(0, 10).map(function (e) { return [e.n, e.c, e.lines, fmt(e.kr)]; })));
      box.appendChild(hintEl('Svinn er ofte helt i orden (utgått dato, knust vare). Se etter mønstre: overvåkede varer, samme vare som er returnert samme dag, store beløp og registreringer utenom åpningstid.'));
    }
  }

  function renderAuditCards(R) {
    var D = R.diff;
    if (!D || !D.rows.length) ui.ctlDiff.appendChild(metaEl('Ingen skannede kassaoppgjør i omfanget. Skann og kjør analysen på nytt.'));
    else {
      ui.ctlDiff.appendChild(tbl(['Enhet', 'Oppgjør', 'Minus', 'Pluss', 'Sum minus', 'Netto', 'Siste differanser'], D.rows.map(function (e) {
        return [{ node: entLink(e.kind, e.id) }, e.n, { t: e.minus, bad: e.flag }, e.plus, { t: fmt(e.sumMinus), bad: e.flag }, fmt(e.net),
          e.list.slice(-5).map(function (x) { return (x.diff > 0 ? '+' : '') + String(x.diff).replace('.', ','); }).join(' · ')];
      })));
      ui.ctlDiff.appendChild(hintEl('Rødt = minst ' + ctlCfg.diffRepeatN + ' oppgjør med minus fordelt på flere dager, eller minus totalt over ' + ctlCfg.diffTotal + ' kr. Differanser under ' + ctlCfg.diffMin + ' kr telles ikke.'));
    }
    if (R.corr && R.corr.rows.length) {
      ui.ctlDiff.appendChild(el('b', { class: 'kvr-subh', text: 'Retur mot kassadifferanse per kasserer' }));
      ui.ctlDiff.appendChild(tbl(['Kasserer', 'Dager', 'ρ', 'Differanse', 'Returandel'], R.corr.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.days, { t: r.rho === null ? '–' : r.rho.toFixed(2).replace('.', ','), bad: r.flag }, { t: fmt(r.diff), bad: r.flag }, pct(r.retShare)];
      })));
      ui.ctlDiff.appendChild(hintEl('ρ = Spearman-korrelasjon over dager (minst ' + ctlCfg.corrDays + ', med minst 5 salg og et kassaoppgjør) mellom returandel og kassadifferanse. Negativ ρ betyr at dager med flere returer har mer minus. Rødt = ρ under −' + (ctlCfg.corrRho || '–') + ', samlet minus og returandel over butikkens.'));
    }
    var N = R.numbers, o = N.overall;
    ui.ctlNum.appendChild(hintEl('Benford (første siffer i totalbeløp): ' + o.n + ' bonger · MAD ' + o.mad.toFixed(3) + ' · ' + o.verdict + (o.enough ? '' : ' (for få bonger til en sikker konklusjon; minst ' + ctlCfg.benfordMin + ')') + '. Hele kroner: ' + Math.round(N.storeRound * 100) + ' % av totalene.'));
    if (N.cashiers.length) {
      ui.ctlNum.appendChild(tbl(['Kasserer', 'Bonger', 'MAD', 'Vurdering', 'Hele kroner', 'Siste siffer (p)'], N.cashiers.map(function (c) {
        return [{ node: entLink('kasserer', c.id) }, c.n, { t: c.mad.toFixed(3), bad: c.flagBenford }, c.verdict, { t: pct(c.roundShare), bad: c.flagRound },
          { t: c.digitP === null ? '–' : (c.digitP < 0.0001 ? '< 0,0001' : c.digitP.toFixed(4).replace('.', ',')), bad: c.flagDigit }];
      })));
    }
    renderDiscCard(R.disc);
    renderMemberCard(R.member);
    renderNetCard(R.net);
    renderMiscCard(R);
    renderLappCard(R);
    renderLinesCard(R);
    renderAcctCard(R);
    renderCwxCard(R);
    ui.ctlNum.appendChild(hintEl('MAD under 0,006 er nær Benford, 0,006–0,012 akseptabel, 0,012–0,015 marginal, over 0,015 avvikende (Nigrini). Avvik er en indikasjon som må forklares, ikke et bevis. Kasserere med færre enn ' + ctlCfg.benfordCashMin + ' bonger vurderes ikke.'));
  }

  // Detaljer viser bare kort med funn eller rød markering; resten og dekningstekstene kommer med «Vis alt».
  function tidyResults(R) {
    var kinds = {};
    R.findings.forEach(function (f) { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
    var clean = [];
    ui.ctlJump.innerHTML = '';
    ui.resCards.forEach(function (c) {
      var card = c[2], n = c[3] === null ? R.findings.length : c[3].reduce(function (a, k) { return a + (kinds[k] || 0); }, 0);
      if (c[3] !== null) n += card.querySelectorAll('.kvr-bad').length;
      card.classList.toggle('kvr-nohit', !n);
      card.querySelectorAll('b.kvr-subh').forEach(function (h) {
        var only = true;
        for (var x = h.nextElementSibling; x && !(x.tagName === 'B' && x.classList.contains('kvr-subh')); x = x.nextElementSibling) if (!x.classList.contains('kvr-meta')) { only = false; break; }
        h.classList.toggle('kvr-meta', only);
      });
      if (!n) { clean.push(c[1]); return; }
      ui.ctlJump.appendChild(btn(c[1] + ' ' + n, function () {
        var s = openSec(c[0]);
        if (s) s.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 'kvr-chip'));
    });
    ui.ctlClean.textContent = clean.length ? 'Uten funn: ' + clean.join(', ') + '.' : '';
  }

  function setShowAll(on) {
    showAll = !!on;
    store(K.showall, showAll);
    var p = document.getElementById('kvr-panel');
    if (p) p.classList.toggle('kvr-showall', showAll);
    if (ui.showAllBtn) ui.showAllBtn.textContent = showAll ? 'Vis bare funn' : 'Vis alt';
    if (showAll) foldAll(true);
  }

  function renderControl() {
    if (!ui.ctlProfile) return;
    var R = ctlRes;
    ui.ctlInfo.textContent = R ? 'Sist kjørt ' + R.at.toLocaleTimeString('nb-NO') + ' på ' + R.n + (R.mode === 'visible' ? ' synlige' : ' kvitteringer i omfanget') + '.' : 'Ikke kjørt ennå. Filtrer listen først, og trykk «Kjør alle kontroller».';
    [ui.ctlProfile, ui.ctlFindings, ui.ctlPant, ui.ctlRecon, ui.ctlDiff, ui.ctlNum, ui.ctlDisc, ui.ctlMember, ui.ctlMisc, ui.ctlLapp, ui.ctlLines, ui.ctlAcct, ui.ctlCwx, ui.ctlNet].forEach(function (n) { n.innerHTML = ''; });
    ui.ctlResults.style.display = R ? '' : 'none';
    ui.ctlSumCard.style.display = R ? '' : 'none';
    if (!R) return;
    var profFlag = R.profile.rows.filter(function (r) { return r.flagged; }).length;
    var reconFlag = R.recon.filter(function (r) { return r.flag; }).length;
    var pantFlag = R.pant.balance.filter(function (b) { return b.flag; }).length;
    ui.ctlSum.textContent = R.findings.length + ' funn · ' + Object.keys(anomMap).length + ' flaggede bonger · ' + profFlag + ' kasserere avviker · ' + reconFlag + ' avstemmingsavvik · ' + pantFlag + ' pantavvik' + (R.disc && R.disc.camp && R.disc.camp.pending ? ' · ' + R.disc.camp.pending + ' kampanjer å bekrefte' : '');
    // kassererprofil
    if (!R.profile.rows.length) ui.ctlProfile.appendChild(metaEl('Ingen salg blant synlige kvitteringer.'));
    else {
      var st = R.profile.store, chs = R.profile.channels || [], multi = chs.length > 1;
      var avgRow = function (name, m, last) { return [name, m.count, pct(m.retShare), fmt(m.avg), m.scanned ? m.lapperPer.toFixed(2) : '–', m.scanned ? m.negPer.toFixed(2) : '–'].concat(multi ? [last] : []); };
      var rows = R.profile.rows.map(function (r) {
        return [{ node: entLink('kasserer', r.id) }, r.count, { t: pct(r.retShare), bad: r.flags.retShare }, { t: fmt(r.avg), bad: r.flags.avg },
          r.scanned ? { t: r.lapperPer.toFixed(2), bad: r.flags.lapperPer } : '–', r.scanned ? { t: r.negPer.toFixed(2), bad: r.flags.negPer } : '–'].concat(multi ? [L.channelLabel(r.ch) + (r.refCh === null ? ' (mot butikk)' : '')] : []);
      });
      if (multi) chs.forEach(function (c) { rows.push(avgRow('Snitt ' + c.label.toLowerCase(), c, plur(c.cashiers, 'kasserer', 'kasserere'))); });
      rows.push(avgRow('Butikksnitt', st, ''));
      ui.ctlProfile.appendChild(tbl(['Kasserer', 'Salg', 'Returandel', 'Snitt kr', 'Manuell pant/salg', 'Korr./salg'].concat(multi ? ['Kanal'] : []), rows));
      var refTxt = multi && ctlCfg.profChannel ? 'snittet i kassererens kanal (der hen har flest salg; kanal med én kasserer: butikksnittet)' : 'butikksnittet';
      ui.ctlProfile.appendChild(hintEl('Rødt = minst ' + ctlCfg.profFactor + '× ' + refTxt + ' (snitt også under 1/' + ctlCfg.profFactor + '). Returandel = salg med negativ sum, uten rene pantereturer. Manuell pant = pantelapper med kode 99. Den og korrigeringer (negative varelinjer utenom pant, og linjer merket slettet) krever skanning. Kasserere med færre enn ' + ctlCfg.profMin + ' bonger vurderes ikke.' + (ctlCfg.profShrink ? ' Tallene krympes mot snittet (som ' + ctlCfg.profShrink + ' bonger), så få bonger gir små utslag.' : '')));
    }
    // funn
    if (!R.findings.length) ui.ctlFindings.appendChild(metaEl('Ingen funn med gjeldende terskler.'));
    R.findings.forEach(function (f) {
      var row = el('div', { class: 'kvr-li kvr-fl' + (f.flag ? '' : ' kvr-na') }, [el('div', { class: 'kvr-fl-t' }, [el('b', { text: f.kind + ': ' + f.title }), el('span', { text: f.detail })])]);
      var people = {}, desks = {};
      if (f.cashier) people[f.cashier] = true;
      f.ids.forEach(function (id) { var rr = recById(id); if (rr) { people[rr.item.cashierNumber] = true; desks[rr.item.workstationNumber] = true; } });
      var ents = el('div', { class: 'kvr-ents' });
      Object.keys(people).slice(0, 3).forEach(function (k) { ents.appendChild(entLink('kasserer', k)); });
      Object.keys(desks).slice(0, 3).forEach(function (k) { ents.appendChild(entLink('kasse', k)); });
      row.firstChild.appendChild(ents);
      row.addEventListener('click', function () { var r = f.ids.map(recById).filter(Boolean)[0]; if (r) jumpTo(r); else say('Kvitteringen er ikke i gjeldende liste.'); });
      row.appendChild(btn('Velg', function (e) {
        e.stopPropagation();
        f.ids.forEach(function (id) { var r = recById(id); if (r) selected[id] = r.item; });
        apply();
      }, 'kvr-sm'));
      ui.ctlFindings.appendChild(row);
    });
    ui.ctlFindings.appendChild(metaEl('Funn merket som avvik får rød markering og vises under «Kun avvik».'));
    // pantebalanse
    if (!R.pant.balance.length) ui.ctlPant.appendChild(metaEl('Ingen skannede salg.'));
    else {
      ui.ctlPant.appendChild(tbl(['Dag', 'Butikk', 'Pant salg', 'Pantelapper ut', 'Diff'], R.pant.balance.map(function (b) {
        return [b.day, L.storeShort(b.store), fmt(b.sale), { t: fmt(b.ret), bad: b.flag }, fmt(b.diff)];
      })));
      ui.ctlPant.appendChild(hintEl('Rødt = utbetalt panteretur er over ' + ctlCfg.pantRatio + '× pantesalget samme dag. Pantelapper kan stamme fra flasker kjøpt andre steder, så vurder over flere dager.'));
    }
    // dagsavstemming
    if (!R.recon.length) ui.ctlRecon.appendChild(metaEl('Ingen skannede salg eller kassaoppgjør.'));
    else {
      ui.ctlRecon.appendChild(tbl(['Dag', 'Kasse', 'Kontant', 'Tilbake', 'Bank/kort', 'Forventet', 'Telt', 'Diff'], R.recon.map(function (r) {
        return [r.day, { node: entLink('kasse', r.kasse, String(r.kasse)) }, fmt(r.pay['Kontant'] || 0), fmt(r.pay['Kontant tilbake'] || 0), fmt(r.pay['Bank'] || 0), fmt(r.expected),
          r.settleCount ? fmt(r.telt) : '–', r.diff === null ? 'ingen oppgjør' : { t: fmt(r.diff) + (r.complete ? '' : ' *'), bad: r.flag }];
      })));
      ui.ctlRecon.appendChild(hintEl('Forventet = kontant − kontant tilbake fra skannede salg. Telt = telt kontant i kassaoppgjør samme dag og kasse. Diff = telt − forventet. * = ikke alle salg er skannet. Oppgjør etter midnatt eller samlet over flere dager gir falske avvik. Rapport-fanens «Diff» er oppgjørets egen differanse.'));
    }
    renderAuditCards(R);
    tidyResults(R);
  }

