if (window.__kvDef === undefined) { try { delete window.define; } catch (e) { window.define = undefined; } }
else window.define = window.__kvDef;
delete window.__kvDef;
