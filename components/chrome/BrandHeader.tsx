/**
 * The sidebar brand header: the mark at w-8 h-8 beside a two-fixed-line
 * wordmark — "Manifest Chess" over "Lite" and the version.
 */

import { useEffect, useState } from "react";

import { api } from "../../lib/renderer/api";

export function BrandHeader(): React.ReactElement {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .appInfo()
      .then((info) => {
        if (!cancelled) setVersion((info as { version: string }).version);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="drag-region pl-3 pr-3 pt-2 pb-3">
      <div className="no-drag flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div
          aria-label="Manifest Chess Lite"
          className="brand-icon h-8 w-8 shrink-0"
          role="img"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
          <span className="text-[15px] font-semibold leading-none tracking-tight text-txt-clear">
            Manifest Chess
          </span>
          <span className="text-[11px] font-medium leading-none tracking-tight text-txt-dimmer">
            Lite{version ? ` v${version}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
