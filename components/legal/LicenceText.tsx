/**
 * The bundled licence documents, readable offline. Each loads from the
 * app's own origin (pgnreader://app/licenses/...), which the custom scheme
 * serves with the fetch API enabled, so the packaged sandboxed build
 * behaves like development and no network is ever touched.
 */

import { useState } from "react";

import { LEGAL_DOCUMENTS, type LegalDocument } from "../../lib/legal/constants";

export function LicenceText(): React.ReactElement {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {LEGAL_DOCUMENTS.map((doc) => (
        <LegalDisclosure key={doc.path} doc={doc} />
      ))}
    </div>
  );
}

function LegalDisclosure({ doc }: { doc: LegalDocument }): React.ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = async (): Promise<void> => {
    if (text !== null) return;
    try {
      const res = await fetch(doc.path);
      const body = await res.text();

      // Belt and braces beyond res.ok: the body must actually open like
      // the licence, so a fallback page can never render as one.
      if (!res.ok || !body.startsWith(doc.firstLine)) {
        setFailed(true);

        return;
      }

      setText(body);
    } catch {
      setFailed(true);
    }
  };

  return (
    <details data-testid={`legal-doc-${doc.path}`} onToggle={() => void load()}>
      <summary className="cursor-pointer text-[13px] text-primary-ink">
        {doc.label}
      </summary>
      {failed ? (
        <p className="mt-2 text-[12px] text-danger">
          This document could not be loaded. A copy is in the source
          repository.
        </p>
      ) : (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-low/40 p-3 text-[11px] leading-relaxed text-txt-dim">
          {text ?? "Loading..."}
        </pre>
      )}
    </details>
  );
}
