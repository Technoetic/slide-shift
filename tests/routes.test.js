import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeUrl } from '../src/shared/routes.js';
test('hash routes preserve screen, mode and resumable game URLs',()=>{
  assert.equal(parseRoute('#/play?mode=practice').path,'/play');
  assert.equal(parseRoute('#/play?mode=practice').params.get('mode'),'practice');
  assert.equal(parseRoute('').path,'/');
  assert.equal(parseRoute('#/absent').path,'/absent');
});
test('a route cannot turn in-app navigation into external navigation',()=>{
  const result=routeUrl('https://evil.test','https://example.test/sub/');
  assert.equal(result.origin,'https://example.test');
  assert.equal(result.pathname,'/sub/');
  assert.equal(result.hash,'#/missing');
  assert.equal(routeUrl('/guide','https://example.test/sub/').href,'https://example.test/sub/#/guide');
});
