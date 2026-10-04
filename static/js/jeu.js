// ══════════════════════════════════════════════════════════════════
// jeu.js — Client WorldFront
// Connexion WebSocket, etat local, barre de ressources, inspecteur de
// case, ordres militaires, panneaux, notifications.
// ══════════════════════════════════════════════════════════════════

import { Carte } from './carte.js';
import { ico, esc, fmt, fmtPop, duree, signe, Grille, coutBatiment, contraste } from './util.js';
import { PANNEAUX, drapeau, cout, nomCase, statutArmee, listeChat, ICONES_EVT, menuCase, menuConquete } from './panneaux.js';

const $ = s => document.querySelector(s);
const corps = document.body;

const S = {
  defs: null, joueur: null, vitesse: 1, g: null, carte: null,
  moi: null, pays: new Map(), blocs: new Map(), classement: [],
  relations: {}, propositions: [], armees: [], missions: [], missiles: [],
  evenements: [], chat: [], prix: [], histPrix: [[], [], [], [], [], []],
  selCase: null, selArmee: null, prodCase: null, ordre: null,
  panneau: null, brancheRecherche: 'militaire', categorie: 'global', filtreJournal: 'tout', canal: 'global',
  nonLus: { journal: 0, chat: 0 }, pret: false,
};
window.WF = S; // pratique pour le debogage depuis la console

// ══════════════════════════════════════════════════════════════════
// Connexion
// ══════════════════════════════════════════════════════════════════
let ws = null, reqId = 0, echecs = 0, dejaInit = false;
const attente = new Map();

function connecter() {
  // Chemin relatif a la page : fonctionne a la racine comme derriere
  // un prefixe de reverse proxy (ex. https://vex.exemple/worldfront/).
  const base = location.pathname.replace(/[^/]*$/, '');
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + 'ws';
  ws = new WebSocket(url);
  ws.onopen = () => { echecs = 0; etatConnexion(true); };
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'init') recevoirInit(m);
    else if (m.t === 'etat') recevoirEtat(m);
    else if (m.t === 'reponse') {
      const r = attente.get(m.req);
      attente.delete(m.req);
      if (r) r(m);
    }
  };
  ws.onclose = () => {
    etatConnexion(false);
    echecs++;
    if (echecs >= 3) verifierSession();
    setTimeout(connecter, Math.min(8000, 1000 * echecs));
  };
}

async function verifierSession() {
  try {
    const r = await fetch('jeu', { redirect: 'manual', cache: 'no-store' });
    if (r.type === 'opaqueredirect' || r.status === 302 || r.status === 303) {
      modale(`<div class="wf-modale-tete">${ico('user-clock')}<h2>Session VEX expirée</h2></div>
        <p>Votre session VEX a expiré (elle dure une heure). Reconnectez-vous à VEX puis revenez ici : votre nation vous attend.</p>
        <div class="wf-boutons fin"><a class="wf-btn" href="${esc(corps.dataset.connexion)}">${ico('right-to-bracket')} Se reconnecter</a></div>`, { fermable: false });
    }
  } catch { /* serveur injoignable : on reessaie */ }
}

function etatConnexion(ok) {
  $('#wf-connexion').classList.toggle('ko', !ok);
  $('#wf-connexion').title = ok ? 'Connecté au serveur' : 'Connexion perdue — reconnexion…';
  $('#wf-hors-ligne').hidden = ok || !dejaInit;
}

function envoyer(action, params = {}) {
  return new Promise(ok => {
    if (!ws || ws.readyState !== 1) { toast('Connexion au serveur perdue.', 'err'); ok({ ok: false }); return; }
    const req = ++reqId;
    attente.set(req, ok);
    ws.send(JSON.stringify({ action, req, ...params }));
    setTimeout(() => { if (attente.has(req)) { attente.delete(req); ok({ ok: false, msg: 'Pas de réponse du serveur.' }); } }, 10000);
  });
}

async function agir(action, params = {}, silencieux = false) {
  const r = await envoyer(action, params);
  if (r.msg && (!silencieux || !r.ok)) toast(r.msg, r.ok ? 'ok' : 'err');
  return r;
}

