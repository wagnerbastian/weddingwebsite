'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/honeymoon';
import type { HoneymoonApi } from './useHoneymoon';
import { Button, Card, TextArea } from './ui';

/**
 * The bookmarklet, and the box you paste its answer into.
 *
 * Booking.com serves a challenge page to a server-side fetch — which is why the
 * "get photos" button already fails on some listings — so a price watcher cannot
 * poll from here. The registry's Target import solved the same problem the same
 * way: the browser you are already browsing in does the reading.
 *
 * Run the bookmarklet on a listing (or on several tabs in turn) and it copies a
 * line per page. Paste them here and each is matched to a stay by its link, the
 * price is recorded against today, and the change since last time is shown.
 */
const BOOKMARKLET = `javascript:(function(){
var sel=['[data-testid="price-and-discounted-price"]','[data-testid="price"]','.prco-valign-middle-helper','._1p7iugi','[data-section-id="BOOK_IT_SIDEBAR"] span','[class*="price"]'];
var t='';for(var i=0;i<sel.length&&!t;i++){var e=document.querySelector(sel[i]);if(e&&e.textContent)t=e.textContent.trim();}
if(!t){t=prompt('Auf dieser Seite wurde kein Preis gefunden. Preis eingeben?','')||'';}
if(!t)return;
var line=location.href+'\\t'+t.replace(/\\s+/g,' ');
navigator.clipboard.writeText(line).then(function(){alert('Kopiert:\\n'+line+'\\n\\nFüge es im Flitterwochen-Portal ein.');},function(){prompt('Diese Zeile kopieren:',line);});
})();`.replace(/\n/g, '');

export default function PriceWatch({ api }: { api: HoneymoonApi }) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [showHow, setShowHow] = useState(false);

    const record = async () => {
        const entries = text.split('\n').map((line) => {
            const [url, price] = line.split('\t');
            return { url: (url ?? '').trim(), price: (price ?? '').trim() };
        }).filter((entry) => entry.url);
        if (!entries.length) return;

        setBusy(true);
        setResult(null);
        try {
            const res = await fetch('/api/admin/honeymoon/price-checks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setResult(body.error ?? 'Die Preise konnten nicht gespeichert werden.'); return; }
            await api.refresh();
            const moved = (body.recorded ?? []).filter(
                (row: { change: number | null }) => row.change != null && row.change !== 0,
            );
            setResult([
                `${body.recorded?.length ?? 0} erfasst.`,
                moved.length
                    ? moved.map((row: { name: string; change: number }) => (
                        `${row.name} ${row.change > 0 ? 'gestiegen um' : 'gesunken um'} ${Math.abs(row.change)}`
                    )).join(', ')
                    : 'Keine Änderungen seit dem letzten Mal.',
                body.unmatched?.length
                    ? `${body.unmatched.length} ${body.unmatched.length === 1 ? 'Link passt' : 'Links passen'} zu keiner Unterkunft.`
                    : '',
            ].filter(Boolean).join(' '));
            setText('');
        } finally {
            setBusy(false);
        }
    };

    const history = api.data?.price_checks ?? [];
    const latest = history.filter((_, index, all) => (
        all.findIndex((row) => row.place_id === all[index].place_id) === index
    ));

    return (
        <Card className="space-y-2 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Preise beobachten</h3>
                <button
                    onClick={() => setShowHow((v) => !v)}
                    className="text-[11px] text-gray-500 underline decoration-dotted"
                >
                    {showHow ? 'Ausblenden' : 'So funktioniert es'}
                </button>
            </div>

            {showHow && (
                <div className="space-y-2 rounded-2xl bg-gray-50 p-3">
                    <p className="text-xs text-gray-600">
                        Zieh das in deine Lesezeichenleiste (oder Rechtsklick → Link als Lesezeichen speichern):
                    </p>
                    {/* A javascript: href is the whole point — this is a
                        bookmarklet, not navigation. */}
                    <a
                        href={BOOKMARKLET}
                        onClick={(e) => e.preventDefault()}
                        className="inline-block cursor-grab rounded-full bg-gray-900 px-4 py-2
                            text-xs font-semibold text-white"
                    >
                        💰 Diesen Preis holen
                    </a>
                    <ol className="list-inside list-decimal space-y-0.5 text-xs text-gray-600">
                        <li>Öffne die Buchungsseite einer Unterkunft, mit eingestelltem Zeitraum und Personenzahl</li>
                        <li>Klick auf das Lesezeichen – es kopiert URL und Preis</li>
                        <li>Füge es unten ein (mehrere Zeilen auf einmal sind in Ordnung)</li>
                    </ol>
                    <p className="text-[11px] text-gray-400">
                        Eine Auswahlliste liegt wochenlang herum und die Preise ändern sich. So erfährst du es, ohne
                        sechs Tabs zu öffnen und dich zu erinnern, was dort beim letzten Mal stand.
                    </p>
                </div>
            )}

            <TextArea
                rows={2}
                value={text}
                placeholder="https://www.booking.com/hotel/…	US$420"
                onChange={(e) => setText(e.target.value)}
                className="font-mono text-[11px]"
            />
            <div className="flex items-center gap-2">
                <Button tone="primary" onClick={record} disabled={!text.trim() || busy}>
                    {busy ? 'Wird erfasst …' : 'Preise erfassen'}
                </Button>
                {result && <span className="text-[11px] text-gray-600">{result}</span>}
            </div>

            {latest.length > 0 && (
                <ul className="space-y-1 border-t border-gray-100 pt-2">
                    {latest.slice(0, 6).map((row) => {
                        const place = api.placeById.get(row.place_id);
                        const previous = history.find(
                            (other) => other.place_id === row.place_id && other !== row,
                        );
                        const change = row.amount != null && previous?.amount != null
                            ? row.amount - previous.amount
                            : null;
                        return (
                            <li
                                key={`${row.place_id}-${row.checked_at}`}
                                className="flex items-baseline gap-2 text-xs"
                            >
                                <span className="min-w-0 flex-1 truncate text-gray-700">
                                    {place?.name ?? 'Eine Unterkunft'}
                                </span>
                                <span className="shrink-0 tabular-nums text-gray-500">
                                    {row.price_note ?? row.amount ?? '—'}
                                </span>
                                {change != null && change !== 0 && (
                                    <span className={`shrink-0 tabular-nums ${change > 0
                                        ? 'text-rose-700' : 'text-emerald-700'}`}>
                                        {change > 0 ? '↑' : '↓'} {Math.abs(Math.round(change))}
                                    </span>
                                )}
                                <span className="shrink-0 text-[10px] text-gray-400">
                                    {row.checked_at ? formatDate(row.checked_at.slice(0, 10)) : ''}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
    );
}
