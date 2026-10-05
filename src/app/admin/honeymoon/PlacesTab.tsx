'use client';

import { useMemo, useState } from 'react';
import {
    STATUSES, categoriesOf, categoryMeta, countriesInUse, distanceKm, formatDistance, hasCoords, reviewToggleFor,
    sourceLabel, sourcesOf,
    type Place, type PlaceStatus,
} from '@/lib/honeymoon';
import {
    assignRegions, placesToCsv, placesToGeoJson, placesToKml,
} from '@/lib/honeymoonPlaces';
import type { HoneymoonApi } from './useHoneymoon';
import { usePlaceSheet } from './PlaceSheetContext';
import ImportPlaces from './ImportPlaces';
import SavedViews from './SavedViews';
import { useLocalPref } from './useLocalPref';
import {
    BulkFieldMenu, Button, Card, EmptyState, MiniSelect, OverflowMenu, SelectField,
    TriToggle, type TriState,
} from './ui';
import { TabToolbar } from './kit/TabToolbar';
import { FilterButton, FilterChips, FilterField, type ActiveFilter } from './kit/FilterButton';
import { PlaceRow } from './kit/PlaceCard';

/** The orders the list can be read in. */
type SortKey = 'name' | 'recent' | 'region' | 'status' | 'rating' | 'distance';

const SORTS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'recent', label: 'Zuletzt hinzugefügt' },
    { key: 'region', label: 'Region' },
    { key: 'status', label: 'Status' },
    { key: 'rating', label: 'Bewertung' },
    { key: 'distance', label: 'Entfernung zur Basis' },
];

/**
 * Hand the browser a file.
 *
 * A blob URL rather than a data: URI, because a two-hundred-place KML is bigger
 * than some browsers will accept in a URL; revoked immediately after, since the
 * click has already started the download.
 */
