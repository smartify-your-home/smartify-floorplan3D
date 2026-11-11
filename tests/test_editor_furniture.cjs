const fs = require('node:fs');
const assert = require('node:assert/strict');
const src = fs.readFileSync('custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js','utf8');
const from = src.indexOf('  _itemFootprint(part, it) {');
const to = src.indexOf('\n  _drawPlan() {', from);
assert(from >= 0 && to > from);
const method = src.slice(from + '  _itemFootprint(part, it) '.length, to);
const footprint = new Function('return function(part,it) ' + method)();
for (const floor of ['eg','og']) {
  const part = JSON.parse(fs.readFileSync('examples/plans/'+floor+'.json','utf8'));
  let count = 0;
  for (const it of part.items) {
    if (Array.isArray(it)) continue;
    const r = footprint(part,it);
    assert(r && r.w > 0 && r.h > 0, floor+' '+it.block);
    for (const k of ['x','y','w','h']) assert(Number.isFinite(r[k]), floor+' '+it.block+' '+k);
    count++;
  }
  console.log(floor+': '+count+' furniture footprints OK');
}
assert(src.includes('data-object-id='), 'furniture footprints individually selectable');
assert(src.includes('const footprint = !mk'), 'pointer selection on footprint');
assert(src.includes('if (d.id[0] === \'o\') this._drawPlan()'), 'redraw after move');
assert(src.includes('const field = document.createElement(\'div\')'), 'no native label wrapping dropdown');
assert(src.includes('this._lightPicker(ec.entity'), 'all entities use native in-place searchable picker');
assert(src.includes('if (!this._cardMode) this._loadPickers()'), 'no late HA picker redraw in card mode');
