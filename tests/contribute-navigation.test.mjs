import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
test('main Contribute menu uses Edit, Guide, Tasks, Activity, Contributors',()=>{
 const opener=html.match(/<button[^>]*id="toolsButton"[^>]*>[^<]*<\/button>/)?.[0];
 assert.match(opener,/aria-label="Contribute">Contribute<\/button>/);
 const menu=html.slice(html.indexOf('<nav id="toolsMenu"'),html.indexOf('</nav>',html.indexOf('<nav id="toolsMenu"')));
 const visible=[...menu.matchAll(/<(button|a)\b([^>]+)>([^<]*)<\/(?:button|a)>/g)].filter(match=>!/(?:^|\s)hidden(?:\s|$)/.test(match[2])).map(match=>match[3]);
 assert.deepEqual(visible,['Edit','Guide','Tasks','Activity','Contributors']);
 assert.match(menu,/<a id="guideButton"[^>]+href="\/guide">Guide<\/a>/,'the guide sits under Edit in the Contribute menu');
 assert.match(html,/<a id="guidePageLink" href="\/guide">Guide<\/a>/,'signed-out visitors reach the guide from the title card');
 assert.match(menu,/<a id="contributorsButton"[^>]+href="\/contributors">/);
 assert.ok(!html.includes('src="contributors.js"'),'old popup must not replace the new page link');
 assert.match(html,/<a id="contributorsPageLink" href="\/contributors"[^>]*>/,'signed-out users retain a normal public link');
});
test('place-specific editing and existing Edit/Tasks handlers retain their actions',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),contributions=readFileSync(new URL('../public/contributions.js',import.meta.url),'utf8');
 assert.match(app,/edit\.textContent='Edit'/);
 assert.match(app,/\['submitTool','submissionView','Edit'\]/);
 assert.match(contributions,/byId\('tasksTool'\)\.addEventListener\('click'/);
 assert.match(html, /id="activityButton"[^>]+href="\/activity"/);
});
