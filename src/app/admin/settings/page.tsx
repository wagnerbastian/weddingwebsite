'use client';

import { useState, useEffect, useCallback } from 'react';
import { AutosaveHeader, useAutosave } from '@/components/admin/useAutosave';
import { DEFAULT_ROOM_BLOCK_MESSAGE } from '@/lib/roomBlock';

export default function AdminSettings() {
    const [config, setConfig] = useState({
        brideName: '',
        groomName: '',
        weddingDate: '',
        weddingTime: '',
        weddingLocation: '',
        weddingVenue: '',
        rsvpDeadline: '',
        contactEmail: '',
        roomBlockHotel: '',
        roomBlockUrl: '',
        roomBlockMessage: '',
        countdownMode: 'full',
        logoMode: false,
    });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/admin/site-config')
            .then(res => res.json())
            // Only this page's own fields. Spreading the whole config into
            // state and posting it back overwrote every other editor's keys
            // with whatever this tab had loaded — the Colour page's save could
            // be undone by pressing Save here a minute later.
            .then(data => setConfig(prev => {
                const next = { ...prev };
                for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
                    if (data[key] !== undefined) (next as Record<string, unknown>)[key] = data[key];
                }
                // Pre-fill the room-block message with the default wording so
                // it's visible and overwritable when nothing has been saved yet.
                next.roomBlockMessage = data.roomBlockMessage || DEFAULT_ROOM_BLOCK_MESSAGE;
                return next;
            }))
            .then(() => setLoaded(true));
    }, []);

    const save = useCallback(async (body: typeof config) => {
        const res = await fetch('/api/admin/site-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
    }, []);

    const { state, retry } = useAutosave({ value: config, ready: loaded, save });

    return (
        <div className="max-w-2xl">
            <AutosaveHeader
                title="Allgemeine Einstellungen"
                subtitle="Legt die Angaben zu eurer Hochzeitswebsite und ihr Erscheinungsbild fest. Änderungen werden automatisch gespeichert."
                state={state}
                onRetry={retry}
            />

            <div className="space-y-6 bg-white p-8 rounded-2xl border border-gray-200 shadow-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name der Braut</label>
                        <input
                            type="text"
                            value={config.brideName}
                            onChange={(e) => setConfig({ ...config, brideName: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Name des Bräutigams</label>
                        <input
                            type="text"
                            value={config.groomName}
                            onChange={(e) => setConfig({ ...config, groomName: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Hochzeitsdatum</label>
                    <input
                        type="text"
                        value={config.weddingDate}
                        onChange={(e) => setConfig({ ...config, weddingDate: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. 15. Juni 2027"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Uhrzeit der Hochzeit</label>
                    <input
                        type="text"
                        value={config.weddingTime}
                        onChange={(e) => setConfig({ ...config, weddingTime: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. 16:00 Uhr"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Anzeige des Countdowns</label>
                    <select
                        value={config.countdownMode || 'full'}
                        onChange={(e) => setConfig({ ...config, countdownMode: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                    >
                        <option value="full">Vollständig (Tage, Stunden, Minuten, Sekunden)</option>
                        <option value="simple">Einfach (nur Tage und Stunden)</option>
                        <option value="days-only">Nur Tage (große Anzeige)</option>
                    </select>
                    <p className="mt-1 text-sm text-gray-500">
                        Wähle den Stil des Countdowns – „Nur Tage“ zeigt eine größere, auffälligere Anzeige
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Name der Location</label>
                    <input
                        type="text"
                        value={config.weddingVenue || ''}
                        onChange={(e) => setConfig({ ...config, weddingVenue: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                        placeholder="z. B. Hotel Seeblick"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">Ort (Stadt, Bundesland)</label>
                    <input
                        type="text"
                        value={config.weddingLocation}
                        onChange={(e) => setConfig({ ...config, weddingLocation: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border"
                    />
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <div className="bg-gradient-to-br from-accent/10 to-accent-light/20 rounded-xl p-6 mb-6 border border-accent/20">
                        <h2 className="text-xl font-semibold text-gray-900 mb-4">Darstellung der Navigation</h2>
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-gray-900">Logo-Modus</h3>
                                <p className="text-sm text-gray-600 mt-1">
                                    Hochzeitslogo statt der Namen in der Navigationsleiste anzeigen
                                </p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.logoMode || false}
                                    onChange={(e) => setConfig({ ...config, logoMode: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-accent"></div>
                            </label>
                        </div>
                        <div className="mt-4 p-4 bg-white/50 rounded-lg border border-accent/30">
                            <p className="text-sm text-gray-700">
                                <strong>Namen-Modus (Standard):</strong> Zeigt die Namen von Braut und Bräutigam in der Navigationsleiste
                            </p>
                            <p className="text-sm text-gray-700 mt-2">
                                <strong>Logo-Modus:</strong> Zeigt euer Hochzeitslogo. Das Logo legst du unter Admin → Fotos → „Hochzeitslogo festlegen“ fest
                            </p>
                        </div>
                    </div>
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Rückmeldungen</h2>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700">Kontakt-E-Mail</label>
                        <input
                            type="email"
                            value={config.contactEmail || ''}
                            onChange={(e) => setConfig({ ...config, contactEmail: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="ihr@beispiel.de"
                        />
                        <p className="mt-1 text-xs text-gray-500">Wird auf der Rückmeldeseite für Gäste mit Problemen angezeigt.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Rückmeldefrist</label>
                        <input
                            type="date"
                            value={config.rsvpDeadline || ''}
                            onChange={(e) => setConfig({ ...config, rsvpDeadline: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-500">Die öffentliche Rückmeldeseite zeigt dieses Datum und zählt die verbleibenden Tage herunter.</p>
                    </div>
                </div>

                <div className="pt-6 border-t border-gray-100">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Unterkunft / Zimmerkontingent</h2>
                    <p className="text-sm text-gray-500 mb-4">
                        Wird Gästen nach der Rückmeldung angezeigt. Lass den Hotelnamen leer, um die Karte zum Zimmerkontingent ganz auszublenden.
                    </p>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Hotel / Name des Zimmerkontingents</label>
                            <input
                                type="text"
                                value={config.roomBlockHotel || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockHotel: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="z. B. Hotel Hafenblick"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Buchungs-URL</label>
                            <input
                                type="url"
                                value={config.roomBlockUrl || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockUrl: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="https://www.choicehotels.com/reservations/groups/tk74b5"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Text zum Zimmerkontingent</label>
                            <textarea
                                rows={5}
                                value={config.roomBlockMessage || ''}
                                onChange={(e) => setConfig({ ...config, roomBlockMessage: e.target.value })}
                                className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                                placeholder="Leer lassen, um den Standardtext zu verwenden."
                            />
                            <div className="mt-2 text-xs text-gray-500 space-y-1">
                                <p>Wird auf der Bestätigungskarte nach der Rückmeldung angezeigt. Leer lassen, um den Standardtext zu verwenden. Diese Platzhalter sind möglich:</p>
                                <ul className="list-disc list-inside space-y-0.5">
                                    <li><code className="text-accent font-mono">{'{names}'}</code> – die Namen des Paares (z. B. Anna &amp; Max)</li>
                                    <li><code className="text-accent font-mono">{'{hotel}'}</code> – der Hotel- bzw. Kontingentname von oben</li>
                                    <li><code className="text-accent font-mono">{'{book}'}</code> – ein anklickbarer Link „Zimmer buchen“. Die Adresse stammt aus der Buchungs-URL oben, sodass das Bearbeiten des Textes den Link nie kaputt machen kann.</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}
