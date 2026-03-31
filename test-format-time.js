const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');

test('formatLocalTime correctly formats timestamps', () => {
    const code = fs.readFileSync('./public/app.js', 'utf8');

    // Extract the formatLocalTime function accurately
    const startIdx = code.indexOf('function formatLocalTime(timestamp, tzOffsetSeconds) {');
    const endStr = '    return `${hours}:${minutes}:${seconds}`;\n}';
    const endIdx = code.indexOf(endStr, startIdx) + endStr.length;
    assert.ok(startIdx !== -1 && endIdx !== -1, 'formatLocalTime function should exist');

    const funcCode = code.substring(startIdx, endIdx);

    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(funcCode, sandbox);

    const formatLocalTime = sandbox.formatLocalTime;

    // Test cases
    // 0 seconds into the day (midnight)
    assert.strictEqual(formatLocalTime(0, 0), '00:00:00');

    // 3600 seconds into the day (1:00 AM)
    assert.strictEqual(formatLocalTime(3600, 0), '01:00:00');

    // 3600 + 120 + 5 seconds into the day (1:02:05 AM)
    assert.strictEqual(formatLocalTime(3725, 0), '01:02:05');

    // 86399 seconds into the day (23:59:59 PM)
    assert.strictEqual(formatLocalTime(86399, 0), '23:59:59');

    // Negative offset (e.g., UTC+1 -> tzOffset is -3600 seconds)
    assert.strictEqual(formatLocalTime(0, -3600), '01:00:00');

    // Positive offset (e.g., UTC-1 -> tzOffset is 3600 seconds)
    // -3600 seconds relative to local midnight is 23:00:00 the previous day
    assert.strictEqual(formatLocalTime(0, 3600), '23:00:00');

    console.log('All tests passed!');
});