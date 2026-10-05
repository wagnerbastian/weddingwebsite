'use client';

import { useState, useEffect, useCallback } from 'react';
import { AutosaveHeader, useAutosave } from '@/components/admin/useAutosave';

export default function AdminAbout() {
    const [config, setConfig] = useState({
        ourStoryTitle: '',
        howWeMetTitle: '',
        ourStoryBody: '',
        venueDescription: '',
        venueAddress: '',
        ceremonyText: '',
        receptionText: '',
        aboutSubtitle: '',
    });
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/admin/site-config')
            .then(res => res.json())
            // Only this page's keys — see Settings for why the whole config is
            // never spread into state and posted back.
            .then(data => {
                setConfig(prev => {
                    const next = { ...prev };
                    for (const key of Object.keys(prev) as (keyof typeof prev)[]) {
                        if (typeof data[key] === 'string') next[key] = data[key];
                    }
                    return next;
                });
                setLoaded(true);
            });
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
        <div className="max-w-4xl">
            <AutosaveHeader
                title="Inhalte „Über uns“"
                subtitle="Passt eure Geschichte und die Infos zur Location an. Änderungen werden automatisch gespeichert."
                state={state}
                onRetry={retry}
            />

            <div className="space-y-8 bg-white p-8 rounded-2xl border border-gray-200 shadow-lg">

                {/* Story Section */}
                <div className="space-y-6 bg-gradient-to-br from-accent/5 to-accent-light/10 rounded-xl p-6 border border-accent/10">
                    <h2 className="text-xl font-semibold text-gray-900">Unsere Geschichte</h2>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Seitenüberschrift</label>
                        <input
                            type="text"
                            value={config.ourStoryTitle || ''}
                            onChange={(e) => setConfig({ ...config, ourStoryTitle: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="z. B. Eine zufällige Begegnung …"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Titel des Abschnitts „Wie wir uns kennengelernt haben“</label>
                        <input
                            type="text"
                            value={config.howWeMetTitle || ''}
                            onChange={(e) => setConfig({ ...config, howWeMetTitle: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="z. B. Wie wir uns kennengelernt haben, Unser Anfang …"
                        />
                        <p className="text-xs text-gray-500 mt-1">Diese Überschrift steht über eurer Geschichte. Leer lassen für „Wie wir uns kennengelernt haben“.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Wie wir uns kennengelernt haben</label>
                        <p className="text-xs text-gray-500 mb-2">Erzählt hier eure Geschichte. Mehrere Zeilen sind möglich.</p>
                        <textarea
                            rows={8}
                            value={config.ourStoryBody || ''}
                            onChange={(e) => setConfig({ ...config, ourStoryBody: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="Erzählt eure Geschichte …"
                        />
                    </div>
                </div>

                {/* Venue Section */}
                <div className="space-y-6 bg-gradient-to-br from-accent/5 to-accent-light/10 rounded-xl p-6 border border-accent/10">
                    <h2 className="text-xl font-semibold text-gray-900">Infos zur Location</h2>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Beschreibung der Location</label>
                        <textarea
                            rows={3}
                            value={config.venueDescription || ''}
                            onChange={(e) => setConfig({ ...config, venueDescription: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="Kurze Beschreibung der Location …"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Adresse der Location (für Karten)</label>
                        <p className="text-xs text-gray-500 mb-2">Mit einer Adresse erscheint auf der Website ein Link „Route anzeigen“.</p>
                        <input
                            type="text"
                            value={config.venueAddress || ''}
                            onChange={(e) => setConfig({ ...config, venueAddress: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="z. B. Hochzeitsweg 12, 12345 Musterstadt"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Text im Feld „Die Trauung“</label>
                        <p className="text-xs text-gray-500 mb-2">Text im Feld „Die Trauung“ unter der Beschreibung der Location.</p>
                        <textarea
                            rows={3}
                            value={config.ceremonyText || ''}
                            onChange={(e) => setConfig({ ...config, ceremonyText: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="z. B. Die Trauung findet um 16:00 Uhr in der Location statt."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Text im Feld „Der Empfang“</label>
                        <p className="text-xs text-gray-500 mb-2">Text im Feld „Der Empfang“ unter der Beschreibung der Location.</p>
                        <textarea
                            rows={3}
                            value={config.receptionText || ''}
                            onChange={(e) => setConfig({ ...config, receptionText: e.target.value })}
                            className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                            placeholder="z. B. Danach gibt es Abendessen und Tanz."
                        />
                    </div>
                </div>

                {/* Nav Card Subtitle */}
                <div className="space-y-4 bg-gradient-to-br from-accent/5 to-accent-light/10 rounded-xl p-6 border border-accent/10">
                    <h2 className="text-xl font-semibold text-gray-900">Untertitel der Navigationskarte</h2>
                    <p className="text-sm text-gray-500">Kurzer Untertitel auf der Karte „Über uns“ unten auf der Startseite.</p>
                    <input
                        type="text"
                        value={config.aboutSubtitle || ''}
                        onChange={(e) => setConfig({ ...config, aboutSubtitle: e.target.value })}
                        className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-accent focus:ring-accent sm:text-sm p-2 border text-gray-900"
                        placeholder="z. B. Wo alles begann"
                    />
                </div>
            </div>
        </div>
    );
}
