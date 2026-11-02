import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {APP,build} from '../scripts/build.mjs';

test('build packages authored levels into the validated async envelope and a coherent build asset graph',async()=>{
  const before=await readFile(path.join(APP,'data/levels.json'),'utf8');
  const result=await build({outDir:'.test-build',tag:'test'});
  const data=JSON.parse(await readFile(path.join(result.out,'data/levels.json'),'utf8'));
  assert.equal(data.schema,1);assert.equal(data.levels.length,8);
  assert.equal(await readFile(path.join(APP,'data/levels.json'),'utf8'),before);
  const html=await readFile(path.join(result.out,'index.html'),'utf8');
  assert.ok(html.includes(`content="${result.buildId}"`));assert.ok(!html.includes('__BUILD_ID__'));
  const script=html.match(/<script type="module" src="([^"]+)"/)[1];
  await access(path.resolve(result.out,script));
  const main=await readFile(path.resolve(result.out,script),'utf8');
  assert.ok(main.includes(result.buildId));
  assert.ok(!main.includes("from './game/engine.js'"));
});
