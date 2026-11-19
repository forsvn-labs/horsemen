/* Themes: two base papers and one for each horse. Runs before first paint, so the page never flashes. */
(function(root){
  const themes=[
    {id:'bone',label:'Bone',note:'Light · warm paper',scheme:'light'},
    {id:'white',label:'White horse',note:'Light · Conquest',scheme:'light'},
    {id:'pale',label:'Pale horse',note:'Light · Death',scheme:'light'},
    {id:'ink',label:'Ink',note:'Dark · warm night',scheme:'dark'},
    {id:'ember',label:'Red horse',note:'Dark · War',scheme:'dark'},
    {id:'midnight',label:'Black horse',note:'Dark · Famine',scheme:'dark'}
  ];
  /* A saved theme wins. Older saved values map forward. Anything else follows the system. */
  function resolve(saved,prefersDark){
    const id={light:'bone',dark:'ink'}[saved]||saved;
    return themes.some(theme=>theme.id===id)?id:(prefersDark?'ink':'bone');
  }
  const api={themes,resolve};
  if(typeof module!=='undefined'){module.exports=api;return}
  root.HorsemenThemes=api;
  let saved=null;try{saved=localStorage.getItem('horsemen-theme')}catch{}
  document.documentElement.dataset.theme=resolve(saved,matchMedia('(prefers-color-scheme: dark)').matches);
})(globalThis);
