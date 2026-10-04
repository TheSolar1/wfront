// ══════════════════════════════════════════════════════════════════
// nav.js — Comportement de la barre de navigation VEX (grille
// d'applications, menu profil), repris a l'identique de
// build_nav_html() cote VEX pour que WorldFront s'y fonde.
// ══════════════════════════════════════════════════════════════════
(function () {
  var appsBtn = document.getElementById('apps-btn-nav');
  var popup = document.getElementById('apps-popup');
  var ui = document.getElementById('user-info-top');
  var pm = document.getElementById('profile-menu');

  if (appsBtn && popup) {
    appsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      popup.style.display = popup.style.display === 'block' ? 'none' : 'block';
      if (pm) { pm.style.display = 'none'; if (ui) ui.setAttribute('aria-expanded', 'false'); }
    });
  }
  if (ui && pm) {
    ui.addEventListener('click', function (e) {
      e.stopPropagation();
      var x = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', x ? 'false' : 'true');
      pm.style.display = pm.style.display === 'block' ? 'none' : 'block';
      if (popup) popup.style.display = 'none';
    });
    ui.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
    });
  }
  function fermer(e) {
    if (popup && !popup.contains(e.target) && appsBtn && !appsBtn.contains(e.target)) popup.style.display = 'none';
    if (pm && !pm.contains(e.target) && ui && !ui.contains(e.target)) {
      pm.style.display = 'none';
      if (ui) ui.setAttribute('aria-expanded', 'false');
    }
  }
  document.addEventListener('click', fermer);
  document.addEventListener('contextmenu', fermer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (popup) popup.style.display = 'none';
      if (pm) pm.style.display = 'none';
      if (ui) ui.setAttribute('aria-expanded', 'false');
    }
  });
})();
