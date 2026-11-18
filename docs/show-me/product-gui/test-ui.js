(async () => {
const check=(v,m)=>{if(!v)throw Error(m)};
const click=s=>{const e=document.querySelector(s);check(e,'Missing '+s);e.click()};
check(document.querySelectorAll('[data-artifact]').length===7,'Seven artifact controls');
for(const name of ['vision','progress','brain','structure','readme','changelog','techstack']){
click('[data-artifact="'+name+'"]');
check(document.querySelector('#peek').open,'Peek opens '+name);
check(document.querySelector('#peek-content').textContent.length>80,'Full content '+name);
click('#source-tab');check(!document.querySelector('#source-content').hidden,'Source visible');
check(document.querySelector('#source-content').textContent.includes('#'),'Markdown exists');
click('#close-peek');check(!document.querySelector('#peek').open,'Peek closes');
}
click('#list-view');check(document.querySelector('#map').classList.contains('list'),'List toggles');
click('#canvas-view');
const search=document.querySelector('#search');search.value='zzzz';search.dispatchEvent(new Event('input'));
check(!document.querySelector('#empty').hidden,'Empty search');search.value='';search.dispatchEvent(new Event('input'));
click('#share');check(document.querySelector('#share-dialog').open,'Share opens');
check(!document.querySelector('input[value="brain"]').checked,'Brain private by default');
click('#preview-share');check(document.querySelector('#public-preview').textContent.includes('VISION'),'Preview selected');
check(!document.querySelector('#public-preview').textContent.includes('BRAIN.md'),'Excluded Brain');
click('#close-share');click('#zoom-out');check(document.querySelector('#zoom-label').textContent==='90%','Zoom out');click('#fit');check(document.querySelector('#zoom-label').textContent==='100%','Fit');click('[data-project="1"]');check(document.querySelector('#project-name').textContent==='Fieldnotes','Project switch');
click('[data-project="0"]');
check(document.documentElement.scrollWidth<=innerWidth,'No page overflow');
return 'PASS: 7 peeks, source views, close, list/canvas, search empty/reset, sharing exclusion, project switch, viewport';
})()
