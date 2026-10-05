'use client';

import { useMemo, useState } from 'react';
import {
    categoryMeta, cleanListingTitle, nameFromAnyUrl, stayUrlsFromText,
    type Place,
} from '@/lib/honeymoon';
import type { HoneymoonApi } from './useHoneymoon';
import LinkPreview from './LinkPreview';
import RateQueue from './RateQueue';
import { usePlaceSheet } from './PlaceSheetContext';
import {
    BulkFieldMenu, Button, Card, EmptyState, OverflowMenu, SelectField, TextArea,
} from './ui';
import { FilterButton, FilterField } from './kit/FilterButton';
import { PlaceCard } from './kit/PlaceCard';
import { Segmented } from './kit/Segmented';
import { Sheet } from './kit/Sheet';
import { TabToolbar } from './kit/TabToolbar';

/**
 * Things to do — tours, classes, dives, day trips.
 *
 * Excursions are ordinary places carrying `is_excursion`, so one can also be
 * pinned on the map and dropped onto a day like anything else. The flag is
 * separate from the category on purpose: *what* an excursion is varies wildly
 * (a cooking class, a boat trip, a temple tour) and that is exactly the field
 * you want free, so tying the tab to a single category would lose anything you
 * re-typed.
 *
 * Any link works, not just booking sites. `/api/admin/fetch-meta` tries a normal
 * browser agent then a link-preview crawler, which is what gets a title and a
 * photo out of sites that stonewall an ordinary request.
 */
