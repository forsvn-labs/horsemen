"""Read explicit Markdown connections without following outside providers."""
import hashlib
import posixpath
import re
from urllib.parse import quote, unquote, urlsplit

def connections(text, source_path, repo, revision):
    # Examples inside fenced/inline code and HTML comments are not relationships.
    text=re.sub(r'<!--.*?-->', '', text, flags=re.S)
    text=re.sub(r'^\s*(`{3,}|~{3,}).*?^\s*\1\s*$', '', text, flags=re.M|re.S)
    text=re.sub(r'`[^`\n]*`', '', text)
    result=[];seen=set()
    pattern=r'(!?)\[([^\]\n]+)\]\(\s*<?([^\s)>]+)>?(?:\s+["\'][^\n]*?["\'])?\s*\)'
    for match in re.finditer(pattern,text):
        image,title,target=match.groups()
        try: url=urlsplit(target)
        except ValueError:continue
        if not url.path and not url.netloc:continue
        if url.scheme and url.scheme not in ('https','http'):continue
        if url.netloc and not url.scheme:continue
        if url.scheme:
            href=target;path=None;kind='external'
        else:
            raw=unquote(url.path)
            if '\\' in raw or '\x00' in raw:continue
            path=posixpath.normpath(posixpath.join(posixpath.dirname(source_path),raw)) if not raw.startswith('/') else posixpath.normpath(raw.lstrip('/'))
            if path=='..' or path.startswith('../'):continue
            href=f'https://github.com/{repo}/blob/{revision}/{quote(path,safe="/")}'
            if url.fragment:href+='#'+quote(unquote(url.fragment))
            kind='document' if path.lower().endswith(('.md','.markdown')) and not image else 'attachment'
        if href in seen:continue
        seen.add(href)
        result.append({'id':hashlib.sha256((source_path+'\0'+href).encode()).hexdigest()[:24],
                       'title':title,'href':href,'path':path,'kind':kind,'source':source_path})
        if len(result)>=200:break
    return result
