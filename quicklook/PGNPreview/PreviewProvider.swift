import Foundation
import QuickLookUI

/// Quick Look preview for PGN files.
///
/// Finder, Spotlight and the Space-bar preview all route here, so a user
/// can read a game without opening Manifest Chess at all. The extension
/// runs in its own sandboxed process and is handed a read-only URL for
/// the one file being previewed; it has no access to anything else and
/// needs no entitlement beyond the sandbox itself.
///
/// Rendering is HTML rather than a drawn view: Quick Look accepts an
/// HTML data reply, and a board drawn with Unicode piece glyphs in a CSS
/// grid needs no image assets shipped alongside the extension.
class PreviewProvider: QLPreviewProvider, QLPreviewingController {

    func providePreview(for request: QLFilePreviewRequest) async throws
        -> QLPreviewReply
    {
        let reply = QLPreviewReply(
            dataOfContentType: .html,
            contentSize: CGSize(width: 800, height: 900)
        ) { _ in
            // Read only as much as a preview needs. A PGN database can be
            // gigabytes; previewing one must not read it all.
            let text = PGNDocument.readHead(of: request.fileURL)
            let games = PGNParser.parse(text, limit: 12)
            let total = PGNDocument.isTruncated(request.fileURL)

            return Data(
                PreviewRenderer.html(
                    games: games,
                    fileName: request.fileURL.lastPathComponent,
                    truncated: total
                ).utf8
            )
        }

        reply.title = request.fileURL.lastPathComponent

        return reply
    }
}
