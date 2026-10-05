'use client';

import { useState, useMemo } from 'react';
import { GuestListEntry, SeatingTableData } from './types';
import { partySeatingState, rsvpLabel, sideLabel } from '@/lib/seating';

interface GuestSidebarProps {
  guests: GuestListEntry[];
  /** The plan, so the list can tell who of a party still has no chair. */
  tables: SeatingTableData[];
  onDragGuest: (guest: GuestListEntry) => void;
  onAssignGuest: (guestId: number, tableId: number, seatIndex: number) => void;
  splitPartyGuestIds: Set<number>;
}

export default function GuestSidebar({
  guests,
  tables,
  onDragGuest,
  splitPartyGuestIds,
}: GuestSidebarProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'unassigned' | 'all'>('unassigned');
  const [showFilters, setShowFilters] = useState(false);

  // Filter state
  const [filterSide, setFilterSide] = useState<string>('all');
  const [filterRsvp, setFilterRsvp] = useState<string>('all');
  const [filterInvited, setFilterInvited] = useState<string>('all');
  const [filterPartySize, setFilterPartySize] = useState<string>('all');

  // Who of each party still has no chair. A household used to leave this list
  // the moment its *guest* was seated, which left anyone else in the party with
  // no way onto the chart at all — the only route was to unseat the whole party
  // and drop it again.
  const seatingByGuest = useMemo(
    () => new Map(guests.map(g => [g.id, partySeatingState(g, tables)])),
    [guests, tables],
  );
  const waiting = (guest: GuestListEntry) => seatingByGuest.get(guest.id)?.unseated ?? [];

  // Collect unique rsvp statuses
  const rsvpStatuses = useMemo(() => {
    const set = new Set<string>();
    guests.forEach(g => { if (g.rsvp_status) set.add(g.rsvp_status); });
    return Array.from(set).sort();
  }, [guests]);

  const activeFilterCount = [
    filterSide !== 'all',
    filterRsvp !== 'all',
    filterInvited !== 'all',
    filterPartySize !== 'all',
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    let list = guests;
    if (tab === 'unassigned') list = list.filter(g => (seatingByGuest.get(g.id)?.unseated.length ?? 0) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      // Everyone in the party, not just whoever the invitation is addressed to —
      // searching for the person you are about to seat is the whole point.
      list = list.filter(g => {
        const state = seatingByGuest.get(g.id);
        const names = [
          g.guest_name,
          g.plus_one_name ?? '',
          ...(state ? [...state.seated, ...state.unseated].map(p => p.name) : []),
        ];
        return names.some(name => name.toLowerCase().includes(q));
      });
    }
    if (filterSide !== 'all') list = list.filter(g => (g.side ?? 'unspecified') === filterSide);
    if (filterRsvp !== 'all') {
      if (filterRsvp === 'none') list = list.filter(g => !g.rsvp_status);
      else list = list.filter(g => g.rsvp_status === filterRsvp);
    }
    if (filterInvited !== 'all') list = list.filter(g => String(g.invited) === filterInvited);
    if (filterPartySize !== 'all') {
      if (filterPartySize === '1') list = list.filter(g => g.party_size === 1);
      else if (filterPartySize === '2') list = list.filter(g => g.party_size === 2);
      else if (filterPartySize === '3+') list = list.filter(g => g.party_size >= 3);
    }
    return list;
  }, [guests, seatingByGuest, tab, search, filterSide, filterRsvp, filterInvited, filterPartySize]);

  // People, not households: half a party still standing is what you are here to
  // fix, and a household that is "assigned" can still have three of them.
  const unassignedCount = guests.reduce(
    (n, g) => n + (seatingByGuest.get(g.id)?.unseated.length ?? 0), 0,
  );
  const totalCount = guests.length;

  const clearFilters = () => {
    setFilterSide('all');
    setFilterRsvp('all');
    setFilterInvited('all');
    setFilterPartySize('all');
  };

  // On a phone: a drawer over the canvas, below the 48px toolbar so the toggle
  // that opened it stays tappable. From `md` up: the usual 288px column, in flow.
  return (
    <div className="absolute inset-x-0 top-12 bottom-0 z-20 md:static md:inset-auto md:z-auto w-full md:w-72 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800">Guests</h2>
          <div className="flex gap-1.5 text-xs">
            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {unassignedCount} ohne Platz
            </span>
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
              {totalCount} gesamt
            </span>
          </div>
        </div>

        {/* Search + filter toggle */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-colors"
              placeholder="Gäste suchen …"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`relative px-2.5 py-1.5 rounded-md border text-sm transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'bg-indigo-50 border-indigo-300 text-indigo-600'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
            title="Filter"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Filter</span>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-indigo-500 hover:underline">
                  Alle zurücksetzen
                </button>
              )}
            </div>

            {/* Side */}
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Seite</label>
              <select
                className="mt-0.5 w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none"
                value={filterSide}
                onChange={e => setFilterSide(e.target.value)}
              >
                <option value="all">Alle Seiten</option>
                <option value="bride">Braut</option>
                <option value="groom">Bräutigam</option>
                <option value="unspecified">Ohne Angabe</option>
              </select>
            </div>

            {/* RSVP Status */}
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Rückmeldung</label>
              <select
                className="mt-0.5 w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none"
                value={filterRsvp}
                onChange={e => setFilterRsvp(e.target.value)}
              >
                <option value="all">Alle Status</option>
                <option value="none">Keine Antwort</option>
                {rsvpStatuses.map(s => (
                  <option key={s} value={s}>{rsvpLabel(s)}</option>
                ))}
              </select>
            </div>

            {/* Invited */}
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Eingeladen</label>
              <select
                className="mt-0.5 w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none"
                value={filterInvited}
                onChange={e => setFilterInvited(e.target.value)}
              >
                <option value="all">Alle</option>
                <option value="true">Eingeladen</option>
                <option value="false">Nicht eingeladen</option>
              </select>
            </div>

            {/* Party Size */}
            <div>
              <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Personenzahl</label>
              <select
                className="mt-0.5 w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white outline-none"
                value={filterPartySize}
                onChange={e => setFilterPartySize(e.target.value)}
              >
                <option value="all">Beliebige Größe</option>
                <option value="1">Einzeln (1)</option>
                <option value="2">Paar (2)</option>
                <option value="3+">Gruppe (3+)</option>
              </select>
            </div>
          </div>
        )}

        {/* Tab toggle */}
        <div className="flex mt-3 bg-gray-100 rounded-md p-0.5">
          <button
            className={`flex-1 text-xs py-1 rounded transition-colors font-medium ${
              tab === 'unassigned' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('unassigned')}
          >
            Ohne Platz
          </button>
          <button
            className={`flex-1 text-xs py-1 rounded transition-colors font-medium ${
              tab === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab('all')}
          >
            Alle
          </button>
        </div>
      </div>

      {/* Guest list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 text-xs py-8">
            {search || activeFilterCount > 0 ? 'Keine passenden Gäste.' : 'Keine Gäste vorhanden.'}
          </div>
        )}

        {filtered.map(guest => {
          const isSplit = splitPartyGuestIds.has(guest.id);
          const isAssigned = !!guest.assigned_seat;
          const stillWaiting = waiting(guest);
          // Some of the party sitting down and some not: the household itself is
          // no longer a thing to drag — that would seat the seated ones twice —
          // so each person still standing becomes their own.
          const partlySeated = stillWaiting.length > 0
            && (seatingByGuest.get(guest.id)?.seated.length ?? 0) > 0;
          const isLikely = guest.rsvp_status === 'likely_not_coming';
          const isDeclined = guest.rsvp_status === 'declined';
          // Colour follows the answer, not the seat: coming green, declined red,
          // likely-not-coming orange, and white only while nobody has answered.
          const isComing = !!guest.rsvp_status && !isDeclined && !isLikely;

          return (
            <div
              key={guest.id}
              draggable={!partlySeated}
              onDragStart={e => {
                if (partlySeated) return;
                e.dataTransfer.setData('guestId', String(guest.id));
                onDragGuest(guest);
              }}
              className={`group flex flex-col gap-0.5 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none
                ${isDeclined
                  ? 'bg-red-50 border-red-200 hover:border-red-300'
                  : isLikely
                    ? 'bg-orange-50 border-orange-200 hover:border-orange-300'
                    : isComing
                      ? 'bg-green-50 border-green-200 hover:border-green-300'
                      : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <svg className="text-gray-300 group-hover:text-gray-400 shrink-0 transition-colors" width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                    <circle cx="3" cy="2" r="1.5" /><circle cx="3" cy="7" r="1.5" /><circle cx="3" cy="12" r="1.5" />
                    <circle cx="7" cy="2" r="1.5" /><circle cx="7" cy="7" r="1.5" /><circle cx="7" cy="12" r="1.5" />
                  </svg>
                  <span className={`text-sm font-medium truncate ${isDeclined ? 'text-red-700' : isLikely ? 'text-orange-700' : 'text-gray-800'}`}>{guest.guest_name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {guest.side && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${
                      guest.side === 'bride' ? 'bg-pink-50 text-pink-600 border-pink-200' : 'bg-blue-50 text-blue-600 border-blue-200'
                    }`}>{sideLabel(guest.side)}</span>
                  )}
                  {guest.party_size > 1 && (
                    <span className={`text-xs border rounded-full px-1.5 py-0.5 font-medium ${
                      isDeclined ? 'bg-red-100 text-red-600 border-red-200' : isLikely ? 'bg-orange-100 text-orange-600 border-orange-200' : 'bg-blue-50 text-blue-600 border-blue-200'
                    }`}>
                      {guest.party_size}
                    </span>
                  )}
                  {isSplit && (
                    <span title="Gruppe sitzt an verschiedenen Tischen" className="text-yellow-500 text-sm">⚠</span>
                  )}
                </div>
              </div>

              {/* Who else the party is, named exactly as the chart will seat
                  them — `plus_one_name` on its own said "+1 Jessica" beside a
                  chair reading "Jessica Bigari", which is the guest list
                  disagreeing with itself. A plus-one recorded against a party of
                  one is a leftover and appears here no more than it is seated.
                  Once some of them are sitting down the summary gives way to the
                  list below, which you can actually act on. */}
              {!partlySeated && stillWaiting.length > 1 && (
                <div className={`text-xs pl-4 truncate ${isDeclined ? 'text-red-400' : isLikely ? 'text-orange-400' : 'text-gray-500'}`}>
                  +{stillWaiting.slice(1).map(p => p.name).join(', ')}
                </div>
              )}

              {partlySeated && (
                <div className="mt-1 flex flex-col gap-1">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 pl-4">
                    Noch ohne Platz
                  </div>
                  {stillWaiting.map(person => (
                    <div
                      key={person.index}
                      draggable
                      onDragStart={e => {
                        e.stopPropagation();
                        e.dataTransfer.setData(
                          'partyPerson',
                          JSON.stringify({ partyGroupId: guest.id, index: person.index }),
                        );
                      }}
                      className="ml-4 flex items-center gap-1.5 px-2 py-1 rounded-md border border-dashed border-amber-300 bg-amber-50/70 text-xs text-amber-900 cursor-grab active:cursor-grabbing hover:border-amber-400 hover:bg-amber-50"
                      title="Auf einen Tisch ziehen, um nur diese Person zu platzieren"
                    >
                      <svg className="text-amber-400 shrink-0" width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                        <circle cx="3" cy="2" r="1.5" /><circle cx="3" cy="7" r="1.5" /><circle cx="3" cy="12" r="1.5" />
                        <circle cx="7" cy="2" r="1.5" /><circle cx="7" cy="7" r="1.5" /><circle cx="7" cy="12" r="1.5" />
                      </svg>
                      <span className="truncate">{person.name}</span>
                    </div>
                  ))}
                </div>
              )}

              {isLikely && (
                <div className="text-[10px] text-orange-500 pl-4 font-medium">Kommt wohl nicht</div>
              )}

              {isDeclined && (
                <div className="text-[10px] text-red-500 pl-4 font-medium">Absage</div>
              )}

              {isAssigned && guest.assigned_seat && (
                <div className={`text-xs pl-4 truncate ${isDeclined ? 'text-red-500' : isLikely ? 'text-orange-500' : 'text-green-600'}`}>
                  {guest.assigned_seat.table_name}, Platz {guest.assigned_seat.seat_index + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
