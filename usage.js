/* Pure usage calculations, shared by the extension and regression tests. */
const Usage = (() => {
  const prices = {
    chatgpt: {name:'ChatGPT', model:'gpt-6.1-sol', input:2, cached:0.1, output:10, source:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'},
    claude: {name:'Claude', model:'Claude Sonnet 5.5', input:2, cached:0.1, output:10, source:'https://platform.claude.com/docs/en/about-claude/pricing'},
    gemini: {name:'Gemini', model:'Gemini 3.8 Flash', input:0.75, cached:0.075, output:3.75, source:'https://ai.google.dev/gemini-api/docs/pricing'},
    mistral: {name:'Mistral', model:'Mistral Medium 3.5', input:1.5, cached:0.15, output:7.5, source:'https://docs.mistral.ai/inference/pricing'},
  };
  const usdPerEuro=1.1188, rateDate='2026-10-26', priceDate='2026-10-27';
  const dateKey = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function aggregate(providers={}) {
    let messages=0, low=0, high=0, long=0, incomplete=0, unpriced=0;
    const breakdown=[];
    for(const [provider,models] of Object.entries(providers)) {
      let count=0;
      for(const totals of Object.values(models)) {
        const n=key=>Math.max(0,Number(totals[key])||0);
        count+=n('turns'); long+=n('longTurns'); incomplete+=n('incompleteConversations');
        const p=prices[provider];
        if(!p){unpriced+=n('turns');continue;}
        const typed=n('typed'), billed=Math.max(typed,n('billed')), out=n('output');
        low+=(typed*p.input+(billed-typed)*p.cached+out*p.output)/1e6/usdPerEuro;
        high+=(billed*p.input+out*p.output)/1e6/usdPerEuro;
      }
      messages+=count;breakdown.push({provider,messages:count});
    }
    return {messages,low,high,long,incomplete,unpriced,breakdown};
  }
  return {prices,usdPerEuro,rateDate,priceDate,dateKey,aggregate};
})();
if(typeof module!=='undefined') module.exports=Usage;
