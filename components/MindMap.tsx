'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Interactive mind map rendered with Markmap.
 *
 * `markmap-lib/no-plugins` is used deliberately: the default build injects
 * third-party plugin scripts from a CDN, which our Content-Security-Policy
 * blocks. The no-plugins transformer renders the outline entirely locally.
 */
export function MindMap({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const render = async () => {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import('markmap-lib/no-plugins'),
          import('markmap-view'),
        ]);
        if (cancelled || !svgRef.current) return;
        const transformer = new Transformer();
        const { root } = transformer.transform(markdown);
        const map = Markmap.create(svgRef.current, { autoFit: true, duration: 300 }, root);
        map.fit();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render the mind map');
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        Mind map could not be rendered: {error}
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{markdown}</pre>
      </div>
    );
  }

  return <svg ref={svgRef} className="h-[560px] w-full rounded-lg border border-ink-100 bg-white" role="img" aria-label="Meeting mind map" />;
}
