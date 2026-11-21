"""Run the source-only, private local Horsemen GitHub workspace."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'horsemen/scripts'))
from horsemen_core.gui import GitHubReader, ScanState, make_server

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8787)
    parser.add_argument('--project', type=Path, help='Preview working files in this GitHub checkout. Refresh after edits.')
    args=parser.parse_args()
    if args.project:
        from horsemen_core.session_reader import SessionReader
        try:
            reader = SessionReader(args.project)
        except (ValueError, OSError) as error:
            parser.error(str(error))
    else:
        reader = GitHubReader()
    server=make_server(args.port,ScanState(reader),Path(__file__).resolve().parents[1]/'web')
    print(f'Horsemen local workspace: http://127.0.0.1:{server.server_port}',flush=True)
    if args.project: print('Previewing working files. Refresh after edits. Ctrl+C stops the server.', flush=True)
    else: print('Read-only GitHub access through gh. Ctrl+C stops the server.',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
