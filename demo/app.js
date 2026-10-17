'use strict';
const $=id=>document.getElementById(id);
let selected={quote:'annually',start:24,end:32};
const points=[{id:1,side:'pro',text:'Quarterly reports make emerging problems visible earlier.',score:18,vote:0},{id:2,side:'con',text:'More frequent reports may consume resources better used to deliver services.',score:11,vote:0},{id:3,side:'pro',text:'A short standard template could keep the additional work manageable.',score:7,vote:0}];
function renderPoints(){
 const container=$('points');container.replaceChildren();
 const ordered=[...points].sort($('point-sort').value==='new'?(a,b)=>b.id-a.id:(a,b)=>(b.score+b.vote)-(a.score+a.vote)||a.id-b.id);
 for(const point of ordered){
  const row=document.createElement('div');row.className='point';
  const controls=document.createElement('div');
  const up=document.createElement('button');up.textContent='▲';up.setAttribute('aria-label','Upvote point: '+point.text);up.setAttribute('aria-pressed',String(point.vote===1));
  const score=document.createElement('span');score.className='score';score.textContent=String(point.score+point.vote);
  const down=document.createElement('button');down.textContent='▼';down.setAttribute('aria-label','Downvote point: '+point.text);down.setAttribute('aria-pressed',String(point.vote===-1));
  for(const [button,value]of [[up,1],[down,-1]]){button.dataset.pointId=String(point.id);button.dataset.vote=String(value);button.onclick=()=>{point.vote=point.vote===value?0:value;renderPoints();document.querySelector('[data-point-id="'+point.id+'"][data-vote="'+value+'"]').focus();$('status').textContent='Sample point ranking updated. Decision voting power is unchanged.';};}
  controls.append(up,score,down);
  const body=document.createElement('div'),side=document.createElement('span'),text=document.createElement('p');side.className='position';side.textContent=point.side==='pro'?'SUPPORTS':'OPPOSES';text.textContent=point.text;body.append(side,text);row.append(controls,body);container.append(row);
 }
}
renderPoints();$('point-sort').onchange=renderPoints;
$('point-form').onsubmit=event=>{event.preventDefault();const text=$('point-text').value.trim();if(!text)return;points.push({id:Math.max(...points.map(x=>x.id))+1,side:$('point-side').value,text,score:0,vote:0});$('point-text').value='';renderPoints();$('status').textContent='Sample point added for this page session only.';};
$('clause').addEventListener('mouseup',captureSelection);$('clause').addEventListener('keyup',captureSelection);
function captureSelection(){const s=window.getSelection();if(!s||s.isCollapsed||!$('clause').contains(s.anchorNode)||!$('clause').contains(s.focusNode))return;const r=s.getRangeAt(0),prefix=r.cloneRange();prefix.selectNodeContents($('clause'));prefix.setEnd(r.startContainer,r.startOffset);selected={quote:s.toString(),start:prefix.toString().length,end:prefix.toString().length+s.toString().length};$('quote').value=selected.quote;}
function openDrawer(){ $('drawer').hidden=false;$('discussion-toggle').setAttribute('aria-expanded','true'); }
$('suggest').onclick=()=>{openDrawer();$('quote').value=selected.quote;$('replacement').focus();};
$('discussion-toggle').onclick=()=>{const hidden=!$('drawer').hidden;$('drawer').hidden=hidden;$('discussion-toggle').setAttribute('aria-expanded',String(!hidden));};
$('proposal-form').onsubmit=event=>{event.preventDefault();$('before').textContent=$('quote').value;$('after').textContent=$('replacement').value;$('status').textContent='Replacement preview updated. This demonstration does not adopt text or carry sample ballots to revised wording.';$('ballot-status').textContent='No sample ballot selected for this wording.';};
document.querySelectorAll('[data-ballot]').forEach(button=>button.onclick=()=>{$('ballot-status').textContent='Sample '+button.dataset.ballot+' selected. '+($('mode').value==='public-input'?'Advisory only; source text stays fixed.':'No real ballot was cast or document changed.');});
$('mode').onchange=()=>{const feedback=$('mode').value==='public-input';$('mode-banner').textContent=feedback?'Public input: the original source text stays fixed. Suggestions and votes are advisory.':'Collaboration: eligible decisions may authorize a new edition.';$('ballot-explanation').textContent=feedback?'Advisory feedback has no adoption threshold. You can still discuss, rank points and express support.':'Sample rule: quorum of 3 eligible people, then a strict majority of yes/no votes. Point scores do not change voting weight.';$('ballot-status').textContent='No sample ballot selected.';};
const info={history:['History & verification','Production will expose immutable editions, the exact proposal and governance rules behind each change, Merkle inclusion proofs and verified blockchain receipts. This demonstration has no real history or blockchain transactions.'],signatures:['Frozen editions & signatures','Production signing will bind explicit intent and authenticated signer capacity to a frozen edition. Large supporter lists use readable appendices and inclusion receipts. Tycho’s Elegy is reserved in the font registry pending commercial and embedding rights. This demonstration does not collect signatures.'],admin:['One settings panel, scoped authority','Production settings will cover governance, trust tiers, clause access, anchoring, prices, subscriptions, credits, quotas, official grants and export profiles. Active ballots and required public transparency remain protected invariants. This is a design explanation, not a working administrator service.']};
for(const[id,[title,body]]of Object.entries(info))$(id).onclick=()=>{$('info-title').textContent=title;$('info-body').textContent=body;$('info-dialog').showModal();};
$('info-close').onclick=()=>$('info-dialog').close();
const steps=[
 ['mode','Choose how people participate','Collaboration can adopt eligible proposed wording. Public input keeps the source edition fixed while collecting suggestions, discussion and advisory votes.'],
 ['outline','Navigate by legal structure','Sections have stable identities. Numbering and references follow the selected jurisdiction, including (a), (1), (A), (i), and (I).'],
 ['text','Start with the exact wording','Highlight a few words in this clause. The proposal records the selected language and its edition so a later edit cannot change what people voted on.'],
 ['selection','Suggest a replacement','Choose this control, enter replacement language in the drawer and preview the before/after wording.'],
 ['points','Debate one point at a time','Add a concise supporting or opposing point. Upvote or downvote points, then sort to find the strongest reasons. Those scores do not change decision voting power.'],
 ['ballot','Inspect the decision rule','The yes/no/abstain ballot is separate from point rankings. A real decision binds wording, policy and eligible voting rights. Public input is always advisory.'],
 ['history','Verify how the text evolved','Production history connects adopted editions with proposals and decisions. Public documents require periodic blockchain commitments and independently verifiable receipts.'],
 ['signatures','Sign and export a fixed edition','Support signatures and legal execution have different intent. The production system will provide frozen PDFs, scalable appendices and signing evidence.'],
 ['admin','Set parameters in one place','Scoped administrators configure rules, access, prices, credits and official grants. They cannot rewrite active ballots or bypass public-input immutability.']
];
let step=0,activeTarget=null,returnFocus=null;
function targetFor(name){const candidates=[...document.querySelectorAll('[data-tour="'+name+'"]')];return candidates.find(el=>el.getClientRects().length>0);}
function positionTour(){if($('tour').hidden||!activeTarget)return;const r=activeTarget.getBoundingClientRect(),tour=$('tour');const w=tour.offsetWidth,h=tour.offsetHeight;let x=Math.min(Math.max(12,r.left),window.innerWidth-w-12),y=r.bottom+15;if(y+h>window.innerHeight-12)y=Math.max(12,r.top-h-15);tour.style.left=x+'px';tour.style.top=y+'px';}
function showStep(){
 activeTarget?.classList.remove('tour-target');
 const [target,title,copy]=steps[step];if(['points','ballot'].includes(target))openDrawer();
 activeTarget=targetFor(target);
 $('tour-counter').textContent='STEP '+(step+1)+' OF '+steps.length;$('tour-title').textContent=title;$('tour-copy').textContent=copy+(!activeTarget?' This control is hidden at this screen size; the explanation is still available.':'');
 $('tour-back').disabled=step===0;$('tour-next').textContent=step===steps.length-1?'Finish':'Next';$('tour').hidden=false;
 if(activeTarget){activeTarget.classList.add('tour-target');activeTarget.scrollIntoView({block:'center',behavior:'instant'});}
 positionTour();$('tour-title').focus({preventScroll:true});
}
function closeTour(){activeTarget?.classList.remove('tour-target');$('tour').hidden=true;returnFocus?.focus();}
$('tour-start').onclick=()=>{returnFocus=document.activeElement;step=0;showStep();};$('tour-close').onclick=closeTour;$('tour-back').onclick=()=>{if(step>0){step--;showStep();}};$('tour-next').onclick=()=>{if(step===steps.length-1)closeTour();else{step++;showStep();}};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('tour').hidden)closeTour();});window.addEventListener('resize',positionTour);window.addEventListener('scroll',positionTour,true);