// ══════════════════════════════════════════════════════════════════
// Reception
// ══════════════════════════════════════════════════════════════════
function recevoirInit(m) {
  S.defs = m.defs;
  S.joueur = m.joueur;
  S.vitesse = m.vitesse || 1;
  S.cotes = m.carte.cotes;
  S.g = new Grille(m.carte.largeur, m.carte.hauteur);
  if (!dejaInit) {
    S.carte = new Carte($('#wf-carte-3d'), m, {
      clic: clicCarte, clicDroit: clicDroitCarte, survol: survolCarte,
      flash: () => { const f = $('#wf-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); },
    });
    S.carte.cotes = m.carte.cotes;
    S.carte.vitesseJeu = S.vitesse;
    dejaInit = true;
  }
  $('#wf-chargement').classList.add('fini');
  construireMenu();
}

function recevoirEtat(e) {
  const premier = !S.pret;
  if (e.publics) {
    S.pays = new Map(e.publics.pays.map(p => [p.id, p]));
    S.blocs = new Map(e.publics.blocs.map(b => [b.id, b]));
    S.classement = e.publics.classement;
    S.carte.majPublics(e.publics);
  }
  const avant = S.moi;
  S.moi = e.moi;
  S.relations = e.relations || {};
  S.propositions = e.propositions || [];
  S.armees = e.armees || [];
  S.missions = e.missions || [];
  S.missiles = e.missiles || [];
  S.prix = e.prix || S.prix;
  S.prix.forEach((p, i) => { const h = S.histPrix[i]; h.push(p); if (h.length > 90) h.shift(); });
  S.carte.setMoi(S.moi ? S.moi.id : null);
  S.carte.setRelations(S.relations);
  S.carte.majEtat(e);
  S.carte.majCommandants(S.moi);
  recuA = performance.now();

  // Evenements
  for (const ev of e.evenements || []) {
    S.evenements.push(ev);
    if (!premier) {
      if (S.panneau !== 'journal') S.nonLus.journal++;
      if (['alerte', 'victoire', 'nucleaire', 'guerre', 'annonce', 'recherche'].includes(ev.genre) || (ev.pays != null && ev.genre === 'construction')) {
        const [ic] = ICONES_EVT[ev.genre] || ['circle-info'];
        toast(ev.texte, ev.genre === 'alerte' || ev.genre === 'nucleaire' || ev.genre === 'guerre' ? 'alerte' : ev.genre === 'victoire' ? 'ok' : 'info', ic, ev.case);
      }
    }
  }
  if (S.evenements.length > 400) S.evenements.splice(0, S.evenements.length - 400);
  for (const c of e.chat || []) {
    S.chat.push(c);
    if (!premier && c.auteur !== S.joueur.nom && S.panneau !== 'chat') S.nonLus.chat++;
  }
  if (S.chat.length > 400) S.chat.splice(0, S.chat.length - 400);

  if (S.selArmee != null && !S.armees.some(a => a.id === S.selArmee)) choisirArmee(null);
  S.pret = true;

  majBarre();
  majMenu();
  majInspecteur();
  majAlertes();
  majPanneau(false);
  if (premier) {
    if (S.moi) S.carte.centrerSur(S.moi.capitale, 30);
    else if (!sessionStorage.getItem('wf-fondation-vue')) ouvrirFondation();
  }
  if (S.moi && S.moi.elimine && (!avant || !avant.elimine)) ouvrirAneantie();
}

// ══════════════════════════════════════════════════════════════════
// Barre de ressources
// ══════════════════════════════════════════════════════════════════
function majBarre() {
  const b = $('#wf-resbar');
  const m = S.moi;
  if (!m) {
    b.innerHTML = `<div class="wf-res-vide">${ico('earth-europe')} Mode observateur — <button class="wf-lien" data-act="fonder">fondez votre nation</button> pour entrer dans la partie.</div>`;
    return;
  }
  const bl = m.bilan;
  const res = S.defs.ressources.map((r, i) => {
    const net = bl.prod[i] - bl.conso[i];
    const cap = i === 0 ? bl.stock * 20 : bl.stock;
    const plein = m.res[i] >= cap * 0.98;
    return `<div class="wf-res ${net < 0 && m.res[i] < 50 ? 'critique' : ''} ${plein ? 'plein' : ''}" title="${esc(r.nom)} : ${fmt(m.res[i])} / ${fmt(cap)}\nProduction ${signe(bl.prod[i])}/min · consommation ${fmt(bl.conso[i], 1)}/min">
      ${ico(r.icone, '', `color:${r.couleur}`)}<b>${fmt(m.res[i])}</b><small class="${net >= 0 ? 'pos' : 'neg'}">${signe(net * S.vitesse)}</small></div>`;
  }).join('');
  const elecOk = bl.elec_ratio >= 0.999;
  const protection = Math.max(0, m.protection - Date.now() / 1000);
  const enrichi = m.ur_enrichi > 0 || bl.niv?.enrichissement || bl.niv?.centrale_nucleaire
    ? `<div class="wf-res" title="Uranium enrichi : ${fmt(m.ur_enrichi, 1)} (pour les centrales nucléaires)">${ico('flask-vial', '', 'color:#16a34a')}<b>${fmt(m.ur_enrichi)}</b></div>` : '';
  b.innerHTML = `${res}${enrichi}
    <span class="wf-res-sep"></span>
    <div class="wf-res" title="Population : ${fmtPop(m.pop)} / ${fmtPop(bl.pop_cap)}">${ico('people-group')}<b>${fmtPop(m.pop).replace(' hab.', '')}</b></div>
    <div class="wf-res" title="Influence (${signe(bl.influence)}/min)">${ico('handshake')}<b>${fmt(m.influence)}</b></div>
    <div class="wf-res" title="Recherche : ${signe(bl.recherche)} pts/min">${ico('flask')}<b>${signe(bl.recherche * S.vitesse)}</b></div>
    <div class="wf-res ${elecOk ? '' : 'critique'}" title="Électricité : ${fmt(bl.elec_prod)} produits / ${fmt(bl.elec_cons)} consommés">${ico('bolt', '', 'color:#facc15')}<b>${fmt(bl.elec_prod - bl.elec_cons)}</b></div>
    <div class="wf-res" title="Provinces / capacité territoriale">${ico('map-location-dot')}<b>${bl.cases}/${bl.capacite}</b></div>
    <span class="wf-espace"></span>
    ${protection > 0 ? `<div class="wf-res bleu" title="Aucune nation ne peut vous déclarer la guerre (sauf si vous attaquez)">${ico('shield-halved')}<b>${duree(protection)}</b></div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// Menu lateral
// ══════════════════════════════════════════════════════════════════
const MENU = [
  ['carte', 'Carte du monde', 'earth-europe'], ['pays', 'Mon pays', 'flag'], ['construction', 'Construction', 'helmet-safety'],
  ['armee', 'Armées', 'person-military-rifle'], ['recherche', 'Recherche', 'flask'], ['diplomatie', 'Diplomatie', 'handshake'],
  ['blocs', 'Blocs & alliances', 'people-group'], ['marche', 'Marché mondial', 'scale-balanced'], ['classement', 'Classements', 'ranking-star'],
  ['journal', 'Journal', 'newspaper'], ['chat', 'Messagerie', 'comments'], ['aide', 'Guide', 'circle-question'],
];

function construireMenu() {
  const admin = S.joueur.admin;
  $('#wf-menu').innerHTML = MENU.map(([id, nom, ic], k) => `
    <a href="#" class="nav-sidebar-item-7844 wf-menu-item" data-act="ouvrir" data-panneau="${id}" title="${nom} (${k < 9 ? k + 1 : ''})">
      ${ico(ic, 'sidebar-ico')}<span>${nom}</span><span class="wf-badge" data-badge="${id}" hidden></span></a>`).join('')
    + (admin ? `<div class="nav-sidebar-divider-7844"></div><a href="#" class="nav-sidebar-item-7844 admin-item wf-menu-item" data-act="ouvrir" data-panneau="admin">${ico('shield-halved', 'sidebar-ico')}<span>Administration</span></a>` : '');
  majMenu();
}

function majMenu() {
  document.querySelectorAll('.wf-menu-item').forEach(a => a.classList.toggle('active', a.dataset.panneau === (S.panneau || 'carte')));
  const badge = (id, n) => { const b = document.querySelector(`[data-badge="${id}"]`); if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; } };
  badge('journal', S.nonLus.journal);
  badge('chat', S.nonLus.chat);
  const props = S.moi ? S.propositions.filter(p => p.a === S.moi.id).length : 0;
  badge('diplomatie', props);
  const bloc = S.moi?.bloc != null ? S.blocs.get(S.moi.bloc) : null;
  badge('blocs', bloc && bloc.chef === S.moi.id ? bloc.candidats.length : (S.moi ? [...S.blocs.values()].filter(b => b.invites.includes(S.moi.id)).length : 0));
  const m = S.moi;
  $('#wf-nation').innerHTML = m
    ? `${drapeau(m, 42)}<div><b>${esc(m.nom)}</b><small>${esc(S.defs.specialisations.find(s => s.id === m.spe)?.nom || '')}</small></div>`
    : `<button class="wf-btn plein" data-act="fonder">${ico('flag')} Fonder ma nation</button>`;
}

// ══════════════════════════════════════════════════════════════════
// Panneaux
// ══════════════════════════════════════════════════════════════════
function ouvrirPanneau(id, opts = {}) {
  if (id === 'carte' || (id === S.panneau && !opts.garder)) {
    S.panneau = null;
    corps.classList.remove('wf-panneau-ouvert');
  } else {
    S.panneau = id;
    if (id === 'journal') S.nonLus.journal = 0;
    if (id === 'chat') { S.nonLus.chat = 0; if (opts.canal) S.canal = opts.canal; }
    corps.classList.add('wf-panneau-ouvert');
    const p = PANNEAUX[id];
    $('#wf-panneau-titre').innerHTML = `${ico(p.icone)}<span>${esc(p.titre)}</span>`;
    $('#wf-panneau-corps').scrollTop = 0;
  }
  majMenu();
  majPanneau(true);
}

let dernierRendu = '';
function majPanneau(force) {
  const id = S.panneau;
  if (!id || !S.defs) return;
  const p = PANNEAUX[id];
  const el = $('#wf-panneau-corps');
  if (p.statique && !force) return;
  if (!force && el.contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName)) {
    if (p.partiel) majChat();
    return;
  }
  const html = p.rendre(S);
  if (force || html !== dernierRendu) {
    const gardes = {};
    el.querySelectorAll('[data-garder]').forEach(i => { if (i.id) gardes[i.id] = i.value; });
    const scroll = el.scrollTop;
    el.innerHTML = html;
    if (!force) {
      for (const [k, v] of Object.entries(gardes)) { const i = document.getElementById(k); if (i) i.value = v; }
      el.scrollTop = scroll;
    }
    dernierRendu = html;
  }
  if (p.partiel) majChat(force);
}

function majChat(force) {
  const l = $('#wf-chat-liste');
  if (!l) return;
  const bas = l.scrollHeight - l.scrollTop - l.clientHeight < 60;
  const html = listeChat(S);
  if (l.dataset.h !== String(html.length) || force) {
    l.innerHTML = html;
    l.dataset.h = String(html.length);
    if (bas || force) l.scrollTop = l.scrollHeight;
  }
}

// ══════════════════════════════════════════════════════════════════
// Carte : clics, survol, inspecteur
// ══════════════════════════════════════════════════════════════════
function armeesSur(i) { return S.armees.filter(a => a.case === i); }
function mesArmeesSur(i) { return armeesSur(i).filter(a => S.moi && a.proprio === S.moi.id); }

function clicCarte(i, e) {
  if (i < 0) return;
  if (S.ordre) { executerOrdre(i); return; }
  const miennes = mesArmeesSur(i);
  if (miennes.length && S.selCase === i) {
    // Clics successifs : on passe d'une armee a l'autre sur la meme case.
    const k = miennes.findIndex(a => a.id === S.selArmee);
    choisirArmee(k + 1 < miennes.length ? miennes[k + 1].id : null);
  } else if (miennes.length) {
    choisirArmee(miennes[0].id);
  } else if (!e?.shiftKey) {
    choisirArmee(null);
  }
  choisirCase(i);
}

function clicDroitCarte(i) {
  if (i < 0) return;
  if (S.ordre) { annulerOrdre(); return; }
  const a = S.armees.find(x => x.id === S.selArmee);
  if (!a || !S.moi || a.proprio !== S.moi.id) return;
  if (a.dom === 'terre' || a.dom === 'mer') agir('deplacer', { armee: a.id, cible: i });
  else if (a.dom === 'air') demarrerOrdre('mission', a);
}

function survolCarte(i, e) {
  const t = $('#wf-survol');
  // La case selectionnee a deja son menu juste a cote : pas d'infobulle.
  if (i == null || !S.defs || i === S.selCase) { t.hidden = true; return; }
  const p = S.carte.proprio[i] >= 0 ? S.pays.get(S.carte.proprio[i]) : null;
  const b = S.carte.bat[i];
  const d = S.carte.depot[i];
  const nb = armeesSur(i).length;
  let dist = '';
  if (S.ordre) {
    const a = S.armees.find(x => x.id === S.ordre.armee);
    if (a) dist = ` · ${S.g.distance(a.case, i)} cases`;
  }
  t.innerHTML = `<b>${esc(nomCase(S, i))}</b>${dist}
    ${p ? `<div>${drapeau(p, 16)} ${esc(p.nom)}</div>` : ''}
    ${b ? `<div>${ico(S.defs.batiments.find(x => x.id === b)?.icone)} ${esc(S.defs.batiments.find(x => x.id === b)?.nom)} ${S.carte.niv[i]}</div>` : ''}
    ${d ? `<div>${ico(S.defs.depots[d].icone)} ${esc(S.defs.depots[d].nom)}</div>` : ''}
    ${S.carte.irr[i] ? `<div class="neg">${ico('radiation')} Zone irradiée</div>` : ''}
    ${nb ? `<div>${ico('flag')} ${nb} armée${nb > 1 ? 's' : ''}</div>` : ''}`;
  t.hidden = false;
  const r = $('#wf-carte').getBoundingClientRect();
  t.style.left = Math.min(r.width - 230, e.clientX - r.left + 16) + 'px';
  t.style.top = Math.min(r.height - 120, e.clientY - r.top + 14) + 'px';
}

function choisirCase(i) {
  S.selCase = i;
  S.carte.selectionnerCase(i);
  if (i != null) $('#wf-survol').hidden = true;
  majInspecteur();
  if (S.panneau === 'construction') majPanneau(true);
}

function choisirArmee(id) {
  S.selArmee = id;
  S.carte.selectionnerArmee(id);
  majInspecteur();
  if (S.panneau === 'armee') majPanneau(true);
}

let dernierInsp = '';
function majInspecteur(force) {
  const el = $('#wf-inspecteur');
  const i = S.selCase;
  if (i == null || !S.defs) { el.hidden = true; return; }
  const m = S.moi;
  const t = S.defs.terrains[S.carte.terrain[i]];
  const pid = S.carte.proprio[i];
  const p = pid >= 0 ? S.pays.get(pid) : null;
  const b = S.carte.bat[i];
  const bd = b ? S.defs.batiments.find(x => x.id === b) : null;
  const d = S.carte.depot[i];
  const rel = p && m && p.id !== m.id ? (S.relations[p.id]?.etat || 'paix') : null;
  const vue = !S.carte.vision || S.carte.vision[i];

  let actions = menuCase(S, i);
  // Province neutre qui touche votre territoire, ou qu'une de vos flottes
  // longe (debarquement depuis la mer, voir flotte_adjacente dans jeu.rs).
  const voisinsI = S.g.voisins(i);
  const flotteACote = m && S.armees.some(a => a.proprio === m.id && a.dom === 'mer' && voisinsI.includes(a.case));
  if (m && !m.elimine && pid < 0 && t.terre && (voisinsI.some(v => v >= 0 && S.carte.proprio[v] === m.id) || flotteACote)) {
    actions += menuConquete(S, i);
  }

  const liste = armeesSur(i);
  const armeesHtml = liste.map(a => {
    const ap = S.pays.get(a.proprio);
    const mienne = m && a.proprio === m.id;
    const u = S.defs.unites.find(x => x.id === a.principal);
    return `<div class="wf-insp-armee ${a.id === S.selArmee ? 'actif' : ''} ${mienne ? 'cliquable' : ''}" ${mienne ? `data-act="sel_armee" data-armee="${a.id}"` : ''}>
      <span class="wf-pastille-armee" style="background:${esc(ap?.couleur || '#607d8b')};color:${contraste(ap?.couleur || '#607d8b')}">${ico(u?.icone)}</span>
      <div class="wf-ligne-corps"><b>${mienne ? esc(a.nom) : esc(ap?.nom || '?')}</b>
      <small>${a.unites ? Object.entries(a.unites).map(([k, n]) => `${n} ${esc(S.defs.unites.find(x => x.id === k)?.nom || k)}`).join(', ') : `environ ${a.estimation} unités`}</small></div>
    </div>`;
  }).join('');

  const html = `<div class="wf-insp-tete" style="--pc:${esc(p?.couleur || t.couleur)}">
      <span class="wf-carre" style="background:${t.couleur}"></span>
      <div class="wf-ligne-corps"><b>${esc(t.nom)}</b> <small>(${S.g.xy(i).join(', ')})${S.cotes[i] === '1' ? ' · côte' : ''}</small></div>
      <button class="wf-btn-ic" data-act="deselection" title="Fermer (Échap)">${ico('xmark')}</button>
    </div>
    <div class="wf-insp-corps">
      <div class="wf-insp-ligne">${p ? `${drapeau(p, 20)} <b>${esc(p.nom)}</b> ${m && p.id === m.id ? '<span class="wf-puce accent">vous</span>' : rel ? `<span class="wf-rel ${rel}">${rel === 'guerre' ? 'En guerre' : rel === 'pna' ? 'Pacte' : 'Paix'}</span>` : ''}` : `${ico('flag')} <i>Territoire neutre</i>`}</div>
      ${d ? `<div class="wf-insp-ligne">${ico(S.defs.depots[d].icone, '', `color:${S.defs.depots[d].couleur}`)} ${esc(S.defs.depots[d].nom)}</div>` : ''}
      ${bd ? `<div class="wf-insp-ligne">${ico(bd.icone)} ${esc(bd.nom)} <b>niv. ${S.carte.niv[i]}</b></div>` : ''}
      ${S.carte.irr[i] ? `<div class="wf-insp-ligne neg">${ico('radiation')} Zone irradiée</div>` : ''}
      ${t.terre ? `<div class="wf-insp-ligne petit">${ico('person-hiking')} Déplacement ×${String(t.cout_mvt).replace('.', ',')} · ${ico('shield-halved')} défense +${Math.round(t.defense * 100)} %</div>` : ''}
      ${!vue ? `<div class="wf-insp-ligne petit">${ico('eye-slash')} Hors de votre champ de vision</div>` : ''}
      ${armeesHtml ? `<div class="wf-insp-armees">${armeesHtml}</div>` : ''}
      ${actions}
      ${carteArmee()}
    </div>`;
  // Re-rendu a chaque tick : on garde le defilement et les quantites
  // saisies, et on ne touche a rien pendant une saisie.
  const saisie = el.contains(document.activeElement) && /input|select|textarea/i.test(document.activeElement.tagName);
  if (force || (!saisie && (html !== dernierInsp || el.hidden))) {
    const gardes = {};
    el.querySelectorAll('[data-garder]').forEach(x => { if (x.id) gardes[x.id] = x.value; });
    const scroll = el.scrollTop;
    const memeCase = el.dataset.case === String(i);
    el.innerHTML = html;
    el.dataset.case = i;
    if (memeCase) {
      for (const [k, v] of Object.entries(gardes)) { const x = document.getElementById(k); if (x && el.contains(x)) x.value = v; }
      el.scrollTop = scroll;
    }
    dernierInsp = html;
  }
  el.hidden = false;
}

// ── Suivi de la carte : menu ancre a la case, comptes a rebours ──
// Le menu de la case selectionnee s'ouvre juste a cote d'elle et la
// suit quand on deplace la camera (sauf sur petit ecran, ou il reste
// en bas). Au-dessus de chaque chantier / production en cours, une
// etiquette affiche le temps restant, interpole entre deux ticks.
const PETIT_ECRAN = matchMedia('(max-width: 760px)');
let recuA = performance.now();
const etiquettes = new Map(); // cle -> element

function placerInspecteur() {
  const el = $('#wf-inspecteur');
  if (el.hidden || S.selCase == null) return;
  if (PETIT_ECRAN.matches) { el.classList.remove('ancre'); el.style.left = el.style.top = ''; return; }
  const zone = $('#wf-carte');
  const W = zone.clientWidth, H = zone.clientHeight;
  const w = el.offsetWidth, h = el.offsetHeight;
  const p = S.carte.ecranDe(S.selCase, 0.3);
  const marge = 10, ecart = 26;
  let x = p.x + ecart;
  if (x + w > W - marge) x = p.x - ecart - w;          // pas la place a droite : a gauche
  x = Math.max(marge, Math.min(W - w - marge, x));
  let y = p.y - Math.min(70, h / 2);
  y = Math.max(58, Math.min(H - h - marge, y));        // sous la barre d'outils
  el.classList.add('ancre');
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
}

function tachesEnCours() {
  const m = S.moi;
  if (!m || m.elimine) return [];
  const ecoule = (performance.now() - recuA) / 1000 * S.vitesse;
  const out = [];
  const vit = Math.max(0.01, m.bilan.vitesse);
  let k = 0;
  m.chantiers.forEach(c => {
    const annexion = c.bat === 'annexion';
    const actif = annexion || k++ < m.bilan.slots;
    const v = annexion ? 1 : vit;
    const d = annexion ? { icone: 'person-military-pointing' } : S.defs.batiments.find(x => x.id === c.bat);
    const reste = actif ? Math.max(0, c.reste / v - ecoule) / S.vitesse : null;
    out.push({ cle: 'c' + c.id, case: c.case, icone: d?.icone || 'helmet-safety', reste, prog: 1 - (actif ? reste * S.vitesse * v : c.reste) / c.total });
  });
  const robot = 1 + 0.07 * (m.mods.robotique || 0);
  const vues = new Set();
  for (const p of m.productions) {
    if (vues.has(p.case)) continue; // seule la tete de file avance
    vues.add(p.case);
    const niv = Math.max(1, S.carte.niv[p.case] || 1);
    const taux = (1 + 0.25 * (niv - 1)) * (1 + (vit - 1) * 0.5) * robot;
    const reste = Math.max(0, p.reste / taux - ecoule) / S.vitesse;
    const u = S.defs.unites.find(x => x.id === p.unite);
    const file = m.productions.filter(x => x.case === p.case).length;
    out.push({ cle: 'p' + p.id, case: p.case, icone: u?.icone || 'industry', reste, qte: p.qte, file, prog: 1 - reste * S.vitesse * taux / p.total, prod: true });
  }
  return out;
}

function placerEtiquettes() {
  const zone = $('#wf-carte');
  const loin = S.carte.cam.d > 75;
  const taches = loin ? [] : tachesEnCours();
  // Plusieurs taches sur une meme case : on les empile.
  const parCase = new Map();
  const vues = new Set();
  for (const t of taches) {
    const rang = parCase.get(t.case) || 0;
    parCase.set(t.case, rang + 1);
    const p = S.carte.ecranDe(t.case, 1.9);
    if (!p.devant || p.x < -60 || p.y < -30 || p.x > zone.clientWidth + 60 || p.y > zone.clientHeight + 30) continue;
    let el = etiquettes.get(t.cle);
    if (!el) {
      el = document.createElement('div');
      el.className = 'wf-minuteur' + (t.prod ? ' prod' : '');
      zone.appendChild(el);
      etiquettes.set(t.cle, el);
    }
    vues.add(t.cle);
    const texte = t.reste == null ? 'en attente' : t.reste < 1 ? 'terminé' : minuteur(t.reste);
    const html = `${ico(t.icone)}${t.qte > 1 ? `<small>${t.qte}×</small>` : ''}<b>${texte}</b>${t.file > 1 ? `<small>+${t.file - 1}</small>` : ''}<span style="width:${Math.round(Math.max(0, Math.min(1, t.prog)) * 100)}%"></span>`;
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    el.classList.toggle('attente', t.reste == null);
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - rang * 24)}px) translate(-50%, -100%)`;
  }
  for (const [k, el] of etiquettes) if (!vues.has(k)) { el.remove(); etiquettes.delete(k); }
}

function minuteur(s) {
  s = Math.ceil(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function suivreCarte() {
  requestAnimationFrame(suivreCarte);
  if (document.hidden || !S.pret || !S.carte) return;
  placerInspecteur();
  placerEtiquettes();
}
requestAnimationFrame(suivreCarte);

function carteArmee() {
  const a = S.armees.find(x => x.id === S.selArmee);
  if (!a || !S.moi || a.proprio !== S.moi.id) return '';
  const st = statutArmee(S, a);
  const unites = Object.keys(a.unites || {}).map(k => S.defs.unites.find(u => u.id === k)).filter(Boolean);
  const portee = Math.max(0, ...unites.filter(u => u.domaine === 'terre' || u.domaine === 'mer').map(u => u.portee));
  const autres = mesArmeesSur(a.case).filter(x => x.id !== a.id && x.dom === a.dom);
  let boutons = '';
  if (a.dom === 'terre' || a.dom === 'mer') {
    boutons += `<button class="wf-btn petit" data-act="ordre" data-type="deplacer">${ico('route')} Déplacer</button>`;
    if (portee > 0) boutons += `<button class="wf-btn petit secondaire" data-act="ordre" data-type="bombarder">${ico('bomb')} Bombarder</button>`;
    if (a.chemin?.length || a.assaut != null || a.bombarde != null) boutons += `<button class="wf-btn petit secondaire" data-act="arreter">${ico('hand')} Halte</button>`;
  } else if (a.dom === 'air') {
    boutons += `<button class="wf-btn petit" data-act="ordre" data-type="mission">${ico('jet-fighter')} Mission de frappe</button>`;
  } else if (a.dom === 'missile') {
    for (const u of unites) boutons += `<button class="wf-btn petit ${u.id === 'missile_nucleaire' ? 'danger' : ''}" data-act="ordre" data-type="missile" data-genre="${u.id}">${ico(u.icone)} Tirer : ${esc(u.nom)}</button>`;
  }
  if (a.total > 1 && (a.dom === 'terre' || a.dom === 'mer')) boutons += `<button class="wf-btn petit secondaire" data-act="scinder_form">${ico('code-branch')} Scinder</button>`;
  for (const o of autres) boutons += `<button class="wf-btn petit secondaire" data-act="fusionner" data-avec="${o.id}">${ico('object-group')} Fusionner avec ${esc(o.nom)}</button>`;
  boutons += `<button class="wf-btn-ic" data-act="renommer_form" title="Renommer">${ico('pen')}</button>`;
  boutons += `<button class="wf-btn-ic danger" data-act="dissoudre" title="Démobiliser">${ico('trash')}</button>`;
  return `<div class="wf-insp-selection">
    <div class="wf-insp-sel-tete">${ico('crosshairs')}<b>${esc(a.nom)}</b><span class="wf-puce ${st.c}">${ico(st.i)}${esc(st.t)}</span></div>
    <div class="wf-compos">${unites.map(u => `<span class="wf-compo" title="${esc(u.nom)}">${ico(u.icone)}${a.unites[u.id]}</span>`).join('')}
      <small>${ico('gauge-high')} ${String(a.vitesse).replace('.', ',')} cases/min${a.blessures ? ` · ${ico('heart-crack')} ${fmt(a.blessures)} PV de dégâts` : ''}</small></div>
    <div class="wf-boutons">${boutons}</div>
  </div>`;
}

function majAlertes() {
  const el = $('#wf-missiles');
  if (!S.moi) { el.hidden = true; return; }
  const entrants = S.missiles.filter(x => x.proprio !== S.moi.id && S.carte.proprio[x.cible] === S.moi.id);
  if (!entrants.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = entrants.map(x => {
    const u = S.defs.unites.find(k => k.id === x.genre);
    const reste = (1 - x.progres) * x.duree / S.vitesse;
    return `<button class="wf-alerte-missile ${x.genre === 'missile_nucleaire' ? 'nucl' : ''}" data-act="voir" data-case="${x.cible}">
      ${ico(u?.icone || 'rocket')}<b>${esc(u?.nom || 'Missile')}</b> de ${esc(S.pays.get(x.proprio)?.nom || '?')} · impact ${duree(reste)}</button>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════
