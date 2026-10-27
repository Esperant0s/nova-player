Nova.router.register('login', function () {
  var MODES = [
    { id: 'xtream', label: 'Xtream Codes', fields: [
      { key: 'server', label: 'Server URL', ph: 'http://provider.com:8080' },
      { key: 'user', label: 'Username', ph: '' },
      { key: 'pass', label: 'Password', ph: '', type: 'password' }
    ] },
    { id: 'm3u', label: 'M3U Playlist', fields: [{ key: 'url', label: 'Playlist URL', ph: 'http://provider.com/get.php?username=…' }] },
    { id: 'demo', label: 'Try the demo', fields: [] }
  ];
  var el = Nova.el('div', 'screen login');
  var mode = 0, focus = 0, busy = false, editing = null;
  var values = {};

  function render() {
    var m = MODES[mode];
    var html = '<div class="login-bg"></div><div class="login-box">' +
      '<div class="login-logo"><b>N</b>NOVA</div><p class="login-sub">Sign in with the details from your IPTV provider.</p>' +
      '<div class="login-tabs">';
    MODES.forEach(function (mm, i) { html += '<div class="tab' + (i === mode ? ' on' : '') + '">' + mm.label + '</div>'; });
    html += '</div>';
    m.fields.forEach(function (f) {
      html += '<label class="field"><span>' + f.label + '</span><input data-k="' + f.key + '" type="' + (f.type || 'text') +
        '" placeholder="' + Nova.esc(f.ph) + '" value="' + Nova.esc(values[f.key] || '') + '" autocomplete="off" spellcheck="false"></label>';
    });
    if (m.id === 'demo') html += '<p class="login-note">Browse a sample library and play free public test streams. Nothing to type.</p>';
    html += '<div class="btn primary login-go">' + (busy ? Nova.ui.spinner() : (m.id === 'demo' ? 'Start demo' : 'Sign in')) + '</div>' +
      '<p class="login-err"></p></div>';
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('input'), function (inp, i) {
      inp.addEventListener('input', function () { values[inp.getAttribute('data-k')] = inp.value; });
      // Mouse users (desktop testing, or a TV with a pointer remote) click straight into fields.
      inp.addEventListener('focus', function () { editing = inp; focus = i + 1; mark(); });
      inp.addEventListener('blur', function () { if (editing === inp) editing = null; });
    });
    Array.prototype.forEach.call(el.querySelectorAll('.login-tabs .tab'), function (tab, i) {
      tab.addEventListener('click', function () { if (busy) return; mode = i; focus = 0; render(); });
    });
    el.querySelector('.login-go').addEventListener('click', function () { focus = targets().length - 1; mark(); submit(); });
    mark();
  }

  // Focus order: tabs, each field, the button.
  function targets() { return [el.querySelector('.login-tabs')].concat(Array.prototype.slice.call(el.querySelectorAll('.field')), [el.querySelector('.login-go')]); }

  function mark() {
    targets().forEach(function (t, i) { t.classList.toggle('focused', i === focus); });
  }

  function stopEditing() {
    if (editing) { editing.blur(); editing = null; }
  }

  function error(msg) { el.querySelector('.login-err').textContent = msg || ''; }

  function submit() {
    if (busy) return;
    var m = MODES[mode], acc = { type: m.id };
    for (var i = 0; i < m.fields.length; i++) {
      var f = m.fields[i], v = (values[f.key] || '').trim();
      if (!v) { error('Please enter the ' + f.label.toLowerCase() + '.'); return; }
      acc[f.key] = v;
    }
    busy = true;
    render();
    Nova.api.login(acc).then(function () {
      Nova.app.start();
    }, function (e) {
      busy = false;
      render();
      error(e.message);
    });
  }

  render();

  return {
    el: el,
    onKey: function (act) {
      var t = targets(), cur = t[focus];
      if (editing) {
        // Enter in the last field signs in, like a normal form.
        if (act === 'ok' && focus === t.length - 2) { stopEditing(); focus = t.length - 1; mark(); submit(); }
        else if (act === 'ok' || act === 'down') { stopEditing(); focus = Math.min(t.length - 1, focus + 1); mark(); }
        else if (act === 'up') { stopEditing(); focus = Math.max(0, focus - 1); mark(); }
        else if (act === 'back') stopEditing();
        return;
      }
      if (act === 'up') { focus = Math.max(0, focus - 1); mark(); }
      else if (act === 'down') { focus = Math.min(t.length - 1, focus + 1); mark(); }
      else if (focus === 0 && (act === 'left' || act === 'right')) {
        mode = Nova.clamp(mode + (act === 'left' ? -1 : 1), 0, MODES.length - 1);
        render();
      } else if (act === 'ok') {
        if (cur.classList.contains('field')) { editing = cur.querySelector('input'); editing.focus(); }
        else if (cur.classList.contains('login-go')) submit();
        else { focus = 1; mark(); }
      } else if (act === 'back') Nova.app.confirmExit();
    }
  };
});
