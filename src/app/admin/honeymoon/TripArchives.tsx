'use client';

import { useState } from 'react';
import type { HoneymoonApi } from './useHoneymoon';
import { Button, TextField } from './ui';

/**
 * Snapshots of the whole trip.
 *
 * Two things this makes possible that the singleton could not: keeping the
 * honeymoon after you have flown home, and starting the next trip from a copy of
 * it. Restoring replaces what is live — so it snapshots the current state first,
 * under its own name, which makes even that undoable.
 */
export default function TripArchives({ api }: { api: HoneymoonApi }) {
    const archives = api.data?.archives ?? [];
    const [name, setName] = useState('');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');

    const snapshot = async () => {
        setBusy('save');
        setMessage('');
        try {
            const res = await fetch('/api/admin/honeymoon/archives', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            if (!res.ok) { setMessage('Schnappschuss konnte nicht gespeichert werden.'); return; }
            setName('');
            await api.refresh();
            setMessage('Gespeichert.');
        } finally {
            setBusy('');
        }
    };

    const restore = async (id: number, label: string) => {
        if (!confirm(
            `„${label}“ wiederherstellen? Alles, was gerade im Portal ist, wird ersetzt – `
            + 'der aktuelle Stand wird vorher als Schnappschuss gesichert, das lässt sich also rückgängig machen.',
        )) return;
        setBusy(`restore-${id}`);
        setMessage('');
        try {
            const res = await fetch('/api/admin/honeymoon/archives', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, confirm: true }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setMessage(body.error ?? 'Wiederherstellen fehlgeschlagen.'); return; }
            await api.refresh();
            setMessage(`„${body.restored}“ wiederhergestellt. Der vorherige Stand wurde als Schnappschuss gespeichert.`);
        } finally {
            setBusy('');
        }
    };

    const forget = async (id: number, label: string) => {
        if (!confirm(`Schnappschuss „${label}“ löschen? Das lässt sich nicht rückgängig machen.`)) return;
        await fetch(`/api/admin/honeymoon/archives?id=${id}`, { method: 'DELETE' });
        await api.refresh();
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                    <label className="mb-1 block text-xs font-semibold text-gray-500">
                        Name
                    </label>
                    <TextField
                        value={name}
                        placeholder="Bevor ich alles in Woche zwei verschoben habe"
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <Button tone="primary" onClick={snapshot} disabled={busy === 'save'}>
                    {busy === 'save' ? 'Wird gespeichert …' : 'Schnappschuss erstellen'}
                </Button>
            </div>

            {message && <p className="text-xs text-gray-600">{message}</p>}

            {archives.length === 0 ? (
                <p className="text-xs text-gray-400">
                    Noch keine Schnappschüsse. Sinnvoll vor einer großen Umplanung – und einer am Ende,
                    damit das Portal die Flitterwochen überdauert.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {archives.map((archive) => (
                        <li
                            key={archive.id}
                            className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50
                                px-2.5 py-1.5"
                        >
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                                {archive.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-gray-400 tabular-nums">
                                {archive.places} {archive.places === 1 ? 'Ort' : 'Orte'} · {archive.days} {archive.days === 1 ? 'Tag' : 'Tage'}
                                {archive.created_at
                                    ? ` · ${new Date(archive.created_at).toLocaleDateString('de-DE')}`
                                    : ''}
                            </span>
                            <Button
                                onClick={() => restore(archive.id, archive.name)}
                                disabled={busy === `restore-${archive.id}`}
                            >
                                {busy === `restore-${archive.id}` ? 'Wird wiederhergestellt …' : 'Wiederherstellen'}
                            </Button>
                            <Button tone="danger" onClick={() => forget(archive.id, archive.name)}>
                                Löschen
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
