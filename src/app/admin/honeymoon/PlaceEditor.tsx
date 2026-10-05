'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
    SOURCE_MANUAL, bookingKindFor, countriesInUse, sourceLabel, sourcesOf,
    type Place, type PlaceLink, type PlaceStatus,
} from '@/lib/honeymoon';
import BookingPanel from './BookingPanel';
import type { HoneymoonApi } from './useHoneymoon';
import { Hint } from './kit/Hint';
import {
    Button, CategorySelect, CustomisableSelect, ManageListModal, SelectField, StatusSelect,
    TextArea, TextField,
} from './ui';

// Leaflet reaches for `window` at import time, so the preview map never joins
// the server bundle.
const PinMap = dynamic(() => import('./PinMap'), {
    ssr: false,
    loading: () => <div className="h-48 w-full rounded-2xl bg-gray-100 animate-pulse" />,
});

/** Every editable field, in one comparable string. */
function fingerprint(form: {
    name: string; category: string; regionId: string; status: string; description: string;
    address: string; priceNote: string; lat: number | null; lng: number | null;
    needsReview: boolean; links: PlaceLink[]; source: string; country: string;
    cost: string; costPer: string; openingHours: string; bestTime: string;
}): string {
    return JSON.stringify([
        form.name, form.category, form.regionId, form.status, form.description, form.address,
        form.priceNote, form.lat, form.lng, form.needsReview, form.links, form.source, form.country,
        form.cost, form.costPer, form.openingHours, form.bestTime,
    ]);
}

/** Matches a bare "lat, lng" so a pasted pair resolves without pressing Find. */
const coordPair = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

interface GeocodeHit {
    label: string;
    lat: number;
    lng: number;
    precision: 'exact' | 'geocoded';
    /** Present when the hit came from a pasted Google Maps link. */
    name?: string;
    address?: string;
    url?: string;
    /** From OSM's extratags, on a search that was happening anyway. */
    opening_hours?: string;
    phone?: string;
    website?: string;
    /** Which geocoder answered; the fallback matches fuzzily. */
    source?: 'nominatim' | 'photon';
}

/**
 * Create/edit a place.
 *
 * The coordinate box accepts all three input styles the API supports — a name
 * to search, a Google Maps link to paste, or raw "lat, lng" — because in
 * practice you reach for whichever is closest to hand.
 */