// Ordres cibles (deplacement, bombardement, mission, missile)
// ══════════════════════════════════════════════════════════════════
function demarrerOrdre(type, a, genre) {
  const unites = Object.keys(a.unites || {}).map(k => S.defs.unites.find(u => u.id === k)).filter(Boolean);
  let portee = null, couleur = '#ffffff', texte = '';
  if (type === 'deplacer') texte = `Choisissez la destination de ${a.nom}.`;
  if (type === 'bombarder') { portee = Math.max(...unites.filter(u => u.portee > 0 && u.domaine !== 'air').map(u => u.portee)); couleur = '#ffb300'; texte = 'Choisissez la case à bombarder.'; }
  if (type === 'mission') { portee = Math.min(...unites.map(u => u.portee)); couleur = '#40c4ff'; texte = `Choisissez la cible du raid (rayon d'action ${portee} cases).`; }
  if (type === 'missile') {
    const u = S.defs.unites.find(x => x.id === genre);
    portee = u.portee > 900 ? null : u.portee;
    couleur = genre === 'missile_nucleaire' ? '#ff1744' : '#ff9100';
    texte = `Choisissez la cible du ${u.nom.toLowerCase()}${portee ? ` (portée ${portee} cases)` : ''}.`;
  }
  S.ordre = { type, armee: a.id, genre, portee };
  S.carte.visee = true;
  if (portee) S.carte.setZone(S.g.rayon(a.case, portee), couleur); else S.carte.setZone(null);
  const c = $('#wf-consigne');
  c.innerHTML = `${ico('crosshairs')} ${esc(texte)} <button class="wf-lien" data-act="annuler_ordre">Annuler (Échap)</button>`;
  c.hidden = false;
}

