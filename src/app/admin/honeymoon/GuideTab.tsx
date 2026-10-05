'use client';

import { useMemo, useState } from 'react';
import { sourceLabel } from '@/lib/honeymoon';
import Markdown from './Markdown';
import type { HoneymoonApi } from './useHoneymoon';
import { TabToolbar } from './kit/TabToolbar';
import {
    Button, Card, EmptyState, InlineText, MiniSelect, OverflowMenu, TextField,
} from './ui';

/**
 * The notes worth having, as blanks to fill in.
 *
 * Every trip needs the same handful and nobody enjoys typing the headings; the
 * language card in particular is the one that gets skipped and then wanted on
 * day one. Markdown, because the Guide renders it now.
 */
const NOTE_TEMPLATES: { title: string; category: string; body: string }[] = [
    {
        title: 'Sprachkarte',
        category: 'Praktisches',
        body: [
            '## Zwanzig Redewendungen',
            '',
            '| Deutsch | Vor Ort |',
            '| --- | --- |',
            '| Hallo | |',
            '| Danke | |',
            '| Bitte | |',
            '| Ja / Nein | |',
            '| Wie viel kostet das? | |',
            '| Zu teuer | |',
            '| Wo ist …? | |',
            '| Die Rechnung, bitte | |',
            '| Ohne Eis | |',
            '| Nicht scharf | |',
            '| Ich bin Vegetarier | |',
            '| Hilfe | |',
            '| Krankenhaus | |',
            '| Polizei | |',
            '| Ich verstehe nicht | |',
            '| Sprechen Sie Englisch? | |',
            '| Guten Morgen | |',
            '| Auf Wiedersehen | |',
            '| Entschuldigung | |',
            '| Lecker | |',
            '',
            '## Trinkgeld',
            '',
            '- Restaurants:',
            '- Fahrer:',
            '- Hotelpersonal:',
            '',
            '## Fortbewegung',
            '',
            '- Taxi-Apps, die hier funktionieren:',
            '- Ungefähre Preise:',
            '- Was man meiden sollte:',
            '',
            '## SIM und Daten',
            '',
            '- Welcher Anbieter:',
            '- Wo man sie kauft:',
            '- Ungefähre Kosten:',
        ].join('\n'),
    },
    {
        title: 'Geld',
        category: 'Praktisches',
        body: [
            '- Karten, die hier funktionieren:',
            '- Bargeld, das man dabeihaben sollte:',
            '- Hinweise zu Geldautomaten (Gebühren, welche Banken):',
            '- Wo nur Karte, wo nur Bargeld geht:',
        ].join('\n'),
    },
    {
        title: 'Gesundheit und Wasser',
        category: 'Praktisches',
        body: [
            '- Leitungswasser:',
            '- Eis:',
            '- Apotheke in der Nähe jeder Unterkunft:',
            '- Nächstes Krankenhaus / nächste Klinik:',
            '- Eingenommene Impfungen und Tabletten:',
        ].join('\n'),
    },
    {
        title: 'Fortbewegung',
        category: 'Praktisches',
        body: [
            '- Kontakte für Fahrer / Transfers:',
            '- Roller: ja oder nein, und warum:',
            '- Fahrzeiten, die wir auf die harte Tour gelernt haben:',
        ].join('\n'),
    },
    {
        title: 'Etikette',
        category: 'Praktisches',
        body: [
            '- Kleidung in Tempeln und an religiösen Orten:',
            '- Wo man die Schuhe auszieht:',
            '- Fotografieren – wo nicht:',
            '- Lokale Bräuche, die man kennen sollte:',
        ].join('\n'),
    },
];

/**
 * Know Before You Go, plus the per-region write-ups.
 *
 * This is the half of the travel guide that has no coordinates — the water
 * warning, the exchange rate, the scooter safety brief — so it lives as cards
 * rather than pins, grouped by the category each note carries.
 */
