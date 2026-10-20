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
    // Desktop menu: an invitation to join makes no sense here, so drop it
    document.querySelectorAll('nav .links a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('enroll') !== -1) { a.style.display = 'none'; }
    });

    // Mobile menu: turn Join into Dashboard instead of hiding it
    document.querySelectorAll('.mobile-menu a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('enroll') !== -1 || /^join/i.test(a.textContent.trim())) {
        a.textContent = 'Dashboard';
        a.setAttribute('href', 'portal.html');
      }
    });
  }

  // Verify the session before promising anything
  fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.ok; })
    .catch(function () { return true; }) // offline: keep the token, show the link
    .then(paint);
})();
