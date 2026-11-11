// Regression: Format-2 item objects must never break the 2D SVG plan renderer.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js', 'utf8');
const start = source.indexOf('  _drawPlan() {');
const end = source.indexOf('\n  // ----- Marker', start);
assert(start > 0 && end > start, '2D render method exists');
const method = source.slice(start + '  _drawPlan() '.length, end);
const FILL = { tile: '#eee', parquet: '#e6d6aa' };
const RECT_ITEMS = ['cabinet', 'table', 'bed', 'sofa'];
const esc = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const render = new Function('FILL','RECT_ITEMS','esc', 'return function() ' + method)(FILL, RECT_ITEMS, esc);
const fpStart = source.indexOf('  _itemFootprint(part, it) {');
const fpMethod = source.slice(fpStart + '  _itemFootprint(part, it) '.length, start);
const footprint = new Function('return function(part, it) ' + fpMethod)();
for (const file of ['eg.json', 'og.json']) {
  const part = JSON.parse(fs.readFileSync('examples/plans/' + file, 'utf8'));
  const vb = { x: 0, y: 0, w: part.size[0], h: part.size[1] };
  const svg = { setAttribute(key, value) { this[key] = value; }, innerHTML: '' };
  const plan = { style: {} };
  const obj = { _vb: vb, _parts: [part], _q(s) { return s === '.plan svg' ? svg : plan; }, _applyPlanZoom() {}, _itemFootprint: footprint };
  assert.doesNotThrow(() => render.call(obj), file + ' SVG rendering');
  assert(svg.innerHTML.includes('<path'), file + ' draws building geometry');
  assert(svg.innerHTML.includes('<line'), file + ' draws openings');
  console.log(file + ': SVG renderer OK, ' + svg.innerHTML.length + ' characters');
}