function annulerOrdre() {
  S.ordre = null;
  S.carte.visee = false;
  S.carte.survolMesh.visible = false;
  S.carte.setZone(null);
  $('#wf-consigne').hidden = true;
}

async function executerOrdre(i) {
  const o = S.ordre;
  const a = S.armees.find(x => x.id === o.armee);
  if (!a) { annulerOrdre(); return; }
  if (o.portee && S.g.distance(a.case, i) > o.portee) { toast('Cible hors de portée.', 'err'); return; }
  if (o.type === 'deplacer') { annulerOrdre(); agir('deplacer', { armee: a.id, cible: i }); return; }
  if (o.type === 'bombarder') { annulerOrdre(); agir('bombarder', { armee: a.id, cible: i }); return; }
  if (o.type === 'mission') { annulerOrdre(); agir('mission', { armee: a.id, cible: i }); return; }
  if (o.type === 'missile') {
    const nucl = o.genre === 'missile_nucleaire';
    annulerOrdre();
    if (nucl) {
      const cible = S.pays.get(S.carte.proprio[i]);
      confirmer(`${ico('radiation')} Lancer une frappe nucléaire ?`,
        `Vous allez frapper <b>${esc(cible?.nom || 'cette zone')}</b>. Toute la planète verra le lancement, la zone sera irradiée et votre nation perdra 200 d'influence. Cette décision est irréversible.`,
        'Lancer', () => agir('missile', { armee: a.id, genre: o.genre, cible: i }), true);
    } else agir('missile', { armee: a.id, genre: o.genre, cible: i });
  }
}

