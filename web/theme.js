/* Themes and type sets. Runs before first paint, so the page never flashes.
   Colour themes: two base papers and one for each horse. Type sets work with every colour theme. */
(function(root){
  const themes=[
    {id:'bone',label:'Bone',note:'Light · warm paper',scheme:'light'},
    {id:'white',label:'White horse',note:'Light · Conquest',scheme:'light'},
    {id:'pale',label:'Pale horse',note:'Light · Death',scheme:'light'},
    {id:'ink',label:'Ink',note:'Dark · warm night',scheme:'dark'},
    {id:'ember',label:'Red horse',note:'Dark · War',scheme:'dark'},
    {id:'midnight',label:'Black horse',note:'Dark · Famine',scheme:'dark'}
  ];
  /* The first type set is the default. `fonts` lists the files to preload for that set. */
  const types=[
    {id:'engraved',label:'Engraved',note:'Carved titles · book text',fonts:['cleft','halden']},
    {id:'modern',label:'Modern',note:'Beacon · open and clear',fonts:['beacon']},
    {id:'system',label:'System',note:'Device fonts · no download',fonts:[]}
  ];
  /* A saved theme wins. Older saved values map forward. Anything else follows the system. */
  function resolve(saved,prefersDark){
    const id={light:'bone',dark:'ink'}[saved]||saved;
    return themes.some(theme=>theme.id===id)?id:(prefersDark?'ink':'bone');
  }
  function resolveType(saved){return types.some(type=>type.id===saved)?saved:types[0].id}
  function preloads(id){return types.find(type=>type.id===resolveType(id)).fonts.map(name=>'/assets/fonts/'+name+'.woff2')}
  const api={themes,resolve,types,resolveType,preloads};
  if(typeof module!=='undefined'){module.exports=api;return}
  root.HorsemenThemes=api;
  const html=document.documentElement,read=key=>{try{return localStorage.getItem(key)}catch{return null}};
  html.dataset.theme=resolve(read('horsemen-theme'),matchMedia('(prefers-color-scheme: dark)').matches);
  html.dataset.type=resolveType(read('horsemen-type'));
  /* Preload only the fonts of the active set. This script runs in <head> before the stylesheet. */
  for(const href of preloads(html.dataset.type)){
    const link=document.createElement('link');link.rel='preload';link.as='font';link.type='font/woff2';link.crossOrigin='anonymous';link.href=href;
    document.head.append(link);
  }
})(globalThis);
