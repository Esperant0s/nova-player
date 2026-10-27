/* Boot: scale the 1920x1080 stage to the window, wire up keys, and open the right first screen. */

Nova.app = {
  init: function () {
    this.fit();
    window.addEventListener('resize', this.fit);
    Nova.menu.init();
    Nova.applySubSize();
    Nova.keys.init(this.dispatch);
    this.initMouse();

    var acc = Nova.prefs.get('account', null);
    if (!acc) return Nova.router.root('login');
    Nova.api.use(acc);
    this.start();
  },

  // Every key, click shortcut and mouse button ends up here: dialogs first, then the menu, then the screen.
  dispatch: function (act, e) {
    var m = Nova.ui.modals[Nova.ui.modals.length - 1];
    if (m) return m.onKey(act, e);
    if (Nova.menu.focused) return Nova.menu.onKey(act, e);
    var t = Nova.router.top();
    if (t && t.onKey) t.onKey(act, e);
  },

  initMouse: function () {
    var back = document.getElementById('backbtn');
    back.innerHTML = Nova.icon('arrowLeft');
    back.addEventListener('click', function () { Nova.app.dispatch('back'); });
    // The "back" side button on many mice.
    document.addEventListener('mouseup', function (e) { if (e.button === 3) { e.preventDefault(); Nova.app.dispatch('back'); } });
    // Clicking anywhere outside the open side menu closes it.
    document.addEventListener('mousedown', function (e) {
      if (!Nova.menu.focused || e.target.closest('#menu')) return;
      Nova.menu.blur();
      var t = Nova.router.top();
      if (t && t.focusIn) t.focusIn();
    });
  },

  // TVs render the app at 1920x1080; desktop browsers get the same layout scaled to fit.
  fit: function () {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    var app = document.getElementById('app');
    app.style.transform = s === 1 ? '' : 'scale(' + s + ')';
    app.style.left = Math.round((window.innerWidth - 1920 * s) / 2) + 'px';
    app.style.top = Math.round((window.innerHeight - 1080 * s) / 2) + 'px';
  },

  start: function () {
    var splash = Nova.el('div', 'splash', '<div class="login-logo"><b>N</b>NOVA</div>' + Nova.ui.spinner() + '<p>Loading your library…</p>');
    document.getElementById('overlay').appendChild(splash);
    Nova.regions.load().then(function () { return Nova.api.load(); }).then(function () {
      splash.parentNode.removeChild(splash);
      Nova.router.root('browse', { section: 'home' });
    }, function (e) {
      splash.parentNode.removeChild(splash);
      Nova.ui.dialog({
        title: 'Couldn’t load your library',
        text: e.message,
        buttons: [
          { label: 'Try again', fn: function () { Nova.app.start(); } },
          { label: 'Sign out', fn: function () { Nova.api.logout().then(function () { Nova.router.root('login'); }); } }
        ],
        onCancel: function () { Nova.app.confirmExit(); }
      });
    });
  },

  confirmExit: function () {
    Nova.ui.dialog({
      title: 'Exit Nova?',
      buttons: [
        { label: 'Exit', fn: function () {
          try { tizen.application.getCurrentApplication().exit(); } catch (e) { Nova.ui.toast('Exit only works on the TV'); }
        } },
        { label: 'Cancel' }
      ],
      focus: 1
    });
  }
};

// Back on a root screen (with the menu already focused) asks to exit.
(function () {
  var onKey = Nova.menu.onKey;
  Nova.menu.onKey = function (act) {
    if (act === 'back' && Nova.router.stack.length === 1) return Nova.app.confirmExit();
    return onKey.call(Nova.menu, act);
  };
})();

Nova.app.init();
