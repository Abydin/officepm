'use strict';

// Section 15 promises the server refuses to start on bad projects.json and says
// exactly why. That promise is load-bearing: the office admin edits this file by
// hand, and a server that boots into a half-valid config is worse than one that
// will not boot at all.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { bootWithConfig } = require('./helpers');

const board = (over) => Object.assign({
  slug: 'eng', name: 'Engineering', prefix: 'AAA-ENG', icon: 'code', flow: 'kanban',
  statuses: ['Backlog', 'Done'], types: ['task'], done_statuses: ['Done']
}, over || {});

const project = (over) => Object.assign({
  slug: 'alpha', name: 'Alpha', description: 'd', boards: [board()]
}, over || {});

describe('startup validation', () => {
  test('a valid config boots and reports what it loaded', async () => {
    const { code, output } = await bootWithConfig({ projects: [project()] });
    assert.equal(code, 'did-not-exit', 'a valid config should keep running');
    assert.match(output, /projects\.json OK/);
    assert.match(output, /1 project\(s\), 1 board\(s\)/);
  });

  test('malformed JSON is refused by name', async () => {
    const { code, output } = await bootWithConfig('{ "projects": [ oops }');
    assert.notEqual(code, 'did-not-exit', 'must not start');
    assert.match(output, /not valid JSON/);
  });

  test('a missing projects array is refused', async () => {
    const { code, output } = await bootWithConfig({ nope: true });
    assert.notEqual(code, 'did-not-exit');
    assert.match(output, /top-level "projects" array/);
  });

  test('duplicate board prefixes are refused, and both owners are named', async () => {
    const { code, output } = await bootWithConfig({
      projects: [
        project({ slug: 'alpha', boards: [board({ prefix: 'SAME' })] }),
        project({ slug: 'beta', name: 'Beta', boards: [board({ slug: 'other', prefix: 'SAME' })] })
      ]
    });
    assert.notEqual(code, 'did-not-exit', 'a duplicate prefix would collide ticket keys');
    assert.match(output, /SAME/);
    assert.match(output, /alpha/);
    assert.match(output, /beta/);
  });

  test('an unknown flow is refused', async () => {
    const { code, output } = await bootWithConfig({
      projects: [project({ boards: [board({ flow: 'agile-ish' })] })]
    });
    assert.notEqual(code, 'did-not-exit');
    assert.match(output, /agile-ish|flow/);
  });

  test('a project with no boards is refused', async () => {
    const { code, output } = await bootWithConfig({ projects: [project({ boards: [] })] });
    assert.notEqual(code, 'did-not-exit');
    assert.match(output, /at least one board/);
  });

  test('a duplicate project slug is refused', async () => {
    const { code, output } = await bootWithConfig({
      projects: [project(), project({ boards: [board({ prefix: 'BBB-ENG' })] })]
    });
    assert.notEqual(code, 'did-not-exit');
    assert.match(output, /duplicate project slug/);
  });

  test('an uppercase slug is refused, since slugs go in urls', async () => {
    const { code, output } = await bootWithConfig({ projects: [project({ slug: 'Alpha' })] });
    assert.notEqual(code, 'did-not-exit');
    assert.match(output, /slug/);
  });
});
