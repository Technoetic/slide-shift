import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GameEngine} from '../src/game/engine.js';
import {GameScreen} from '../src/screens/game-screen.js';

test('a suspended animation clock pauses a real run without charging hidden time, then normal frames consume time',()=>{
  const levels=JSON.parse(fs.readFileSync(new URL('../data/levels.json',import.meta.url),'utf8'));
  const engine=new GameEngine(levels);engine.start();
  const original=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{
    const screen={alive:true,engine,lastFrame:100,render(){},renderTime(){},tick:GameScreen.prototype.tick};
    GameScreen.prototype.tick.call(screen,10100);
    assert.equal(engine.getSnapshot().phase,'paused');assert.equal(engine.getSnapshot().timeLeftMs,90000);
    engine.resume();GameScreen.prototype.tick.call(screen,10200);
    assert.equal(engine.getSnapshot().phase,'playing');assert.equal(engine.getSnapshot().timeLeftMs,89900);
  }finally{globalThis.requestAnimationFrame=original;}
});
