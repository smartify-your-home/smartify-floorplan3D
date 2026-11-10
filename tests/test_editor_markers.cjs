// Regression: positions in plan.light entries are objects containing pos, not direct arrays.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync('custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js', 'utf8');
const from = source.indexOf('  _marks() {');
const to = source.indexOf('\n  _iconFor(', from);
assert(from !== -1 && to > from, '_marks method found');
const method = source.slice(from + '  _marks() '.length, to);
const num = (v,d) => v == null || v === '' ? d : (isNaN(+v) ? d : +v);
const viewsOf = cfg => (cfg.floors || ['eg']).map(id => ({ id }));
const fn = new Function('num','viewsOf', 'return function() '+ method)(num,viewsOf);
for (const name of ['eg', 'og']) {
  const part = JSON.parse(fs.readFileSync('examples/plans/' + name + '.json','utf8'));
  const o = {
    _config: { floors: [name], elements: [], model_lights: {} },
    _view: name, _parts: [part], _lights: part.lights,
    _vb: {x:0,y:0,w:part.size[0],h:part.size[1]},
    _cardMode: true,
    _ids() {return [name,part.id] },
  };
  const marks = fn.call(o);
  const lights = marks.filter(x => x.kind === 'l');
  assert.equal(lights.length, Object.keys(part.lights).length);
  for (const l of lights) {
    const p = part.lights[l.k].pos;
    assert.equal(l.x,p[0], 'light x ' + l.k);
    assert.equal(l.y,p[1], 'light y ' + l.k);
  }
  assert.equal(marks.filter(x=>x.kind==='o').length,part.items.length);
  console.log(name + ': ' + lights.length + ' light coordinates OK');
}
assert(source.includes('if (m.kind === \'o\' && this._cardMode && !this._showObjects'), 'objects hidden by default');
assert(source.includes('const pointers = new Map();'), 'pointer tracking for pan and pinch');
assert(source.includes('scroll.scrollTop = pinch.yContent'), 'vertical pinch pan');
