import Foundation

/// One game, as much of it as a preview needs.
struct PGNGame {
    var headers: [String: String] = [:]
    var moveText: String = ""

    var white: String { headers["White"] ?? "?" }
    var black: String { headers["Black"] ?? "?" }
    var result: String { headers["Result"] ?? "*" }
    var event: String { headers["Event"] ?? "" }
    var date: String { headers["Date"] ?? "" }
    var whiteElo: String { headers["WhiteElo"] ?? "" }
    var blackElo: String { headers["BlackElo"] ?? "" }
}

/// A deliberately small PGN reader.
///
/// This is NOT the app's parser and must not grow into one. The app uses
/// chessops for anything that has to be correct about chess; this only
/// has to split a file into games and pull out the tag pairs, and it
/// lives in a separate sandboxed process that cannot call into the app.
/// Keeping it minimal is what keeps that duplication honest.
enum PGNParser {

    static func parse(_ text: String, limit: Int) -> [PGNGame] {
        var games: [PGNGame] = []
        var current = PGNGame()
        var moveLines: [String] = []

        func flush() {
            if current.headers.isEmpty && moveLines.isEmpty { return }
            current.moveText = moveLines.joined(separator: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            games.append(current)
            current = PGNGame()
            moveLines = []
        }

        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if line.hasPrefix("[") && line.hasSuffix("]") {
                // A tag pair after move text means the next game started.
                if !moveLines.isEmpty {
                    flush()
                    if games.count >= limit { return games }
                }
                if let (key, value) = parseTag(line) {
                    current.headers[key] = value
                }
                continue
            }

            if line.isEmpty { continue }

            moveLines.append(line)
        }

        flush()

        return Array(games.prefix(limit))
    }

    /// `[White "Carlsen, Magnus"]` to ("White", "Carlsen, Magnus").
    private static func parseTag(_ line: String) -> (String, String)? {
        let body = line.dropFirst().dropLast()

        guard let firstQuote = body.firstIndex(of: "\"") else { return nil }

        let key = body[..<firstQuote].trimmingCharacters(in: .whitespaces)
        let rest = body[body.index(after: firstQuote)...]

        guard let closingQuote = rest.lastIndex(of: "\"") else { return nil }

        // PGN defines exactly two escapes inside a tag value: \\ and \".
        // Leaving them in shows a reader `O'Brien \"Quote\"`.
        let value = String(rest[..<closingQuote])
            .replacingOccurrences(of: "\\\"", with: "\"")
            .replacingOccurrences(of: "\\\\", with: "\\")

        return key.isEmpty ? nil : (key, value)
    }
}
