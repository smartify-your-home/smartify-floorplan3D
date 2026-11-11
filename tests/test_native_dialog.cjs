const fs = require('node:fs');
const assert = require('node:assert/strict');
const code = fs.readFileSync('custom_components/smartify_floorplan3d/frontend/smartify-floorplan3d.js', 'utf8');
assert(code.includes('<dialog class="fp-sel"'), 'dialog element');
assert(code.includes('box.showModal()'), 'modal opens using browser top layer');
assert(code.includes('box.close()'), 'dialog closes natively');
assert(code.includes('dialog.fp-sel::backdrop'), 'native backdrop');
assert(code.includes('dialog.fp-sel:not([open])'), 'closed dialog hidden');
console.log('Native dialog checks OK');