// ══════════════════════════════════════════════════════════════════
// Notifications et fenetres
// ══════════════════════════════════════════════════════════════════
function toast(texte, type = 'info', icone, caseCible) {
  if (!texte) return;
  const el = document.createElement('div');
  el.className = 'wf-toast ' + type;
  const ic = icone || { ok: 'circle-check', err: 'circle-xmark', alerte: 'triangle-exclamation', info: 'circle-info' }[type];
  el.innerHTML = `${ico(ic)}<span>${esc(texte)}</span>`;
  if (caseCible != null) { el.classList.add('cliquable'); el.onclick = () => { S.carte.centrerSur(caseCible); choisirCase(caseCible); }; }
  const zone = $('#wf-toasts');
  zone.appendChild(el);
  while (zone.children.length > 5) zone.firstChild.remove();
  setTimeout(() => { el.classList.add('sortie'); setTimeout(() => el.remove(), 400); }, type === 'alerte' ? 8000 : 4500);
}

let modaleOk = null;
function modale(html, { fermable = true, large = false } = {}) {
  const f = $('#wf-modale');
  f.innerHTML = `<div class="wf-modale ${large ? 'large' : ''}">${fermable ? `<button class="wf-modale-x" data-act="fermer_modale">${ico('xmark')}</button>` : ''}${html}</div>`;
  f.hidden = false;
  f.dataset.fermable = fermable ? '1' : '0';
  setTimeout(() => f.querySelector('input:not([type=hidden]):not([type=color])')?.focus(), 50);
}
function fermerModale() { $('#wf-modale').hidden = true; $('#wf-modale').innerHTML = ''; modaleOk = null; }

