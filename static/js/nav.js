// ══════════════════════════════════════════════════════════════════
// nav.js — Comportement de la barre de navigation (menu profil).
// ══════════════════════════════════════════════════════════════════
(function () {
  var ui = document.getElementById('user-info-top');
  var pm = document.getElementById('profile-menu');

  if (ui && pm) {
    ui.addEventListener('click', function (e) {
      e.stopPropagation();
      var x = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', x ? 'false' : 'true');
      pm.style.display = pm.style.display === 'block' ? 'none' : 'block';
    });
    ui.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
    });
  }
  function fermer(e) {
    if (pm && !pm.contains(e.target) && ui && !ui.contains(e.target)) {
      pm.style.display = 'none';
      if (ui) ui.setAttribute('aria-expanded', 'false');
    }
  }
  document.addEventListener('click', fermer);
  document.addEventListener('contextmenu', fermer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (pm) pm.style.display = 'none';
      if (ui) ui.setAttribute('aria-expanded', 'false');
    }
  });
})();
