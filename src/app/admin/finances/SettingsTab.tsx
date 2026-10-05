'use client';

import { useCallback, useState } from 'react';
import type { FinanceApi, FinancePayload } from './useFinances';
import { Card, EmptyState, GlyphButton, InlineNumber, InlineText, PillButton, formatDate, formatMoney } from './ui';

interface ArchivedRows {
    categories: { id: number; name: string }[];
    items: { id: number; name: string; category_name: string | null }[];
    purchases: { id: number; description: string; amount: number; purchased_on: string | null }[];
    contributors: { id: number; name: string; pledged: number }[];
}

export default function SettingsTab({ data, api }: { data: FinancePayload; api: FinanceApi }) {
    const { settings, payers, summary, headcount, weddingDate } = data;
    const [newPayer, setNewPayer] = useState('');

    const shareSum = payers.reduce((sum, p) => sum + p.share_pct, 0);

    const addPayer = async () => {
        const name = newPayer.trim();
        if (!name) return;
        await api.create('payers', { name, share_pct: 0, sort_order: payers.length });
        setNewPayer('');
    };

    return (
        /* Same two-column treatment as the Overview, and for the same reason:
         * these are forms, and a text input a thousand pixels wide is harder to
         * use than a short one, not easier. */
        <div className="space-y-5 xl:space-y-0 xl:columns-2 xl:gap-5
            [&>*]:xl:mb-5 [&>*]:xl:break-inside-avoid">
            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Personenzahl</h3>
                <p className="text-xs text-gray-400 mb-4">
                    Bestimmt jeden Posten, dessen Menge auf Erwachsene, Kinder, Trinkende oder Alle Gäste
                    steht – Dinner, Kindermenüs, Bar.
                </p>

                <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Erwachsene</label>
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-2">
                            <InlineNumber
                                value={settings.adult_count}
                                onCommit={(adult_count) => api.update('settings', { adult_count })}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Kinder</label>
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-2">
                            <InlineNumber
                                value={settings.minor_count}
                                onCommit={(minor_count) => api.update('settings', { minor_count })}
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-4 max-w-sm">
                    <label className="block text-xs font-semibold text-gray-500 mb-1">
                        Trinkende <span className="font-normal text-gray-400">(ab 21)</span>
                    </label>
                    <div className="bg-gray-50 border border-gray-200 rounded-2xl px-2">
                        <InlineNumber
                            value={settings.drinking_count}
                            onCommit={(drinking_count) => api.update('settings', { drinking_count })}
                        />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                        Ein Teil der Erwachsenen, keine zusätzlichen Gäste – auch unter 21 isst man das
                        Erwachsenen-Dinner. Nur Posten mit „Trinkende“ nutzen diese Zahl.
                    </p>
                    {/* Said here, beside the field, and not only on the Overview: a
                        number typed in with nothing reading it looks exactly like a
                        number that worked. */}
                    {summary.warnings.some((w) => w.kind === 'drinkers-unused') && (
                        <p className="mt-2 rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                            Noch kein Budgetposten wird pro trinkender Person berechnet, diese Zahl ändert also
                            nichts. Öffne <strong>Budget</strong>, suche den Posten für die Bar und stelle{' '}
                            <strong>Menge nach</strong> auf <strong>Trinkende (21+)</strong>.
                        </p>
                    )}
                </div>

                <div className="text-xs text-gray-500 mt-3">
                    Gesamt: <strong>{settings.adult_count + settings.minor_count} Gäste</strong>
                    {settings.drinking_count > 0 && (
                        <>, davon <strong>{settings.drinking_count}</strong> trinkend</>
                    )}
                </div>

                {headcount && (
                    <div className="mt-4 bg-gray-50 rounded-2xl p-4">
                        <div className="text-xs font-semibold text-gray-600 mb-1">Aus eurer Gästeliste</div>
                        <p className="text-xs text-gray-500 mb-3">
                            {headcount.invited.toLocaleString('de-DE')} eingeladen ·{' '}
                            {headcount.attending.toLocaleString('de-DE')} mit Zusage.
                            Das sind nur Richtwerte – euer Budget bleibt bei den oben eingetragenen Zahlen, damit
                            eine späte Rückmeldung die Summe nicht unbemerkt verschiebt. Die Gästeliste kennt
                            keine Unterscheidung zwischen Erwachsenen und Kindern, die Aufteilung macht ihr selbst.
                        </p>
                        {headcount.under21 > 0 && (
                            <p className="text-xs text-gray-500 mb-3">
                                {headcount.under21.toLocaleString('de-DE')} der{' '}
                                {headcount.expected.toLocaleString('de-DE')} erwarteten Personen sind als unter
                                21 markiert, an der Bar bleiben <strong>{headcount.drinking.toLocaleString('de-DE')}</strong>.
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <PillButton
                                onClick={() => api.update('settings', { adult_count: headcount.invited, minor_count: 0 })}
                            >
                                {headcount.invited} Eingeladene als Erwachsene übernehmen
                            </PillButton>
                            {headcount.attending > 0 && (
                                <PillButton
                                    onClick={() => api.update('settings', { adult_count: headcount.attending, minor_count: 0 })}
                                >
                                    {headcount.attending} Zusagen als Erwachsene übernehmen
                                </PillButton>
                            )}
                            {headcount.expected > 0 && (
                                <PillButton
                                    onClick={() => api.update('settings', { drinking_count: headcount.drinking })}
                                >
                                    {headcount.drinking} Trinkende übernehmen
                                </PillButton>
                            )}
                        </div>
                    </div>
                )}
            </Card>

            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Wer zahlt</h3>
                <p className="text-xs text-gray-400 mb-4">
                    Die Anteile teilen auf, was die Beiträge nicht decken. Wer etwas kauft, aber keinen
                    Anteil schuldet – etwa ein Elternteil, das die Deko übernimmt –, bekommt <strong>0 %</strong>;
                    die Ausgaben erscheinen trotzdem, nur als Guthaben.
                </p>

                <div className="space-y-2">
                    {payers.map((payer) => {
                        const stats = summary.payers.find((p) => p.id === payer.id);
                        return (
                            <div key={payer.id}
                                className="flex flex-wrap items-center gap-3 border border-gray-100 rounded-2xl px-3 py-2">
                                <div className="flex-1 min-w-[7rem]">
                                    <InlineText
                                        value={payer.name}
                                        onCommit={(name) => api.update('payers', { id: payer.id, name })}
                                        className="font-medium text-gray-800"
                                    />
                                </div>
                                <div className="w-20">
                                    <div className="bg-gray-50 border border-gray-200 rounded-xl px-1 flex items-center">
                                        <InlineNumber
                                            value={payer.share_pct}
                                            onCommit={(share_pct) => api.update('payers', { id: payer.id, share_pct })}
                                        />
                                        <span className="text-xs text-gray-400 pr-1">%</span>
                                    </div>
                                </div>
                                <div className="text-[11px] text-gray-400 w-32 text-right tabular-nums">
                                    bezahlt {formatMoney(stats?.spent ?? 0)}
                                </div>
                                <GlyphButton
                                    label={`${payer.name} entfernen`}
                                    className="text-lg leading-none hover:text-rose-500"
                                    onClick={() => {
                                        if (confirm(`${payer.name} entfernen? Die Ausgaben bleiben erhalten, sind danach aber nicht mehr zugeordnet.`)) {
                                            api.remove('payers', payer.id);
                                        }
                                    }}
                                >
                                    &times;
                                </GlyphButton>
                            </div>
                        );
                    })}
                    {!payers.length && <EmptyState>Noch keine Zahler.</EmptyState>}
                </div>

                {payers.length > 0 && shareSum !== 100 && (
                    <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
                        Die Anteile ergeben <strong>{shareSum} %</strong>, nicht 100 %. Das funktioniert trotzdem – jede Person
                        zahlt ihren Teil der {shareSum} % –, aber bei insgesamt 100 % sind die Zahlen
                        leichter zu lesen.
                    </p>
                )}

                <div className="flex gap-2 items-center mt-4">
                    <input
                        value={newPayer}
                        onChange={(e) => setNewPayer(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addPayer(); }}
                        placeholder="Person hinzufügen, die Ausgaben bezahlt"
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-base md:text-sm
                            focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <PillButton tone="accent" onClick={addPayer} disabled={!newPayer.trim()}>Zahler hinzufügen</PillButton>
                </div>
            </Card>

            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Ratenplanung</h3>
                <p className="text-xs text-gray-400 mb-4">
                    Auf welchen Zeitraum der Rest verteilt wird. Bleibt das Feld leer, zählt es automatisch
                    bis zu eurem Hochzeitsdatum.
                </p>

                <div className="grid sm:grid-cols-2 gap-4 max-w-lg">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">
                            Planungszeitraum (Monate)
                        </label>
                        <input
                            type="number"
                            min={1}
                            // Uncontrolled and committed on blur: typing "12" used to
                            // save 1 and then 12, each with a full refetch.
                            key={settings.plan_horizon_months ?? 'auto'}
                            defaultValue={settings.plan_horizon_months ?? ''}
                            placeholder={weddingDate ? 'Automatisch – bis zur Hochzeit' : 'Automatisch'}
                            onBlur={(e) => {
                                const next = e.target.value === '' ? null : e.target.value;
                                if (String(next ?? '') !== String(settings.plan_horizon_months ?? '')) {
                                    api.update('settings', { plan_horizon_months: next });
                                }
                            }}
                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2
                                text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">
                            {summary.horizon.derived
                                ? `Automatisch: noch ${summary.horizon.days.toLocaleString('de-DE')} Tage${weddingDate ? ` bis zum ${formatDate(weddingDate)}` : ''}.`
                                : `Fest auf ${settings.plan_horizon_months} Monate gesetzt.`}
                        </p>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">
                            Tage zwischen Gehaltszahlungen
                        </label>
                        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-2">
                            <InlineNumber
                                value={settings.paycheck_interval_days}
                                onCommit={(paycheck_interval_days) =>
                                    api.update('settings', { paycheck_interval_days })}
                            />
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">
                            14 für alle zwei Wochen, 7 für wöchentlich, 15 für zweimal im Monat.
                            Noch ca. {Math.floor(summary.horizon.paychecks)} Gehaltszahlungen.
                        </p>
                    </div>
                </div>
            </Card>

            <ArchiveCard data={data} api={api} />
        </div>
    );
}

/**
 * The way back from an archive.
 *
 * Archived rows are filtered out of the working set so they can't skew a total,
 * which means without this they'd be invisible and effectively lost.
 */
function ArchiveCard({ data, api }: { data: FinancePayload; api: FinanceApi }) {
    const total = data.archived.categories + data.archived.items
        + data.archived.purchases + data.archived.contributors;
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<ArchivedRows | null>(null);

    const load = useCallback(async () => {
        const res = await fetch('/api/admin/finances/archived', { cache: 'no-store' });
        if (res.ok) setRows(await res.json());
    }, []);

    const toggle = () => {
        // Fetched on demand rather than in an effect: archived rows are only
        // needed when someone actually asks to see them.
        if (!open) load();
        setOpen((v) => !v);
    };

    const restore = async (resource: 'categories' | 'items' | 'purchases' | 'contributors', id: number) => {
        await api.update(resource, { id, archived: false });
        load();
    };

    if (total === 0) {
        return (
            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Archiv</h3>
                <p className="text-xs text-gray-400">
                    Nichts archiviert. Wer einen Bereich, Posten oder eine Zahlung entfernt, archiviert
                    ihn nur – er zählt nicht mehr zu den Summen, ist hier aber wiederherstellbar.
                </p>
            </Card>
        );
    }

    return (
        <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="font-semibold text-gray-900">Archiv</h3>
                    <p className="mt-0.5 text-xs text-gray-400">
                        {total} {total === 1 ? 'archivierter Eintrag' : 'archivierte Einträge'} – in keiner Summe
                        enthalten, aber bei Bedarf noch da.
                    </p>
                </div>
                <PillButton onClick={toggle}>
                    {open ? 'Ausblenden' : 'Archiv anzeigen'}
                </PillButton>
            </div>

            {open && rows && (
                <div className="mt-4 space-y-4">
                    <ArchiveGroup title="Bereiche" items={rows.categories.map((c) => ({
                        id: c.id, label: c.name,
                    }))} onRestore={(id) => restore('categories', id)} />
                    <ArchiveGroup title="Posten" items={rows.items.map((i) => ({
                        id: i.id, label: i.category_name ? `${i.name} (${i.category_name})` : i.name,
                    }))} onRestore={(id) => restore('items', id)} />
                    <ArchiveGroup title="Zahlungen" items={rows.purchases.map((p) => ({
                        id: p.id, label: `${p.description} – ${formatMoney(p.amount)}`,
                    }))} onRestore={(id) => restore('purchases', id)} />
                    <ArchiveGroup title="Beitragende" items={rows.contributors.map((c) => ({
                        id: c.id, label: `${c.name} – ${formatMoney(c.pledged)} zugesagt`,
                    }))} onRestore={(id) => restore('contributors', id)} />
                </div>
            )}
        </Card>
    );
}

function ArchiveGroup({ title, items, onRestore }: {
    title: string;
    items: { id: number; label: string }[];
    onRestore: (id: number) => void;
}) {
    if (!items.length) return null;
    return (
        <div>
            <div className="mb-1 text-xs font-semibold text-gray-500">{title}</div>
            <div className="space-y-1">
                {items.map((item) => (
                    <div key={item.id}
                        className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-gray-600">{item.label}</span>
                        <button onClick={() => onRestore(item.id)}
                            className="shrink-0 text-xs font-medium text-accent hover:underline">
                            Wiederherstellen
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
