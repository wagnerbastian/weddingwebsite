'use client';

import { useMemo, useState } from 'react';
import {
    TRAVEL_MODES, formatDate, todayIso, travelModeMeta,
    type TravelMode,
} from '@/lib/honeymoon';
import {
    dayForDate, formatMinutes, journeysOf, parseFlightPaste, placementFor,
    type JourneyGroup,
} from '@/lib/honeymoonJourneys';
import JourneyCard from './JourneyCard';
import type { HoneymoonApi } from './useHoneymoon';
import { Button, Card, EmptyState, MiniSelect, TextArea } from './ui';
import { Hint } from './kit/Hint';
import { Sheet } from './kit/Sheet';
import { TabToolbar } from './kit/TabToolbar';

/**
 * Every journey of the trip.
 *
 * The old tab was a flat list of *legs*, each asking which trip day it belonged
 * to. That is backwards twice over: a ticket is one thing with several legs, and
 * which day a leg falls on is arithmetic the confirmation email has already
 * done. So this is journeys, ordered by when you travel them, with the day
 * placement derived from the dates.
 *
 * Three ways to fill one in, in the order they are quick:
 *   1. Paste the flight numbers and dates — every leg looked up and filled in.
 *   2. Start a journey and add legs by hand.
 *   3. Both: paste what you have, correct what is wrong.
 */
