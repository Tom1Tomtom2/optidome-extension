import {inspect} from './policy.mjs';
export function mountAnalysis(root, initial='', changed=()=>{}) {
 const fr=chrome.i18n.getUILanguage().startsWith('fr'), L=(f,e)=>fr?f:e, t=k=>chrome.i18n.getMessage(k);
 root.innerHTML=`<label for="draft">${L('Message à analyser','Message to analyse')}</label><textarea id="draft" rows="5" maxlength="200000" autocomplete="off" spellcheck="false"></textarea><p class="small">${L('Copie de votre message. Les modifications ici ne changent pas votre chat.','A copy of your message. Changes here do not change your chat.')}</p><label class="check"><input id="context" type="checkbox"><span>${t('analysisContext')}</span></label><details id="long-options"><summary>${L('Votre message est long ?','Is your message long?')}</summary><label>${L('Décrivez la tâche en une phrase (conseillé)','Describe the task in one sentence (recommended)')}<textarea id="task" rows="2" maxlength="8000"></textarea></label><label class="check"><input id="excerpts" type="checkbox"><span>${L('Sinon, analyser seulement le début et la fin. Une consigne au milieu peut être manquée.','Otherwise, analyse only the beginning and end. Instructions in the middle may be missed.')}</span></label></details><button id="analyse" class="primary">${L('Analyser mon message','Analyse my message')}</button><button id="cancel" hidden>${t('analysisCancel')}</button><p class="small">${L('L’analyse peut ralentir brièvement votre ordinateur.','Analysis may briefly slow down your computer.')}</p><p id="analysis-status" role="status" aria-live="polite"></p><section id="result" class="result" hidden><p id="scope" class="badge"></p><p class="kicker">${L('Type de modèle conseillé','Suggested model type')}</p><h2 id="model-type"></h2><p class="kicker">${L('Réglage conseillé, s’il existe','Suggested setting, if available')}</p><h2 id="recommendation"></h2><p id="reason"></p><p id="model" class="muted"></p><ul id="notes"></ul></section><details><summary>${L('Ce que signifie ce conseil','What this advice means')}</summary><p>${L('Le modèle détermine les capacités disponibles. Le niveau de réflexion règle l’effort pour cette réponse, lorsque le modèle propose ce réglage.','The model determines available capabilities. The reasoning level adjusts effort for this response, when that setting is available.')}</p><p>${L('Cette comparaison expérimentale avec des exemples ne connaît pas les modèles accessibles dans votre compte. Elle conseille un type de modèle, sans garantir la qualité de sa réponse. Elle ne lit pas vos fichiers ni l’historique.','This experimental comparison with examples does not know the models available in your account. It suggests a model type without guaranteeing answer quality. It does not read your files or conversation history.')}</p><p>${L('Le calcul se fait sur cet ordinateur. Le texte n’est ni enregistré ni envoyé à un serveur par Optidome.','Computation happens on this computer. Optidome neither stores the text nor sends it to a server.')}</p></details>`;
 const $=id=>root.querySelector('#'+id);$('draft').value=initial;
 let worker,serial=0,idle,deadline,busy=false,disposed=false;
 const release=()=>{worker?.terminate();worker=null;clearTimeout(deadline);clearTimeout(idle);};
 const ready=()=>{busy=false;$('analyse').disabled=!($('draft').value.trim()||$('task').value.trim());$('cancel').hidden=true;clearTimeout(deadline);};
 const invalidate=()=>{serial++;if(busy)release();ready();$('result').hidden=true;$('analysis-status').textContent='';changed($('draft').value);};
 for(const id of ['draft','task'])$(id).addEventListener('input',invalidate);
 for(const id of ['context','excerpts'])$(id).addEventListener('change',invalidate);
 $('cancel').addEventListener('click',()=>{serial++;release();ready();$('analysis-status').textContent=t('analysisCancelled');});
 const show=(result,mode)=>{
  $('result').hidden=false;const level=result.level;
  $('scope').textContent=mode==='excerpts'?L('Analyse partielle · début et fin','Partial analysis · beginning and end'):mode==='description'?L('Conseil fondé sur votre description','Advice based on your description'):L('Message analysé en entier','Entire message analysed');
  $('model-type').textContent=level?({quick:L('Rapide et léger','Fast and lightweight'),standard:L('Polyvalent','General-purpose'),deep:L('Raisonnement avancé','Advanced reasoning')})[level]:L('Pas de recommandation','No recommendation');
  $('recommendation').textContent=t('analysisLevel_'+(level||'unknown'));
  $('reason').textContent=result.reason==='partial'?L('Les extraits ne suffisent pas pour conseiller un modèle. Décrivez la tâche en une phrase plutôt que de réduire le niveau sur cette base.','These excerpts are insufficient to suggest a model. Describe the task in a sentence instead of lowering the level on this basis.'):t('analysisReason_'+result.reason);
  $('model').textContent=level?t('analysisModel_'+level):t('analysisNoChange');
  $('notes').replaceChildren();for(const key of result.notes||[]){const li=document.createElement('li');li.textContent=t('analysisNote_'+key);$('notes').append(li);}
 };
 $('analyse').addEventListener('click',()=>{
  if(busy||disposed)return;const description=$('task').value.trim(),text=description||$('draft').value;
  const mode=description?'description':$('excerpts').checked?'excerpts':'full';
  const reason=$('context').checked?'context':inspect(text);
  $('result').hidden=true;
  if(reason&&!(reason==='long'&&mode==='excerpts')){show({level:null,reason},mode);if(reason==='long')$('long-options').open=true;return;}
  busy=true;$('analyse').disabled=true;$('cancel').hidden=false;clearTimeout(idle);const id=++serial;
  $('analysis-status').textContent=t('analysisLoading');
  const fail=()=>{serial++;release();ready();$('analysis-status').textContent=t('analysisError');};
  try{
   worker??=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
   worker.onerror=e=>{e.preventDefault();fail();};
   worker.onmessage=({data})=>{if(disposed||data.id!==serial)return;if(data.type==='error'){fail();return;}if(data.type==='status'){$('analysis-status').textContent=t(data.stage==='loading'?'analysisLoading':'analysisWorking');return;}if(data.type==='result'){ready();$('analysis-status').textContent=t('analysisDone');show(data.result,mode);if(data.result.reason==='long')$('long-options').open=true;idle=setTimeout(release,60000);}};
   deadline=setTimeout(fail,60000);worker.postMessage({type:'analyse',id,text,mode});
  }catch{fail();}
 });
 ready();
 return ()=>{disposed=true;serial++;release();};
}
