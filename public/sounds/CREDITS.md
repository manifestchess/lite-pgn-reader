# Sound credits

Every sound file shipped with Manifest Chess Lite is listed here. All of them come
from a single source with a documented licence.

## Enigmahack sound packs

The `piano`, `sfx`, `nes`, and `futuristic` packs were created by
[Enigmahack](https://github.com/Enigmahack) for
[lichess.org](https://lichess.org) and are licensed **AGPLv3 or later**.

- Source: https://github.com/lichess-org/lila (`public/sound/`)
- Licence text: `LICENSE-AGPL-3.0.txt`, next to this file
- Attribution basis: lila's `COPYING.md` lists
  `public/sounds/{futuristic,nes,piano,sfx}` under "Exceptions (free)".

Files were copied verbatim and only renamed (`Move.mp3` to `move.mp3`,
`Capture.mp3` to `capture.mp3`, `Check.mp3` to `check.mp3`) to match this
project's asset naming. No audio content was altered.

## Deliberately excluded packs

These Lichess packs were reviewed and **not** included:

| Pack | Reason |
| --- | --- |
| `lisp` | CC BY-NC-SA 4.0. The NonCommercial term is incompatible with a commercially distributed build, and ShareAlike is incompatible with the GPL. |
| `standard`, `robot`, `woodland` | Listed under "Exceptions (non-free)" in lila's `COPYING.md`. Lichess states no usable licence grant for them. |

Where these packs appear in other GPL-3.0 projects, that licence does not
cover them: those files are byte-for-byte copies of the Lichess originals, so
the Lichess terms above still govern them.