function confirmer(titre, texte, bouton, ok, danger = false) {
  modaleOk = ok;
  modale(`<div class="wf-modale-tete"><h2>${titre}</h2></div><p>${texte}</p>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button>
    <button class="wf-btn ${danger ? 'danger' : ''}" data-act="modale_ok">${esc(bouton)}</button></div>`);
}

function ouvrirFondation() {
  const d = S.defs;
  const couleur = d.couleurs[Math.floor(Math.random() * d.couleurs.length)];
  modale(`<div class="wf-modale-tete">${ico('flag')}<div><h2>Fonder votre nation</h2><p>Choisissez l'identité du pays que vous allez diriger. Sa capitale apparaîtra sur des terres libres.</p></div></div>
    <div class="wf-form">
      <label>Nom de la nation<input id="f-nom" maxlength="28" placeholder="Ex. : République de Valdor"></label>
      <label>Devise <small>(facultatif)</small><input id="f-devise" maxlength="80" placeholder="Ex. : Unité, travail, grandeur"></label>
      <label>Couleur</label>
      <div class="wf-palette">${d.couleurs.map(c => `<button class="wf-pastille ${c === couleur ? 'actif' : ''}" style="--c:${c}" data-act="choisir" data-groupe="f-couleur" data-val="${c}"></button>`).join('')}
        <input type="color" id="f-couleur" value="${couleur}"></div>
      <label>Emblème</label>
      <div class="wf-emblemes">${d.emblemes.map((e, k) => `<button class="wf-embleme ${k === 0 ? 'actif' : ''}" data-act="choisir" data-groupe="f-embleme" data-val="${e}">${ico(e)}</button>`).join('')}</div>
      <input type="hidden" id="f-embleme" value="${d.emblemes[0]}">
      <label>Spécialisation nationale</label>
      <div class="wf-spes">${d.specialisations.map((s, k) => `<button class="wf-spe ${k === 0 ? 'actif' : ''}" data-act="choisir" data-groupe="f-spe" data-val="${s.id}">${ico(s.icone)}<b>${esc(s.nom)}</b><small>${esc(s.desc)}</small></button>`).join('')}</div>
      <input type="hidden" id="f-spe" value="${d.specialisations[0].id}">
    </div>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="observer">${ico('eye')} Observer d'abord</button>
    <button class="wf-btn" data-act="rejoindre">${ico('flag')} Fonder ma nation</button></div>`, { large: true });
}

