// Runs before the page is drawn so dark mode never flashes white first.
// Uses the person's saved choice, otherwise their phone/computer setting.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('c19-theme'); } catch { /* private mode: fall back to the device setting */ }
  var dark = saved ? saved === 'dark' : window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
