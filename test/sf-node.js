/* Stockfish (js/vendor/stockfish) in Node als Engine-Transport für die Tests – nach dem Lader aus dem npm-Paket. */
const path = require('path');
const CG = require('../js/game.js');
require('../js/engine.js');
require('../js/strength.js');

const DIR = path.join(__dirname, '../js/vendor/stockfish');

function load() {
  const INIT = require(path.join(DIR, 'stockfish.js'));
  const fns = [];
  const sf = {
    locateFile: (p) => path.join(DIR, p.includes('.wasm') ? 'stockfish.wasm' : 'stockfish.js'),
    listener: (line) => fns.forEach((f) => f(line)),
  };
  return INIT()(sf).then(function ready() {
    if (sf._isReady && !sf._isReady()) return new Promise((r) => setTimeout(r, 10)).then(ready);
    const post = (cmd) => setImmediate(() => sf.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) }));
    return new CG.Engine({ post, onLine: (f) => fns.push(f) });
  });
}

module.exports = { load, CG };
