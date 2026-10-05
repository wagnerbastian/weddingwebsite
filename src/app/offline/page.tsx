'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const LABELS: Record<string, string> = {
    '/': 'Start', '/about': 'Über uns', '/our-story': 'Unsere Geschichte', '/wedding-party': 'Trauzeugen & Team',
    '/schedule': 'Ablauf', '/photos': 'Fotos', '/rsvp': 'Rückmeldung', '/registry': 'Wunschliste',
    '/admin': 'Admin', '/admin/honeymoon': 'Flitterwochen', '/admin/honeymoon/today': 'Flitterwochen · Heute',
    '/admin/honeymoon/itinerary': 'Flitterwochen · Reiseplan', '/admin/honeymoon/files': 'Flitterwochen · Dokumente',
    '/admin/rsvps': 'Rückmeldungen', '/admin/finances': 'Finanzen', '/admin/seating': 'Sitzplan',
};

/** A readable name for any saved page: "/admin/wip-control" → "Admin · Wip control". */
function labelOf(path: string): string {
    if (LABELS[path]) return LABELS[path];
    const parts = path.split('/').filter(Boolean)
        .map((part) => part.replace(/-/g, ' '))
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
    return parts.join(' · ') || 'Start';
}

/**
 * What a page that was never saved falls back to, with no connection.
 *
 * Lists what *is* saved on this device, so there is always somewhere to go.
 */
export default function OfflinePage() {
    const [saved, setSaved] = useState<string[] | null>(null);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!('caches' in window)) { setSaved([]); return; }
        caches.open('site-pages-v1')
            .then((cache) => cache.keys())
            .then((keys) => setSaved(keys.map((key) => new URL(key.url).pathname)
                .filter((path) => path !== '/offline')
                .sort((a, b) => a.localeCompare(b))))
            .catch(() => setSaved([]));
    }, []);

    return (
        <div className="mx-auto max-w-xl px-6 py-16">
            <h1 className="text-3xl font-serif text-gray-900">Ihr seid offline</h1>
            <p className="mt-3 text-gray-600">
                Diese Seite ist auf diesem Gerät noch nicht gespeichert und lässt sich ohne Verbindung nicht öffnen.
                {saved && saved.length > 0 && ' Diese Seiten funktionieren:'}
            </p>
            {saved && saved.length > 0 && (
                <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {saved.map((path) => (
                        <li key={path}>
                            <Link
                                href={path}
                                className="flex min-h-11 items-center rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-800 hover:bg-gray-50"
                            >
                                {labelOf(path)}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            <p className="mt-8 text-sm text-gray-500">
                Öffnet die installierte App einmal mit Verbindung, dann speichert sie die ganze Website.
            </p>
        </div>
    );
}
