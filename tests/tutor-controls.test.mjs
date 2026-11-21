import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { register } from 'tsx/esm/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { intersectTutorModels } from '../lib/tutor-models.ts';

registerHooks({resolve(specifier,context,next){
 if(specifier.endsWith('.css'))return {url:'data:text/javascript,export {};',shortCircuit:true};
 return next(specifier,context);
}});
register();
const { TutorControls }=await import('../components/TutorControls.tsx');
const render=(value,availability)=>renderToStaticMarkup(React.createElement(TutorControls,{value,availability,onChange(){}}));
const available={status:'ready',models:intersectTutorModels(['gpt-6.2-astra','gpt-6-luna','gpt-5.4-mini']),message:'',ready:true,reload(){}};

test('actual controls display only project choices and selected-model reasoning strengths',()=>{
 const astra=render({model:'gpt-6.2-astra',reasoningEffort:'low'},available);
 assert.match(astra,/GPT-6.2 Astra/);assert.doesNotMatch(astra,/GPT-5.4 nano|value="none"/);assert.match(astra,/value="max"/);
 const mini=render({model:'gpt-5.4-mini',reasoningEffort:'none'},available);
 assert.match(mini,/value="none"/);assert.doesNotMatch(mini,/value="max"/);
});

test('empty and restricted metadata have distinct accessible states and do not submit retry',()=>{
 const value={model:'gpt-5.4-mini',reasoningEffort:'low'};
 const empty=render(value,{...available,status:'empty',models:[],message:'无兼容型号',ready:false});
 assert.match(empty,/暂无可用模型/);assert.match(empty,/disabled=""/);assert.match(empty,/role="status"/);assert.match(empty,/type="button"/);
 const restricted=render(value,{...available,status:'unavailable',message:'模型列表查询受限'});
 assert.match(restricted,/待核实/);assert.match(restricted,/模型列表查询受限/);assert.doesNotMatch(restricted,/disabled=""/);
});

test('speed selector is independent, model-specific, and discloses premium billing without promising access',()=>{
 const standard=render({model:'gpt-5.4-mini',reasoningEffort:'low'},available);
 assert.match(standard,/aria-label="速度"/);assert.match(standard,/value="fast"/);assert.doesNotMatch(standard,/value="ultrafast"/);
 const astra=render({model:'gpt-6.2-astra',reasoningEffort:'high',speed:'ultrafast'},available);
 assert.match(astra,/value="ultrafast"/);assert.match(astra,/title="[^"]*加价/);assert.doesNotMatch(astra,/tutor-speed-note/);
 assert.match(astra,/>Fast<\/option>/);assert.match(astra,/>Ultrafast<\/option>/);
});
