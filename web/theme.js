/* Themes. Runs before first paint, so the page never flashes.
   A theme (data-style) sets fonts, shapes, borders, shadows, spacing, the canvas, and colours.
   Engraved, the default, has six palettes (data-theme). A theme with a light and a dark mode
   follows the device unless the person chooses a mode (data-mode). */
(function(root){
  /* `modes` lists the modes a theme supports. `fonts` lists the files to preload for that theme. */
  const styles=[
    {id:'engraved',label:'Engraved',note:'Carved titles and book text on bone or ink',modes:['light','dark'],palettes:true,fonts:['cleft','halden']},
    {id:'modern',label:'Modern',note:'Clear product type, grey, and one blue accent',modes:['light','dark'],fonts:['beacon']},
    {id:'editorial',label:'Editorial',note:'Newspaper serif, hairline rules, no shadows',modes:['light'],fonts:['opaline','folio']},
    {id:'terminal',label:'Terminal',note:'Monospace, phosphor green, amber, compact',modes:['dark'],fonts:['diode']},
    {id:'swiss',label:'Swiss',note:'Bold grotesk on a grid, black, white, and red',modes:['light'],fonts:['halden']},
    {id:'blueprint',label:'Blueprint',note:'White line work on a blue field',modes:['dark'],fonts:['tessera','signal']},
    {id:'soft',label:'Soft',note:'Pastel, very round, and airy',modes:['light','dark'],fonts:['brioche','mallow']},
    {id:'contrast',label:'High contrast',note:'Black and white, larger text, thick focus',modes:['light','dark'],fonts:['beacon']}
  ];
  /* Engraved palettes: two base papers and one for each horse. */
  const themes=[
    {id:'bone',label:'Bone',note:'Light · warm paper',scheme:'light'},
    {id:'white',label:'White horse',note:'Light · Conquest',scheme:'light'},
    {id:'pale',label:'Pale horse',note:'Light · Death',scheme:'light'},
    {id:'ink',label:'Ink',note:'Dark · warm night',scheme:'dark'},
    {id:'ember',label:'Red horse',note:'Dark · War',scheme:'dark'},
    {id:'midnight',label:'Black horse',note:'Dark · Famine',scheme:'dark'}
  ];
  const style=id=>styles.find(s=>s.id===id);
  /* A saved Engraved palette wins. Older saved values map forward. Anything else follows the system. */
  function resolve(saved,prefersDark){
    const id={light:'bone',dark:'ink'}[saved]||saved;
    return themes.some(theme=>theme.id===id)?id:(prefersDark?'ink':'bone');
  }
  /* A saved theme wins. The old Modern and System type sets were for readable text: they map to Modern. */
  function resolveStyle(saved,legacyType){
    if(style(saved))return saved;
    return legacyType==='modern'||legacyType==='system'?'modern':styles[0].id;
  }
  /* A theme with one mode always uses it. Otherwise a saved mode wins, then the device. */
  function resolveMode(id,saved,prefersDark){
    const modes=style(resolveStyle(id)).modes;
    if(modes.length===1)return modes[0];
    return modes.includes(saved)?saved:(prefersDark?'dark':'light');
  }
  function preloads(id){return style(resolveStyle(id)).fonts.map(name=>'/assets/fonts/'+name+'.woff2')}
  /* The attributes for one choice. Engraved takes its mode from the palette. */
  function attributes(saved){
    const id=resolveStyle(saved.style,saved.type);
    if(id==='engraved'){const palette=resolve(saved.theme,saved.prefersDark);return {style:id,theme:palette,mode:themes.find(t=>t.id===palette).scheme}}
    return {style:id,theme:null,mode:resolveMode(id,saved.mode,saved.prefersDark)};
  }
  const api={styles,themes,resolve,resolveStyle,resolveMode,preloads,attributes};
  if(typeof module!=='undefined'){module.exports=api;return}
  root.HorsemenThemes=api;
  const html=document.documentElement,read=key=>{try{return localStorage.getItem(key)}catch{return null}};
  const chosen=attributes({style:read('horsemen-style'),type:read('horsemen-type'),theme:read('horsemen-theme'),mode:read('horsemen-mode'),prefersDark:matchMedia('(prefers-color-scheme: dark)').matches});
  html.dataset.style=chosen.style;html.dataset.mode=chosen.mode;
  if(chosen.theme)html.dataset.theme=chosen.theme;
  /* Preload only the fonts of the active theme. This script runs in <head> before the stylesheet. */
  for(const href of preloads(chosen.style)){
    const link=document.createElement('link');link.rel='preload';link.as='font';link.type='font/woff2';link.crossOrigin='anonymous';link.href=href;
    document.head.append(link);
  }
})(globalThis);
