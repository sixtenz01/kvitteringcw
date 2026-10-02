const assert = require('assert');
const L = require('../src/logic.js');

const rows = [
  { transactionId: 'a-1', endDateTime: '2026-10-02 00:22', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -556, receiptType: 1, memberNumber: null },
  { transactionId: 'a-2', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 1, cashierNumber: '11', totalAmount: null, receiptType: 2, memberNumber: null },
  { transactionId: 'a-3', endDateTime: '2026-10-02 00:04', storeNumber: 1005, workstationNumber: 6, cashierNumber: '10', totalAmount: -0.7, receiptType: 1, memberNumber: null },
  { transactionId: 'a-4', endDateTime: '2026-10-01 23:30', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: 'M12345' },
  { transactionId: 'a-5', endDateTime: '2026-10-01 23:30', storeNumber: 1005, workstationNumber: 4, cashierNumber: '12', totalAmount: 296.8, receiptType: 1, memberNumber: null }
];
const ids = (f, ctx) => rows.filter(r => L.matches(r, f, ctx)).map(r => r.transactionId);
const F = (o) => Object.assign(L.defaultFilters(), o);

assert.deepStrictEqual(ids(F({})), ['a-1', 'a-2', 'a-3', 'a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ types: ['1'] })), ['a-1', 'a-3', 'a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ workstations: ['6'] })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ cashiers: ['12'] })), ['a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ onlyNegative: true })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ sumMin: '100' })), ['a-4', 'a-5']);
assert.deepStrictEqual(ids(F({ sumMax: '0' })), ['a-1', 'a-3']);
assert.deepStrictEqual(ids(F({ member: 'm123' })), ['a-4']);
assert.deepStrictEqual(ids(F({ onlyMember: true })), ['a-4']);
assert.deepStrictEqual(ids(F({ dateFrom: '2026-10-02', dateTo: '2026-10-02' })), ['a-1', 'a-2', 'a-3']);
assert.deepStrictEqual(ids(F({ timeFrom: '00:00', timeTo: '05:59' })), ['a-1', 'a-2', 'a-3']);
assert.deepStrictEqual(ids(F({ timeFrom: '23:00', timeTo: '00:10' })), ['a-2', 'a-3', 'a-4', 'a-5']);

const dup = L.findDuplicates(rows);
assert.deepStrictEqual(Object.keys(dup.ids).sort(), ['a-4', 'a-5']);
assert.strictEqual(dup.groups.length, 1);
assert.deepStrictEqual(ids(F({ onlyDup: true }), { dupIds: dup.ids }), ['a-4', 'a-5']);

const sorted = rows.slice().sort((a, b) => L.compare(a, b, 'sumDesc')).map(r => r.transactionId);
assert.deepStrictEqual(sorted, ['a-4', 'a-5', 'a-3', 'a-1', 'a-2']);
const asc = rows.slice().sort((a, b) => L.compare(a, b, 'sumAsc')).map(r => r.transactionId);
assert.deepStrictEqual(asc, ['a-1', 'a-3', 'a-4', 'a-5', 'a-2']);

assert.deepStrictEqual(L.sumSelected([rows[0], rows[2]]), { count: 2, sum: -556.7 });
assert.deepStrictEqual(L.quickRange('today', new Date(2026, 9, 2, 12)), { dateFrom: '2026-10-02', dateTo: '2026-10-02', timeFrom: '', timeTo: '' });
assert.strictEqual(L.quickRange('yesterday', new Date(2026, 9, 2, 12)).dateFrom, '2026-10-01');
assert.deepStrictEqual(L.sanitizeFilters({ stores: [1], bogus: 1, sort: 'sumAsc' }).stores, ['1']);
assert.strictEqual(L.activeCount(F({ types: ['1'], onlyNegative: true, sort: 'sumAsc' })), 2);
assert.strictEqual(L.typeLabel(11), 'PDA-operasjon (uavklart)');
assert.strictEqual(L.typeLabel(99), 'Type 99');
console.log('logic: ok');