function ouvrirAneantie() {
  modale(`<div class="wf-modale-tete">${ico('skull')}<div><h2>Votre nation a été anéantie</h2><p>Sa dernière province est tombée. Vous pouvez la refonder sur des terres libres : vos technologies sont perdues, mais pas votre nom.</p></div></div>
    <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Plus tard</button><button class="wf-btn" data-act="refonder">${ico('seedling')} Refonder</button></div>`);
}

// ══════════════════════════════════════════════════════════════════
// Actions (delegation)
// ══════════════════════════════════════════════════════════════════
const val = id => document.getElementById(id)?.value ?? '';
const selA = () => S.armees.find(x => x.id === S.selArmee);

const ACTIONS = {
  ouvrir: d => { if (d.prod) S.prodCase = +d.prod; ouvrirPanneau(d.panneau, { canal: d.canal, garder: !!(d.prod || d.canal) }); },
  fermer_panneau: () => ouvrirPanneau('carte'),
  voir: d => { const i = +d.case; S.carte.centrerSur(i); choisirCase(i); },
  deselection: () => { choisirArmee(null); choisirCase(null); },
  fonder: () => ouvrirFondation(),
  observer: () => { sessionStorage.setItem('wf-fondation-vue', '1'); fermerModale(); },
  fermer_modale: () => fermerModale(),
  modale_ok: () => { const f = modaleOk; fermerModale(); f && f(); },
  choisir: (d, el) => {
    el.parentElement.querySelectorAll('.actif').forEach(x => x.classList.remove('actif'));
    el.classList.add('actif');
    const i = document.getElementById(d.groupe);
    if (i) i.value = d.val;
  },
  rejoindre: async () => {
    const r = await agir('rejoindre', { nom: val('f-nom'), devise: val('f-devise'), couleur: val('f-couleur'), embleme: val('f-embleme'), spe: val('f-spe') });
    if (r.ok) { fermerModale(); setTimeout(() => S.moi && S.carte.centrerSur(S.moi.capitale, 24), 300); }
  },
  refonder: async () => { const r = await agir('refonder'); if (r.ok) { fermerModale(); setTimeout(() => S.moi && S.carte.centrerSur(S.moi.capitale, 24), 300); } },
  profil: () => agir('profil', { devise: val('profil-devise'), couleur: val('profil-couleur'), embleme: val('profil-embleme') }),

  construire: d => agir('construire', { case: +d.case, bat: d.bat }),
  ameliorer: d => agir('ameliorer', { case: +d.case }),
  demolir: d => confirmer('Démolir ce bâtiment ?', 'Le bâtiment sera détruit sans remboursement.', 'Démolir', () => agir('demolir', { case: +d.case }), true),
  annuler_chantier: d => agir('annuler_chantier', { id: +d.id }),
  annexer: d => agir('annexer', d.cmdt ? { case: +d.case, cmdt: +d.cmdt } : { case: +d.case }),
  rechercher: d => agir('rechercher', { tech: d.tech }),
  annuler_recherche: d => agir('annuler_recherche', { tech: d.tech }),
  branche: d => { S.brancheRecherche = d.branche; majPanneau(true); majInspecteur(true); },
  produire: d => agir('produire', { case: +d.case, unite: d.unite, qte: Math.max(1, Math.min(50, +val(d.champ || 'qte-' + d.unite) || 1)) }),
  annuler_production: d => agir('annuler_production', { id: +d.id }),
  prod_case: d => { S.prodCase = +d.case; majPanneau(true); },

  sel_armee: d => {
    const a = S.armees.find(x => x.id === +d.armee);
    if (!a) return;
    choisirArmee(a.id);
    choisirCase(a.case);
    S.carte.centrerSur(a.case);
  },
  ordre: d => { const a = d.armee ? S.armees.find(x => x.id === Number(d.armee)) : selA(); if (a) demarrerOrdre(d.type, a, d.genre); },
  annuler_ordre: () => annulerOrdre(),
  arreter: () => { const a = selA(); if (a) agir('arreter', { armee: a.id }); },
  fusionner: d => { const a = selA(); if (a) agir('fusionner', { armee: a.id, avec: +d.avec }); },
  dissoudre: () => { const a = selA(); if (a) confirmer('Démobiliser cette armée ?', `${esc(a.nom)} sera dissoute définitivement.`, 'Démobiliser', () => agir('dissoudre', { armee: a.id }), true); },
  renommer_form: () => {
    const a = selA(); if (!a) return;
    modaleOk = () => agir('renommer_armee', { armee: a.id, nom: val('r-nom') });
    modale(`<div class="wf-modale-tete">${ico('pen')}<h2>Renommer</h2></div><div class="wf-form"><input id="r-nom" maxlength="32" value="${esc(a.nom)}"></div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">Renommer</button></div>`);
  },
  scinder_form: () => {
    const a = selA(); if (!a) return;
    modaleOk = () => {
      const unites = {};
      for (const k of Object.keys(a.unites)) { const n = +val('s-' + k) || 0; if (n > 0) unites[k] = n; }
      agir('scinder', { armee: a.id, unites });
    };
    modale(`<div class="wf-modale-tete">${ico('code-branch')}<h2>Scinder ${esc(a.nom)}</h2></div><p>Unités qui formeront la nouvelle armée :</p>
      <div class="wf-form">${Object.entries(a.unites).map(([k, n]) => { const u = S.defs.unites.find(x => x.id === k); return `<label class="wf-ligne-form">${ico(u.icone)} ${esc(u.nom)} <small>(${n})</small><input type="number" id="s-${k}" min="0" max="${n}" value="${Math.floor(n / 2)}" class="wf-qte"></label>`; }).join('')}</div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">Scinder</button></div>`);
  },

  guerre: d => {
    const p = S.pays.get(+d.pays);
    const bloc = p?.bloc != null ? S.blocs.get(p.bloc) : null;
    confirmer(`${ico('burst')} Déclarer la guerre à ${esc(p?.nom)} ?`,
      `Coût : 10 d'influence. Votre propre protection de nouveau venu prend fin.${bloc ? `<br><b>${esc(p.nom)} appartient au bloc ${esc(bloc.nom)} : ses ${bloc.membres.length - 1} alliés entreront aussi en guerre contre vous.</b>` : ''}`,
      'Déclarer la guerre', () => agir('guerre', { pays: +d.pays }), true);
  },
  proposer: d => agir('proposer', { pays: +d.pays, genre: d.genre }),
  repondre: d => agir('repondre', { pays: +d.pays, genre: d.genre, accepte: d.accepte === '1' }),
  espion: d => agir('espionnage', { pays: +d.pays, op: d.op }),
  aide_form: d => {
    const p = S.pays.get(+d.pays);
    modaleOk = () => agir('aide', { pays: +d.pays, res: S.defs.ressources.map((_, i) => +val('aide-' + i) || 0) });
    modale(`<div class="wf-modale-tete">${ico('box-open')}<h2>Envoyer une aide à ${esc(p?.nom)}</h2></div><p>5 % des ressources sont perdues pendant le transport.</p>
      <div class="wf-form grille2">${S.defs.ressources.map((r, i) => `<label>${ico(r.icone, '', `color:${r.couleur}`)} ${esc(r.nom)} <small>(${fmt(S.moi?.res[i])})</small><input type="number" id="aide-${i}" min="0" value="0"></label>`).join('')}</div>
      <div class="wf-boutons fin"><button class="wf-btn secondaire" data-act="fermer_modale">Annuler</button><button class="wf-btn" data-act="modale_ok">${ico('paper-plane')} Envoyer</button></div>`);
  },

  bloc_creer: () => agir('bloc_creer', { nom: val('bloc-nom'), sigle: val('bloc-sigle'), couleur: val('bloc-couleur'), charte: val('bloc-charte-new') }),
  bloc_postuler: d => agir('bloc_postuler', { bloc: +d.bloc }),
  bloc_accepter: d => agir('bloc_accepter', { pays: +d.pays }),
  bloc_refuser: d => agir('bloc_refuser', { pays: +d.pays }),
  bloc_inviter: d => agir('bloc_inviter', { pays: +d.pays }),
  bloc_exclure: d => confirmer('Exclure ce membre ?', `${esc(S.pays.get(+d.pays)?.nom)} quittera le bloc.`, 'Exclure', () => agir('bloc_exclure', { pays: +d.pays }), true),
  bloc_chef: d => confirmer('Transmettre la direction ?', `${esc(S.pays.get(+d.pays)?.nom)} dirigera désormais le bloc.`, 'Transmettre', () => agir('bloc_chef', { pays: +d.pays })),
  bloc_quitter: () => confirmer('Quitter le bloc ?', 'Vous perdrez la vision partagée et la défense collective.', 'Quitter', () => agir('bloc_quitter'), true),
  bloc_charte: () => agir('bloc_charte', { charte: val('bloc-charte') }),
  bloc_don: () => agir('bloc_don', { montant: +val('bloc-don') || 0 }),
  bloc_verser: d => agir('bloc_verser', { pays: +d.pays, montant: +val('verser-' + d.pays) || 0 }),

  marche: d => agir('marche', { res: +d.res, sens: d.sens, qte: +val(d.champ || 'marche-' + d.res) || 0 }),
  acheter_unite: d => agir('marche', { genre: 'unite', unite: d.unite, qte: Math.max(1, Math.min(20, +val(d.champ) || 1)) }),
  vendre_unite: d => agir('marche', { genre: 'vendre_unite', unite: d.unite, qte: Math.max(1, +val(d.champ) || 1) }),
  vendre_service: d => agir('marche', { genre: 'vendre_service', service: d.service, qte: Math.max(1, +val(d.champ) || 1) }),
  acheter_service: d => agir('marche', { genre: 'service', service: d.service, qte: Math.max(1, +val(d.champ) || 1) }),
  onglet_marche: d => { S.ongletMarche = d.onglet; majPanneau(true); },
  categorie: d => { S.categorie = d.cat; majPanneau(true); },
  filtre_journal: d => { S.filtreJournal = d.f; majPanneau(true); },
  canal: d => { S.canal = d.canal; majPanneau(true); },

  admin_annonce: () => agir('admin_annonce', { texte: val('admin-annonce') }),
  admin_supprimer: d => confirmer('Supprimer cette nation ?', `${esc(S.pays.get(+d.pays)?.nom)} et tout son territoire disparaîtront définitivement.`, 'Supprimer', () => agir('admin_supprimer_pays', { pays: +d.pays }), true),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const f = ACTIONS[el.dataset.act];
  if (!f) return;
  e.preventDefault();
  f(el.dataset, el);
});

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form="chat"]');
  if (!f) return;
  e.preventDefault();
  const i = $('#chat-texte');
  const t = i.value.trim();
  if (!t) return;
  agir('chat', { canal: S.canal, texte: t }, true).then(r => { if (r.ok) i.value = ''; });
});

