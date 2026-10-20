// Keeps the public header honest: if you are signed in, it offers your dashboard
// instead of asking you to join a community you already belong to.
(function () {
  var token = localStorage.getItem('lotus_token');
  if (!token) return;

  function paint(signedIn) {
    if (!signedIn) {
      localStorage.removeItem('lotus_token');
      localStorage.removeItem('lotus_user');
      return;
    }
    // Main call-to-action button
    document.querySelectorAll('nav .btn-nav, header.top nav .btn-nav').forEach(function (a) {
      a.textContent = 'My Dashboard';
      a.setAttribute('href', 'portal.html');
      a.setAttribute('title', 'Back to your account');
    });
    // Any "Join" link in the menu becomes a way back into the account
    document.querySelectorAll('nav .links a, .mobile-menu a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('enroll') !== -1 || /join/i.test(a.textContent)) {
        a.textContent = 'Dashboard';
        a.setAttribute('href', 'portal.html');
      }
    });
    // A quiet line so it is obvious you are still signed in
    var nav = document.querySelector('nav .links');
    if (nav && !document.getElementById('authNavBadge')) {
      var badge = document.createElement('a');
      badge.id = 'authNavBadge';
      badge.href = 'portal.html';
      badge.textContent = 'Signed in';
      badge.style.cssText = 'font-size:.72rem;letter-spacing:.6px;text-transform:uppercase;color:#8a6a1f;opacity:.85';
      nav.appendChild(badge);
    }
  }

  // Verify the session before promising anything
  fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.ok; })
    .catch(function () { return true; }) // offline: keep the token, show the link
    .then(paint);
})();
