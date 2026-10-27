/* Remote-control keys. Samsung codes plus desktop-keyboard equivalents for testing:
   arrows, Enter, Backspace/Escape = Back, Space = play/pause, PageUp/PageDown = channel,
   [ and ] = rewind/forward, I = info, F = favourite. */

Nova.keys = (function () {
  var MAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 65376: 'ok', 65385: 'back',
    10009: 'back', 27: 'back', 8: 'back',
    415: 'play', 19: 'pause', 10252: 'playpause', 32: 'playpause', 413: 'stop',
    417: 'ff', 221: 'ff', 412: 'rw', 219: 'rw',
    427: 'chup', 33: 'chup', 428: 'chdown', 34: 'chdown',
    457: 'info', 73: 'info', 10190: 'prech',
    403: 'red', 404: 'green', 405: 'yellow', 70: 'yellow', 406: 'blue'
  };
  var TIZEN_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'ChannelUp', 'ChannelDown', 'Info', 'PreviousChannel', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  function register() {
    if (!window.tizen || !tizen.tvinputdevice) return;
    var supported = {};
    try { tizen.tvinputdevice.getSupportedKeys().forEach(function (k) { supported[k.name] = 1; }); } catch (e) {}
    TIZEN_KEYS.forEach(function (k) {
      if (!supported[k]) return;
      try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
    });
  }

  function actionFor(e) {
    var c = e.keyCode;
    if (c >= 48 && c <= 57) return 'digit';
    if (c >= 96 && c <= 105) return 'digit';
    return MAP[c] || null;
  }

  function init(dispatch) {
    register();
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      var act = actionFor(e);
      // Let text fields keep their editing keys.
      if (typing && (act === 'left' || act === 'right' || e.keyCode === 8 || e.keyCode === 32 || act === 'digit' || act === 'info' || act === 'yellow' || act === 'ff' || act === 'rw')) return;
      if (typing && !act) return;
      if (!act) {
        // Letters are forwarded for the search screen's physical-keyboard support.
        if (e.key && e.key.length === 1) dispatch('char', e);
        return;
      }
      e.preventDefault();
      if (act === 'digit') e.digit = e.keyCode >= 96 ? e.keyCode - 96 : e.keyCode - 48;
      dispatch(act, e);
    });
  }

  return { init: init };
})();