$('#wf-modale').addEventListener('click', e => {
  if (e.target.id === 'wf-modale' && e.currentTarget.dataset.fermable === '1') fermerModale();
});

document.addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(document.activeElement?.tagName)) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  if (e.key === 'Escape') {
    if (!$('#wf-modale').hidden && $('#wf-modale').dataset.fermable === '1') fermerModale();
    else if (S.ordre) annulerOrdre();
    else if (S.selArmee != null) choisirArmee(null);
    else if (S.selCase != null) choisirCase(null);
    else if (S.panneau) ouvrirPanneau('carte');
    return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && !e.ctrlKey && !e.altKey) ouvrirPanneau(MENU[n - 1][0]);
});

// Boutons de mode de carte
document.querySelectorAll('[data-mode-carte]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-mode-carte]').forEach(x => x.classList.toggle('actif', x === b));
  S.carte?.setMode(b.dataset.modeCarte);
}));
$('#wf-recentrer').addEventListener('click', () => { if (S.moi) S.carte.centrerSur(S.moi.capitale, 30); else S.carte.centrerSur(Math.floor(S.g.n / 2), 70); });
$('#wf-vue-globale').addEventListener('click', () => S.carte.centrerSur(Math.floor(S.g.n / 2) + Math.floor(S.g.l / 2), 95));

// Horloge + rafraichissement leger (comptes a rebours)
setInterval(() => {
  $('#wf-horloge').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (S.pret) majAlertes();
}, 1000);

// Dev : le menu profil pointe vers la deconnexion locale, et
// devTout() (console du navigateur) donne toutes les technologies et des
// ressources pour tester la fin de partie. Refuse par le serveur hors mode dev.
if (corps.dataset.mode === 'reseau') {
  // Connexion reseau : se deconnecter de WorldFront (pas du nœud VEX).
  document.querySelectorAll('#profile-menu a').forEach(a => { if (a.href.includes('logout')) a.href = 'deconnexion'; });
}
if (corps.dataset.mode === 'dev') {
  document.querySelectorAll('#profile-menu a').forEach(a => { if (a.href.includes('logout')) a.href = 'dev/sortir'; });
  window.devTout = () => agir('dev_tout');
}

connecter();
