/* Generated canvases: one card for each second-level heading of a record.
   Pure rules, shared by the app and its regression checks. Nothing here reads
   or writes a file: the same record text always gives the same cards, IDs, and places.
   Card text is a source excerpt only; nothing is inferred. */
(function(root){
  const P=typeof module!=='undefined'&&module.exports?require('./previews.js'):root.HorsemenPreview;
  const TITLES={vision:'Vision',progress:'Progress',brain:'Brain',structure:'Structure',readme:'README',changelog:'Changelog',techstack:'Tech stack'};
  /* The ID rule of the canvas file format: a section card is "s-" plus the heading slug. */
  const NODE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  const CARD={width:320,height:196},PITCH={x:360,y:248},COLUMNS=3,SLUG_MAX=56;
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  /* Lower-case letters and digits, with one hyphen between words. Accents fold to plain letters. */
  function slug(text){
    return String(text??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,SLUG_MAX).replace(/-+$/,'');
  }
  /* Sections in source order. The reading view decides what a heading is, so the rules match it:
     comments are removed first, then code blocks; a heading starts its line with "## ". */
  function parse(markdown){
    const text=String(markdown??'').replace(/<!--[^]*?-->/g,comment=>comment.replace(/[^\n]/g,''));
    const found=[],counts=new Map(),used=new Set();let current=null,fence=false;
    text.split('\n').forEach((line,i)=>{
      if(/^\s*```/.test(line))fence=!fence;
      const heading=!fence&&line.match(/^##\s+(.+)/);
      if(!heading){if(current)current.body.push(line);return}
      const title=P.plain(heading[1]),name=slug(title)||'section',base='s-'+name,ordinal=(counts.get(name)||0)+1;counts.set(name,ordinal);
      let n=ordinal,id=n===1?base:base+'-'+n;while(used.has(id))id=base+'-'+(++n);used.add(id);
      current={id,slug:name,ordinal,index:found.length,title:title||heading[1].trim(),line:i+1,body:[]};found.push(current);
    });
    return found.map(s=>({...s,body:s.body.join('\n')}));
  }
  /* A fixed grid in reading order. A place depends only on the position of the card in the record. */
  function layout(count){
    return Array.from({length:Math.max(0,count|0)},(_,i)=>[(i%COLUMNS)*PITCH.x,Math.floor(i/COLUMNS)*PITCH.y]);
  }
  const clip=line=>line.slice(0,260);
  /* A few key lines from the source: text first; a table gives its first column; a code block gives its first lines. */
  function excerpt(body,title=''){
    const tidy=P.tidy(body||''),outside=[],inside=[];let fence=false,diagram=false,drawn=false;
    for(const line of tidy.split('\n')){
      if(/^\s*```/.test(line)){fence=!fence;diagram=fence&&/^\s*```\s*mermaid\b/i.test(line);if(diagram)drawn=true;continue}
      if(fence){if(!diagram&&line.trim())inside.push(line.trim());continue}
      outside.push(line);
    }
    const table=P.toolsTable(outside.join('\n')),prose=P.lines(outside.filter(line=>!/^\s*\|/.test(line)).join('\n'));
    const first=table.rows.map(row=>row[0]).filter(Boolean).join(' · ');
    /* A heading that only wraps later sections in a disclosure: its label, when it says more than the heading. */
    const label=P.plain(String(body||'').match(/^<summary>(.*?)<\/summary>\s*$/m)?.[1]||'');
    const lines=prose.length?prose:first?[first]:inside.length?inside:drawn?['Diagram']:label&&slug(label)!==slug(title)?[label]:[];
    const shape=P.shape(outside.join('\n'));
    const meta=shape.count<2?'':shape.kind==='list'?shape.count+' items':shape.kind==='table'?shape.count+' rows':'';
    return {lead:clip(lines[0]||''),lines:lines.slice(1,3).map(clip),meta,empty:!lines.length};
  }
  /* The canvas of one record. A record without sections is one card for the whole record. */
  function canvas(key,markdown){
    if(!Object.hasOwn(TITLES,key))return {key,nodes:[],edges:[]};
    const text=String(markdown??''),sections=parse(text);
    const cards=sections.length?sections.map(s=>({id:s.id,kind:'section',title:s.title,line:s.line,...excerpt(s.body,s.title)}))
      :text.trim()?[{id:'r-'+key,kind:'record',title:TITLES[key],line:1,...excerpt(text.split('\n').filter(line=>!/^#\s/.test(line)).join('\n'))}]:[];
    const spots=layout(cards.length);
    return {key,nodes:cards.map((card,i)=>({...card,x:spots[i][0],y:spots[i][1],width:CARD.width,height:CARD.height})),edges:[]};
  }
  /* The inside of a card button. Record text is escaped; only the tags written here reach the page. */
  function cardHTML(node){
    const body=node.empty?'<span class="card-note">'+(node.kind==='record'?'This record is empty.':'No text under this heading.')+'</span>'
      :'<span class="card-lead">'+esc(node.lead)+'</span>'+node.lines.map(line=>'<span class="card-line">'+esc(line)+'</span>').join('')+(node.meta?'<span class="card-meta">'+esc(node.meta)+'</span>':'');
    return '<span class="cardhead"><b>'+esc(node.title)+'</b></span><span class="cardbody">'+body+'</span>';
  }
  const cardLabel=node=>node.kind==='record'?'Open '+node.title:'Open section: '+node.title;
  /* A place in a link: the canvas of a record or a board (the name of a canvas file) and at most one element on it.
     Home is the default and needs no name. The app opens Home when the project has no canvas with the name. */
  const CANVAS_NAME=/^[a-z0-9][a-z0-9-]{0,63}$/;
  function viewLink(state){
    const canvas=state&&typeof state.canvas==='string'&&state.canvas!=='home'&&CANVAS_NAME.test(state.canvas)?state.canvas:null;
    const node=canvas&&typeof state.node==='string'&&NODE_ID.test(state.node)?state.node:null;
    return {canvas,node};
  }
  /* The local app keeps the place in the address hash: #p=<project>&c=<canvas>&n=<element>&r=<record>. */
  const HASH=/^#p=([a-f0-9]{24})(?:&c=([a-z0-9-]+))?(?:&n=([A-Za-z0-9_-]+))?(?:&r=([a-z]+))?$/;
  function parseHash(hash){
    const m=String(hash||'').match(HASH);if(!m)return null;
    const view=viewLink({canvas:m[2],node:m[3]});
    return {p:m[1],r:m[4]&&Object.hasOwn(TITLES,m[4])?m[4]:null,c:view.canvas,n:view.node};
  }
  function formatHash(state){
    if(!state||!/^[a-f0-9]{24}$/.test(state.p||''))return '';
    const view=viewLink({canvas:state.c,node:state.n});
    return '#p='+state.p+(view.canvas?'&c='+view.canvas:'')+(view.node?'&n='+view.node:'')+(state.r&&Object.hasOwn(TITLES,state.r)?'&r='+state.r:'');
  }
  /* Which of the headings on a page belongs to a section card. Names decide; a repeated heading uses its count.
     byOrder: in the full document, where each section has one heading, the order decides when no name matches. */
  function headingIndex(sections,id,headings,options={}){
    const section=sections.find(s=>s.id===id);if(!section)return -1;
    const same=[];headings.forEach((heading,i)=>{if((slug(heading)||'section')===section.slug)same.push(i)});
    if(same.length)return same[section.ordinal-1]??-1;
    return options.byOrder&&headings.length===sections.length?section.index:-1;
  }
  const api={TITLES,NODE_ID,CARD,PITCH,COLUMNS,slug,parse,layout,excerpt,canvas,cardHTML,cardLabel,viewLink,parseHash,formatHash,headingIndex};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HorsemenSections=api;
})(globalThis);