export default function ExcursionsTab({ api, segmentSwitch }: {
    api: HoneymoonApi;
    segmentSwitch?: React.ReactNode;
}) {
    const { data } = api;
    const [bulk, setBulk] = useState('');
    const [adding, setAdding] = useState(false);
    const [rated, setRated] = useState<
        'all' | 'yes' | 'mid' | 'no' | 'unrated' | 'removed'
    >('all');
    const [typeFilter, setTypeFilter] = useState('');
    const [preview, setPreview] = useState<Place | null>(null);
    const { openPlace } = usePlaceSheet();
    const [pasting, setPasting] = useState(false);
    const [fetching, setFetching] = useState(0);
    const [triaging, setTriaging] = useState(false);
    /** Multi-select, matching the Places and Stays tabs. */
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const places = useMemo(() => data?.places ?? [], [data]);
    // Removed places stay out of the shortlist, as on the Stays tab.
    const excursions = useMemo(() => places.filter((p) => p.is_excursion && !p.archived), [places]);
    /*
     * Removed excursions, kept.
     *
     * "Remove" used to flip `is_excursion` off, which does not delete the place
     * but does make it vanish from the only tab that lists excursions — so a
     * dive you ruled out was findable solely by remembering its name. Archiving
     * matches Stays exactly: a Removed bucket you can restore from or empty for
     * good, and the same word meaning the same thing on both tabs.
     */
    const removed = useMemo(() => places.filter((p) => p.is_excursion && p.archived), [places]);

    const shown = useMemo(() => {
        const source = rated === 'removed' ? removed : excursions;
        return source.filter((e) => {
            if (typeFilter && e.category !== typeFilter) return false;
            if (rated === 'all' || rated === 'removed') return true;
            if (rated === 'unrated') return e.rating == null;
            return e.rating === rated;
        });
    }, [excursions, removed, rated, typeFilter]);

    const counts = useMemo(() => ({
        all: excursions.length,
        yes: excursions.filter((e) => e.rating === 'yes').length,
        mid: excursions.filter((e) => e.rating === 'mid').length,
        no: excursions.filter((e) => e.rating === 'no').length,
        unrated: excursions.filter((e) => e.rating == null).length,
        removed: removed.length,
    }), [excursions, removed]);

    /** The types actually in use here, so the filter reflects the list. */
    const types = useMemo(() => {
        const seen = new Map<string, ReturnType<typeof categoryMeta>>();
        for (const e of excursions) if (!seen.has(e.category)) seen.set(e.category, categoryMeta(e.category));
        return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
    }, [excursions]);

    /** Preview data for a link. Never throws — a missing photo can't block a save. */
    const previewOf = async (url: string): Promise<{ title?: string; image?: string }> => {
        try {
            const res = await fetch('/api/admin/fetch-meta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!res.ok) return {};
            const body = await res.json();
            return { title: body.title || undefined, image: body.image || undefined };
        } catch {
            return {};
        }
    };

    const addLinks = async () => {
        const urls = stayUrlsFromText(bulk);
        if (!urls.length) return;
        setAdding(true);
        try {
            const existing = new Set(excursions.flatMap((e) => e.links.map((l) => l.url)));
            for (const url of urls) {
                if (existing.has(url)) continue;
                const meta = await previewOf(url);
                const name = cleanListingTitle(meta.title ?? '')
                    ?? nameFromAnyUrl(url)
                    ?? 'Unbenannter Ausflug';
                await api.create('places', {
                    name,
                    category: 'activity',
                    status: 'idea',
                    source: 'Added by me',
                    is_excursion: true,
                    image_url: meta.image ?? '',
                    links: [{ label: 'Link', url }],
                });
            }
            setBulk('');
        } finally {
            setAdding(false);
        }
    };

    const missingImages = useMemo(
        () => excursions.filter((e) => !e.image_url && e.links.length > 0),
        [excursions],
    );

    const fetchMissingImages = async () => {
        setFetching(missingImages.length);
        try {
            for (const item of missingImages) {
                const url = item.links[0]?.url;
                if (!url) continue;
                const meta = await previewOf(url);
                if (meta.image) await api.update('places', { id: item.id, image_url: meta.image });
                setFetching((n) => n - 1);
            }
        } finally {
            setFetching(0);
        }
    };

    const linkOf = (place: Place) => place.links[0]?.url ?? null;

    return (
        <div className="space-y-3">
            <TabToolbar
                left={(
                    <>
                        {segmentSwitch}
                        <Segmented
                            ariaLabel="Welche Ausflüge anzeigen"
                            size="sm"
                            value={rated}
                            onChange={setRated}
                            options={[
                                { key: 'all', label: 'Alle', count: counts.all },
                                { key: 'yes', label: '👍', count: counts.yes, title: 'Interessiert' },
                                { key: 'mid', label: '😐', count: counts.mid, title: 'Mittelklasse' },
                                { key: 'no', label: '👎', count: counts.no, title: 'Nicht interessiert' },
                                { key: 'unrated', label: 'Unbewertet', count: counts.unrated },
                                ...(counts.removed ? [{ key: 'removed' as const, label: '🗑', count: counts.removed, title: 'Entfernt' }] : []),
                            ]}
                        />
                    </>
                )}
                right={(
                    <>
                        {types.length > 1 && (
                            <FilterButton
                                active={typeFilter ? [{
                                    key: 'type', label: categoryMeta(typeFilter).label, clear: () => setTypeFilter(''),
                                }] : []}
                                onReset={() => setTypeFilter('')}
                            >
                                <FilterField label="Art">
                                    <SelectField value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                                        <option value="">Alle Typen</option>
                                        {types.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                                    </SelectField>
                                </FilterField>
                            </FilterButton>
                        )}
                        <Button tone="primary" onClick={() => setPasting(true)}>+ Ausflüge hinzufügen</Button>
                        <OverflowMenu items={[
                            ...(counts.unrated > 0 ? [{ label: `⚡ ${counts.unrated} Unbewertete bewerten`, onClick: () => setTriaging(true) }] : []),
                            ...(missingImages.length > 0 && fetching === 0 ? [{
                                label: `Fotos für ${missingImages.length} holen`, onClick: fetchMissingImages,
                            }] : []),
                        ]} />
                    </>
                )}
                below={fetching > 0 ? <p className="text-[11px] text-gray-500">Fotos werden geholt … noch {fetching}</p> : undefined}
            />

            {selected.size > 0 && (
                <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-2 p-3">
                    <span className="text-sm font-medium text-gray-700">
                        {selected.size} ausgewählt
                    </span>
                    <div className="flex-1" />
                    <BulkFieldMenu
                        fields={[
                            {
                                key: 'rating',
                                label: 'Bewertung',
                                options: [
                                    { value: 'yes', label: '👍 Interessiert' },
                                    { value: 'mid', label: '😐 Mittelklasse' },
                                    { value: 'no', label: '👎 Nicht interessiert' },
                                    { value: '', label: '— unbewertet —' },
                                ],
                            },
                            {
                                key: 'status',
                                label: 'Status',
                                options: [
                                    { value: 'idea', label: 'Idee' },
                                    { value: 'shortlisted', label: 'In der Auswahl' },
                                    { value: 'booked', label: 'Gebucht' },
                                ],
                            },
                            {
                                key: 'region_id',
                                label: 'Region',
                                options: [
                                    { value: null, label: '— keine Region —' },
                                    ...(data?.regions ?? []).map((region) => ({
                                        value: region.id, label: region.name,
                                    })),
                                ],
                            },
                        ]}
                        onApply={async (key, value) => {
                            await api.update('places', { ids: [...selected], [key]: value });
                            setSelected(new Set());
                        }}
                        label="Feld für alle Ausgewählten ändern"
                    />
                    <Button
                        onClick={async () => {
                            await api.update('places', { ids: [...selected], archived: true });
                            setSelected(new Set());
                        }}
                    >
                        Aus der Auswahl entfernen
                    </Button>
                    <Button tone="ghost" onClick={() => setSelected(new Set())}>Aufheben</Button>
                </Card>
            )}

            {/* ---- Cards ---- */}
            {shown.length === 0 ? (
                <Card>
                    <EmptyState
                        title={excursions.length ? 'Nichts passt zu diesem Filter' : 'Noch keine Ausflüge'}
                        hint={excursions.length
                            ? 'Probier „Alle“.'
                            : 'Füge oben einen Link ein – eine Tour, einen Kochkurs, einen Tauchgang.'}
                    />
                </Card>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
                    {shown.map((item) => (
                        <PlaceCard
                            key={item.id}
                            place={item}
                            selected={selected.has(item.id)}
                            onToggleSelect={() => setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                                return next;
                            })}
                            menu={[
                                { label: 'Öffnen', onClick: () => openPlace(item.id) },
                                ...(linkOf(item) ? [{ label: 'Seite in der Vorschau ansehen', onClick: () => setPreview(item) }] : []),
                                // Archive, not un-flag: see `removed`.
                                item.archived
                                    ? { label: 'Zurück in die Auswahl', onClick: () => api.patchPlace(item.id, { archived: false }) }
                                    : { label: 'Aus der Auswahl entfernen', onClick: () => api.patchPlace(item.id, { archived: true }) },
                                { label: 'Kein Ausflug', onClick: () => api.update('places', { id: item.id, is_excursion: false }) },
                                { label: 'Endgültig löschen', danger: true, onClick: () => api.removePlaces([item]) },
                            ]}
                        />
                    ))}
                </div>
            )}

            {preview && (
                <LinkPreview
                    key={preview.id}
                    title={preview.name}
                    url={linkOf(preview)}
                    rating={preview.rating}
                    onClose={() => setPreview(null)}
                    onRate={(rating) => api.patchPlace(preview.id, { rating })}
                />
            )}

            <Sheet
                open={pasting}
                onClose={() => setPasting(false)}
                side="center"
                title={<h2 className="font-semibold text-gray-900">Ausflüge aus Links hinzufügen</h2>}
            >
                <div className="space-y-2">
                    <TextArea
                        rows={4}
                        value={bulk}
                        onChange={(e) => setBulk(e.target.value)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                            const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
                            if (!text) return;
                            e.preventDefault();
                            setBulk((prev) => (prev ? `${prev}\n${text.trim()}` : text.trim()));
                        }}
                        placeholder="https://…  – eine Tour, ein Kurs, eine Tauchschule. Eine pro Zeile."
                    />
                    <p className="text-[11px] text-gray-400">
                        Name und Foto kommen von der Seite, sofern sie welche bietet. Art und Kosten trägst du selbst ein.
                    </p>
                    <div className="flex justify-end">
                        <Button
                            tone="primary"
                            onClick={async () => { await addLinks(); setPasting(false); }}
                            disabled={adding || !stayUrlsFromText(bulk).length}
                        >
                            {adding ? 'Wird hinzugefügt …' : `${stayUrlsFromText(bulk).length || ''} hinzufügen`.trim()}
                        </Button>
                    </div>
                </div>
            </Sheet>

            <RateQueue
                api={api}
                open={triaging}
                onClose={() => setTriaging(false)}
                title="Ausflüge bewerten"
                filter={(place) => place.is_excursion}
            />

        </div>
    );
}
