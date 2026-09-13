import Foundation

/// The preview's HTML.
///
/// Everything is inline: a Quick Look reply is a single document with no
/// origin to load assets from. Colours follow the system appearance so
/// the preview does not glare in dark mode.
enum PreviewRenderer {

    static func html(games: [PGNGame], fileName: String, truncated: Bool)
        -> String
    {
        let body =
            games.isEmpty
            ? "<p class=\"empty\">No games found in this file.</p>"
            : games.enumerated().map { gameCard(index: $0.0, game: $0.1) }
                .joined()

        let note =
            truncated
            ? "<p class=\"note\">Showing the first games in a large file. Open in Manifest Chess Lite to see all of them.</p>"
            : ""

        return """
        <!doctype html>
        <html><head><meta charset="utf-8"><style>\(css)</style></head>
        <body>
          <header>
            <span class="file">\(escape(fileName))</span>
            <span class="count">\(games.count) game\(games.count == 1 ? "" : "s")</span>
          </header>
          \(body)
          \(note)
        </body></html>
        """
    }

    private static func gameCard(index: Int, game: PGNGame) -> String {
        let whiteElo = game.whiteElo.isEmpty ? "" : " (\(escape(game.whiteElo)))"
        let blackElo = game.blackElo.isEmpty ? "" : " (\(escape(game.blackElo)))"
        let meta = [game.event, game.date]
            .filter { !$0.isEmpty && $0 != "?" && $0 != "????.??.??" }
            .map(escape)
            .joined(separator: " &middot; ")

        return """
        <section class="game">
          <div class="players">
            <span class="name">\(escape(game.white))\(whiteElo)</span>
            <span class="result">\(escape(game.result))</span>
            <span class="name">\(escape(game.black))\(blackElo)</span>
          </div>
          \(meta.isEmpty ? "" : "<div class=\"meta\">\(meta)</div>")
          <div class="moves">\(escape(truncateMoves(game.moveText)))</div>
        </section>
        """
    }

    /// Enough moves to recognise the game, not the whole score.
    private static func truncateMoves(_ moves: String) -> String {
        let limit = 320

        if moves.count <= limit { return moves }

        let cut = moves.prefix(limit)
        let lastSpace = cut.lastIndex(of: " ") ?? cut.endIndex

        return String(cut[..<lastSpace]) + " ..."
    }

    /// Escape for HTML text content. The preview renders untrusted file
    /// contents, so nothing reaches the document unescaped.
    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static let css = """
    :root { color-scheme: light dark; }
    body {
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      margin: 0; padding: 16px 18px;
      background: Canvas; color: CanvasText;
    }
    header {
      display: flex; justify-content: space-between; align-items: baseline;
      padding-bottom: 10px; margin-bottom: 12px;
      border-bottom: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    }
    .file { font-weight: 600; font-size: 14px; }
    .count { opacity: 0.55; font-size: 12px; }
    .game {
      padding: 10px 0;
      border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    }
    .game:last-of-type { border-bottom: none; }
    .players {
      display: flex; align-items: baseline; gap: 10px;
      font-weight: 600; font-size: 13.5px;
    }
    .result {
      font-variant-numeric: tabular-nums; opacity: 0.65; font-weight: 500;
    }
    .meta { opacity: 0.55; font-size: 12px; margin-top: 3px; }
    .moves {
      margin-top: 6px; font-family: "SF Mono", ui-monospace, monospace;
      font-size: 11.5px; line-height: 1.55; opacity: 0.85;
      word-break: break-word;
    }
    .empty, .note { opacity: 0.6; font-size: 12px; }
    .note { margin-top: 14px; font-style: italic; }
    """
}