export default function GuideTab({ api }: { api: HoneymoonApi }) {
    const { data } = api;
    const [newTitle, setNewTitle] = useState('');
    const [openRegion, setOpenRegion] = useState<number | null>(null);

    // Stable identity so the grouping memo below doesn't rerun every render.
    const notes = useMemo(() => data?.notes ?? [], [data]);
    const regions = data?.regions ?? [];

    /** Grouped by category, with uncategorised last. */
    const grouped = useMemo(() => {
        const map = new Map<string, typeof notes>();
        for (const note of notes) {
            const key = note.category?.trim() || 'Allgemein';
            const list = map.get(key);
            if (list) list.push(note); else map.set(key, [note]);
        }
        return [...map.entries()].sort(([a], [b]) => {
            if (a === 'Allgemein' || a === 'General') return 1;
            if (b === 'Allgemein' || b === 'General') return -1;
            return a.localeCompare(b);
        });
    }, [notes]);

    /** Fill a template in, unless a note by that name already exists. */
    const addTemplate = async (template: { title: string; category: string; body: string }) => {
        const exists = notes.some(
            (note) => note.title.trim().toLowerCase() === template.title.toLowerCase(),
        );
        if (exists) {
            alert(`Es gibt bereits eine Notiz namens „${template.title}“.`);
            return;
        }
        await api.create('notes', {
            title: template.title,
            category: template.category,
            body: template.body,
            source: 'Template',
        });
    };

    const addNote = async () => {
        const title = newTitle.trim();
        if (!title) return;
        await api.create('notes', { title, body: '', category: 'Allgemein' });
        setNewTitle('');
    };

    const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    return (
        <div className="space-y-4">
            <TabToolbar
                left={(
                    <>
                        <Button onClick={() => jump('guide-regions')}>Regionen</Button>
                        <Button onClick={() => jump('guide-notes')}>Gut zu wissen</Button>
                    </>
                )}
            />
            {/* ---- Regions ---- */}
            <section id="guide-regions" className="scroll-mt-16">
                <h2 className="text-sm font-semibold text-gray-900 mb-2 px-1">Regionen</h2>
                {regions.length === 0 ? (
                    <Card>
                        <EmptyState
                            title="Noch keine Regionen"
                            hint="Regionen gruppieren eure Orte und enthalten die Gebietsbeschreibungen des Reiseführers."
                        />
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2 items-start">
                        {regions.map((region) => {
                            const count = (data?.places ?? []).filter((p) => p.region_id === region.id).length;
                            const open = openRegion === region.id;
                            return (
                                <Card key={region.id} className="p-3">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setOpenRegion(open ? null : region.id)}
                                            className="flex-1 min-w-0 min-h-11 md:min-h-0 text-left"
                                        >
                                            <span className="text-sm font-medium text-gray-900">
                                                {region.name}
                                            </span>
                                            <span className="text-xs text-gray-400 ml-2">
                                                {region.country || (
                                                    <span className="text-sky-700">kein Land</span>
                                                )} · {count} {count === 1 ? 'Ort' : 'Orte'}
                                            </span>
                                        </button>
                                        <span className="text-gray-300 text-xs">{open ? '▲' : '▼'}</span>
                                        <OverflowMenu items={[{
                                            label: 'Region löschen',
                                            danger: true,
                                            onClick: () => {
                                                if (confirm(
                                                    `${region.name} löschen? Die ${count} Ort(e) bleiben erhalten, verlieren aber ihre Region.`,
                                                )) api.remove('regions', region.id);
                                            },
                                        }]} />
                                    </div>
                                    {open && (
                                        <div className="mt-2 pt-2 border-t border-gray-100">
                                            {/* Country is not cosmetic: it drives the map's
                                                country filter, and a region without one used
                                                to make its places disappear. */}
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[11px] uppercase tracking-wide
                                                    text-gray-400 font-semibold shrink-0">
                                                    Land
                                                </span>
                                                <InlineText
                                                    value={region.country ?? ''}
                                                    placeholder="Indonesia"
                                                    className="text-xs -ml-1 max-w-[14rem]"
                                                    onCommit={(country) => api.update('regions', {
                                                        id: region.id, country,
                                                    })}
                                                />
                                                {!region.country && (
                                                    <span className="text-[11px] text-sky-700 shrink-0">
                                                        nicht gesetzt – aus den Länderfiltern ausgeblendet
                                                    </span>
                                                )}
                                            </div>
                                            <InlineText
                                                multiline
                                                value={region.description ?? ''}
                                                placeholder="Wie ist diese Gegend?"
                                                className="text-sm text-gray-600 -ml-2"
                                                onCommit={(description) => api.update('regions', {
                                                    id: region.id, description,
                                                })}
                                            />
                                        </div>
                                    )}
                                </Card>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ---- Notes ---- */}
            <section id="guide-notes" className="scroll-mt-16">
                <div className="flex items-center justify-between gap-2 mb-2 px-1">
                    <h2 className="text-sm font-semibold text-gray-900">Gut zu wissen</h2>
                </div>

                <Card className="p-3 mb-2">
                    <div className="flex gap-2">
                        <TextField
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                            placeholder="Notiz hinzufügen – Visum bei Ankunft, SIM-Karten …"
                        />
                        <Button tone="primary" onClick={addNote} disabled={!newTitle.trim()}>Hinzufügen</Button>
                    </div>
                    {/* Templates, because the useful notes are the same five
                        every trip and nobody wants to type the headings. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-gray-400">Mit einer Vorlage starten:</span>
                        {NOTE_TEMPLATES.map((template) => (
                            <button
                                key={template.title}
                                onClick={() => addTemplate(template)}
                                className="min-h-11 md:min-h-0 rounded-full border border-gray-200 px-2.5 py-1
                                    text-[11px] text-gray-600 hover:bg-gray-50"
                            >
                                {template.title}
                            </button>
                        ))}
                    </div>
                </Card>

                {notes.length === 0 ? (
                    <Card>
                        <EmptyState
                            title="Noch keine Notizen"
                            hint="Führe npm run seed:honeymoon aus, um die praktischen Abschnitte des Bali-Reiseführers zu laden."
                        />
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {grouped.map(([category, items]) => (
                            <div key={category}>
                                <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5 px-1">
                                    {category}
                                </h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3
                                    gap-2 items-start">
                                    {items.map((note) => (
                                        <Card key={note.id} className="p-3">
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <InlineText
                                                        value={note.title}
                                                        className="font-medium text-gray-900 -ml-2"
                                                        onCommit={(title) => api.update('notes', {
                                                            id: note.id, title,
                                                        })}
                                                    />
                                                    <InlineText
                                                        multiline
                                                        value={note.body}
                                                        placeholder="Details … **fett**, *kursiv*, - Listen, [Links](https://…)"
                                                        className="text-sm text-gray-600 -ml-2 mt-0.5"
                                                        onCommit={(body) => api.update('notes', {
                                                            id: note.id, body,
                                                        })}
                                                    />
                                                    {/* Rendered underneath rather
                                                        than instead: the editor is
                                                        the plain text, and seeing
                                                        both is how you learn what
                                                        the markup does. */}
                                                    {/[*`\[#>-]/.test(note.body) && (
                                                        <details className="mt-1">
                                                            <summary className="cursor-pointer
                                                                text-[11px] text-gray-400">
                                                                Formatiert
                                                            </summary>
                                                            <Markdown
                                                                source={note.body}
                                                                className="mt-1 text-sm text-gray-700"
                                                            />
                                                        </details>
                                                    )}
                                                </div>
                                                <OverflowMenu items={[{
                                                    label: 'Notiz löschen',
                                                    danger: true,
                                                    // Undoable, so no confirm — see the toast.
                                                    onClick: () => api.removeRow(
                                                        'notes', note, `„${note.title}“ gelöscht`,
                                                    ),
                                                }]} />
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                                <InlineText
                                                    value={note.category ?? ''}
                                                    placeholder="Kategorie"
                                                    className="text-[11px] text-gray-400 -ml-2"
                                                    onCommit={(cat) => api.update('notes', {
                                                        id: note.id, category: cat,
                                                    })}
                                                />
                                                {/* What the note is about. A note
                                                    tied to a region shows up on the
                                                    itinerary whenever that region is
                                                    where you are sleeping — which is
                                                    the moment you want to read it. */}
                                                <MiniSelect
                                                    value={note.region_id != null
                                                        ? String(note.region_id) : ''}
                                                    onChange={(e) => api.update('notes', {
                                                        id: note.id,
                                                        region_id: e.target.value || null,
                                                    })}
                                                    aria-label="Zu welcher Region"
                                                >
                                                    <option value="">Ganze Reise</option>
                                                    {regions.map((region) => (
                                                        <option key={region.id} value={region.id}>
                                                            Über {region.name}
                                                        </option>
                                                    ))}
                                                </MiniSelect>
                                                <span className="text-[11px] text-gray-300 shrink-0 pr-1">
                                                    {sourceLabel(note.source)}
                                                </span>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
