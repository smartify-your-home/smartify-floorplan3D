const fs = require('fs');
const assert = require('assert');
const code = fs.readFileSync('custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js', 'utf8');
assert.match(code, /<dialog class=\\"sel\\"/);
assert.match(code, /box\.showModal\(\)/);
assert.match(code, /box\.close\(\)/);
assert.match(code, /dialog\.sel::backdrop/);
assert.match(code, /dialog\.sel:not\(\[open\]\)/);
console.log('Native 2D selection dialog regression checks OK');
