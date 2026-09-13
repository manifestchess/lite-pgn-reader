# Copying Manifest Chess Lite

Any file in this project that does not state otherwise and is not listed as an
exception below is part of Manifest Chess Lite and copyright (c) 2026 the Manifest
Chess authors.

Manifest Chess Lite is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

Manifest Chess Lite is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

See the [LICENSE](./LICENSE) file for a copy of the _GNU General Public
License_.

## Why GPL

The choice is not entirely ours. The app links `chessground` and `chessops`
(both GPL-3.0-or-later), and the installer ships a Stockfish build (GPL-3.0).
Either of those alone forces a GPL-family licence on the combined work.

Plain GPLv3 rather than the Affero variant. Manifest Chess Lite is a desktop
application: it runs on the machine in front of you and offers no service to
users over a network, so AGPLv3 section 13, the one clause distinguishing the
two, would impose an obligation with nothing to attach to.

Several bundled art and sound assets come from lichess-org/lila and are
AGPL-3.0-or-later. They keep that licence, and it travels with them: the rows
below say so individually, and the full text ships alongside them. GPLv3
section 13 expressly permits combining a GPLv3 work with an AGPLv3 one, which
is what makes that lawful, and it is the same clause that covers the Stockfish
and chessground combination.

## Exceptions (free)

<!-- prettier-ignore -->
Files | Author(s) | License
--- | --- | ---
`cg-board square.*` and coordinate colour rules in `styles/globals.css` | the [chessground](https://github.com/lichess-org/chessground) authors | [GPLv3+](https://www.gnu.org/licenses/gpl-3.0.txt)
`public/chess-assets/boards/*` except `disco.svg` | the [lila](https://github.com/lichess-org/lila) authors and [pirouetti](https://lichess.org/@/pirouetti) | AGPLv3+
`public/sounds/{piano,sfx,nes,futuristic}` | [Enigmahack](https://github.com/Enigmahack) for [lila](https://github.com/lichess-org/lila) | AGPLv3+, full text at `public/sounds/LICENSE-AGPL-3.0.txt`, per-pack detail in `public/sounds/CREDITS.md`
`public/font/lichess-chess.woff2` | the [pgn4web](http://pgn4web.casaschi.net/home.html) authors | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
`public/stockfish/*` | the [Stockfish](https://github.com/official-stockfish/Stockfish) developers, WASM build by [nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js), NNUE nets by [Linmiao Xu](https://github.com/linrock) | [GPLv3](https://www.gnu.org/licenses/gpl-3.0.txt)
`public/chess-assets/pieces/caliente` | [Leonid Gordenin "avi"](https://github.com/avi-0/caliente) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
`public/chess-assets/pieces/cburnett` | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
`public/chess-assets/pieces/celtic` | [Maurizio Monge](https://github.com/maurimo/chess-art) | [MIT](https://github.com/maurimo/chess-art/blob/main/LICENSE)
`public/chess-assets/pieces/chessnut` | [Alexis Luengas](https://github.com/LexLuengas) | [Apache 2.0](https://github.com/LexLuengas/chessnut-pieces/blob/master/LICENSE.txt)
`public/chess-assets/pieces/fantasy` | [Maurizio Monge](https://github.com/maurimo/chess-art) | [MIT](https://github.com/maurimo/chess-art/blob/main/LICENSE)
`public/chess-assets/pieces/firi` | [James Faure](https://github.com/jfaure/Firi-pieceset) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
`public/chess-assets/pieces/kiwen-suwi` | [neverRare](https://github.com/neverRare) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
`public/chess-assets/pieces/kosal` | [Kosal Sen / Philatype](https://github.com/philatype/kosal) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
`public/chess-assets/pieces/letter` | [usolando](https://lichess.org/@/usolando) | AGPLv3+
`public/chess-assets/pieces/merida` | Armando Hernandez Marroquin | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
`public/chess-assets/pieces/mono` | Thibault Duplessis and [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt)
`public/chess-assets/pieces/mpchess` | [Maxime Chupin](https://github.com/chupinmaxime) | [GPLv3+](https://www.gnu.org/licenses/gpl-3.0.txt)
`public/chess-assets/pieces/pirouetti` | [pirouetti](https://lichess.org/@/pirouetti) | AGPLv3+
`public/chess-assets/pieces/pixel` | therealqtpi | AGPLv3+
`public/chess-assets/pieces/rhosgfx` | [RhosGFX](https://rhosgfx.itch.io/) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
`public/chess-assets/pieces/shapes` | [flugsio](https://github.com/flugsio/chess_shapes) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
`public/chess-assets/pieces/spatial` | [Maurizio Monge](https://github.com/maurimo/chess-art) | [MIT](https://github.com/maurimo/chess-art/blob/main/LICENSE)
UI icons rendered through `@iconify/react` | [Lucide](https://lucide.dev/) | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE)

The piece sets above were sourced from lichess-org/lila, which republishes them
with the per-set attribution recorded in its own
[COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md). Where
an artist has since relicensed their work upstream (`caliente`), the upstream
grant is the one recorded here.

`public/chess-assets/boards/disco.svg` and `public/brand/*` are our own work and
are covered by the project licence.

## Trademarks (not covered by the project licence)

"Manifest Chess Lite" and the Manifest Chess Lite logo are trademarks of the Manifest
Chess authors. The GPL gives you the right to fork the code; it does not give
you the right to ship your fork under our name or mark.

## Source for the binaries

The GPL requires that anyone who receives a Manifest Chess Lite binary can get the
corresponding source. Each tagged release publishes the complete source of that
release. The bundled Stockfish build corresponds to
[nmrugg/stockfish.js](https://github.com/nmrugg/stockfish.js) at the version
recorded in the banner comment of `public/stockfish/stockfish-18-lite.js`, which
in turn corresponds to
[official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish).
