import { useEffect, useMemo, useState } from 'react';
import { AiSummary } from './components/AiSummary';
import { useAiEval } from './hooks/useAiEval';

const COMPACT_KEY = 'airguard.compactMode';

export default function App() {
  const { status, data, error, offline } = useAiEval();
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(COMPACT_KEY) === '1';
  });
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));

  useEffect(() => {
    document.documentElement.dataset.compact = compact ? 'on' : 'off';
    window.localStorage.setItem(COMPACT_KEY, compact ? '1' : '0');
  }, [compact]);

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const highlights = useMemo(() => (data ? data.highlights : []), [data]);

  return (
    <div className={`app ${compact ? 'app--compact' : ''}`}>
      <header className="app__header">
        <h1>AirGuard Dashboard</h1>
        <div className="app__header-actions">
          <label className="compact-toggle">
            <input
              type="checkbox"
              checked={compact}
              onChange={(event) => setCompact(event.target.checked)}
            />
            Kompaktansicht
          </label>
          {(offline || isOffline) && <span className="pill pill--offline">Offline</span>}
        </div>
      </header>

      {status === 'error' && (
        <div className="banner banner--error" role="alert">
          AI-Bewertung derzeit nicht verfügbar.
          {error && <span className="banner__details"> ({error.message})</span>}
        </div>
      )}

      <main className="dashboard" aria-live="polite">
        {data && (
          <div className="dashboard__overview">
            <AiSummary data={data} />
            <section className="card kpi-placeholder" aria-label="KPI Übersicht">
              <h2>Aktuelle Werte</h2>
              <p>
                Die wichtigsten Kennzahlen erscheinen hier, sobald die Integration der Messkarten
                abgeschlossen ist.
              </p>
            </section>
          </div>
        )}
        {!data && status === 'loading' && (
          <div className="card" aria-busy="true">
            <p>Daten werden geladen…</p>
          </div>
        )}
        <section className="card" aria-label="Trendhinweise">
          <h2>Empfehlungen</h2>
          <ul>
            {highlights.length === 0 && <li>Keine Maßnahmen erforderlich.</li>}
            {highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