function download(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/** Liked first, then unrated, then mid, then rejected. */
function rank(place: Place): number {
    if (place.rating === 'yes') return 3;
    if (place.rating == null) return 2;
    if (place.rating === 'mid') return 1;
    return 0;
}

/**
 * The place library — every candidate from the guide plus anything added by hand.
 *
 * This is the tab that has to stay usable at 200+ rows, so it leads with search
 * and filters rather than the list.
 */
/**
 * @param panel Rendered as a narrow column beside the map rather than as the
 *   whole page: the five count cards go (the shell header already carries those
 *   numbers) and the filters stack two-up, so the list keeps the height.
 */
export default function PlacesTab({ api, panel = false, segmentSwitch }: {
    api: HoneymoonApi;
    panel?: boolean;
    /** The hub's All · Stays · Excursions control, drawn at the left of the toolbar. */
    segmentSwitch?: React.ReactNode;
}) {
    const { data } = api;
    const [search_, setSearch] = useState('');
    /*
     * Filters, sort and density are remembered per browser.
     *
     * They reset on every visit before this, which the map (which remembers its
     * split) made look like an oversight rather than a decision. Search is
     * deliberately *not* remembered: a stale search term hiding two hundred rows
     * on arrival reads as data loss.
     */
    const [regionFilter, setRegionFilter] = useLocalPref('hm-places-region', '');
    const [categoryFilter, setCategoryFilter] = useLocalPref('hm-places-category', '');
    const [statusFilter, setStatusFilter] = useLocalPref('hm-places-status', '');
    const [reviewState, setReviewState] = useLocalPref<TriState>('hm-places-review', 'off');
    const [pinState, setPinState] = useLocalPref<TriState>('hm-places-pin', 'off');
    const [sourceFilter, setSourceFilter] = useLocalPref('hm-places-source', '');
    const [sort, setSort] = useLocalPref<SortKey>('hm-places-sort', 'name');
    const [dense, setDense] = useLocalPref('hm-places-dense', false);
    const { openPlace, newPlace } = usePlaceSheet();
    const [importing, setImporting] = useState(false);
    const [filing, setFiling] = useState('');
    const [seeding, setSeeding] = useState(false);
    const [seedNote, setSeedNote] = useState('');
    const [selected, setSelected] = useState<Set<number>>(new Set());

    // Stable identity — see MapTab: a fresh `?? []` per render would defeat
    // the filter and counts memos below.
    const places = useMemo(() => data?.places ?? [], [data]);

    const filtered = useMemo(() => {
        const term = search_.trim().toLowerCase();
        return places.filter((p) => {
            if (term && !p.name.toLowerCase().includes(term)
                && !(p.description ?? '').toLowerCase().includes(term)) return false;
            if (regionFilter && String(p.region_id ?? '') !== regionFilter) return false;
            if (categoryFilter && p.category !== categoryFilter) return false;
            if (statusFilter && p.status !== statusFilter) return false;
            if (reviewState === 'on' && !p.needs_review) return false;
            if (reviewState === 'inverted' && p.needs_review) return false;
            if (pinState === 'on' && hasCoords(p)) return false;
            if (pinState === 'inverted' && !hasCoords(p)) return false;
            if (sourceFilter && sourceLabel(p.source) !== sourceFilter) return false;
            return true;
        });
    }, [places, search_, regionFilter, categoryFilter, statusFilter,
        reviewState, pinState, sourceFilter]);

    /**
     * The order the list is in.
     *
     * Name was the only option, which is the wrong default for two of the three
     * things you come here to do: "what did I add last night" and "what is near
     * where we are staying" are both orderings, not searches. Distance sorts from
     * whichever base is set on the earliest day that has one — the trip's centre
     * of gravity — and says so in the label.
     */
    const distanceFrom = useMemo(() => {
        for (const day of data?.days ?? []) {
            if (day.base_place_id == null) continue;
            const base = api.placeById.get(day.base_place_id);
            if (base && hasCoords(base)) return base;
        }
        return null;
    }, [data?.days, api.placeById]);

    const sorted = useMemo(() => {
        const rows = [...filtered];
        switch (sort) {
            case 'recent':
                // Highest id first: `created_at` is only on places, and the id
                // is the same order without a parse.
                return rows.sort((a, b) => b.id - a.id);
            case 'region':
                return rows.sort((a, b) => (api.regionById.get(a.region_id ?? -1) ?? '~')
                    .localeCompare(api.regionById.get(b.region_id ?? -1) ?? '~')
                    || a.name.localeCompare(b.name));
            case 'status':
                return rows.sort((a, b) => STATUSES.findIndex((s) => s.key === b.status)
                    - STATUSES.findIndex((s) => s.key === a.status)
                    || a.name.localeCompare(b.name));
            case 'rating':
                return rows.sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
            case 'distance': {
                if (!distanceFrom) return rows;
                const from = { lat: distanceFrom.lat as number, lng: distanceFrom.lng as number };
                return rows.sort((a, b) => {
                    const left = hasCoords(a)
                        ? distanceKm(from, { lat: a.lat, lng: a.lng }) : Infinity;
                    const right = hasCoords(b)
                        ? distanceKm(from, { lat: b.lat, lng: b.lng }) : Infinity;
                    return left - right;
                });
            }
            default:
                return rows.sort((a, b) => a.name.localeCompare(b.name));
        }
    }, [filtered, sort, api.regionById, distanceFrom]);

    /** Built from the data, so a new batch of suggestions shows up on its own. */
    const sources = useMemo(() => sourcesOf(places), [places]);

    const counts = useMemo(() => ({
        total: places.length,
        pinned: places.filter(hasCoords).length,
        review: places.filter((p) => p.needs_review).length,
        shortlisted: places.filter((p) => p.status === 'shortlisted').length,
        booked: places.filter((p) => p.status === 'booked').length,
    }), [places]);

    const toggle = (id: number) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const bulk = async (fields: Record<string, unknown>) => {
        if (!selected.size) return;
        await api.update('places', { ids: [...selected], ...fields });
        setSelected(new Set());
    };

    /**
     * The same confirmed/unconfirmed toggle the map's lasso carries.
     *
     * The two selection bars are meant to offer the same verbs — which ones you
     * get should not depend on whether you happened to select on a map or in a
     * list — so this is the shared helper, not a second rule.
     */
    const review = useMemo(
        () => reviewToggleFor(
            [...selected].map((id) => api.placeById.get(id)).filter((p) => p != null),
        ),
        [selected, api.placeById],
    );

    /**
     * The same fields the map's lasso can set, offered here too.
     *
     * Which verbs you get shouldn't depend on whether you happened to select on
     * a map or in a list — they are the same places either way.
     */
    const bulkFields = useMemo(() => [
        {
            key: 'category',
            label: 'Typ',
            options: (data?.categories ?? []).map((c) => ({
                value: c.key, label: `${c.icon} ${c.label}`,
            })),
        },
        {
            key: 'region_id',
            label: 'Region',
            options: [
                { value: null, label: '— keine Region —' },
                ...(data?.regions ?? []).map((r) => ({
                    value: r.id, label: r.country ? `${r.name} · ${r.country}` : r.name,
                })),
            ],
        },
        {
            key: 'country',
            label: 'Land',
            options: [
                { value: '', label: '— aus der Region —' },
                ...countriesInUse(data?.regions ?? [], places).map((c) => ({ value: c, label: c })),
            ],
        },
        {
            key: 'source',
            label: 'Quelle',
            options: sources.map((src) => ({ value: src, label: src })),
        },
        {
            key: 'needs_review',
            label: 'Prüfmarkierung',
            options: [
                { value: false, label: 'Geprüft – Pin stimmt' },
                { value: true, label: 'Muss geprüft werden' },
            ],
        },
        {
            key: 'is_excursion',
            label: 'Ausflug',
            options: [
                { value: true, label: 'Ist ein Ausflug' },
                { value: false, label: 'Kein Ausflug' },
            ],
        },
        {
            key: 'rating',
            label: 'Bewertung',
            options: [
                { value: 'yes', label: '\u{1F44D} Interessiert' },
                { value: 'mid', label: '\u{1F610} Mittelklasse' },
                { value: 'no', label: '\u{1F44E} Nicht interessiert' },
                { value: '', label: '— unbewertet —' },
            ],
        },
    ], [data?.categories, data?.regions, places, sources]);

    /**
     * Load the bundled guide, from a button.
     *
     * The empty state used to say "run npm run seed:honeymoon", which is not
     * something you can do from the admin panel, let alone from a phone. The
     * seed is idempotent — matched on name — so pressing it twice is harmless.
     */
    const loadGuide = async () => {
        setSeeding(true);
        setSeedNote('');
        try {
            const res = await fetch('/api/admin/honeymoon/seed', { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setSeedNote(body.error ?? 'Der Reiseführer konnte nicht geladen werden.'); return; }
            await api.refresh();
            setSeedNote(
                `${body.added.places} Orte, ${body.added.regions} Regionen und `
                + `${body.added.notes} Reiseführer-Notizen hinzugefügt. Die Pins sind geocodierte Schätzungen – sie werden mit `
                + 'gestricheltem Ring angezeigt, bis du sie bestätigst.',
            );
        } finally {
            setSeeding(false);
        }
    };

    /**
     * File the unfiled places by where they are.
     *
     * A drawn region boundary decides outright; otherwise the nearest region
     * centre, which is a guess and is described as one. Only places with no
     * region are touched — re-filing something you put somewhere on purpose is
     * the kind of help that loses work — and it is one request, not one per row.
     */
    const fileByLocation = async () => {
        const matches = assignRegions(places, data?.regions ?? []);
        if (!matches.length) {
            setFiling('Nichts zuzuordnen: Jeder Ort mit Pin hat bereits eine Region.');
            return;
        }
        const ok = await api.updateMany('places', matches.map((match) => ({
            id: match.placeId, region_id: match.regionId,
        })));
        const drawn = matches.filter((match) => match.how === 'boundary').length;
        setFiling(ok
            ? `${matches.length} ${matches.length === 1 ? 'Ort' : 'Orte'} zugeordnet`
                + `${drawn ? `, ${drawn} per gezeichneter Grenze` : ''}`
                + `${matches.length - drawn ? `, ${matches.length - drawn} nach nächstem Regionszentrum – lohnt einen Blick` : ''}.`
            : 'Die Orte konnten nicht zugeordnet werden.');
    };

    /** Schedule the whole selection onto a day, skipping anything already on it. */
    const addToDay = async (dayId: number) => {
        const day = (data?.days ?? []).find((d) => d.id === dayId);
        if (!day) return;
        const already = new Set(day.stops.map((s) => s.place_id).filter((v) => v != null));
        const rows = [...selected]
            .filter((id) => !already.has(id))
            .map((id) => ({ day_id: dayId, place_id: id }));
        await api.createMany('stops', rows);
        await api.refresh();
        setSelected(new Set());
    };

    const regionName = (id: string) => (data?.regions ?? []).find((r) => String(r.id) === id)?.name ?? id;
    const active: ActiveFilter[] = [
        ...(sourceFilter ? [{ key: 'source', label: sourceFilter, clear: () => setSourceFilter('') }] : []),
        ...(regionFilter ? [{ key: 'region', label: regionName(regionFilter), clear: () => setRegionFilter('') }] : []),
        ...(categoryFilter ? [{ key: 'category', label: categoryMeta(categoryFilter).label, clear: () => setCategoryFilter('') }] : []),
        ...(statusFilter ? [{ key: 'status', label: STATUSES.find((st) => st.key === statusFilter)?.label ?? statusFilter, clear: () => setStatusFilter('') }] : []),
        ...(reviewState !== 'off' ? [{ key: 'review', label: reviewState === 'on' ? 'Muss geprüft werden' : 'Bereits geprüft', clear: () => setReviewState('off') }] : []),
        ...(pinState !== 'off' ? [{ key: 'pin', label: pinState === 'on' ? 'Ohne Pin' : 'Mit Pin', clear: () => setPinState('off') }] : []),
    ];
    const resetFilters = () => {
        setRegionFilter(''); setCategoryFilter(''); setStatusFilter('');
        setSourceFilter(''); setReviewState('off'); setPinState('off');
    };

    const filters = (
        <FilterButton active={active} onReset={resetFilters}>
            <FilterField label="Quelle">
                <SelectField value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                    <option value="">Alle Quellen</option>
                    {sources.map((src) => <option key={src} value={src}>{src}</option>)}
                </SelectField>
            </FilterField>
            <FilterField label="Region">
                <SelectField value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
                    <option value="">Alle Regionen</option>
                    {(data?.regions ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </SelectField>
            </FilterField>
            <FilterField label="Typ">
                <SelectField value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    <option value="">Alle Typen</option>
                    {categoriesOf(places).map((c) => (
                        <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
                    ))}
                </SelectField>
            </FilterField>
            <FilterField label="Status">
                <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">Beliebiger Status</option>
                    {STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                </SelectField>
            </FilterField>
            <div className="grid grid-cols-2 gap-2">
                <TriToggle state={reviewState} onChange={setReviewState}
                    offLabel="⚠ Prüfung: egal" onLabel="⚠ Zu prüfen" invertedLabel="✓ Geprüft" />
                <TriToggle state={pinState} onChange={setPinState} tone="sky"
                    offLabel="Pin: egal" onLabel="Ohne Pin" invertedLabel="Mit Pin" />
            </div>
            <FilterField label="Gespeicherte Ansichten">
                <SavedViews
                    api={api}
                    current={{
                        region: regionFilter, category: categoryFilter, status: statusFilter,
                        source: sourceFilter, review: reviewState, pin: pinState, sort,
                    }}
                    onApply={(saved: Record<string, unknown>) => {
                        setRegionFilter(String(saved.region ?? ''));
                        setCategoryFilter(String(saved.category ?? ''));
                        setStatusFilter(String(saved.status ?? ''));
                        setSourceFilter(String(saved.source ?? ''));
                        setReviewState((saved.review as TriState) ?? 'off');
                        setPinState((saved.pin as TriState) ?? 'off');
                        setSort((saved.sort as SortKey) ?? 'name');
                    }}
                />
            </FilterField>
        </FilterButton>
    );

    const search = (
        <input
            type="search"
            value={search_}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Orte suchen …"
            aria-label="Orte suchen"
            className={`min-h-11 md:min-h-0 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-base md:text-sm
                focus:outline-none focus:ring-2 focus:ring-accent/30 ${panel ? 'min-w-0 flex-1' : 'w-full sm:w-56'}`}
        />
    );

    const menu = [
        { label: dense ? 'Großzügige Zeilen' : 'Kompakte Zeilen', onClick: () => setDense(!dense) },
        { label: 'Liste importieren …', onClick: () => setImporting(true) },
        {
            label: 'Als CSV exportieren',
            onClick: () => download(
                placesToCsv(sorted, (id) => (id != null ? api.regionById.get(id) ?? '' : '')),
                'places.csv', 'text/csv',
            ),
        },
        {
            label: 'Als GeoJSON exportieren',
            onClick: () => download(
                placesToGeoJson(sorted, (id) => (id != null ? api.regionById.get(id) ?? '' : '')),
                'places.geojson', 'application/geo+json',
            ),
        },
        {
            label: 'Als KML exportieren (Google My Maps)',
            onClick: () => download(
                placesToKml(sorted, data?.trip.title ?? 'Flitterwochen-Orte'),
                'places.kml', 'application/vnd.google-earth.kml+xml',
            ),
        },
        { label: 'Regionen nach Standort zuordnen', onClick: fileByLocation },
    ];

    const summary = (
        <p className="text-xs text-gray-500">
            {counts.total} Orte · {counts.pinned} mit Pin
            {counts.review > 0 && (
                <>
                    {' · '}
                    <button type="button" className="min-h-11 md:min-h-0 text-amber-700 hover:underline" onClick={() => setReviewState('on')}>
                        {counts.review} zu prüfen
                    </button>
                </>
            )}
            {' '}· {counts.shortlisted} in der Auswahl · {counts.booked} gebucht
            {sorted.length !== places.length && <span className="text-gray-400"> · {sorted.length} angezeigt</span>}
        </p>
    );

    return (
        <div className="space-y-3">
            {panel ? (
                <div className="flex items-center gap-2">{search}{filters}</div>
            ) : (
                <TabToolbar
                    left={segmentSwitch}
                    right={(
                        <>
                            {search}
                            {filters}
                            <MiniSelect
                                value={sort}
                                onChange={(e) => setSort(e.target.value as SortKey)}
                                aria-label="Sortieren nach"
                                className="max-w-[7.5rem] md:max-w-[10rem]"
                            >
                                {SORTS.map((option) => (
                                    <option key={option.key} value={option.key}>
                                        {option.key === 'distance' && !distanceFrom
                                            ? 'Entfernung (zuerst eine Basis festlegen)'
                                            : option.label}
                                    </option>
                                ))}
                            </MiniSelect>
                            <Button tone="primary" onClick={() => newPlace()} aria-label="Ort hinzufügen">
                                +<span className="hidden sm:inline"> Hinzufügen</span>
                            </Button>
                            <OverflowMenu items={menu} />
                        </>
                    )}
                    below={<div className="flex flex-wrap items-center gap-2">{summary}<FilterChips active={active} /></div>}
                />
            )}
            {panel && <FilterChips active={active} />}
            {filing && (
                <p className="rounded-xl bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">{filing}</p>
            )}

            {/* ---- Bulk bar ---- */}
            {selected.size > 0 && (
                <Card className="p-3 flex flex-wrap items-center gap-2 sticky top-2 z-10">
                    <span className="text-sm font-medium text-gray-700">{selected.size} ausgewählt</span>
                    <div className="flex-1" />
                    <SelectField
                        className="max-w-[10rem]"
                        value=""
                        onChange={(e) => { if (e.target.value) bulk({ status: e.target.value }); }}
                    >
                        <option value="">Status setzen …</option>
                        {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </SelectField>
                    {(data?.days ?? []).length > 0 && (
                        <MiniSelect
                            value=""
                            onChange={(e) => { if (e.target.value) addToDay(Number(e.target.value)); }}
                        >
                            <option value="">Zu Tag hinzufügen …</option>
                            {(data?.days ?? []).map((d) => (
                                <option key={d.id} value={d.id}>
                                    Tag {d.day_number}{d.title ? ` — ${d.title}` : ''}
                                </option>
                            ))}
                        </MiniSelect>
                    )}
                    <BulkFieldMenu
                        fields={bulkFields}
                        onApply={(key, value) => bulk({ [key]: value })}
                        label="Feld für alle Ausgewählten ändern"
                    />
                    <Button
                        onClick={() => bulk({ needs_review: review.needsReview })}
                        title={review.needsReview
                            ? `Alle ${review.confirmed} wieder auf unbestätigt setzen`
                            : `${review.unconfirmed} unbestätigte${review.unconfirmed === 1 ? 'n Ort' : ' Orte'} bestätigen`}
                    >
                        {review.label}
                    </Button>
                    <Button
                        tone="danger"
                        onClick={async () => {
                            const rows = [...selected]
                                .map((id) => api.placeById.get(id))
                                .filter((p) => p != null);
                            if (!rows.length) return;
                            if (!confirm(`${rows.length} ${rows.length === 1 ? 'Ort' : 'Orte'} löschen? Das lässt sich rückgängig machen.`)) return;
                            await api.removePlaces(rows);
                            setSelected(new Set());
                        }}
                    >
                        Löschen
                    </Button>
                    <Button tone="ghost" onClick={() => setSelected(new Set())}>Aufheben</Button>
                </Card>
            )}

            {/* ---- List ---- */}
            <Card>
                {sorted.length === 0 ? (
                    <div className="p-6 text-center">
                        <EmptyState
                            title={places.length ? 'Keine Orte passen zu diesen Filtern' : 'Noch keine Orte'}
                            hint={places.length
                                ? 'Setze die Filter zurück.'
                                : 'Füge einen von Hand hinzu, importiere eine Liste oder lade den mitgelieferten Bali- und '
                                    + 'Singapur-Reiseführer – 231 Orte, 126 davon bereits mit Pin.'}
                        />
                        {places.length === 0 && (
                            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                                <Button tone="primary" onClick={loadGuide} disabled={seeding}>
                                    {seeding ? 'Wird geladen …' : 'Bali-Reiseführer laden'}
                                </Button>
                                <Button onClick={() => setImporting(true)}>Liste importieren …</Button>
                            </div>
                        )}
                        {seedNote && (
                            <p className="mt-2 text-xs text-gray-600">{seedNote}</p>
                        )}
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-100">
                        {sorted.map((place) => (
                            <PlaceRow
                                key={place.id}
                                place={place}
                                dense={dense}
                                selected={selected.has(place.id)}
                                onToggleSelect={() => toggle(place.id)}
                                trailing={sort === 'distance' && distanceFrom && hasCoords(place) ? (
                                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400">
                                        {formatDistance(distanceKm(
                                            { lat: distanceFrom.lat as number, lng: distanceFrom.lng as number },
                                            { lat: place.lat, lng: place.lng },
                                        ))}
                                    </span>
                                ) : undefined}
                                menu={[
                                    { label: 'Öffnen', onClick: () => openPlace(place.id) },
                                    ...STATUSES
                                        .filter((st) => st.key !== place.status)
                                        .map((st) => ({
                                            label: `Markieren als: ${st.label}`,
                                            onClick: () => api.update('places', {
                                                id: place.id, status: st.key as PlaceStatus,
                                            }),
                                        })),
                                    ...(place.needs_review ? [{
                                        label: 'Pin stimmt',
                                        onClick: () => api.update('places', { id: place.id, needs_review: false }),
                                    }] : []),
                                    { label: 'Löschen', danger: true, onClick: () => api.removePlaces([place]) },
                                ]}
                            />
                        ))}
                    </ul>
                )}
            </Card>

            {panel && sorted.length > 0 && (
                <p className="px-1 text-[11px] text-gray-400">
                    {sorted.length} von {places.length} angezeigt. Zieh eine Zeile auf einen Tag, um sie einzuplanen.
                </p>
            )}

            <ImportPlaces api={api} open={importing} onClose={() => setImporting(false)} />
        </div>
    );
}
