# Live check for slice 2b

These two files make one board for the live check of slice 2b on a deployed
canvas: a real video, a real sheet, and a CSV file. The automated browser
checks use a fake player. This check uses the real providers once.

| File | Copy to | Contents |
| --- | --- | --- |
| `live-check.canvas` | `.horsemen/canvas/live-check.canvas` | A group, two videos, a Google sheet, a CSV table, a note, and a look-alike link. Canonical text. |
| `live-check.csv` | `.horsemen/media/live-check.csv` | Five rows of fictional walk data. |

The public addresses:

| Element | Address | Frame that the app builds |
| --- | --- | --- |
| YouTube video (Blender Foundation, "Big Buck Bunny") | `https://www.youtube.com/watch?v=aqz-KE-bpKQ` | `https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ` |
| Vimeo video (Vimeo staff, "The New Vimeo Player") | `https://vimeo.com/76979871` | `https://player.vimeo.com/video/76979871?dnt=1` |
| Google sheet (the public sample of the Google Sheets API) | `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit` | `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/preview` |
| Look-alike host | `https://www.youtube.com.example.net/watch?v=aqz-KE-bpKQ` | None: a link card |

## Steps

1. Deploy the Worker from main after the merge.
2. Copy the two files into a public repository that has Horsemen records,
   then commit and push to its default branch.
3. Open `https://horsemen.forsvn.com/<owner>/<repo>?canvas=live-check` in a
   browser that you use for tests.
4. Before a click, open the network panel: it shows no request to
   `youtube-nocookie.com`, `vimeo.com`, or `docs.google.com`.
5. Select **Load video** on each video and **Load preview** on the sheet. Each
   player shows in its card. The console shows no `frame-src` violation.
6. The CSV card shows a table of five rows. The look-alike card is a link.
7. Open the List view and a phone width; take before and after screenshots.

A failed player keeps "Open on …" in its card. Record which provider failed
and the console message.
