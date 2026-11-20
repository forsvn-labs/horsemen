"""Read explicit Markdown connections without following outside providers."""
import hashlib
import json
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

MAX_CANVAS_NODES=500

def _safe_file(target):
    """A path inside the project, as a canvas file states it. The same rule as web/hosted-reader.js."""
    if not isinstance(target,str) or not 1<=len(target)<=1024 or target.startswith('/') or '\\' in target:return False
    if any(ord(c)<32 for c in target):return False
    try: target.encode('utf-8')
    except UnicodeError:return False
    return all(part not in ('','.','..') for part in target.split('/'))

def _no_constant(name):
    raise ValueError(name)

def canvas_links(text, source_path, root, repo, revision):
    """Files that a canvas file names, as links. Only these files can be read for the canvas.

    The browser checks the canvas in full. This reader takes file nodes with a safe path from
    text that is JSON; a portal to another canvas needs no read."""
    try: doc=json.loads(text,parse_constant=_no_constant)
    except (ValueError,RecursionError):return []
    nodes=doc.get('nodes') if isinstance(doc,dict) else None
    if not isinstance(nodes,list) or len(nodes)>MAX_CANVAS_NODES:return []
    result=[];seen=set()
    for node in nodes:
        if not isinstance(node,dict) or node.get('type')!='file':continue
        target=node.get('file')
        if not _safe_file(target) or target.endswith('.canvas'):continue
        path=f'{root}/{target}' if root else target
        href=f'https://github.com/{repo}/blob/{revision}/{quote(path,safe="/")}'
        if href in seen:continue
        seen.add(href)
        alt=node.get('alt')
        result.append({'id':hashlib.sha256((source_path+'\0'+href).encode()).hexdigest()[:24],
                       'title':alt if isinstance(alt,str) and alt else posixpath.basename(path),'href':href,'path':path,
                       'kind':'document' if path.lower().endswith(('.md','.markdown')) else 'attachment','source':source_path})
    return result