export default function TravelTab({ api }: { api: HoneymoonApi }) {
    const { data } = api;
    const groups = useMemo(() => (data ? journeysOf(data) : []), [data]);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');

    const trip = data?.trip;
    const days = data?.days ?? [];

    /* ---- Starting a journey ---- */
    const [mode, setMode] = useState<TravelMode>('flight');

    /**
     * Make a journey and give it its first leg.
     *
     * A journey with no legs is a valid intermediate state — the card handles it
     * — but "New journey" is nearly always followed by "add the first leg", so
     * it does both.
     */
    const newJourney = async () => {
        setBusy(true);
        setNote('');
        try {
            const journey = await api.createRow('journeys', {
                kind: mode,
                title: '',
                sort_order: groups.length,
            });
            if (journey?.id == null) return;
            await addLegTo(journey.id, null);
            await api.refresh();
        } finally {
            setBusy(false);
        }
    };

    /**
     * Append a leg to a journey, prefilled from the one before it.
     *
     * A connection leaves from where the last one landed, on the day it landed —
     * which is true often enough to be the right default and is the tedious part
     * of entering a multi-leg ticket by hand.
     */
    const addLegTo = async (journeyId: number, previous: JourneyGroup | null) => {
        const last = previous?.legs[previous.legs.length - 1] ?? null;
        const departDate = last?.arrive_date ?? last?.depart_date ?? trip?.start_date ?? null;
        const placement = trip && departDate
            ? placementFor({ depart_date: departDate, arrive_date: departDate }, days, trip)
            : null;

        await api.create('travel', {
            // A leg still belongs to a day; it is just no longer chosen by hand.
            day_id: placement?.day_id ?? days[0]?.id ?? null,
            journey_id: journeyId,
            mode: last?.mode ?? previous?.mode ?? mode,
            from_text: last?.to_text ?? '',
            from_lat: last?.to_lat ?? null,
            from_lng: last?.to_lng ?? null,
            depart_tz: last?.arrive_tz ?? '',
            depart_date: departDate ?? '',
            arrive_date: departDate ?? '',
            arrive_day_offset: placement?.arrive_day_offset ?? 0,
            sort_order: previous ? previous.legs.length : 0,
        });
    };

    /**
     * Turn a leg that belongs to no journey into one.
     *
     * Nothing was migrated when journeys arrived — an old leg is a journey of
     * one — so this is how such a leg gains a second hop.
     */
    const promoteToJourney = async (group: JourneyGroup) => {
        const leg = group.legs[0];
        if (!leg) return;
        setBusy(true);
        try {
            const journey = await api.createRow('journeys', {
                kind: leg.mode,
                title: '',
                sort_order: groups.length,
            });
            if (journey?.id == null) return;
            await api.update('travel', { id: leg.id, journey_id: journey.id });
            await addLegTo(journey.id, { ...group, legs: [leg] });
            await api.refresh();
        } finally {
            setBusy(false);
        }
    };

    const onAddLeg = async (group: JourneyGroup) => {
        if (!group.journey) { await promoteToJourney(group); return; }
        setBusy(true);
        try {
            await addLegTo(group.journey.id, group);
            await api.refresh();
        } finally {
            setBusy(false);
        }
    };

    /* ---- Building a journey from pasted flight numbers ---- */
    const [paste, setPaste] = useState('');
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasting, setPasting] = useState(false);
    const [pasteNote, setPasteNote] = useState('');

    /**
     * "SQ 27 2026-09-12, SQ 938 2026-09-14" → a journey with two legs, filled in.
     *
     * This is the feature the flight lookup was always for: the fastest correct
     * way to enter a ticket is to type what is printed on it and let the schedule
     * supply the rest. One line or one comma per leg; a date can be omitted and
     * the previous leg's is used.
     *
     * Paced deliberately: the lookup's free plan allows one request a second, and
     * the route itself may make two, so legs are done one at a time with a wait
     * between. Slower than firing them all at once, and it works.
     */
    const buildFromPaste = async () => {
        const entries = parseFlightPaste(paste, trip?.start_date);

        if (!entries.length) {
            setPasteNote(
                'Das sieht weder nach einer Flugnummer noch nach einem Datum aus. Versuch es mit '
                + '„SQ938 2026-09-14, SQ27 2026-09-12".',
            );
            return;
        }

        setPasting(true);
        setPasteNote(`${entries.length} ${entries.length === 1 ? 'Flug wird' : 'Flüge werden'} abgefragt …`);
        try {
            const journey = await api.createRow('journeys', {
                kind: 'flight',
                title: '',
                sort_order: groups.length,
            });
            if (journey?.id == null) { setPasteNote('Die Verbindung konnte nicht angelegt werden.'); return; }

            let previousDate = trip?.start_date ?? todayIso();
            const built: string[] = [];
            const failed: string[] = [];
            const blank: string[] = [];

            for (const [index, entry] of entries.entries()) {
                const date = entry.date ?? previousDate;
                let flight: Record<string, unknown> | null = null;
                // Nothing to look up without a number — the leg is still made,
                // on the date the line gave, for the times to be typed in.
                if (entry.number) {
                    try {
                        const res = await fetch(
                            `/api/admin/honeymoon/flight?no=${encodeURIComponent(entry.number)}`
                            + `&date=${date}`,
                        );
                        const body = await res.json();
                        flight = body?.flight ?? null;
                        if (!body?.configured) {
                            setPasteNote(
                                'Für die Flugabfrage fehlt FLIGHT_API_KEY im Stack. Die Teilstrecken wurden '
                                + 'trotzdem angelegt – trag die Zeiten von Hand ein oder hinterlege den Schlüssel und nutze '
                                + '„Aus Flugplan ausfüllen".',
                            );
                        }
                    } catch { /* handled below */ }
                }

                const departDate = (flight?.from_date as string | undefined) ?? date;
                const arriveDate = flight?.arrive_day_offset != null
                    ? new Date(Date.parse(`${departDate}T00:00:00Z`)
                        + Number(flight.arrive_day_offset) * 86_400_000)
                        .toISOString().slice(0, 10)
                    : departDate;
                const placement = trip
                    ? placementFor({ depart_date: departDate, arrive_date: arriveDate }, days, trip)
                    : null;

                await api.create('travel', {
                    day_id: placement?.day_id ?? days[0]?.id ?? null,
                    journey_id: journey.id,
                    mode: 'flight',
                    flight_no: (flight?.flight_no as string | undefined) ?? entry.number ?? '',
                    from_text: (flight?.from_text as string | undefined) ?? '',
                    to_text: (flight?.to_text as string | undefined) ?? '',
                    depart_time: (flight?.depart_time as string | undefined) ?? '',
                    arrive_time: (flight?.arrive_time as string | undefined) ?? '',
                    depart_tz: (flight?.depart_tz as string | undefined) ?? '',
                    arrive_tz: (flight?.arrive_tz as string | undefined) ?? '',
                    from_terminal: (flight?.from_terminal as string | undefined) ?? '',
                    to_terminal: (flight?.to_terminal as string | undefined) ?? '',
                    aircraft: (flight?.aircraft as string | undefined) ?? '',
                    // A line we could not read a number out of keeps its text,
                    // so the empty leg still says which one it came from.
                    notes: entry.number ? '' : entry.raw,
                    depart_date: departDate,
                    arrive_date: arriveDate,
                    arrive_day_offset: placement?.arrive_day_offset ?? 0,
                    sort_order: index,
                });

                if (!entry.number) blank.push(entry.raw);
                else if (flight) built.push(entry.number);
                else failed.push(entry.number);
                previousDate = arriveDate;

                // The plan's rate limit, plus the route's own retry headroom.
                if (entry.number && index < entries.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1400));
                }
            }

            await api.refresh();
            setPaste('');
            setPasteNote([
                built.length ? `Ausgefüllt: ${built.join(', ')}.` : '',
                failed.length
                    ? `Kein Flugplan gefunden für ${failed.join(', ')} – die Teilstrecken sind angelegt, aber leer.`
                    : '',
                blank.length
                    ? `${blank.length} ${blank.length === 1 ? 'Zeile hatte' : 'Zeilen hatten'} keine Flugnummer `
                        + '– diese Teilstrecken liegen an ihrem Datum und warten auf den Rest.'
                    : '',
            ].filter(Boolean).join(' ') || 'Teilstrecken angelegt.');
        } finally {
            setPasting(false);
        }
    };

    /* ---- Trip-wide summary ---- */
    const summary = useMemo(() => {
        const moving = groups.reduce(
            (total, group) => total + (group.movingMinutes ?? 0), 0,
        );
        const problems = groups.reduce((total, group) => total + group.problems.length, 0);
        return { journeys: groups.length, moving, problems };
    }, [groups]);

    if (!days.length) {
        return (
            <Card>
                <EmptyState
                    title="Noch keine Tage zum Reisen"
                    hint="Eine Verbindung liegt auf einem Tag, deshalb braucht die Reise mindestens einen. Lege die Daten in den Einstellungen fest, dann werden die Tage für dich angelegt."
                />
            </Card>
        );
    }

    return (
        <div className="max-w-4xl space-y-3">
            <TabToolbar
                left={summary.journeys > 0 ? (
                    <p className="text-xs text-gray-500">
                        {summary.journeys} {summary.journeys === 1 ? 'Verbindung' : 'Verbindungen'}
                        {summary.moving > 0 && ` · ${formatMinutes(summary.moving)} unterwegs`}
                        {summary.problems > 0 && (
                            <span className="text-amber-700">
                                {' '}· {summary.problems} {summary.problems === 1 ? 'Punkt' : 'Punkte'} zu prüfen
                            </span>
                        )}
                    </p>
                ) : undefined}
                right={(
                    <>
                        <MiniSelect
                            value={mode}
                            aria-label="Art der Verbindung"
                            onChange={(e) => setMode(e.target.value as TravelMode)}
                        >
                            {TRAVEL_MODES.map((entry) => (
                                <option key={entry.key} value={entry.key}>{entry.icon} {entry.label}</option>
                            ))}
                        </MiniSelect>
                        <Button tone="primary" onClick={newJourney} disabled={busy}>
                            {busy ? 'Einen Moment …' : '+ Neue Verbindung'}
                        </Button>
                        <Button onClick={() => setPasteOpen(true)}>Flüge einfügen …</Button>
                    </>
                )}
                below={note ? <p className="text-[11px] text-gray-600">{note}</p> : undefined}
            />

            <Sheet
                open={pasteOpen}
                onClose={() => setPasteOpen(false)}
                side="center"
                title={<h2 className="font-semibold text-gray-900">Flugnummern aus der Bestätigung einfügen</h2>}
            >
                <div className="space-y-2">
                    <label className="mb-1 block text-xs font-semibold text-gray-500">
                        Oder die Flugnummern aus deiner Bestätigung einfügen
                    </label>
                    <TextArea
                        rows={2}
                        value={paste}
                        placeholder={'SQ 27 2026-09-12\nSQ 938 2026-09-14'}
                        onChange={(e) => setPaste(e.target.value)}
                        className="font-mono text-[11px]"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button onClick={buildFromPaste} disabled={!paste.trim() || pasting}>
                            {pasting ? 'Wird angelegt …' : 'Verbindung anlegen'}
                        </Button>
                        <Hint label="So funktioniert das Einfügen von Flügen">
                            Einer pro Zeile – der Rest der Zeile darf stehen bleiben, Daten in
                            beliebiger Schreibweise. Jeder Flug wird abgefragt und ausgefüllt –
                            Zeiten, Terminals, Flugzeug, Zeitzonen – und auf den richtigen Tag
                            gelegt. Was sich nicht abfragen lässt, wird trotzdem eine
                            Teilstrecke zum Ausfüllen von Hand.
                        </Hint>
                    </div>
                    {pasteNote && (
                        <p className="mt-1.5 text-[11px] text-sky-800">{pasteNote}</p>
                    )}
                </div>
            </Sheet>

            {/* ---- The journeys ---- */}
            {groups.length === 0 ? (
                <Card>
                    <EmptyState
                        title="Noch keine Verbindungen eingetragen"
                        hint="Fang mit dem Flug an, der euch hinbringt. Trag das ganze Ticket ein – jede Teilstrecke, beide Zeiten, die Umstiege – und jede Teilstrecke landet von selbst auf dem richtigen Tag."
                    />
                </Card>
            ) : (
                <div className="space-y-3">
                    {groups.map((group) => (
                        <div key={group.key}>
                            {/* Where this journey sits in the trip, said once
                                above the card rather than per leg. */}
                            {group.departDate && trip?.start_date && (
                                <p className="mb-1 px-1 text-[11px] text-gray-400">
                                    {formatDate(group.departDate)}
                                    {(() => {
                                        const placed = dayForDate(
                                            days, trip.start_date, group.departDate,
                                        );
                                        return placed.dayNumber != null
                                            ? ` · Tag ${placed.dayNumber}${placed.beyond ? ' (noch nicht geplant)' : ''}`
                                            : '';
                                    })()}
                                    {group.legs.length > 1
                                        && ` · ${group.legs.length} Teilstrecken`}
                                    {` · ${travelModeMeta(group.mode).label}`}
                                </p>
                            )}
                            <JourneyCard api={api} group={group} onAddLeg={onAddLeg} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
