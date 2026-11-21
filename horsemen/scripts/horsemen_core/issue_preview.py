"""Read one Linear issue on request in a local coding session."""
from http.client import HTTPSConnection, HTTPException
import json
import os
import re

from .gui import ProviderError

ISSUE = re.compile(r'https://linear\.app/([\w-]+)/issue/([A-Za-z][A-Za-z0-9]*-[1-9][0-9]*)(?:[/?#].*)?')


def fetch_issue(identifier, token):
    connection = HTTPSConnection('api.linear.app', timeout=8)
    query = 'query Issue($id:String!){issue(id:$id){identifier url title state{name}}}'
    try:
        connection.request('POST', '/graphql', json.dumps({'query':query, 'variables':{'id':identifier}}),
                           {'Content-Type':'application/json', 'Authorization':token})
        response = connection.getresponse()
        if response.status == 200:
            return json.loads(response.read(65536))['data']['issue']
    except (HTTPException, OSError, ValueError, KeyError, TypeError):
        pass
    finally:
        connection.close()
    raise ProviderError('Linear could not return this issue. Check access or open the original.', 422)


def issue_preview(url):
    match = ISSUE.fullmatch(url)
    if not match:
        raise ProviderError('Use a Linear issue link.', 400)
    token = os.getenv('LINEAR_API_KEY')
    if not token:
        raise ProviderError('Set LINEAR_API_KEY for the local server to preview this issue.', 422)
    issue = fetch_issue(match[2].upper(), token)
    address = issue.get('url') if isinstance(issue, dict) else None
    actual = ISSUE.fullmatch(address) if isinstance(address, str) else None
    if not actual or actual[1].lower() != match[1].lower():
        raise ProviderError('The linked issue is unavailable in this workspace.', 404)
    state = issue.get('state')
    fields = {'title':issue.get('title'), 'identifier':issue.get('identifier'),
              'state':state.get('name') if isinstance(state, dict) else None}
    if not all(isinstance(value, str) and value.strip() for value in fields.values()):
        raise ProviderError('Linear returned incomplete issue details.', 422)
    if fields['identifier'].upper() != actual[2].upper():
        raise ProviderError('Linear returned inconsistent issue details.', 422)
    return fields
