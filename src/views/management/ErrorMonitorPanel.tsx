import React, { useEffect, useState } from 'react';
import { fetchRecentErrors, ErrorEvent } from '../../services/errorMonitorService';
import { AlertTriangle, Info, Clock } from 'lucide-react';

const levelColor = {
  error: 'text-red-600',
  warning: 'text-yellow-600',
  info: 'text-blue-600'
};

export const ErrorMonitorPanel: React.FC = () => {
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchRecentErrors().then(events => {
      setErrors(events);
      setLoading(false);
    });
  }, []);

  const visibleErrors = showAll ? errors : errors.slice(0, 5);
  const canToggle = errors.length > 5;

  return (
    <div className="bg-ninpo-card border border-white/10 rounded-2xl p-6 mt-8">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5 text-red-500" />
        <h3 className="text-lg font-black uppercase tracking-widest text-white">Error Monitor</h3>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-slate-400"><Clock className="w-4 h-4 animate-spin" /> Loading errors...</div>
      ) : errors.length === 0 ? (
        <div className="text-green-600 font-bold">No recent errors detected.</div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {visibleErrors.map(evt => (
              <li key={evt.id} className="flex items-start gap-3">
                <span className={levelColor[evt.level] + ' mt-1'}>
                  {evt.level === 'error' ? <AlertTriangle className="w-4 h-4" /> : evt.level === 'warning' ? <Info className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                </span>
                <div>
                  <div className="font-bold text-white text-sm">{evt.message}</div>
                  <div className="text-xs text-slate-400">{new Date(evt.timestamp).toLocaleString()}</div>
                  {evt.url && <a href={evt.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 underline">View Details</a>}
                </div>
              </li>
            ))}
          </ul>
          {canToggle && (
            <button
              type="button"
              onClick={() => setShowAll(prev => !prev)}
              className="text-xs font-bold uppercase tracking-widest text-ninpo-lime hover:text-white transition"
            >
              {showAll ? 'Show Less' : 'Show More'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
