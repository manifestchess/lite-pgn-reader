import Foundation

/// Bounded reads of a PGN file.
///
/// A PGN database is routinely gigabytes and can hold millions of games.
/// A preview must never read one whole, so everything is capped and the UI
/// says when it truncated.
enum PGNDocument {

    /// How much of a file a preview is allowed to read.
    static let headByteLimit = 256 * 1024

    /// Read at most `headByteLimit` bytes, decoded leniently.
    ///
    /// PGN is nominally ASCII but real archives carry Latin-1 player
    /// names, so a strict UTF-8 decode would return nothing at all for
    /// files that are otherwise perfectly readable.
    static func readHead(of url: URL) -> String {
        guard let handle = try? FileHandle(forReadingFrom: url) else {
            return ""
        }
        defer { try? handle.close() }

        let data =
            (try? handle.read(upToCount: headByteLimit)) ?? Data()

        if let utf8 = String(data: data, encoding: .utf8) {
            return utf8
        }

        return String(data: data, encoding: .isoLatin1) ?? ""
    }

    /// Whether the file is larger than a preview reads.
    static func isTruncated(_ url: URL) -> Bool {
        let size =
            (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0

        return size > headByteLimit
    }
}
