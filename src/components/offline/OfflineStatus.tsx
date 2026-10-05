'use client';

import { saveForOffline } from './offlineStore';
import { savedLabel, useOfflineState } from './OfflineManager';

/**
 * "Offline gespeichert · heute 14:02 Uhr" and the button that does it, in the admin
 * sidebar. The installed app saves on its own; this is for checking, and for
 * saving from an ordinary browser tab.
 */
export default function OfflineStatus() {
    const state = useOfflineState();
    const saving = state.phase === 'saving';
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    return (
        <div data-offline-status data-phase={state.phase} className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <div className="flex items-center justify-between gap-2">
                <span>
                    {saving
                        ? `Wird offline gespeichert … ${pct} %`
                        : state.phase === 'failed'
                            ? 'Offline-Speicherung abgebrochen – bitte erneut versuchen'
                            : state.record
                                ? `Offline gespeichert · ${savedLabel(state.record.at)}`
                                : 'Noch nicht offline gespeichert'}
                </span>
                <button
                    type="button"
                    disabled={saving}
                    onClick={() => { void saveForOffline(); }}
                    className="shrink-0 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700
                        hover:bg-gray-100 disabled:opacity-50"
                >
                    {saving ? 'Wird gespeichert …' : state.record ? 'Erneut speichern' : 'Jetzt speichern'}
                </button>
            </div>
            {saving && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
            )}
        </div>
    );
}