export function PlaceForm({ api, place, defaults, onDone, onCancel, registerGuard }: {
    api: HoneymoonApi;
    /** null means "create new". */
    place: Place | null;
    /** What a new place starts with — a stay from the Stays segment, say. */
    defaults?: Partial<Place>;
    /** After a successful save. */
    onDone: () => void;
    onCancel: () => void;
    /** Hands the panel its "you have unsaved changes" check. */
    registerGuard?: (guard: () => boolean) => void;
}) {
    const editing = place != null;
    /**
     * What the cost box is denominated in.
     *
     * There is no picker: a place keeps whatever currency it arrived with — an
     * import can carry euros — and anything new is in the trip's own. Both the
     * label and the saved row read this one value, so they cannot disagree.
     */
    const homeCurrency = api.data?.trip.home_currency || 'USD';
    const costCurrency = place?.cost_currency || homeCurrency;

    const [name, setName] = useState('');
    const [category, setCategory] = useState('misc');
    const [regionId, setRegionId] = useState<string>('');
    const [status, setStatus] = useState<PlaceStatus>('idea');
    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [priceNote, setPriceNote] = useState('');
    const [lat, setLat] = useState<number | null>(null);
    const [lng, setLng] = useState<number | null>(null);
    const [needsReview, setNeedsReview] = useState(false);
    const [links, setLinks] = useState<PlaceLink[]>([]);
    const [source, setSource] = useState(SOURCE_MANUAL);
    const [country, setCountry] = useState('');
    const [cost, setCost] = useState('');
    const [costPer, setCostPer] = useState<'night' | 'person' | 'total'>('total');
    const [openingHours, setOpeningHours] = useState('');
    const [bestTime, setBestTime] = useState('');
    const [managing, setManaging] = useState<'categories' | 'regions' | null>(null);
    /** Fingerprint of the form as it was opened — see confirmDiscard. */
    const pristine = useRef('');

    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<GeocodeHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [lookupError, setLookupError] = useState('');
    const searchSeq = useRef(0);

    /**
     * Load the incoming place into the form each time the modal opens, and
     * record what "untouched" looks like.
     *
     * The snapshot has to be taken from the same values being written here, not
     * from state read on a later render: state updates are queued, so reading it
     * afterwards captures the *previous* form and every dialog would then look
     * dirty the moment it opened.
     */
    const seed = place ?? defaults ?? null;
    useEffect(() => {
        const initial = {
            name: seed?.name ?? '',
            category: seed?.category ?? 'misc',
            regionId: seed?.region_id != null ? String(seed.region_id) : '',
            status: seed?.status ?? 'idea',
            description: seed?.description ?? '',
            address: seed?.address ?? '',
            priceNote: seed?.price_note ?? '',
            lat: seed?.lat ?? null,
            lng: seed?.lng ?? null,
            needsReview: seed?.needs_review ?? false,
            links: seed?.links ?? [],
            source: place ? sourceLabel(place.source) : SOURCE_MANUAL,
            country: seed?.country ?? '',
            cost: place?.cost != null ? String(place.cost) : '',
            /*
             * With no number yet, "per" says nothing — and the column's own
             * default is "total", so an unpriced stay opened here read Total
             * while the Stays card it was typed on said per night. Start a stay
             * where a stay belongs and only trust the stored value once there
             * is a figure for it to describe.
             */
            costPer: place?.cost != null
                ? place.cost_per
                : (seed?.category ?? 'misc') === 'stay' ? 'night' : 'total',
            openingHours: seed?.opening_hours ?? '',
            bestTime: seed?.best_time ?? '',
        };
        setName(initial.name);
        setCategory(initial.category);
        setRegionId(initial.regionId);
        setStatus(initial.status as PlaceStatus);
        setDescription(initial.description);
        setAddress(initial.address);
        setPriceNote(initial.priceNote);
        setLat(initial.lat);
        setLng(initial.lng);
        setNeedsReview(initial.needsReview);
        setLinks(initial.links);
        setSource(initial.source);
        setCountry(initial.country);
        setCost(initial.cost);
        setCostPer(initial.costPer as 'night' | 'person' | 'total');
        setOpeningHours(initial.openingHours);
        setBestTime(initial.bestTime);
        setQuery('');
        setHits([]);
        setLookupError('');
        pristine.current = fingerprint(initial);
    // Loaded once per place: a refetch after an inline edit elsewhere must not
    // wipe what is being typed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [place?.id]);

    /** What this place would count as if it just followed its region. */
    const inheritedCountry = (api.data?.regions ?? [])
        .find((r) => String(r.id) === regionId)?.country?.trim() ?? '';

    const lookup = useCallback(async (raw: string) => {
        const term = raw.trim();
        if (!term) { setHits([]); return; }

        // Guard against an earlier slow request landing after a later one and
        // overwriting fresher results.
        const seq = ++searchSeq.current;
        setSearching(true);
        setLookupError('');
        try {
            const res = await fetch(`/api/admin/honeymoon/geocode?q=${encodeURIComponent(term)}`);
            const body = await res.json();
            if (seq !== searchSeq.current) return;
            setHits(body.results ?? []);
            if (body.error) setLookupError(body.error);
            else if (!body.results?.length) setLookupError('Keine Treffer. Ergänze den Ort oder füge einen Google-Maps-Link ein.');
        } catch {
            if (seq === searchSeq.current) setLookupError('Suche fehlgeschlagen.');
        } finally {
            if (seq === searchSeq.current) setSearching(false);
        }
    }, []);

    /**
     * Take everything a hit can give us.
     *
     * A pasted Google Maps link carries a name, an address and the link itself —
     * retyping all three when they arrived in one paste is busywork. Existing
     * values are never clobbered: if you already typed a name, the link's name
     * loses.
     */
    const applyHit = (hit: GeocodeHit) => {
        setLat(hit.lat);
        setLng(hit.lng);
        // Placing a pin deliberately is exactly what clears the review flag.
        setNeedsReview(false);

        if (!name.trim() && hit.name) setName(hit.name);
        if (!address.trim()) {
            if (hit.address) setAddress(hit.address);
            else if (hit.precision === 'geocoded') setAddress(hit.label);
        }
        if (hit.url) {
            // Don't stack duplicates if the same link is pasted twice.
            setLinks((prev) => (prev.some((l) => l.url === hit.url)
                ? prev
                : [...prev, { label: 'Google Maps', url: hit.url! }]));
        }
        // OSM's extras, taken only where the field is still empty: a hit should
        // fill in blanks, never overwrite something you typed.
        if (hit.opening_hours && !openingHours.trim()) setOpeningHours(hit.opening_hours);
        if (hit.website) {
            setLinks((prev) => (prev.some((l) => l.url === hit.website)
                ? prev
                : [...prev, { label: 'Website', url: hit.website! }]));
        }
        if (hit.phone && !description.includes(hit.phone)) {
            setDescription((prev) => (prev.trim() ? prev : `Telefon: ${hit.phone}`));
        }

        setHits([]);
        setQuery('');
    };

    /** A pasted or dropped link should just work, without hunting for Find. */
    const autoLookup = (value: string) => {
        setQuery(value);
        const trimmed = value.trim();
        if (/^https?:\/\//i.test(trimmed) || coordPair.test(trimmed)) lookup(trimmed);
    };

    /**
     * Is the form still as it was opened?
     *
     * Closing this dialog used to throw away everything typed into it without a
     * word — a stray Escape or a mis-aimed click and the notes you just wrote
     * were gone. Comparing a fingerprint of the form against the one taken when
     * it opened tells "nothing happened" from "you are about to lose work", and
     * only the second one is worth interrupting anyone for.
     */
    const confirmDiscard = useCallback(() => {
        const now = fingerprint({
            name, category, regionId, status, description, address, priceNote,
            lat, lng, needsReview, links, source, country, cost, costPer, openingHours, bestTime,
        });
        if (now === pristine.current) return true;
        return confirm('Änderungen an diesem Ort verwerfen?');
    }, [name, category, regionId, status, description, address, priceNote,
        lat, lng, needsReview, links, source, country, cost, costPer, openingHours, bestTime]);

    useEffect(() => { registerGuard?.(confirmDiscard); }, [registerGuard, confirmDiscard]);

    const save = async () => {
        if (!name.trim()) return;
        const payload: Record<string, unknown> = {
            name: name.trim(),
            category,
            region_id: regionId === '' ? null : Number(regionId),
            status,
            description: description.trim(),
            address: address.trim(),
            price_note: priceNote.trim(),
            lat, lng,
            needs_review: needsReview,
            links: links.filter((l) => l.url.trim()),
            source: source.trim() || SOURCE_MANUAL,
            country: country.trim(),
            // A blank cost is "not priced yet", which is not zero — the coercion
            // in the route turns '' into NULL and keeps that distinction.
            cost: cost.trim(),
            cost_per: costPer,
            // The label above the box names a currency, so the row is stored
            // saying the same thing. Left unstamped, a cost imported as euros
            // kept meaning euros while the box that edited it said dollars.
            cost_currency: cost.trim() ? costCurrency : '',
            opening_hours: openingHours.trim(),
            best_time: bestTime.trim(),
            ...(editing ? {} : { is_excursion: defaults?.is_excursion ?? false }),
        };
        const ok = editing
            ? await api.update('places', { id: place.id, ...payload })
            : await api.create('places', payload);
        if (ok) onDone();
    };

    return (
            <div
                className="@container space-y-3"
                // Save without reaching for the mouse. Plain Enter can't do it —
                // this form has a search box where Enter means "look that up".
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
                }}
            >
                <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
                    <TextField
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Tukad Cepung Waterfall"
                        autoFocus={!editing}
                    />
                </div>

                <div className="grid grid-cols-1 @md:grid-cols-2 @4xl:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Kategorie</label>
                        <CategorySelect
                            value={category}
                            places={api.data?.places ?? []}
                            onChange={setCategory}
                            onCreateCategory={api.createCategory}
                            onManage={() => setManaging('categories')}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Land</label>
                        <CustomisableSelect
                            label="Land"
                            value={country}
                            placeholder="Indonesien, Singapur …"
                            options={[
                                {
                                    key: '',
                                    // Named rather than blank so it is obvious this is
                                    // inheritance, not "no country".
                                    label: inheritedCountry
                                        ? `— aus der Region (${inheritedCountry}) —`
                                        : '— keine —',
                                },
                                ...countriesInUse(api.data?.regions ?? [], api.data?.places ?? [])
                                    .map((c) => ({ key: c, label: c })),
                            ]}
                            onChange={setCountry}
                            onCreate={(typed) => typed.trim()}
                        />
                        {country && inheritedCountry && country !== inheritedCountry && (
                            <p className="text-[11px] text-amber-700 mt-1">
                                Überschreibt das Land der Region ({inheritedCountry}).
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Region</label>
                        <CustomisableSelect
                            label="Region"
                            value={regionId}
                            placeholder="Nusa Penida, Gili-Inseln …"
                            options={[
                                { key: '', label: '— keine —' },
                                ...(api.data?.regions ?? []).map((r) => ({
                                    key: String(r.id),
                                    label: r.country ? `${r.name} · ${r.country}` : `${r.name} · kein Land`,
                                })),
                            ]}
                            onChange={setRegionId}
                            onCreate={async (typed) => {
                                // A region is a real row, so it has to exist before it
                                // can be selected. Reuse an existing one on a name
                                // match rather than creating a near-duplicate.
                                const existing = (api.data?.regions ?? []).find(
                                    (r) => r.name.toLowerCase() === typed.toLowerCase(),
                                );
                                if (existing) return String(existing.id);
                                // Inherit whatever country the trip is focused on, so a
                                // region added mid-filter isn't born invisible.
                                const created = await api.createRegion(
                                    typed, api.data?.trip.focus_country || '',
                                );
                                return created == null ? null : String(created);
                            }}
                            onManage={() => setManaging('regions')}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Status</label>
                        <StatusSelect value={status} onChange={(e) => setStatus(e.target.value as PlaceStatus)} />
                    </div>
                </div>

                <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-3 items-start">
                    {/* ---- Location ---- */}
                    <div className="rounded-2xl border border-gray-200 p-3 space-y-2.5">
                        {/* Coordinates and Clear pin share the header line — both
                            are about the pin, and giving Clear pin a row of its
                            own cost more height than the control is worth. */}
                        <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                                Standort
                                <Hint label="Einen Ort finden">
                                    Das Suchfeld nimmt einen Namen (&bdquo;Tukad Cepung Wasserfall&ldquo;),
                                    einen direkt eingefügten Google-Maps-Link oder reine &bdquo;Breite, Länge&ldquo;-
                                    Zahlen. Ein Rechtsklick auf einen Pin in Google Maps kopiert diese Zahlen – die
                                    zuverlässigste Möglichkeit für alles, was die Suche nicht findet.
                                </Hint>
                            </label>
                            {lat != null && lng != null ? (
                                <span className="flex items-center gap-2">
                                    <span className="text-[11px] text-gray-400 tabular-nums">
                                        {lat.toFixed(5)}, {lng.toFixed(5)}
                                    </span>
                                    <button
                                        onClick={() => { setLat(null); setLng(null); }}
                                        className="text-[11px] text-gray-400 hover:text-rose-600"
                                    >
                                        Pin entfernen
                                    </button>
                                </span>
                            ) : (
                                <span className="text-[11px] text-amber-600">Ohne Pin</span>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <TextField
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(query); } }}
                                onPaste={(e) => {
                                    const text = e.clipboardData.getData('text');
                                    if (!text) return;
                                    e.preventDefault();
                                    autoLookup(text);
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                    // Dragging a link from the browser gives text/uri-list;
                                    // dragging selected text gives text/plain.
                                    const text = e.dataTransfer.getData('text/uri-list')
                                        || e.dataTransfer.getData('text');
                                    if (!text) return;
                                    e.preventDefault();
                                    autoLookup(text.trim());
                                }}
                                placeholder="Name suchen oder Google-Maps-Link einfügen/hierher ziehen"
                            />
                            <Button onClick={() => lookup(query)} disabled={searching || !query.trim()}>
                                {searching ? '…' : 'Suchen'}
                            </Button>
                        </div>

                        {lookupError && <p className="text-xs text-amber-700">{lookupError}</p>}

                        {hits.length > 0 && (
                            <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-100 overflow-hidden">
                                {hits.map((hit, i) => (
                                    <li key={`${hit.lat},${hit.lng},${i}`}>
                                        <button
                                            onClick={() => applyHit(hit)}
                                            className="w-full text-left px-3 py-2 hover:bg-gray-50 transition"
                                        >
                                            <div className="text-sm text-gray-800 line-clamp-2">{hit.label}</div>
                                            <div className="text-[11px] text-gray-400 tabular-nums">
                                                {hit.lat.toFixed(5)}, {hit.lng.toFixed(5)}
                                                {hit.source === 'photon' && (
                                                    <span className="text-amber-700">
                                                        {' '}· ungenauer Treffer, bitte prüfen
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {/* Confirming a pin you can't see is a coin flip, so the map
                            appears as soon as there is a coordinate to show. */}
                        {lat != null && lng != null && (
                            <>
                                <PinMap
                                    lat={lat}
                                    lng={lng}
                                    category={category}
                                    onChange={(nextLat, nextLng) => {
                                        setLat(nextLat);
                                        setLng(nextLng);
                                        // Placing the pin by hand IS the confirmation.
                                        setNeedsReview(false);
                                    }}
                                />
                                <p className="text-[11px] text-gray-400">
                                    Zieh den Pin oder klick auf die Karte, um ihn zu verschieben.
                                </p>
                            </>
                        )}

                        {needsReview && lat != null ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl
                                bg-amber-50 px-3 py-2">
                                <span className="text-xs text-amber-800">
                                    Automatisch platziert – prüfe die Karte oben, bevor du dich darauf verlässt.
                                </span>
                                <Button onClick={() => setNeedsReview(false)}>Stimmt</Button>
                            </div>
                        ) : needsReview ? (
                            <div className="rounded-2xl bg-amber-50 px-3 py-2">
                                <span className="text-xs text-amber-800">
                                    Noch kein Pin – such oben oder füge einen Google-Maps-Link ein.
                                </span>
                            </div>
                        ) : null}

                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Notizen</label>
                            <TextArea
                                rows={3}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Lichtstrahlen zwischen 9 und 11 Uhr."
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Adresse</label>
                            <TextField value={address} onChange={(e) => setAddress(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-1 @sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Quelle</label>
                                <TextField
                                    list="honeymoon-sources"
                                    value={source}
                                    onChange={(e) => setSource(e.target.value)}
                                    placeholder="Wer hat das vorgeschlagen?"
                                />
                                <datalist id="honeymoon-sources">
                                    {sourcesOf(api.data?.places ?? []).map((s) => (
                                        <option key={s} value={s} />
                                    ))}
                                </datalist>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Preishinweis</label>
                                <TextField
                                    value={priceNote}
                                    onChange={(e) => setPriceNote(e.target.value)}
                                    placeholder="ca. 500.000 IDR Eintritt"
                                />
                            </div>
                        </div>

                        {/* ---- The numbers the budget can add up ---- */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-500">
                                    Kosten ({costCurrency})
                                    <Hint label="Wie die Kosten verwendet werden">
                                        Der eine Preis für diesen Ort. Eine Buchung multipliziert ihn mit den
                                        Nächten, statt ihn erneut abzufragen. Der Preishinweis hält
                                        die Details fest; &bdquo;Frühstück inklusive&ldquo; ist keine Rechnung.
                                    </Hint>
                                </label>
                                <TextField
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.01"
                                    value={cost}
                                    onChange={(e) => setCost(e.target.value)}
                                    placeholder="420"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">
                                    Pro
                                </label>
                                <SelectField
                                    value={costPer}
                                    onChange={(e) => setCostPer(
                                        e.target.value as 'night' | 'person' | 'total',
                                    )}
                                >
                                    <option value="total">Gesamt</option>
                                    <option value="night">Pro Nacht</option>
                                    <option value="person">Pro Person</option>
                                </SelectField>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-gray-500">
                                    Öffnungszeiten
                                    <Hint label="Zu den Öffnungszeiten">
                                        OSM-Schreibweise, z. B. Mo-Su 09:00-18:00 – wird aus der Kartensuche
                                        übernommen, wenn sie die Zeiten kennt. Der Reiseplan warnt, wenn ein Stopp
                                        außerhalb davon liegt.
                                    </Hint>
                                </label>
                                <TextField
                                    value={openingHours}
                                    onChange={(e) => setOpeningHours(e.target.value)}
                                    placeholder="Mo-Su 09:00-18:00"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">
                                    Beste Reisezeit
                                </label>
                                <TextField
                                    value={bestTime}
                                    onChange={(e) => setBestTime(e.target.value)}
                                    placeholder="Sonnenaufgang · Wochenenden meiden"
                                />
                            </div>
                        </div>

                        {/* ---- Booking ----
                            Only for a place that exists: a booking hangs off a
                            place_id, and there isn't one until the first save.

                            Not gated on the status any more. A stay's check-in
                            and check-out are what put it on the itinerary, and
                            they were reachable only after flipping the status
                            dropdown — so the day card could say "add the dates
                            on Stays" and the Stays tab show nowhere to add them.
                            Excursions were never gated; now nothing is. */}
                        {editing && (
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">
                                    Buchung
                                </label>
                                <BookingPanel
                                    api={api}
                                    kind={bookingKindFor(place)}
                                    placeId={place.id}
                                    compact
                                />
                            </div>
                        )}

                        {/* ---- Links ---- */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Links</label>
                            <div className="space-y-2">
                                {links.map((link, i) => (
                                    <div key={i} className="flex gap-2">
                                        <TextField
                                            value={link.label}
                                            placeholder="Website"
                                            className="max-w-[8rem]"
                                            onChange={(e) => setLinks(links.map((l, j) =>
                                                j === i ? { ...l, label: e.target.value } : l))}
                                        />
                                        <TextField
                                            value={link.url}
                                            placeholder="https://…"
                                            onChange={(e) => setLinks(links.map((l, j) =>
                                                j === i ? { ...l, url: e.target.value } : l))}
                                        />
                                        <Button
                                            tone="ghost"
                                            onClick={() => setLinks(links.filter((_, j) => j !== i))}
                                        >
                                            ✕
                                        </Button>
                                    </div>
                                ))}
                                <Button onClick={() => setLinks([...links, { label: '', url: '' }])}>
                                    + Link hinzufügen
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                <ManageListModal
                    open={managing === 'categories'}
                    onClose={() => setManaging(null)}
                    title="Kategorien bearbeiten"
                    hint="Beim Umbenennen bleiben alle zugeordneten Orte erhalten. Beim Löschen wandern sie zu Sonstiges. Farbe und Emoji werden auf der Karte gezeichnet."
                    items={(api.data?.categories ?? []).map((c) => {
                        const used = (api.data?.places ?? [])
                            .filter((p) => p.category === c.key).length;
                        return {
                            id: c.id,
                            // Label only — what you edit is exactly what is stored.
                            label: c.label,
                            color: c.color,
                            icon: c.icon,
                            detail: used ? `${used} ${used === 1 ? 'Ort' : 'Orte'}` : 'ungenutzt',
                            warn: used
                                ? `„${c.label}“ löschen? ${used} ${used === 1 ? 'Ort wandert' : 'Orte wandern'} zu Sonstiges.`
                                : `„${c.label}“ löschen?`,
                            locked: c.key === 'misc'
                                ? 'Sonstiges ist die Ausweichkategorie'
                                : undefined,
                        };
                    })}
                    onRename={(id, label) => api.update('categories', { id, label })}
                    onRestyle={(id, fields) => api.update('categories', { id, ...fields })}
                    onDelete={(id) => api.remove('categories', id)}
                />

                <ManageListModal
                    open={managing === 'regions'}
                    onClose={() => setManaging(null)}
                    title="Regionen bearbeiten"
                    hint="Beim Umbenennen bleiben alle Orte darin erhalten. Beim Löschen bleiben die Orte bestehen, verlieren aber ihre Region."
                    items={(api.data?.regions ?? []).map((r) => {
                        const used = (api.data?.places ?? [])
                            .filter((p) => p.region_id === r.id).length;
                        return {
                            id: r.id,
                            label: r.name,
                            detail: used ? `${used} ${used === 1 ? 'Ort' : 'Orte'}` : 'ungenutzt',
                            warn: used
                                ? `„${r.name}“ löschen? ${used} ${used === 1 ? 'Ort bleibt' : 'Orte bleiben'}, ${used === 1 ? 'verliert' : 'verlieren'} aber ${used === 1 ? 'seine' : 'ihre'} Region.`
                                : `„${r.name}“ löschen?`,
                        };
                    })}
                    onRename={(id, name) => api.update('regions', { id, name })}
                    onDelete={(id) => api.remove('regions', id)}
                />

                <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                    <Button onClick={() => { if (confirmDiscard()) onCancel(); }}>Abbrechen</Button>
                    <Button tone="primary" onClick={save} disabled={!name.trim()}>
                        {editing ? 'Speichern' : 'Ort hinzufügen'}
                    </Button>
                </div>
            </div>
    );
}
