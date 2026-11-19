/* Markdown to safe HTML. Source text is always escaped; only the tags written here reach the page. */
(function(root){
  const escapeHTML=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  function safeURL(value,base){try{const u=new URL(value,base);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
  const anchor=(url,label)=>'<a target="_blank" rel="noopener noreferrer" href="'+escapeHTML(url)+'">'+label+'</a>';
  const LINK=/(`[^`]+`|!?\[[^\]]*\]\((?:[^\s()]|\([^\s()]*\))+\)|<https?:\/\/[^\s<>]+>|https?:\/\/[^\s<>\]]+)/g;
  function marks(text){
    return escapeHTML(text)
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|[^\w*])\*([^*\s](?:[^*]*[^*\s])?)\*(?![\w*])/g,'$1<em>$2</em>')
      .replace(/(^|[^\w_])_([^_\s](?:[^_]*[^_\s])?)_(?![\w_])/g,'$1<em>$2</em>')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g,'<del>$1</del>');
  }
  function inline(text,base){
    const held=[];
    const hold=html=>'\u0000'+(held.push(html)-1)+'\u0000';
    const plain=String(text).replaceAll('\u0000','').replace(LINK,part=>{
      if(part.startsWith('`'))return hold('<code>'+escapeHTML(part.slice(1,-1))+'</code>');
      const m=part.match(/^(!?)\[([^\]]*)\]\((.+)\)$/);
      if(m){const url=safeURL(m[3],base);return hold(url?anchor(url,(m[1]?'Attachment: ':'')+(m[2]?marks(m[2]):escapeHTML(url))):marks(m[2]))}
      if(part.startsWith('<')){const url=safeURL(part.slice(1,-1),base);return url?hold(anchor(url,escapeHTML(part.slice(1,-1)))):part}
      const tail=part.match(/[.,;:!?)'"]+$/)?.[0]||'',bare=tail?part.slice(0,-tail.length):part,url=safeURL(bare,base);
      return url?hold(anchor(url,escapeHTML(bare)))+tail:part;
    });
    return marks(plain).replace(/\u0000(\d+)\u0000/g,(_,i)=>held[+i]);
  }
  const ITEM=/^(\s*)([-*+]|\d+[.)])\s+(.*)$/, RULE=/^\s*([-*_])(?:\s*\1){2,}\s*$/, FIELD=/^[A-Z][A-Za-z /-]{0,30}: \S/;
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  const divider=line=>line!==undefined&&line.includes('-')&&cells(line).every(c=>/^:?-+:?$/.test(c));
  const indentOf=line=>line.match(/^\s*/)[0].replaceAll('\t','    ').length;
  function listHTML(items,base){
    let html='';
    for(let i=0;i<items.length;){
      let j=i;while(j<items.length&&items[j].ordered===items[i].ordered)j++;
      const group=items.slice(i,j).map(item=>{
        let text=item.text.join(' ');const task=text.match(/^\[([ xX])\]\s+(.*)$/s);if(task)text=task[2];
        const bold=text.match(/^\*\*(.+?)\*\*\s*(?:[:—–]|-(?=\s))\s*(\S.*)$/s)||text.match(/^\*\*(.+?):\*\*\s*(\S.*)$/s);
        const linked=!bold&&text.match(/^(\[[^\]]+\]\((?:[^\s()]|\([^\s()]*\))+\))\s*(?:[:—–]|-(?=\s))\s*(\S.*)$/s);
        const entry=bold?'<strong>'+inline(bold[1],base)+'</strong><span>'+inline(bold[2],base)+'</span>':linked?'<strong>'+inline(linked[1],base)+'</strong><span>'+inline(linked[2],base)+'</span>':null;
        const cls=[task&&'task',task&&task[1]!==' '&&'done',entry&&'entry'].filter(Boolean).join(' ');
        return {task:!!task,html:'<li'+(cls?' class="'+cls+'"':'')+'>'+(entry||inline(text,base))+listHTML(item.children,base)+'</li>'};
      });
      const tag=items[i].ordered?'ol':'ul';
      html+='<'+tag+(group.every(g=>g.task)?' class="tasks"':'')+'>'+group.map(g=>g.html).join('')+'</'+tag+'>';i=j;
    }
    return html;
  }
  function render(text,base,depth=0){
    const lines=String(text||'').replace(/<!--[^]*?-->/g,'\n\n').split('\n'),out=[];let para=[],open=0;
    const flush=()=>{
      if(!para.length)return;
      let html='';para.forEach((line,i)=>{const br=i&&(FIELD.test(line)||/(?: {2}|\\)$/.test(para[i-1]));html+=(i?(br?'<br>':' '):'')+inline(line.trim().replace(/\\$/,''),base)});
      out.push('<p>'+html+'</p>');para=[];
    };
    const blockStart=line=>/^\s*```/.test(line)||/^#{1,6}\s/.test(line)||RULE.test(line)||/^\s*>/.test(line)||/^<\/?details/.test(line)||/^<summary>/.test(line);
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(/^\s*```/.test(line)){
        flush();const code=[];i++;while(i<lines.length&&!/^\s*```/.test(lines[i]))code.push(lines[i++]);
        out.push('<pre><code>'+escapeHTML(code.join('\n'))+'</code></pre>');continue;
      }
      if(!line.trim()){flush();continue}
      if(/^<details(?: open)?>\s*$/.test(line)){flush();out.push(line.includes('open')?'<details open>':'<details>');open++;continue}
      if(/^<\/details>\s*$/.test(line)&&open){flush();out.push('</details>');open--;continue}
      const summary=line.match(/^<summary>(.*?)<\/summary>\s*$/);
      if(summary&&open){flush();out.push('<summary>'+inline(summary[1],base)+'</summary>');continue}
      const heading=line.match(/^(#{1,6})\s+(.*)/);
      if(heading){flush();out.push('<h'+heading[1].length+'>'+inline(heading[2].trim(),base)+'</h'+heading[1].length+'>');continue}
      if(RULE.test(line)){flush();out.push('<hr>');continue}
      if(line.includes('|')&&divider(lines[i+1])){
        flush();let html='<div class="table-wrap"><table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c,base)+'</th>').join('')+'</tr></thead><tbody>';i++;
        while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){i++;html+='<tr>'+cells(lines[i]).map(c=>'<td>'+inline(c,base)+'</td>').join('')+'</tr>'}
        out.push(html+'</tbody></table></div>');continue;
      }
      if(/^\s*>/.test(line)&&depth<4){
        flush();const quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*>\s?/,''));i--;
        const alert=quote[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);if(alert)quote.shift();
        out.push('<blockquote'+(alert?' class="alert '+alert[1].toLowerCase()+'"':'')+'>'+render(quote.join('\n'),base,depth+1)+'</blockquote>');continue;
      }
      if(ITEM.test(line)){
        flush();const rootItem={indent:-1,children:[]},stack=[rootItem];
        for(;i<lines.length;i++){
          const current=lines[i],m=current.match(ITEM);
          if(m&&!RULE.test(current)){
            const indent=indentOf(current);while(stack.length>1&&stack.at(-1).indent>=indent)stack.pop();
            const item={indent,ordered:/\d/.test(m[2]),text:[m[3].trim()],children:[]};stack.at(-1).children.push(item);stack.push(item);continue;
          }
          if(!current.trim()){const next=lines[i+1];if(next!==undefined&&next.trim()&&(ITEM.test(next)&&!RULE.test(next)||indentOf(next)>=2)&&!blockStart(next))continue;break}
          if(blockStart(current)||(current.includes('|')&&divider(lines[i+1])))break;
          if(!lines[i-1].trim()&&indentOf(current)<2)break;
          stack.at(-1).text.push(current.trim());
        }
        i--;out.push(listHTML(rootItem.children,base));continue;
      }
      para.push(line);
    }
    flush();while(open-->0)out.push('</details>');
    return out.join('');
  }
  const api={escapeHTML,safeURL,inline,render};
  if(typeof module!=='undefined')module.exports=api;else root.HorsemenMarkdown=api;
})(globalThis);
