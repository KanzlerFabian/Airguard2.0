import type { EvalResponse } from '../types/eval';

interface AiSummaryProps {
  data: EvalResponse;
}

export function AiSummary({ data }: AiSummaryProps) {
  return (
    <section className="card ai-summary" aria-label="AI Bewertung">
      <header className="ai-summary__header">
        <div className="ai-summary__score" aria-live="polite">
          <span className="ai-summary__value" aria-label="Score">
            {Math.round(data.overall)}
          </span>
          <span className="ai-summary__status">{data.status}</span>
        </div>
        <h2>AI-Raumklima</h2>
      </header>
      <ul className="ai-summary__highlights">
        {data.highlights.length === 0 && <li>Alles im grünen Bereich.</li>}
        {data.highlights.slice(0, 2).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
