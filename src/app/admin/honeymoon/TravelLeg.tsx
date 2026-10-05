'use client';

import {
    TRAVEL_MODES, formatDate, formatDayDate, legArrivalDay, legEnds, legIsOvernight,
    travelModeMeta,
    type Day, type TravelLeg, type TravelMode,
} from '@/lib/honeymoon';
import { journeysOf } from '@/lib/honeymoonJourneys';
import { addDaysIso } from '@/lib/honeymoonTimeline';
import LegFields from './LegFields';
import { useTimeFormat } from './kit/useTimeFormat';
import type { HoneymoonApi } from './useHoneymoon';
import { OverflowMenu, SelectField } from './ui';

/**
 * One travel leg, as it appears on an itinerary day card.
 *
 * The Travel tab owns the *journey* — a whole ticket, its legs, its layovers and
 * its one booking reference (see `JourneyCard`). This is the other place a leg
 * shows up: inside the day it leaves on, where the useful thing is a compact
 * summary plus the same editor, so noticing a wrong time while reading the day
 * does not mean going to another tab to fix it.
 *
 * It used to carry a "Booking details" panel which itself contained a
 * "+ Booking details" button opening a second panel — three levels for one
 * ticket. The ticket now lives once, on its journey.
 */
export default function TravelLegCard({ leg, day, api }: {
    leg: TravelLeg;
    /** The day the leg leaves on — its dates and number come from here. */
    day: Day;
    api: HoneymoonApi;
}) {
    const fmt = useTimeFormat();
    const startDate = api.data?.trip.start_date ?? null;
    const realDate = formatDayDate(startDate, day.day_number);
    const meta = travelModeMeta(leg.mode);

    /*
     * The date this leg is drawn under, when it is not the leg's own date.
     *
     * Null in every ordinary case: the payload files a dated leg onto the day
     * whose date matches, so the two agree by construction.
     */
    const misdated = leg.depart_date && startDate
        && leg.depart_date !== addDaysIso(startDate, day.day_number - 1)
        ? formatDate(leg.depart_date)
        : null;

    /* The journey this leg belongs to, so the card can say so. */
    const group = api.data
        ? journeysOf(api.data).find((entry) => entry.legs.some((row) => row.id === leg.id))
        : undefined;
    const sibling = group ? group.legs.length - 1 : 0;

    return (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-2.5">
            <div className="flex items-center gap-2">
                <span className="text-base leading-none" aria-hidden>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900">
                        {[leg.from_text, leg.to_text].filter(Boolean).join(' → ')
                            || `${meta.label} – wohin geht es?`}
                        {leg.flight_no && (
                            <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[10px]
                                font-semibold text-gray-600">
                                {leg.flight_no}
                            </span>
                        )}
                    </p>
                    <p className="text-[11px] text-gray-500 tabular-nums">
                        {leg.depart_time ? fmt(leg.depart_time) : '—'}
                        {' → '}
                        {leg.arrive_time ? fmt(leg.arrive_time) : '—'}
                        {legIsOvernight(leg) && ` · Landung an Tag ${legArrivalDay(leg, day.day_number)}`}
                        {sibling > 0 && ` · ${sibling} weitere ${sibling === 1 ? 'Teilstrecke' : 'Teilstrecken'} auf diesem Ticket`}
                    </p>
                </div>
                {legIsOvernight(leg) && (
                    <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px]
                        font-semibold text-white">
                        +{leg.arrive_day_offset}d
                    </span>
                )}
                <OverflowMenu items={[
                    ...(day.travel.length > 1 ? [
                        {
                            label: 'Früher am Tag',
                            onClick: () => {
                                const ids = day.travel.map((row) => row.id);
                                const at = ids.indexOf(leg.id);
                                if (at <= 0) return;
                                ids.splice(at - 1, 0, ids.splice(at, 1)[0]);
                                api.reorder('travel', ids);
                            },
                        },
                        {
                            label: 'Später am Tag',
                            onClick: () => {
                                const ids = day.travel.map((row) => row.id);
                                const at = ids.indexOf(leg.id);
                                if (at < 0 || at === ids.length - 1) return;
                                ids.splice(at + 1, 0, ids.splice(at, 1)[0]);
                                api.reorder('travel', ids);
                            },
                        },
                        {
                            label: 'Tag nach Abfahrtszeit sortieren',
                            onClick: () => api.reorder('travel', [...day.travel]
                                .sort((a, b) => (a.depart_time ?? '~')
                                    .localeCompare(b.depart_time ?? '~'))
                                .map((row) => row.id)),
                        },
                    ] : []),
                    {
                        label: 'Teilstrecke entfernen',
                        danger: true,
                        onClick: () => api.removeRow('travel', leg, 'Teilstrecke entfernt'),
                    },
                ]} />
            </div>

            {/* A dated leg is filed on the day its date names, on every read — so
                the only way it can be drawn on a day with a different date is
                that the trip has no day for its date at all (the range was
                shortened, or days were deleted under it). Saying so here is the
                difference between a wrong date you can see and one you cannot:
                without it the card reads as though the flight leaves today. */}
            {misdated && (
                <p className="mt-2 rounded-xl bg-rose-50 border border-rose-200 px-2.5 py-1.5
                    text-[11px] text-rose-800">
                    Diese Teilstrecke startet am {misdated}, und die Reise hat keinen Tag für dieses
                    Datum – deshalb liegt sie vorerst hier. Passe das Datum im Tab „Verbindungen“ an
                    oder füge die fehlenden Tage hinzu.
                </p>
            )}

            {legIsOvernight(leg) && (
                <p className="mt-2 rounded-xl bg-slate-100 px-2.5 py-1.5 text-[11px] text-slate-700">
                    {meta.icon} Abfahrt an Tag {day.day_number}
                    {leg.depart_time ? ` um ${fmt(leg.depart_time)}` : ''}
                    {realDate ? ` (${realDate})` : ''}, Ankunft an Tag{' '}
                    {legArrivalDay(leg, day.day_number)}
                    {leg.arrive_time ? ` um ${fmt(leg.arrive_time)}` : ''}
                    {formatDayDate(startDate, legArrivalDay(leg, day.day_number))
                        ? ` (${formatDayDate(startDate, legArrivalDay(leg, day.day_number))})`
                        : ''}.
                </p>
            )}

            {/* Both ends found: say so once, on the leg, rather than twice on the
                fields. */}
            {legEnds(leg) && (
                <p className="mt-1 text-[11px] text-sky-700">
                    {meta.icon} Auf der Karte eingezeichnet – dort 🗓 Reiseplan einschalten, um sie zu sehen.
                </p>
            )}

            <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-medium text-slate-600">
                    Teilstrecke bearbeiten
                </summary>
                <div className="mt-2 border-t border-slate-200 pt-2">
                    {group && <LegFields api={api} leg={leg} group={group} />}
                </div>
            </details>
        </div>
    );
}

export type { TravelMode };
export { TRAVEL_MODES, SelectField };
