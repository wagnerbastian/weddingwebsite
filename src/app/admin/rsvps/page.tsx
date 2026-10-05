'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FundItem, SiteConfig } from '@/lib/config';
import AddressReconcileModal from '@/components/admin/AddressReconcileModal';
import { MAILING_HEADERS, mailingRows, toCsv } from '@/lib/mailing';
import { SaveStatus, useAutosave } from '@/components/admin/useAutosave';
import {
    alignEntries, dietCodes, entriesToStore, isEmptyEntry, signature,
    type DietCode, type DietaryEntry,
} from '@/lib/dietary';
import { cleanName } from '@/lib/names';
import DietaryPills from '@/components/admin/DietaryPills';
import Under21Pill from '@/components/admin/Under21Pill';
import VendorsTab from './VendorsTab';

// Guest-table columns to drop as horizontal space runs out, in order (first dropped → last).
// Name + Party/Invited/RSVP/Actions are never in this list, so they always stay.
const GUEST_COL_HIDE_ORDER = ['contact', 'notes', 'address', 'donated', 'relation', 'select'];
// Use layout effect on the client (avoids a flash) but fall back to useEffect during SSR.
const useIsoEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;



interface RSVP {
    id: number;
    guest_name: string;
    plus_one_name?: string;
    email: string;
    phone: string;
    attending: boolean;
    number_of_guests: number;
    dietary_restrictions: DietaryEntry[] | string | null;
    message: string;
    created_at: string;
}

interface PartyMember {
    name: string | null;
    // The person's own RSVP answer. null = not answered. The seating chart reads
    // this, so an edit here must never drop it.
    attending?: boolean | null;
    // Too young to drink. Nothing to do with their plate — they eat the adult
    // meal; it keeps them out of the bar charge on the budget.
    under21?: boolean | null;
}

interface Guest {
    id: number;
    guest_name: string;
    email: string;
    phone: string;
    party_size: number;
    side?: string;
    notes: string;
    invited: boolean;
    rsvp_status?: string;
    party_members?: PartyMember[];
    plus_one_name?: string | null;
    under_21?: boolean | null;
    address?: string;
    flag?: string | null;
    relationship?: string;
    /** 'guest' for everyone invited; 'couple' for the two getting married. */
    kind?: string | null;
    created_at: string;
}

/**
 * Is this row an actual guest?
 *
 * Rows written before the `kind` column exists carry null, and those are all
 * guests — so the absence of an answer means guest, never "unknown".
 */
function isGuestRow(guest: { kind?: string | null }): boolean {
    return (guest.kind ?? 'guest') === 'guest';
}

/** The row for the two people getting married, if it has been created yet. */
function coupleRow<T extends { kind?: string | null }>(guests: T[]): T | undefined {
    return guests.find(g => g.kind === 'couple');
}

interface Donation {
    id: number;
    guest_id: number | null;
    guest_name: string;
    amount: number;
    gift?: string | null;
    fund_item_id: string | null;
    fund_item_title: string | null;
    event: string | null;
    created_at: string;
    thank_you_sent?: boolean;
    thank_you_sent_at?: string | null;
    co_donors?: { id: number | null; name: string }[];
}

type Tab = 'rsvps' | 'guestlist' | 'vendors' | 'donations';
type GuestFilter = 'all' | 'no_response' | 'attending' | 'declined' | 'likely_not_coming' | 'invited' | 'not_invited' | 'bride' | 'groom' | 'noted' | 'issue' | 'need' | 'kids_meal';

/** Donation events are stored under their English names; these are what the page shows. */
const EVENT_LABELS: Record<string, string> = {
    'Bridal Shower': 'Junggesellinnenabschied',
    'Engagement Party': 'Verlobungsfeier',
    'Wedding Day': 'Hochzeitstag',
    'Other': 'Sonstiges',
};

export default function RSVPDashboard() {
    const [activeTab, setActiveTab] = useState<Tab>('rsvps');
    const [guestFilter, setGuestFilter] = useState<GuestFilter>('all');
    const [guestSearch, setGuestSearch] = useState('');
    const [rsvps, setRsvps] = useState<RSVP[]>([]);
    const [guests, setGuests] = useState<Guest[]>([]);
    const [donations, setDonations] = useState<Donation[]>([]);
    const [showDonationModal, setShowDonationModal] = useState(false);
    const [donationDonorSearch, setDonationDonorSearch] = useState('');
    const [donationDonor, setDonationDonor] = useState<{ id: number; guest_name: string } | null>(null);
    const [donationAmount, setDonationAmount] = useState('');
    const [donationGift, setDonationGift] = useState('');
    const [donationFundId, setDonationFundId] = useState('');
    const [selectedDonations, setSelectedDonations] = useState<number[]>([]);
    const [markingThanks, setMarkingThanks] = useState(false);
    const [donationEvent, setDonationEvent] = useState('Wedding Day');
    const [donationOtherEvent, setDonationOtherEvent] = useState('');
    const [savingDonation, setSavingDonation] = useState(false);
    const [coGivers, setCoGivers] = useState<{ id: number | null; name: string }[]>([]);
    const [coGiverSearch, setCoGiverSearch] = useState('');
    const [editingDonationId, setEditingDonationId] = useState<number | null>(null);
    const [origDonation, setOrigDonation] = useState<{ amount: number; fund_item_id: string | null } | null>(null);
    const [deletingDonation, setDeletingDonation] = useState<Donation | null>(null);
    const [loading, setLoading] = useState(true);
    const [deletingRsvp, setDeletingRsvp] = useState<RSVP | null>(null);
    const [confirmName, setConfirmName] = useState('');
    const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
    const [isAddingGuest, setIsAddingGuest] = useState(false);
    const [selectedGuests, setSelectedGuests] = useState<number[]>([]);
    // Feedback for the type-a-name-then-Enter rapid check-off flow.
    const guestSearchRef = useRef<HTMLInputElement | null>(null);
    const [quickPick, setQuickPick] = useState<{ text: string; ok: boolean } | null>(null);
    const [config, setConfig] = useState<Partial<SiteConfig> | null>(null);
    const [addingCouple, setAddingCouple] = useState(false);
    const [rsvpSubtitle, setRsvpSubtitle] = useState('');
    const [subtitleLoaded, setSubtitleLoaded] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    // Bulk edit of the selected guests. Every field defaults to '' = leave unchanged,
    // with an explicit "Clear" option where clearing makes sense.
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [showBulkMenu, setShowBulkMenu] = useState(false);
    const bulkMenuRef = useRef<HTMLDivElement | null>(null);
    const [bulkFlag, setBulkFlag] = useState('');
    const [bulkSide, setBulkSide] = useState('');
    const [bulkRsvp, setBulkRsvp] = useState('');
    const [bulkNote, setBulkNote] = useState('');
    const [bulkNoteMode, setBulkNoteMode] = useState<'append' | 'replace' | 'clear'>('append');
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkResult, setBulkResult] = useState<string | null>(null);
    const [showReconcileModal, setShowReconcileModal] = useState(false);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [importing, setImporting] = useState(false);
    const [importResults, setImportResults] = useState<{ added: number; updated: number; failed: number; errors: string[] } | null>(null);
    const [guestForm, setGuestForm] = useState({
        guest_name: '',
        email: '',
        phone: '',
        party_size: 1,
        side: '',
        notes: '',
        invited: false,
        party_members: [] as PartyMember[],
        rsvp_status: '',
        address: '',
        flag: '',
        relationship: '',
        under_21: false,
        dietary: [] as DietaryEntry[],
    });

    // --- Responsive guest table: measure real widths and drop the lowest-priority
    // column the instant it no longer fits at full width (before headers can collide).
    const guestTableWrapRef = useRef<HTMLDivElement | null>(null);
    const [hiddenGuestCols, setHiddenGuestCols] = useState<string[]>([]);

    /*
     * Column widths for the RSVP table, in pixels, for as long as this page is open.
     *
     * Deliberately not remembered anywhere. Widening the message column is a
     * "let me read that one" move, not a preference, and a width that outlived
     * the question would be a setting nobody asked for — so a refresh puts the
     * table back to the layout it works out for itself.
     *
     * Null until the first grab, which freezes what the browser had already
     * worked out for *every* column: otherwise dragging one re-flows the rest.
     */
    const [rsvpColWidths, setRsvpColWidths] = useState<Record<string, number> | null>(null);
    const rsvpHeadRef = useRef<HTMLTableRowElement>(null);
    const colDrag = useRef<{ key: string; x: number; width: number } | null>(null);

    useEffect(() => {
        fetchRsvps();
        fetchGuests();
        fetchConfig();
        fetchDonations();
        const params = new URLSearchParams(window.location.search);
        const tab = params.get('tab');
        if (tab === 'donations' || tab === 'guestlist' || tab === 'rsvps' || tab === 'vendors') {
            setActiveTab(tab as Tab);
        }
    }, []);

    // Close the bulk overflow menu on an outside click or Escape. Also closes when
    // the selection empties, since the trigger unmounts with the rest of the bar.
    useEffect(() => {
        if (!showBulkMenu) return;
        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (!bulkMenuRef.current?.contains(e.target as Node)) setShowBulkMenu(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setShowBulkMenu(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [showBulkMenu]);

    useEffect(() => {
        if (selectedGuests.length === 0) setShowBulkMenu(false);
    }, [selectedGuests.length]);

    useIsoEffect(() => {
        const wrap = guestTableWrapRef.current;
        if (!wrap) return;
        const NAME_TARGET = 200; // width reserved for Name so it shrinks last
        const MARGIN = 16;       // breathing room so columns pop before touching
        let raf = 0;
        let lastW = -1;

        // Border-box width, so a scrollbar appearing/disappearing can't feed back into
        // another hide/show cycle (clientWidth would shrink and cause oscillation).
        const availWidth = () => wrap.getBoundingClientRect().width;

        const measure = () => {
            const table = wrap.querySelector('table');
            if (!table) return;
            const container = availWidth();
            // Measure natural column widths on an off-screen clone with every column shown.
            const clone = table.cloneNode(true) as HTMLTableElement;
            clone.querySelectorAll('[data-col]').forEach((el) => (el as HTMLElement).classList.remove('hidden'));
            clone.querySelectorAll('[data-col="name"]').forEach((el) => {
                const s = (el as HTMLElement).style;
                s.width = `${NAME_TARGET}px`; s.minWidth = `${NAME_TARGET}px`; s.maxWidth = `${NAME_TARGET}px`;
            });
            const cs = clone.style;
            cs.tableLayout = 'auto'; cs.width = 'auto'; cs.maxWidth = 'none';
            cs.position = 'absolute'; cs.left = '-99999px'; cs.top = '0'; cs.visibility = 'hidden';
            document.body.appendChild(clone);
            const widths: Record<string, number> = {};
            clone.querySelectorAll('thead th[data-col]').forEach((th) => {
                widths[(th as HTMLElement).dataset.col as string] = Math.ceil((th as HTMLElement).getBoundingClientRect().width);
            });
            document.body.removeChild(clone);

            let total = Object.values(widths).reduce((a, b) => a + b, 0);
            const hide: string[] = [];
            for (const col of GUEST_COL_HIDE_ORDER) {
                if (total + MARGIN <= container) break;
                if (widths[col] != null) { total -= widths[col]; hide.push(col); }
            }
            setHiddenGuestCols((prev) =>
                prev.length === hide.length && prev.every((c) => hide.includes(c)) ? prev : hide
            );
        };

        const schedule = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const w = availWidth();
                if (w === lastW) return;
                lastW = w;
                measure();
            });
        };

        // Initial measure (force, ignoring the width guard).
        measure();
        lastW = availWidth();
        const ro = new ResizeObserver(schedule);
        ro.observe(wrap);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
        // activeTab matters: the table only exists on the guestlist tab, so without it
        // the effect would early-return on mount (null ref) and never re-run on tab switch.
    }, [activeTab, guests, guestFilter, guestSearch]);

    const saveSubtitle = useCallback(async (value: string) => {
        const res = await fetch('/api/admin/site-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rsvpSubtitle: value }),
        });
        if (!res.ok) throw new Error(String(res.status));
    }, []);

    const { state: subtitleState, retry: retrySubtitle } =
        useAutosave({ value: rsvpSubtitle, ready: subtitleLoaded, save: saveSubtitle });

    const fetchConfig = async () => {
        try {
            const response = await fetch('/api/admin/site-config');
            const data = await response.json();
            setConfig(data);
            if (data.rsvpSubtitle) setRsvpSubtitle(data.rsvpSubtitle);
            setSubtitleLoaded(true);
        } catch (error) {
            console.error('Error fetching config:', error);
        }
    };

    const fetchRsvps = () => {
        fetch('/api/admin/rsvps')
            .then(res => res.json())
            .then(data => {
                setRsvps(data.rsvps || []);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    };

    const fetchGuests = async () => {
        try {
            const response = await fetch('/api/admin/guest-list');
            const data = await response.json();
            setGuests(data);
        } catch (error) {
            console.error('Error fetching guests:', error);
        }
    };

    const fetchDonations = async () => {
        try {
            const response = await fetch('/api/admin/donations');
            const data = await response.json();
            setDonations(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching donations:', error);
        }
    };

    const resetDonationModal = () => {
        setShowDonationModal(false);
        setDonationDonorSearch('');
        setDonationDonor(null);
        setDonationAmount('');
        setDonationGift('');
        setDonationFundId('');
        setDonationEvent('Wedding Day');
        setDonationOtherEvent('');
        setCoGivers([]);
        setCoGiverSearch('');
        setEditingDonationId(null);
        setOrigDonation(null);
    };

    const addCoGiver = (person: { id: number | null; name: string }) => {
        const name = person.name.trim();
        if (!name) return;
        if (coGivers.some(c => c.name.toLowerCase() === name.toLowerCase())) { setCoGiverSearch(''); return; }
        setCoGivers([...coGivers, { id: person.id, name }]);
        setCoGiverSearch('');
    };
    const removeCoGiver = (name: string) => setCoGivers(coGivers.filter(c => c.name !== name));

    const openEditDonation = (d: Donation) => {
        setEditingDonationId(d.id);
        setOrigDonation({ amount: d.amount, fund_item_id: d.fund_item_id });
        setDonationDonor(d.guest_id != null ? { id: d.guest_id, guest_name: d.guest_name } : { id: 0, guest_name: d.guest_name });
        setDonationAmount(d.amount ? String(d.amount) : '');
        setDonationGift(d.gift || '');
        setDonationFundId(d.fund_item_id || '');
        const presets = ['Bridal Shower', 'Engagement Party', 'Wedding Day'];
        if (d.event && presets.includes(d.event)) { setDonationEvent(d.event); setDonationOtherEvent(''); }
        else { setDonationEvent('Other'); setDonationOtherEvent(d.event || ''); }
        setCoGivers(Array.isArray(d.co_donors) ? d.co_donors : []);
        setCoGiverSearch('');
        setShowDonationModal(true);
    };

    const saveDonation = async () => {
        // A donation can be money, a physical gift, or both — but not nothing.
        const amount = donationAmount.trim() ? parseFloat(donationAmount) : 0;
        const gift = donationGift.trim();
        if (!donationDonor || isNaN(amount) || amount < 0) return;
        if (!amount && !gift) return;
        // A fund only matters for money — a gift-only entry needs no fund.
        if (amount && !donationFundId) return;
        const funds: FundItem[] = config?.registry?.items || [];
        const fund = amount ? funds.find(f => f.id === donationFundId) : null;
        if (amount && !fund) return;
        const eventValue = donationEvent === 'Other' ? (donationOtherEvent.trim() || 'Other') : donationEvent;
        setSavingDonation(true);
        try {
            // Build per-fund delta map (edit reverses the original first)
            const delta: Record<string, number> = {};
            if (editingDonationId && origDonation?.fund_item_id) {
                delta[origDonation.fund_item_id] = (delta[origDonation.fund_item_id] || 0) - origDonation.amount;
            }
            if (fund) delta[fund.id] = (delta[fund.id] || 0) + amount;
            await applyFundDeltas(delta);
            // Write the donation row
            const body = {
                guest_id: donationDonor.id || null,
                guest_name: donationDonor.guest_name,
                amount,
                gift: gift || null,
                fund_item_id: fund?.id ?? null,
                fund_item_title: fund?.title ?? null,
                event: eventValue,
                co_donors: coGivers,
            };
            if (editingDonationId) {
                await fetch('/api/admin/donations', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...body, id: editingDonationId }),
                });
            } else {
                await fetch('/api/admin/donations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            }
            await fetchDonations();
            await fetchConfig();
            resetDonationModal();
        } catch (e) {
            console.error('Failed to save donation:', e);
        } finally {
            setSavingDonation(false);
        }
    };

    // Fetch fresh config, apply per-fund funded deltas clamped to [0, price], POST it back.
    const applyFundDeltas = async (delta: Record<string, number>) => {
        const configRes = await fetch('/api/admin/site-config');
        const freshConfig = await configRes.json();
        const items: FundItem[] = (freshConfig.registry?.items || []).map((i: FundItem) => {
            const d = delta[i.id];
            if (!d) return i;
            return { ...i, funded: Math.max(0, Math.min(i.price, i.funded + d)) };
        });
        // Only the registry key: posting the whole config back would overwrite
        // anything another admin tab saved in the meantime.
        await fetch('/api/admin/site-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registry: { ...(freshConfig.registry || {}), items } }),
        });
    };

    const toggleDonationSelection = (id: number) => {
        setSelectedDonations(prev =>
            prev.includes(id) ? prev.filter(dId => dId !== id) : [...prev, id]
        );
    };

    const toggleSelectAllDonations = () => {
        if (donations.length > 0 && selectedDonations.length === donations.length) {
            setSelectedDonations([]);
        } else {
            setSelectedDonations(donations.map(d => d.id));
        }
    };

    const setThankYouSent = async (sent: boolean) => {
        if (selectedDonations.length === 0) return;
        setMarkingThanks(true);
        try {
            await fetch('/api/admin/donations', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: selectedDonations, thank_you_sent: sent }),
            });
            await fetchDonations();
            setSelectedDonations([]);
        } catch (e) {
            console.error('Failed to update thank-you status:', e);
        } finally {
            setMarkingThanks(false);
        }
    };

    const confirmDeleteDonation = async () => {
        if (!deletingDonation) return;
        setSavingDonation(true);
        try {
            if (deletingDonation.fund_item_id) {
                await applyFundDeltas({ [deletingDonation.fund_item_id]: -deletingDonation.amount });
            }
            await fetch('/api/admin/donations', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deletingDonation.id }),
            });
            setSelectedDonations(prev => prev.filter(id => id !== deletingDonation.id));
            await fetchDonations();
            await fetchConfig();
            setDeletingDonation(null);
        } catch (e) {
            console.error('Failed to delete donation:', e);
        } finally {
            setSavingDonation(false);
        }
    };

    const handleDeleteRsvp = async () => {
        if (!deletingRsvp) return;

        try {
            const response = await fetch('/api/admin/rsvps', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deletingRsvp.id }),
            });

            if (response.ok) {
                setDeletingRsvp(null);
                setConfirmName('');
                fetchRsvps();
            }
        } catch (error) {
            console.error('Failed to delete RSVP:', error);
        }
    };

    const handleSaveGuest = async () => {
        try {
            const url = '/api/admin/guest-list';
            const method = editingGuest ? 'PUT' : 'POST';
            const body = editingGuest
                ? { ...guestForm, id: editingGuest.id }
                : guestForm;

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                // The guest list holds the people; their restrictions live on the
                // RSVP, which is the only place anything reads them from.
                await saveDietary();
                setEditingGuest(null);
                setIsAddingGuest(false);
                setGuestForm({
                    guest_name: '',
                    email: '',
                    phone: '',
                    party_size: 1,
                    side: '',
                    notes: '',
                    invited: false,
                    party_members: [],
                    rsvp_status: '',
                    address: '',
                    flag: '',
                    relationship: '',
                    under_21: false,
                    dietary: [],
                });
                fetchGuests();
            }
        } catch (error) {
            console.error('Error saving guest:', error);
        }
    };

    const handleDeleteGuest = async (id: number) => {
        if (!confirm('Diesen Gast wirklich löschen?')) return;

        try {
            const response = await fetch('/api/admin/guest-list', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });

            if (response.ok) {
                fetchGuests();
            }
        } catch (error) {
            console.error('Error deleting guest:', error);
        }
    };

    /** The household's most recent RSVP, matched the way everything else does. */
    const rsvpFor = (name: string): RSVP | undefined => {
        const wanted = cleanName(name).toLowerCase();
        return rsvps.find(r => cleanName(r.guest_name).toLowerCase() === wanted);
    };

    /** Its dietary answers — the column also holds pre-JSONB free text. */
    const dietaryOf = (rsvp: RSVP | undefined): DietaryEntry[] =>
        (Array.isArray(rsvp?.dietary_restrictions) ? rsvp.dietary_restrictions : []);

    /**
     * Store the household's restrictions on its RSVP.
     *
     * Skipped when nothing changed, and — when the household has no RSVP at all —
     * when there is nothing to record either, so opening a guest and saving them
     * never conjures an RSVP out of an empty form.
     */
    const saveDietary = async () => {
        const rows = [
            { entry: guestForm.dietary[0] ?? {}, name: guestForm.guest_name, attending: null as boolean | null },
            ...guestForm.party_members.map((member, i) => ({
                entry: guestForm.dietary[i + 1] ?? {},
                name: member.name ?? '',
                attending: member.attending ?? null,
            })),
        ];
        const entries = entriesToStore(rows);
        const existing = rsvpFor(guestForm.guest_name);
        if (!existing && signature(entries) === signature([])) return;
        if (signature(entries) === signature(dietaryOf(existing))) return;

        await fetch('/api/admin/rsvps', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guest_name: guestForm.guest_name, dietary_restrictions: entries }),
        });
        fetchRsvps();
    };

    const openEditGuest = (guest: Guest) => {
        setEditingGuest(guest);
        // Build party_members slots to match party_size - 1
        const existing = guest.party_members || [];
        const slots: PartyMember[] = Array.from({ length: Math.max(0, guest.party_size - 1) }, (_, i) => ({
            name: existing[i]?.name ?? null,
            attending: existing[i]?.attending ?? null,
            under21: existing[i]?.under21 ?? false,
        }));
        setGuestForm({
            guest_name: guest.guest_name,
            email: guest.email || '',
            phone: guest.phone || '',
            party_size: guest.party_size,
            side: guest.side || '',
            notes: guest.notes || '',
            invited: guest.invited,
            party_members: slots,
            rsvp_status: guest.rsvp_status || '',
            address: guest.address || '',
            flag: guest.flag || '',
            relationship: guest.relationship || '',
            under_21: !!guest.under_21,
            // One row per person, in the order the editor draws them, whether or
            // not the RSVP has an answer for that person.
            dietary: alignEntries(
                [guest.guest_name, ...slots.map(m => m.name ?? '')],
                dietaryOf(rsvpFor(guest.guest_name)),
            ),
        });
    };

    const handleMarkLikelyNotComing = async (guest: Guest) => {
        const newStatus = guest.rsvp_status === 'likely_not_coming' ? '' : 'likely_not_coming';
        try {
            await fetch('/api/admin/guest-list', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...guest, rsvp_status: newStatus }),
            });
            fetchGuests();
        } catch (error) {
            console.error('Error updating guest status:', error);
        }
    };

    const toggleGuestSelection = (id: number) => {
        setBulkResult(null);
        setSelectedGuests(prev =>
            prev.includes(id) ? prev.filter(gId => gId !== id) : [...prev, id]
        );
    };

    // Select-all works on the *visible* rows only. The header checkbox already
    // reflected filteredGuests, so selecting every guest in the table (including
    // ones the filter hides) would silently widen a bulk edit or delete.
    const toggleSelectAll = () => {
        setBulkResult(null);
        const visibleIds = filteredGuests.map(g => g.id);
        const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedGuests.includes(id));
        setSelectedGuests(prev =>
            allVisibleSelected
                ? prev.filter(id => !visibleIds.includes(id))
                : Array.from(new Set([...prev, ...visibleIds]))
        );
    };

    const handleBulkMarkInvited = async () => {
        if (selectedGuests.length === 0) return;

        try {
            await Promise.all(
                selectedGuests.map(id =>
                    fetch('/api/admin/guest-list', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id,
                            ...guests.find(g => g.id === id),
                            invited: true,
                        }),
                    })
                )
            );
            setSelectedGuests([]);
            fetchGuests();
        } catch (error) {
            console.error('Error marking guests as invited:', error);
        }
    };

    const handleBulkUnmarkInvited = async () => {
        if (selectedGuests.length === 0) return;
        if (!confirm(`${selectedGuests.length} ${selectedGuests.length === 1 ? 'Gast' : 'Gäste'} als „Nicht eingeladen“ markieren?`)) return;

        try {
            await Promise.all(
                selectedGuests.map(id =>
                    fetch('/api/admin/guest-list', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id,
                            ...guests.find(g => g.id === id),
                            invited: false,
                        }),
                    })
                )
            );
            setSelectedGuests([]);
            fetchGuests();
        } catch (error) {
            console.error('Error unmarking guests as invited:', error);
        }
    };

    // Shared bulk-field update. Only the keys passed in are touched server-side.
    const patchSelectedGuests = async (fields: Record<string, unknown>) => {
        if (selectedGuests.length === 0) return 0;
        const res = await fetch('/api/admin/guest-list', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedGuests, ...fields }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Aktualisierung fehlgeschlagen');
        const data = await res.json();
        return data.updated ?? selectedGuests.length;
    };

    // One-click flag for the whole selection. Clicking the flag the selection already
    // has clears it, matching the per-row 🙁 toggle.
    const handleBulkFlag = async (flag: 'issue' | 'need') => {
        if (selectedGuests.length === 0) return;
        const chosen = guests.filter(g => selectedGuests.includes(g.id));
        const allHaveIt = chosen.length > 0 && chosen.every(g => g.flag === flag);
        try {
            const n = await patchSelectedGuests({ flag: allHaveIt ? '' : flag });
            const label = flag === 'issue' ? '⚠️ Problem' : '📌 Nachfassen';
            setBulkResult(allHaveIt ? `${label} bei ${n} ${n === 1 ? 'Gast' : 'Gäste'} entfernt` : `${n} ${n === 1 ? 'Gast' : 'Gäste'} als ${label} markiert`);
            fetchGuests();
        } catch (error) {
            console.error('Error flagging guests:', error);
            setBulkResult('Die ausgewählten Gäste konnten nicht aktualisiert werden');
        }
    };

    const openBulkModal = () => {
        setBulkFlag('');
        setBulkSide('');
        setBulkRsvp('');
        setBulkNote('');
        setBulkNoteMode('append');
        setBulkResult(null);
        setShowBulkModal(true);
    };

    const handleBulkEdit = async () => {
        if (selectedGuests.length === 0) return;
        const fields: Record<string, unknown> = {};
        if (bulkFlag) fields.flag = bulkFlag === 'clear' ? '' : bulkFlag;
        if (bulkSide) fields.side = bulkSide === 'clear' ? '' : bulkSide;
        if (bulkRsvp) fields.rsvp_status = bulkRsvp === 'clear' ? '' : bulkRsvp;
        if (bulkNoteMode === 'clear') {
            fields.noteMode = 'clear';
        } else if (bulkNote.trim()) {
            fields.noteMode = bulkNoteMode;
            fields.notes = bulkNote;
        }
        if (Object.keys(fields).length === 0) {
            setBulkResult('Nichts zu ändern – wähle zuerst ein Feld');
            return;
        }

        setBulkSaving(true);
        try {
            const n = await patchSelectedGuests(fields);
            setShowBulkModal(false);
            setSelectedGuests([]);
            setBulkResult(`${n} ${n === 1 ? 'Gast' : 'Gäste'} aktualisiert`);
            fetchGuests();
        } catch (error) {
            console.error('Error bulk editing guests:', error);
            setBulkResult(error instanceof Error ? error.message : 'Die ausgewählten Gäste konnten nicht aktualisiert werden');
        } finally {
            setBulkSaving(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedGuests.length === 0) return;
        if (!confirm(`${selectedGuests.length} ${selectedGuests.length === 1 ? 'Gast' : 'Gäste'} wirklich löschen?`)) return;

        try {
            await Promise.all(
                selectedGuests.map(id =>
                    fetch('/api/admin/guest-list', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id }),
                    })
                )
            );
            setSelectedGuests([]);
            fetchGuests();
        } catch (error) {
            console.error('Error deleting guests:', error);
        }
    };

    const handleImportCSV = async () => {
        if (!csvFile) return;

        setImporting(true);
        setImportResults(null);

        try {
            const text = await csvFile.text();
            const lines = text.split('\n').filter(line => line.trim());

            if (lines.length === 0) {
                alert('Die CSV-Datei ist leer');
                setImporting(false);
                return;
            }

            // Parse CSV
            // Parse a CSV line respecting quoted fields (handles commas inside addresses etc.)
            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current = '';
                let inQuotes = false;
                for (let ci = 0; ci < line.length; ci++) {
                    const ch = line[ci];
                    if (ch === '"') {
                        if (inQuotes && line[ci + 1] === '"') { current += '"'; ci++; }
                        else inQuotes = !inQuotes;
                    } else if (ch === ',' && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += ch;
                    }
                }
                result.push(current.trim());
                return result;
            };

            const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
            const results = { added: 0, updated: 0, failed: 0, errors: [] as string[] };

            for (let i = 1; i < lines.length; i++) {
                const values = parseCSVLine(lines[i]);

                if (values.length === 0 || !values[0]) continue;

                const guestData: Record<string, string> = {};
                headers.forEach((header, index) => {
                    guestData[header] = values[index] || '';
                });

                // Map CSV columns to guest fields
                const guest = {
                    guest_name: guestData.name || guestData.guest_name || '',
                    email: guestData.email || '',
                    phone: guestData.phone || '',
                    party_size: parseInt(guestData.party_size) || 1,
                    side: guestData.side || '',
                    notes: guestData.notes || '',
                    invited: guestData.invited === 'true' || guestData.invited === '1',
                    plus_one_name: guestData.plus_one_name || '',
                    address: guestData.address || '',
                    upsert: true,
                };

                if (!guest.guest_name) {
                    results.errors.push(`Zeile ${i + 1}: Gastname fehlt`);
                    results.failed++;
                    continue;
                }

                try {
                    const response = await fetch('/api/admin/guest-list', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(guest),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        if (data.inserted === false) {
                            results.updated++;
                        } else {
                            results.added++;
                        }
                    } else {
                        results.failed++;
                        results.errors.push(`Zeile ${i + 1}: ${guest.guest_name} – Import fehlgeschlagen`);
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push(`Zeile ${i + 1}: ${guest.guest_name} – ${error}`);
                }
            }

            setImportResults(results);
            fetchGuests();
        } catch (error) {
            alert('Fehler beim Lesen der CSV-Datei: ' + error);
        } finally {
            setImporting(false);
        }
    };

    if (loading) return <div className="p-8">Wird geladen …</div>;

    // The couple's card writes their dietary answers the way every card does —
    // onto an RSVP — so giving the bride a nut allergy creates an RSVP row in
    // their name. It is storage, not a reply: this tab counts and lists the
    // replies, so it leaves that row out. Their restrictions are still read from
    // it by name, which is why it is filtered here rather than never fetched.
    const coupleNames = new Set(
        guests.filter(g => !isGuestRow(g)).map(g => cleanName(g.guest_name).toLowerCase()),
    );
    const guestRsvps = rsvps.filter(r => !coupleNames.has(cleanName(r.guest_name).toLowerCase()));

    const totalGuests = guestRsvps.reduce((acc, curr) => acc + (curr.attending ? curr.number_of_guests : 0), 0);
    // A declined RSVP is stored with number_of_guests = 0, so count the household
    // from the guest list (falling back to 1 when the name isn't on it).
    const partySizeByName = new Map(guests.map(g => [g.guest_name.trim().toLowerCase(), g.party_size || 1]));
    const totalDeclinedGuests = guestRsvps
        .filter(r => !r.attending)
        .reduce((acc, curr) => acc + (partySizeByName.get(curr.guest_name.trim().toLowerCase()) ?? 1), 0);
    // Every statistic counts guests and only guests. The couple are on this list
    // so they can be seated and fed, but they were not invited to their own
    // wedding and will never RSVP to it — counting them would put "Total
    // Invited" two over, and that is a number that ends up in a contract.
    const guestRows = guests.filter(isGuestRow);
    const totalInvited = guestRows.filter(g => g.invited).reduce((acc, curr) => acc + curr.party_size, 0);
    const totalNotInvited = guestRows.filter(g => !g.invited).reduce((acc, curr) => acc + curr.party_size, 0);
    const likelyNotComingCount = guestRows.filter(g => g.rsvp_status === 'likely_not_coming').reduce((acc, curr) => acc + curr.party_size, 0);
    const totalGuestListSize = guestRows.filter(g => g.rsvp_status !== 'likely_not_coming' && g.rsvp_status !== 'declined').reduce((acc, curr) => acc + curr.party_size, 0);
    const missingRsvps = guestRows.filter(g => g.invited && !g.rsvp_status).reduce((acc, curr) => acc + curr.party_size, 0);

    /**
     * Does anyone on this invitation carry this dietary answer?
     *
     * The answers live on the household's RSVP, not on the guest row, so this
     * is a lookup by name rather than a column — and it is the household that
     * matches, because the row is the household: a family of four with one
     * child on a kids' meal is one row you want to see.
     *
     * Read through `dietCodes()` rather than off the boolean, so an entry that
     * also says "not eating" is not counted — that answer overrides the rest.
     */
    const householdHas = (guest: Guest, code: DietCode): boolean =>
        dietaryOf(rsvpFor(guest.guest_name)).some(entry => dietCodes(entry).includes(code));

    const filteredGuests = guests.filter(g => {
        const memberNames = (g.party_members || []).map(m => m.name || '').join(' ');
        const matchesSearch = !guestSearch || g.guest_name.toLowerCase().includes(guestSearch.toLowerCase()) || memberNames.toLowerCase().includes(guestSearch.toLowerCase());
        if (!matchesSearch) return false;
        switch (guestFilter) {
            case 'kids_meal': return householdHas(g, 'KID');
            case 'no_response': return g.invited && !g.rsvp_status;
            case 'attending': return g.rsvp_status === 'attending';
            case 'declined': return g.rsvp_status === 'declined';
            case 'likely_not_coming': return g.rsvp_status === 'likely_not_coming';
            case 'invited': return g.invited;
            case 'not_invited': return !g.invited;
            case 'bride': return g.side === 'bride';
            case 'groom': return g.side === 'groom';
            case 'noted': return !!(g.notes && g.notes.trim());
            case 'issue': return g.flag === 'issue';
            case 'need': return g.flag === 'need';
            default: return true;
        }
    })
        // The couple first, wherever the alphabet would otherwise put them —
        // they are the one row on this page that is looked for rather than
        // scrolled past.
        .sort((a, b) => Number(isGuestRow(a)) - Number(isGuestRow(b)));

    /**
     * Put the two people getting married on the guest list.
     *
     * One row, not two: the app already represents two people on one invitation
     * as a household with a party member, which is what makes both of them
     * draggable on the seating chart and gives each of them their own row of
     * dietary pills on the card — with no seating code changed at all.
     *
     * Names are seeded from the site settings and are yours to edit afterwards:
     * settings say "Heaven", and a place card says "Heaven Lucas".
     */
    const handleAddCouple = async () => {
        if (addingCouple || coupleRow(guests)) return;
        setAddingCouple(true);
        try {
            const bride = (config?.brideName || '').trim() || 'Braut';
            const groom = (config?.groomName || '').trim() || 'Bräutigam';
            const res = await fetch('/api/admin/guest-list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    guest_name: bride,
                    email: '',
                    phone: '',
                    party_size: 2,
                    notes: '',
                    // Attending and "invited" so the seating chart offers them
                    // chairs on exactly the path every other attending household
                    // takes. `kind` is what keeps them out of the totals.
                    invited: true,
                    rsvp_status: 'attending',
                    party_members: [{ name: groom, attending: true }],
                    kind: 'couple',
                }),
            });
            if (!res.ok) throw new Error('Failed to add the couple');
            await fetchGuests();
        } catch (error) {
            console.error('Error adding the couple:', error);
            alert('Das Brautpaar konnte nicht zur Gästeliste hinzugefügt werden.');
        } finally {
            setAddingCouple(false);
        }
    };

    // Export exactly what's on screen (current filter + search) as a mail-merge
    // ready CSV: envelope name, address split into label lines, and the rest of
    // the guest record for reference. Minus the couple: this file addresses
    // envelopes, and nobody posts themselves an invitation.
    const mailableGuests = filteredGuests.filter(isGuestRow);
    const handleExportGuests = () => {
        if (!mailableGuests.length) return;
        const csv = toCsv(MAILING_HEADERS, mailingRows(mailableGuests));
        const stamp = new Date().toISOString().slice(0, 10);
        const scope = guestSearch.trim() ? 'search' : guestFilter;
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `gaesteliste-${scope}-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // People selectable as a donor / co-giver: every primary guest PLUS their
    // plus-ones and party members (which are names nested on the guest row, not
    // their own guest-list entries). id is null for non-primary people.
    const donationPeople = guests.flatMap(g => {
        const people: { id: number | null; name: string; key: string }[] = [
            { id: g.id, name: g.guest_name, key: `g-${g.id}` },
        ];
        const seen = new Set([g.guest_name.trim().toLowerCase()]);
        const addPerson = (raw: string | null | undefined, suffix: string) => {
            const name = (raw || '').trim();
            if (!name || seen.has(name.toLowerCase())) return;
            seen.add(name.toLowerCase());
            people.push({ id: null, name, key: `g-${g.id}-${suffix}` });
        };
        (g.party_members || []).forEach((m, i) => addPerson(m.name, `m${i}`));
        addPerson(g.plus_one_name, 'plus');
        return people;
    });

    const donationTotalByGuestId = donations.reduce<Record<number, number>>((acc, d) => {
        if (d.guest_id != null) acc[d.guest_id] = (acc[d.guest_id] || 0) + d.amount;
        return acc;
    }, {});

    // Guests who gave a physical gift — so the Donated column isn't blank for gift-only givers.
    const giftGuestIds = new Set(
        donations.filter(d => d.gift && d.guest_id != null).map(d => d.guest_id as number)
    );

    // Rapid check-off: type a name, hit Enter to tick the top match, box clears and
    // keeps focus so the next name can be typed straight away. Enter is additive (never
    // unticks) so re-entering the same name can't silently undo a tick.
    const handleGuestSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const query = guestSearch.trim();
        if (!query) return;
        const match = filteredGuests[0];
        if (!match) {
            // Keep the text so a typo can be corrected rather than retyped.
            setQuickPick({ text: `Kein Gast passt zu „${query}“`, ok: false });
            return;
        }
        const already = selectedGuests.includes(match.id);
        if (!already) setSelectedGuests(prev => [...prev, match.id]);
        setQuickPick({
            text: already ? `${match.guest_name} war bereits abgehakt` : `${match.guest_name} abgehakt`,
            ok: true,
        });
        setGuestSearch('');
        guestSearchRef.current?.focus();
    };

    // Returns 'hidden' for a guest-table column the measurer has dropped, else ''.
    const H = (c: string) => (hiddenGuestCols.includes(c) ? 'hidden' : '');

    /** Nothing narrower than this: a column you cannot grab again is a trap. */
    const MIN_COL_WIDTH = 72;

    const beginColumnResize = (key: string, clientX: number) => {
        const row = rsvpHeadRef.current;
        if (!row) return;
        const frozen: Record<string, number> = { ...(rsvpColWidths ?? {}) };
        row.querySelectorAll<HTMLTableCellElement>('th[data-rsvp-col]').forEach((th) => {
            const name = th.dataset.rsvpCol;
            if (name && frozen[name] == null) {
                frozen[name] = Math.round(th.getBoundingClientRect().width);
            }
        });
        colDrag.current = { key, x: clientX, width: frozen[key] ?? MIN_COL_WIDTH };
        setRsvpColWidths(frozen);
    };

    const dragColumnTo = (clientX: number) => {
        const drag = colDrag.current;
        if (!drag) return;
        const next = Math.max(MIN_COL_WIDTH, Math.round(drag.width + (clientX - drag.x)));
        setRsvpColWidths((prev) => ({ ...(prev ?? {}), [drag.key]: next }));
    };

    const nudgeColumn = (key: string, by: number) => {
        const row = rsvpHeadRef.current;
        const current = rsvpColWidths?.[key]
            ?? row?.querySelector<HTMLTableCellElement>(`th[data-rsvp-col="${key}"]`)
                ?.getBoundingClientRect().width;
        if (current == null) return;
        beginColumnResize(key, 0);
        setRsvpColWidths((prev) => ({
            ...(prev ?? {}), [key]: Math.max(MIN_COL_WIDTH, Math.round(current + by)),
        }));
        colDrag.current = null;
    };

    /**
     * One header cell, with the grip that resizes it.
     *
     * Pointer capture on the grip itself rather than window listeners: the drag
     * then survives the cursor leaving this 8px strip, which it does at once.
     */
    const rsvpHeader = (key: string, label: string, share?: string) => (
        <th
            key={key}
            data-rsvp-col={key}
            // A dragged width wins; otherwise the share, where one is asked for.
            style={rsvpColWidths ? { width: rsvpColWidths[key] } : share ? { width: share } : undefined}
            className="relative group/col px-6 py-3 text-left text-xs font-medium text-gray-500
                uppercase tracking-wider select-none"
        >
            {label}
            <span
                role="separator"
                aria-orientation="vertical"
                aria-label={`Spalte „${label}“ in der Breite ändern`}
                tabIndex={0}
                title={`Ziehen, um „${label}“ zu verbreitern – bis zum Neuladen`}
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    beginColumnResize(key, event.clientX);
                }}
                onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        dragColumnTo(event.clientX);
                    }
                }}
                onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    colDrag.current = null;
                }}
                onPointerCancel={() => { colDrag.current = null; }}
                onKeyDown={(event) => {
                    const step = event.key === 'ArrowLeft' ? -16
                        : event.key === 'ArrowRight' ? 16 : 0;
                    if (!step) return;
                    event.preventDefault();
                    nudgeColumn(key, step);
                }}
                className="absolute right-0 top-0 z-10 flex h-full w-2 translate-x-1/2 cursor-col-resize
                    touch-none items-center justify-center focus:outline-none"
            >
                <span className="h-4 w-0.5 rounded-full bg-gray-200 transition-colors
                    group-hover/col:bg-gray-400 hover:!bg-accent" />
            </span>
        </th>
    );

    return (
        <div>
            {/* Nav Card Subtitle */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Untertitel der Navigationskarte</h2>
                <p className="text-sm text-gray-500 mb-3">Kurzer Slogan auf der Rückmeldungs-Karte unten auf der Startseite.</p>
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={rsvpSubtitle}
                        onChange={(e) => setRsvpSubtitle(e.target.value)}
                        className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                        placeholder="z. B. Sagt uns, dass ihr dabei seid"
                    />
                    <SaveStatus state={subtitleState} onRetry={retrySubtitle} />
                </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">Rückmeldungen & Gästeverwaltung</h1>
                    <p className="text-gray-600">Rückmeldungen verfolgen und die Gästeliste verwalten</p>
                </div>

                {/* Tab Buttons — equal columns on mobile. Four of them no longer fit
                    on one phone row, so they wrap to two rather than shrink to
                    illegibility or scroll sideways. */}
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => setActiveTab('rsvps')}
                        className={`flex-1 sm:flex-none min-w-0 px-3 sm:px-4 py-2 rounded-full text-sm sm:text-base font-medium text-center whitespace-nowrap transition-colors duration-300 shadow-md ${
                            activeTab === 'rsvps'
                                ? 'bg-accent text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:shadow-lg'
                        }`}
                    >
                        <span className="sm:hidden">Antworten</span>
                        <span className="hidden sm:inline">Rückmeldungen</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('guestlist')}
                        className={`flex-1 sm:flex-none min-w-0 px-3 sm:px-4 py-2 rounded-full text-sm sm:text-base font-medium text-center whitespace-nowrap transition-colors duration-300 shadow-md ${
                            activeTab === 'guestlist'
                                ? 'bg-accent text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:shadow-lg'
                        }`}
                    >
                        <span className="sm:hidden">Gäste</span>
                        <span className="hidden sm:inline">Gästeliste</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('vendors')}
                        className={`flex-1 sm:flex-none min-w-0 px-3 sm:px-4 py-2 rounded-full text-sm sm:text-base font-medium text-center whitespace-nowrap transition-colors duration-300 shadow-md ${
                            activeTab === 'vendors'
                                ? 'bg-accent text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:shadow-lg'
                        }`}
                    >
                        Dienstleister
                    </button>
                    <button
                        onClick={() => setActiveTab('donations')}
                        className={`flex-1 sm:flex-none min-w-0 px-3 sm:px-4 py-2 rounded-full text-sm sm:text-base font-medium text-center whitespace-nowrap transition-colors duration-300 shadow-md ${
                            activeTab === 'donations'
                                ? 'bg-accent text-white shadow-lg'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:shadow-lg'
                        }`}
                    >
                        Spenden
                    </button>
                </div>
            </div>

            {/* RSVP Management Tab */}
            {activeTab === 'rsvps' && (
                <>
                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-gray-200">
                            <p className="text-sm font-medium text-gray-500">Rückmeldungen gesamt</p>
                            <p className="text-3xl font-bold text-gray-900">{guestRsvps.length}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-green-200">
                            <p className="text-sm font-medium text-green-600">Zusagen gesamt</p>
                            <p className="text-3xl font-bold text-green-700">{totalGuests}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-red-200">
                            <p className="text-sm font-medium text-red-600">Absagen</p>
                            <p className="text-3xl font-bold text-red-700">{totalDeclinedGuests}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-orange-200">
                            <p className="text-sm font-medium text-orange-600">Kommt wohl nicht</p>
                            <p className="text-3xl font-bold text-orange-700">{likelyNotComingCount}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-yellow-200">
                            <p className="text-sm font-medium text-yellow-600">Fehlende Rückmeldungen</p>
                            <p className="text-3xl font-bold text-yellow-700">{missingRsvps}</p>
                        </div>
                    </div>

                    {/* RSVP Table */}
                    <div className="bg-white shadow-lg border border-gray-200 rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                            {/* Fixed layout only once a column has been dragged: until
                                then the browser's own sizing is better than anything
                                hard-coded, and after it the drag has to move one
                                column rather than re-flow all six. */}
                            <table
                                className={`divide-y divide-gray-200 ${rsvpColWidths ? '' : 'min-w-full'}`}
                                style={rsvpColWidths
                                    ? {
                                        tableLayout: 'fixed',
                                        // The table is as wide as its columns add up to, and the
                                        // wrapper scrolls. Left at 100% it would take back from
                                        // one column whatever another was given, so a 160px drag
                                        // moved a column 23px and shrank its neighbour.
                                        width: Object.values(rsvpColWidths)
                                            .reduce((sum, width) => sum + width, 0),
                                    }
                                    : undefined}
                            >
                                <thead className="bg-gray-50">
                                    <tr ref={rsvpHeadRef}>
                                        {rsvpHeader('name', 'Name')}
                                        {rsvpHeader('status', 'Status')}
                                        {rsvpHeader('guests', 'Gäste')}
                                        {/* Dietary hands roughly a third of its width to the
                                            message beside it: it holds a few short flags, and the
                                            message is the column anyone actually leans in to read. */}
                                        {rsvpHeader('dietary', 'Ernährung', '10%')}
                                        {rsvpHeader('message', 'Nachricht', '35%')}
                                        {rsvpHeader('date', 'Datum')}
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {guestRsvps.map((rsvp) => {
                                        const members = Array.isArray(rsvp.dietary_restrictions)
                                            ? rsvp.dietary_restrictions.slice(1)
                                            : [];
                                        const hasParty = members.length > 0;
                                        const primaryDietary = Array.isArray(rsvp.dietary_restrictions)
                                            ? rsvp.dietary_restrictions[0]
                                            : null;
                                        const dietaryFlags = (entry: DietaryEntry | null) => {
                                            if (!entry) return '-';
                                            const flags = [
                                                entry.vegetarian && 'Vegetarisch',
                                                entry.vegan && 'Vegan',
                                                entry.gluten_free && 'Glutenfrei',
                                                entry.nut_allergy && 'Nussallergie',
                                                entry.other && (entry.other_text || 'Sonstiges'),
                                                entry.kids_meal && 'Kindermenü',
                                                entry.no_meal && 'Isst nicht mit',
                                            ].filter(Boolean);
                                            return flags.length ? flags.join(', ') : '-';
                                        };
                                        return (
                                            <React.Fragment key={rsvp.id}>
                                                {/* Primary guest row */}
                                                <tr className="group hover:bg-gray-50 relative">
                                                    <td className="px-6 py-4 whitespace-nowrap overflow-hidden">
                                                        <div className="text-sm font-medium text-gray-900 truncate">{rsvp.guest_name}</div>
                                                        <div className="text-xs text-gray-400 truncate">{rsvp.email}</div>
                                                        {rsvp.phone && <div className="text-xs text-gray-400 truncate">{rsvp.phone}</div>}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${rsvp.attending ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                            {rsvp.attending ? 'Zusage' : 'Absage'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {rsvp.attending ? rsvp.number_of_guests : '-'}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-500">
                                                        {dietaryFlags(primaryDietary)}
                                                    </td>
                                                    {/* Wraps rather than truncating — a note cut off at
                                                        one line is a note nobody read. */}
                                                    <td className="px-6 py-4 text-sm text-gray-500
                                                        whitespace-pre-wrap break-words">
                                                        {rsvp.message || '-'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 relative">
                                                        {new Date(rsvp.created_at).toLocaleDateString('de-DE')}
                                                        <div className="absolute right-0 inset-y-0 flex items-center pr-4 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-gray-50 via-gray-50 to-transparent pl-8">
                                                            <button
                                                                onClick={() => { setDeletingRsvp(rsvp); setConfirmName(''); }}
                                                                className="text-red-600 hover:text-red-900 bg-white border border-gray-200 shadow-sm px-3 py-1 rounded-full text-xs font-medium"
                                                            >
                                                                Löschen
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {/* Party member sub-rows */}
                                                {members.map((member, mi) => (
                                                    <tr key={`${rsvp.id}-m${mi}`} className="bg-gray-50/60">
                                                        <td className="pl-10 pr-6 py-1.5 whitespace-nowrap border-l-2 border-gray-200">
                                                            <span className="text-gray-300 mr-1.5 text-xs">└</span>
                                                            <span className="text-sm text-gray-500 italic">{member.name || 'Unbekannt'}</span>
                                                        </td>
                                                        <td className="px-6 py-1.5 whitespace-nowrap">
                                                            <span className="px-2 inline-flex text-xs leading-5 font-medium rounded-full bg-gray-100 text-gray-500">Zusage</span>
                                                        </td>
                                                        <td className="px-6 py-1.5 text-xs text-gray-300">—</td>
                                                        <td className="px-6 py-1.5 text-xs text-gray-400">{dietaryFlags(member)}</td>
                                                        <td className="px-6 py-1.5 text-xs text-gray-300">—</td>
                                                        <td className="px-6 py-1.5 text-xs text-gray-300">—</td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* Guest List Tab */}
            {activeTab === 'guestlist' && (
                <>
                    {/* Guest List Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-8">
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-gray-200">
                            <p className="text-sm font-medium text-gray-500">Eingeladen gesamt</p>
                            <p className="text-3xl font-bold text-gray-900">{totalInvited}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-gray-200">
                            <p className="text-sm font-medium text-gray-500">Noch nicht eingeladen</p>
                            <p className="text-3xl font-bold text-gray-900">{totalNotInvited}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-gray-200">
                            <p className="text-sm font-medium text-gray-500">Erwartete Gäste</p>
                            <p className="text-3xl font-bold text-gray-900">{totalGuestListSize}</p>
                            <p className="text-xs text-gray-400 mt-1">ohne „kommt wohl nicht“ &amp; Absagen</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-orange-200">
                            <p className="text-sm font-medium text-orange-600">Kommt wohl nicht</p>
                            <p className="text-3xl font-bold text-orange-700">{likelyNotComingCount}</p>
                        </div>
                        <div className="bg-white p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 border border-green-200">
                            <p className="text-sm font-medium text-gray-500">Zusagen gesamt</p>
                            <p className="text-3xl font-bold text-green-600">{totalGuests}</p>
                        </div>
                    </div>

                    {/* Bulk Actions and Add Guest Button */}
                    <div className="mb-4 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
                        <div className="flex flex-wrap gap-2 items-center">
                            {selectedGuests.length > 0 && (
                                <>
                                    <span className="text-sm font-semibold text-gray-700 self-center">
                                        {selectedGuests.length} ausgewählt
                                    </span>
                                    <button
                                        onClick={handleBulkMarkInvited}
                                        className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 text-sm transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        Als eingeladen markieren
                                    </button>
                                    <button
                                        onClick={handleBulkDelete}
                                        className="bg-red-600 text-white px-4 py-2 rounded-full hover:bg-red-700 text-sm transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        Auswahl löschen
                                    </button>

                                    {/* Overflow menu for the less-used bulk actions */}
                                    <div className="relative" ref={bulkMenuRef}>
                                        <button
                                            onClick={() => setShowBulkMenu(v => !v)}
                                            title="Weitere Aktionen für die ausgewählten Gäste"
                                            aria-haspopup="menu"
                                            aria-expanded={showBulkMenu}
                                            aria-label="Weitere Aktionen"
                                            className={`w-9 h-9 flex items-center justify-center rounded-full text-sm transition-all duration-300 shadow-sm hover:shadow-md ${
                                                showBulkMenu ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                                <circle cx="4" cy="10" r="1.6" />
                                                <circle cx="10" cy="10" r="1.6" />
                                                <circle cx="16" cy="10" r="1.6" />
                                            </svg>
                                        </button>
                                        {showBulkMenu && (
                                            <div
                                                role="menu"
                                                className="absolute left-0 mt-2 w-64 bg-white/95 backdrop-blur rounded-2xl shadow-2xl border border-gray-200 py-2 z-40"
                                            >
                                                <p className="px-4 pb-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                                                    {selectedGuests.length} ausgewählt
                                                </p>
                                                <button
                                                    role="menuitem"
                                                    onClick={() => { setShowBulkMenu(false); handleBulkUnmarkInvited(); }}
                                                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                                                >
                                                    Als nicht eingeladen markieren
                                                </button>
                                                <button
                                                    role="menuitem"
                                                    onClick={() => { setShowBulkMenu(false); handleBulkFlag('issue'); }}
                                                    title="Später erneut klicken, um die Markierung zu entfernen"
                                                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-red-50 transition-colors"
                                                >
                                                    ⚠️ Als Problem markieren
                                                </button>
                                                <button
                                                    role="menuitem"
                                                    onClick={() => { setShowBulkMenu(false); handleBulkFlag('need'); }}
                                                    title="Später erneut klicken, um die Markierung zu entfernen"
                                                    className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-amber-50 transition-colors"
                                                >
                                                    📌 Als Nachfassen markieren
                                                </button>
                                                <div className="my-1.5 border-t border-gray-100" />
                                                <button
                                                    role="menuitem"
                                                    onClick={() => { setShowBulkMenu(false); openBulkModal(); }}
                                                    className="w-full text-left px-4 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
                                                >
                                                    ✏️ Auswahl bearbeiten …
                                                    <span className="block text-xs font-normal text-gray-400 mt-0.5">Notiz, Markierung, Seite oder Rückmeldung</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                            {bulkResult && (
                                <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                                    {bulkResult}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setShowImportModal(true)}
                                className="bg-green-600 text-white px-4 py-2 rounded-full hover:bg-green-700 flex items-center gap-2 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                CSV importieren
                            </button>
                            <button
                                onClick={handleExportGuests}
                                disabled={mailableGuests.length === 0}
                                title={`Die aktuell angezeigten ${mailableGuests.length} ${mailableGuests.length === 1 ? 'Gast' : 'Gäste'} als Adressliste (CSV) herunterladen`}
                                className="bg-blue-600 text-white px-4 py-2 rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 9l-3 3m0 0l-3-3m3 3V3" />
                                </svg>
                                CSV exportieren ({mailableGuests.length})
                            </button>
                            <button
                                onClick={() => setShowReconcileModal(true)}
                                className="bg-amber-500 text-white px-4 py-2 rounded-full hover:bg-amber-600 flex items-center gap-2 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                </svg>
                                Adressen abgleichen
                            </button>
                            <button
                                onClick={() => {
                                    setIsAddingGuest(true);
                                    setGuestForm({
                                        guest_name: '',
                                        email: '',
                                        phone: '',
                                        party_size: 1,
                                        side: '',
                                        notes: '',
                                        invited: false,
                                        party_members: [],
                                        rsvp_status: '',
                                        address: '',
                                        flag: '',
                                        relationship: '',
                                        under_21: false,
                                        dietary: [],
                                    });
                                }}
                                className="bg-accent text-white px-4 py-2 rounded-full hover:bg-accent/90 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                Gast hinzufügen
                            </button>
                        </div>
                    </div>

                    {/* The couple are on the guest list so the seating chart can
                        give them chairs and the kitchen can count their plates —
                        but they are not guests, so nothing here counts them as
                        invited. Offered only while the row does not exist; a page
                        that writes to the database because you looked at it is
                        not a page anyone can trust. */}
                    {!coupleRow(guests) && (
                        <div className="mb-4 px-5 py-4 rounded-2xl bg-gray-50 border border-gray-100 flex flex-wrap items-center gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-800">
                                    {config?.brideName || 'Die Braut'} und {config?.groomName || 'der Bräutigam'} stehen nicht auf der Liste
                                </p>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Füge sie hinzu, dann können sie an einem Tisch sitzen und für die
                                    Küche mitgezählt werden. In den Einladungszahlen und im Adressexport tauchen sie nicht auf.
                                </p>
                            </div>
                            <button
                                onClick={handleAddCouple}
                                disabled={addingCouple}
                                className="ml-auto shrink-0 px-5 py-2.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors"
                            >
                                {addingCouple ? 'Wird hinzugefügt …' : 'Brautpaar hinzufügen'}
                            </button>
                        </div>
                    )}

                    {/* Filters & Search */}
                    <div className="mb-4 flex flex-col sm:flex-row gap-3">
                        <input
                            ref={guestSearchRef}
                            type="text"
                            placeholder="Gäste suchen … (Enter zum Abhaken)"
                            value={guestSearch}
                            onChange={e => { setGuestSearch(e.target.value); if (quickPick) setQuickPick(null); }}
                            onKeyDown={handleGuestSearchKeyDown}
                            className="px-3 py-2 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 w-full sm:w-56"
                        />
                        <div className="flex flex-wrap gap-2">
                            {([
                                { key: 'all', label: 'Alle', color: 'gray' },
                                { key: 'no_response', label: '⏳ Keine Antwort', color: 'yellow' },
                                { key: 'attending', label: '✓ Zusage', color: 'green' },
                                { key: 'declined', label: '✗ Absage', color: 'red' },
                                { key: 'likely_not_coming', label: '🙁 Kommt wohl nicht', color: 'orange' },
                                { key: 'invited', label: '✉ Eingeladen', color: 'blue' },
                                { key: 'not_invited', label: 'Nicht eingeladen', color: 'gray' },
                                { key: 'bride', label: `Seite von ${config?.brideName || 'Braut'}`, color: 'pink' },
                                { key: 'groom', label: `Seite von ${config?.groomName || 'Bräutigam'}`, color: 'blue' },
                                { key: 'kids_meal', label: '🧒 Kindermenü', color: 'blue' },
                                { key: 'noted', label: '📝 Mit Notiz', color: 'indigo' },
                                { key: 'issue', label: '⚠️ Problem', color: 'red' },
                                { key: 'need', label: '📌 Nachfassen', color: 'amber' },
                            ] as { key: GuestFilter; label: string; color: string }[]).map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => setGuestFilter(f.key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                                        guestFilter === f.key
                                            ? 'bg-accent text-white shadow-md'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <p className="text-sm text-gray-500">
                            {filteredGuests.length} von {guests.length} Gästen angezeigt
                        </p>
                        {quickPick && (
                            <span
                                aria-live="polite"
                                className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                                    quickPick.ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                }`}
                            >
                                {quickPick.ok ? '✓' : '⚠️'} {quickPick.text}
                            </span>
                        )}
                    </div>

                    {/* Guest List Table */}
                    <div className="bg-white shadow-lg border border-gray-200 rounded-2xl overflow-hidden">
                        {/* overflow-x-auto is the last-resort floor: below ~640px the five
                            mandatory columns physically cannot fit, and the rounded parent is
                            overflow-hidden, so without this the Actions pills get clipped away. */}
                        <div className="w-full overflow-x-auto" ref={guestTableWrapRef}>
                            <table className="w-full table-auto divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th data-col="select" className={`${H('select')} w-10 px-2 sm:px-4 lg:px-6 py-3 text-left`}>
                                            <input
                                                type="checkbox"
                                                checked={filteredGuests.length > 0 && filteredGuests.every(g => selectedGuests.includes(g.id))}
                                                onChange={toggleSelectAll}
                                                className="rounded border-gray-300 text-accent focus:ring-accent"
                                            />
                                        </th>
                                        <th data-col="name" className="w-full max-w-0 min-w-[72px] px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Name</th>
                                        <th data-col="contact" className={`${H('contact')} px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap`}>Kontakt</th>
                                        <th data-col="relation" className={`${H('relation')} px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap`}>Beziehung</th>
                                        <th data-col="party" className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Gruppe</th>
                                        <th data-col="invited" className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Eingeladen</th>
                                        <th data-col="rsvp" className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Antwort</th>
                                        <th data-col="notes" className={`${H('notes')} px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap`}>Notizen</th>
                                        <th data-col="address" className={`${H('address')} px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap`}>Adresse</th>
                                        <th data-col="donated" className={`${H('donated')} px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap`}>Gespendet</th>
                                        <th data-col="actions" className="px-2 sm:px-4 lg:px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Aktionen</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredGuests.map((guest) => {
                                        const isLikelyNotComing = guest.rsvp_status === 'likely_not_coming';
                                        const members = guest.party_members || [];
                                        const hasParty = members.length > 0;
                                        // Find this guest's RSVP dietary data for member details
                                        const rsvp = rsvps.find(r => r.guest_name.toLowerCase() === guest.guest_name.toLowerCase());
                                        const memberDietary = Array.isArray(rsvp?.dietary_restrictions)
                                            ? rsvp.dietary_restrictions.slice(1)
                                            : [];
                                        const dietaryFlags = (entry: DietaryEntry | null | undefined) => {
                                            if (!entry) return null;
                                            const flags = [
                                                entry.vegetarian && 'Vegetarisch',
                                                entry.vegan && 'Vegan',
                                                entry.gluten_free && 'Glutenfrei',
                                                entry.nut_allergy && 'Nussallergie',
                                                entry.other && (entry.other_text || 'Sonstiges'),
                                                entry.kids_meal && 'Kindermenü',
                                                entry.no_meal && 'Isst nicht mit',
                                            ].filter(Boolean);
                                            return flags.length ? flags.join(', ') : null;
                                        };
                                        return (
                                        <React.Fragment key={guest.id}>
                                        <tr className={`align-top bg-white hover:bg-gray-50 ${isLikelyNotComing ? '!bg-red-50' : ''}`}>
                                            <td data-col="select" className={`${H('select')} px-2 sm:px-4 lg:px-6 py-4`}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedGuests.includes(guest.id)}
                                                    onChange={() => toggleGuestSelection(guest.id)}
                                                    className="rounded border-gray-300 text-accent focus:ring-accent"
                                                />
                                            </td>
                                            <td data-col="name" className="w-full max-w-0 px-2 sm:px-4 lg:px-6 py-4 overflow-hidden">
                                                <div className={`text-sm font-semibold truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-900'}`} title={guest.guest_name}>{guest.guest_name}</div>
                                                {!isGuestRow(guest) && (
                                                    <div className="flex flex-nowrap items-center gap-1 mt-1 overflow-hidden">
                                                        <span
                                                            className="inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                                            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent-dark)' }}
                                                            title="Nicht eingeladen, nie mitgezählt – nur hier, damit sie Platz und Essen bekommen"
                                                        >
                                                            💍 Das Brautpaar
                                                        </span>
                                                    </div>
                                                )}
                                                {(guest.flag || (guest.notes && guest.notes.trim())) && (
                                                    // nowrap + clip: when Name is squeezed these badges would otherwise
                                                    // wrap one-per-line and balloon the row height.
                                                    <div className="flex flex-nowrap items-center gap-1 mt-1 overflow-hidden">
                                                        {guest.flag === 'issue' && (
                                                            <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">⚠️ Problem</span>
                                                        )}
                                                        {guest.flag === 'need' && (
                                                            <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-700">📌 Nachfassen</span>
                                                        )}
                                                        {guest.notes && guest.notes.trim() && (
                                                            <span className="inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-100 text-indigo-700" title={guest.notes}>📝 Notiz</span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                            <td data-col="contact" className={`${H('contact')} px-2 sm:px-4 lg:px-6 py-4 max-w-[240px] overflow-hidden`}>
                                                <div className={`text-sm truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`} title={guest.email || ''}>{guest.email || '-'}</div>
                                                <div className={`text-sm truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`} title={guest.phone || ''}>{guest.phone || '-'}</div>
                                            </td>
                                            <td data-col="relation" className={`${H('relation')} px-2 sm:px-4 lg:px-6 py-4 text-sm max-w-[180px] truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`} title={guest.relationship || ''}>
                                                {guest.relationship || '-'}
                                            </td>
                                            <td data-col="party" className={`px-2 sm:px-4 lg:px-6 py-4 text-sm ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`}>
                                                {guest.party_size}
                                            </td>
                                            <td data-col="invited" className="px-2 sm:px-4 lg:px-6 py-4 whitespace-nowrap">
                                                <span className={`inline-block text-center px-2 py-0.5 text-xs font-semibold rounded-full ${
                                                    guest.invited ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {guest.invited ? 'Eingeladen' : 'Nicht eingeladen'}
                                                </span>
                                            </td>
                                            <td data-col="rsvp" className="px-2 sm:px-4 lg:px-6 py-4 whitespace-nowrap">
                                                {guest.rsvp_status === 'attending' ? (
                                                    <span className="inline-block text-center px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">Zusage</span>
                                                ) : guest.rsvp_status === 'declined' ? (
                                                    <span className="inline-block text-center px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">Absage</span>
                                                ) : guest.rsvp_status === 'likely_not_coming' ? (
                                                    <span className="inline-block text-center px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-700">Kommt wohl nicht</span>
                                                ) : (
                                                    <span className="text-sm text-gray-400">Keine Antwort</span>
                                                )}
                                            </td>
                                            <td data-col="notes" className={`${H('notes')} px-2 sm:px-4 lg:px-6 py-4 text-sm max-w-[220px] truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`} title={guest.notes || ''}>
                                                {guest.notes || '-'}
                                            </td>
                                            <td data-col="address" className={`${H('address')} px-2 sm:px-4 lg:px-6 py-4 text-sm max-w-[240px] truncate ${isLikelyNotComing ? 'text-gray-400' : 'text-gray-500'}`} title={guest.address || ''}>
                                                {guest.address || '-'}
                                            </td>
                                            <td data-col="donated" className={`${H('donated')} px-2 sm:px-4 lg:px-6 py-4 text-sm text-gray-700 whitespace-nowrap`}>
                                                {[
                                                    donationTotalByGuestId[guest.id] ? `$${donationTotalByGuestId[guest.id].toLocaleString('de-DE')}` : null,
                                                    giftGuestIds.has(guest.id) ? 'Geschenk' : null,
                                                ].filter(Boolean).join(' + ') || '-'}
                                            </td>
                                            <td data-col="actions" className="px-2 sm:px-4 lg:px-6 py-4 text-right text-sm font-medium">
                                                <div className="flex flex-nowrap items-center gap-1.5 justify-end whitespace-nowrap">
                                                    <button
                                                        onClick={() => handleMarkLikelyNotComing(guest)}
                                                        title={isLikelyNotComing ? '„Kommt wohl nicht“ entfernen' : 'Als „kommt wohl nicht“ markieren'}
                                                        className={`text-xs px-2.5 py-1 rounded-full transition-colors ${isLikelyNotComing ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' : 'bg-gray-100 text-gray-500 hover:bg-orange-100 hover:text-orange-700'}`}
                                                    >
                                                        🙁
                                                    </button>
                                                    <button
                                                        onClick={() => openEditGuest(guest)}
                                                        className="text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                                                    >
                                                        Bearbeiten
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteGuest(guest.id)}
                                                        className="text-xs font-semibold px-3 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                                                    >
                                                        Löschen
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {/* Party member sub-rows */}
                                        {members.map((member, mi) => {
                                            const mDietary = memberDietary[mi];
                                            const mAttending = !!mDietary;
                                            const flags = dietaryFlags(mDietary);
                                            return (
                                                <tr key={`${guest.id}-m${mi}`} className="align-top bg-gray-50">
                                                    <td data-col="select" className={`${H('select')} px-2 sm:px-4 lg:px-6 py-1.5`} />
                                                    <td data-col="name" className="w-full max-w-0 px-2 sm:px-4 lg:px-6 py-1.5 border-l-2 border-gray-200 overflow-hidden">
                                                        <div className="flex items-center gap-1 min-w-0">
                                                            <span className="text-gray-300 text-xs shrink-0">└</span>
                                                            <span className="text-sm text-gray-500 italic truncate" title={member.name || `Unbekannter Gast ${mi + 2}`}>
                                                                {member.name || `Unbekannter Gast ${mi + 2}`}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td data-col="contact" className={`${H('contact')} px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300`}>—</td>
                                                    <td data-col="relation" className={`${H('relation')} px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300`}>—</td>
                                                    <td data-col="party" className="px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300">—</td>
                                                    <td data-col="invited" className="px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300">—</td>
                                                    <td data-col="rsvp" className="px-2 sm:px-4 lg:px-6 py-1.5">
                                                        {mAttending ? (
                                                            <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">Zusage</span>
                                                        ) : (
                                                            <span className="text-xs text-gray-300">—</span>
                                                        )}
                                                    </td>
                                                    <td data-col="notes" className={`${H('notes')} px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-400 max-w-[220px] truncate`} title={flags || ''}>
                                                        {flags || '—'}
                                                    </td>
                                                    <td data-col="address" className={`${H('address')} px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300`}>—</td>
                                                    <td data-col="donated" className={`${H('donated')} px-2 sm:px-4 lg:px-6 py-1.5 text-xs text-gray-300`}>—</td>
                                                    <td data-col="actions" className="px-2 sm:px-4 lg:px-6 py-1.5" />
                                                </tr>
                                            );
                                        })}
                                        </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'vendors' && (
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
                    <VendorsTab />
                </div>
            )}

            {activeTab === 'donations' && (
                <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-gray-500">
                            {donations.length} {donations.length === 1 ? 'Spende' : 'Spenden'} · Gesamt ${donations.reduce((s, d) => s + d.amount, 0).toLocaleString('de-DE')}
                            {donations.filter(d => d.gift).length > 0 && ` · ${donations.filter(d => d.gift).length} ${donations.filter(d => d.gift).length === 1 ? 'Geschenk' : 'Geschenke'}`}
                            {' · '}{donations.filter(d => d.thank_you_sent).length}/{donations.length} bedankt
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            {selectedDonations.length > 0 && (
                                <>
                                    <span className="text-sm text-gray-600">{selectedDonations.length} ausgewählt</span>
                                    <button
                                        onClick={() => setThankYouSent(true)}
                                        disabled={markingThanks}
                                        className="bg-green-600 text-white px-4 py-2 rounded-full text-sm hover:bg-green-700 disabled:opacity-40 transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        {markingThanks ? 'Wird gespeichert …' : 'Dank als gesendet markieren'}
                                    </button>
                                    <button
                                        onClick={() => setThankYouSent(false)}
                                        disabled={markingThanks}
                                        className="bg-gray-500 text-white px-4 py-2 rounded-full text-sm hover:bg-gray-600 disabled:opacity-40 transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        Markierung entfernen
                                    </button>
                                </>
                            )}
                            <button
                                onClick={() => setShowDonationModal(true)}
                                className="bg-accent text-white px-4 py-2.5 rounded-full text-sm font-medium hover:opacity-90"
                            >
                                + Spende erfassen
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="w-10 px-6 py-3 text-left">
                                        <input
                                            type="checkbox"
                                            checked={donations.length > 0 && selectedDonations.length === donations.length}
                                            onChange={toggleSelectAllDonations}
                                            className="rounded border-gray-300 text-accent focus:ring-accent"
                                        />
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gast</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Betrag</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Geschenk</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fonds</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Anlass</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dank</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Datum</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Aktionen</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {donations.length === 0 ? (
                                    <tr><td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-400">Noch keine Spenden erfasst.</td></tr>
                                ) : donations.map(d => (
                                    <tr key={d.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedDonations.includes(d.id)}
                                                onChange={() => toggleDonationSelection(d.id)}
                                                className="rounded border-gray-300 text-accent focus:ring-accent"
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                                            {[d.guest_name, ...((d.co_donors || []).map(c => c.name))].join(', ')}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{d.amount ? `$${d.amount.toLocaleString('de-DE')}` : '-'}</td>
                                        <td className="px-6 py-4 text-sm text-gray-500 max-w-[220px] truncate" title={d.gift || ''}>{d.gift || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{d.fund_item_title || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{d.event ? (EVENT_LABELS[d.event] ?? d.event) : '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            {d.thank_you_sent ? (
                                                <span
                                                    className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full"
                                                    title={d.thank_you_sent_at ? `Gesendet am ${new Date(d.thank_you_sent_at).toLocaleDateString('de-DE')}` : undefined}
                                                >
                                                    ✓ Dank gesendet
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">
                                                    Nicht gesendet
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(d.created_at).toLocaleDateString('de-DE')}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                                            <button onClick={() => openEditDonation(d)} className="text-accent hover:text-accent-dark mr-3">Bearbeiten</button>
                                            <button onClick={() => setDeletingDonation(d)} className="text-red-600 hover:text-red-800">Löschen</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Log Donation Modal */}
            {showDonationModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={resetDonationModal} />
                    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 z-10">
                        <h2 className="text-lg font-bold text-gray-900 mb-4">{editingDonationId ? 'Spende bearbeiten' : 'Spende erfassen'}</h2>

                        <label className="block text-sm font-medium text-gray-700 mb-1">Wer hat gespendet?</label>
                        {donationDonor ? (
                            <div className="flex items-center justify-between border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4">
                                <span>{donationDonor.guest_name}</span>
                                <button type="button" onClick={() => { setDonationDonor(null); setDonationDonorSearch(''); }} className="text-gray-400 hover:text-gray-600">✕</button>
                            </div>
                        ) : (
                            <div className="mb-4">
                                <input
                                    type="text"
                                    value={donationDonorSearch}
                                    onChange={e => setDonationDonorSearch(e.target.value)}
                                    placeholder="Gästeliste durchsuchen …"
                                    className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                />
                                {donationDonorSearch.trim() && (
                                    <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-2xl">
                                        {donationPeople
                                            .filter(p => p.name.toLowerCase().includes(donationDonorSearch.toLowerCase()))
                                            .slice(0, 8)
                                            .map(p => (
                                                <button
                                                    key={p.key}
                                                    type="button"
                                                    onClick={() => { setDonationDonor({ id: p.id ?? 0, guest_name: p.name }); setDonationDonorSearch(''); }}
                                                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                                                >
                                                    {p.name}
                                                </button>
                                            ))}
                                        {donationPeople.filter(p => p.name.toLowerCase().includes(donationDonorSearch.toLowerCase())).length === 0 && (
                                            <p className="px-3 py-2 text-sm text-gray-400">Kein passender Gast</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <label className="block text-sm font-medium text-gray-700 mb-1">Mitgebende (optional)</label>
                        {coGivers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                                {coGivers.map(c => (
                                    <span key={c.name} className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-1 text-xs">
                                        {c.name}
                                        <button type="button" onClick={() => removeCoGiver(c.name)} className="text-gray-400 hover:text-gray-600">✕</button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <input
                            type="text"
                            value={coGiverSearch}
                            onChange={e => setCoGiverSearch(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && coGiverSearch.trim()) { e.preventDefault(); addCoGiver({ id: null, name: coGiverSearch }); } }}
                            placeholder="Mitgebende:n hinzufügen (tippen & Enter oder unten wählen)"
                            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4"
                        />
                        {coGiverSearch.trim() && (
                            <div className="-mt-3 mb-4 max-h-32 overflow-y-auto border border-gray-200 rounded-2xl">
                                {donationPeople
                                    .filter(p => p.name.toLowerCase().includes(coGiverSearch.toLowerCase()))
                                    .slice(0, 8)
                                    .map(p => (
                                        <button key={p.key} type="button" onClick={() => addCoGiver({ id: p.id, name: p.name })}
                                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100">
                                            {p.name}
                                        </button>
                                    ))}
                            </div>
                        )}

                        <p className="text-xs text-gray-400 mb-3">Erfasse Geld, ein Geschenk oder beides – eines von beiden ist nötig.</p>

                        <label className="block text-sm font-medium text-gray-700 mb-1">Erhaltener Betrag ($)</label>
                        <input
                            type="number"
                            value={donationAmount}
                            onChange={e => setDonationAmount(e.target.value)}
                            placeholder="Leer lassen für nur ein Geschenk"
                            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4"
                        />

                        <label className="block text-sm font-medium text-gray-700 mb-1">Geschenk</label>
                        <input
                            type="text"
                            value={donationGift}
                            onChange={e => setDonationGift(e.target.value)}
                            placeholder="z. B. Küchenmaschine, selbstgenähte Decke"
                            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4"
                        />

                        {/* A fund only applies to money — a gift-only entry has nothing to allocate. */}
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Fonds {donationAmount.trim() ? '' : <span className="text-gray-400 font-normal">(nur bei Geld)</span>}
                        </label>
                        <select
                            value={donationFundId}
                            onChange={e => setDonationFundId(e.target.value)}
                            disabled={!donationAmount.trim()}
                            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <option value="">Fonds auswählen …</option>
                            {(config?.registry?.items || []).map((f: FundItem) => (
                                <option key={f.id} value={f.id}>{f.title}</option>
                            ))}
                        </select>

                        <label className="block text-sm font-medium text-gray-700 mb-1">Bei welchem Anlass?</label>
                        <select
                            value={donationEvent}
                            onChange={e => setDonationEvent(e.target.value)}
                            className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-3"
                        >
                            <option value="Bridal Shower">Junggesellinnenabschied</option>
                            <option value="Engagement Party">Verlobungsfeier</option>
                            <option value="Wedding Day">Hochzeitstag</option>
                            <option value="Other">Sonstiges</option>
                        </select>
                        {donationEvent === 'Other' && (
                            <input
                                type="text"
                                value={donationOtherEvent}
                                onChange={e => setDonationOtherEvent(e.target.value)}
                                placeholder="Name des Anlasses"
                                className="w-full border border-gray-200 bg-gray-50 rounded-xl px-3 py-2.5 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all mb-4"
                            />
                        )}

                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={saveDonation}
                                disabled={
                                    savingDonation || !donationDonor ||
                                    (!donationAmount.trim() && !donationGift.trim()) ||
                                    (!!donationAmount.trim() && !donationFundId)
                                }
                                className="flex-1 bg-accent text-white py-2.5 rounded-full text-sm font-medium disabled:opacity-40"
                            >
                                {savingDonation ? 'Wird gespeichert …' : 'Speichern'}
                            </button>
                            <button onClick={resetDonationModal} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-full text-sm">
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Donation Modal */}
            {deletingDonation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeletingDonation(null)} />
                    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 z-10">
                        <h2 className="text-lg font-bold text-gray-900 mb-2">Spende löschen?</h2>
                        <p className="text-sm text-gray-500 mb-4">
                            {deletingDonation.guest_name} — {[
                                deletingDonation.amount ? `$${deletingDonation.amount.toLocaleString('de-DE')} für ${deletingDonation.fund_item_title || 'einen Fonds'}` : null,
                                deletingDonation.gift ? `Geschenk: ${deletingDonation.gift}` : null,
                            ].filter(Boolean).join(' · ')}
                            . {deletingDonation.amount ? 'Der Betrag wird vom Fortschritt des Fonds abgezogen und das ' : 'Das '}lässt sich nicht rückgängig machen.
                        </p>
                        <div className="flex gap-2">
                            <button onClick={confirmDeleteDonation} disabled={savingDonation}
                                className="flex-1 bg-red-600 text-white py-2.5 rounded-full text-sm font-medium disabled:opacity-40">
                                {savingDonation ? 'Wird gelöscht …' : 'Löschen'}
                            </button>
                            <button onClick={() => setDeletingDonation(null)} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-full text-sm">
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete RSVP Modal */}
            {deletingRsvp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Löschen bestätigen</h3>
                        <p className="text-sm text-gray-500 mb-4">
                            Soll die Rückmeldung von <strong>{deletingRsvp.guest_name}</strong> wirklich gelöscht werden?
                            Das lässt sich nicht rückgängig machen.
                        </p>
                        <p className="text-sm text-gray-700 mb-2">
                            Gib zur Bestätigung <strong>{deletingRsvp.guest_name}</strong> ein:
                        </p>
                        <input
                            type="text"
                            value={confirmName}
                            onChange={(e) => setConfirmName(e.target.value)}
                            className="w-full px-4 py-3 border border-gray-200 bg-gray-50 rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400 sm:text-sm mb-6 transition-all"
                            placeholder="Gastnamen hier eingeben"
                        />
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => setDeletingRsvp(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleDeleteRsvp}
                                disabled={confirmName !== deletingRsvp.guest_name}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-full hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                Rückmeldung löschen
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add/Edit Guest Modal */}
            {(isAddingGuest || editingGuest) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
                        {/* Header */}
                        <div className="px-6 sm:px-8 pt-7 pb-5 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur z-10 rounded-t-3xl">
                            <h3 className="text-2xl font-bold text-gray-900">
                                {editingGuest ? 'Gast bearbeiten' : 'Gast hinzufügen'}
                            </h3>
                            <p className="text-sm text-gray-400 mt-1">
                                {editingGuest
                                    ? `Angaben zu ${guestForm.guest_name || 'diesem Gast'} aktualisieren.`
                                    : 'Neuen Gast zur Liste hinzufügen.'}
                            </p>
                        </div>

                        <div className="px-6 sm:px-8 py-6 space-y-6">
                            {/* Guest + party names */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        Gastname <span className="text-accent">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={guestForm.guest_name}
                                        onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                        placeholder="Vorname Nachname"
                                        required
                                    />
                                    <DietaryPills
                                        entry={guestForm.dietary[0] ?? {}}
                                        onChange={entry => {
                                            const dietary = [...guestForm.dietary];
                                            dietary[0] = entry;
                                            setGuestForm({ ...guestForm, dietary });
                                        }}
                                    />
                                    {/* Its own row, below the restrictions, because it is not one:
                                        it changes the bar charge on the budget, never the plate. */}
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                        <Under21Pill
                                            on={guestForm.under_21}
                                            onChange={under_21 => setGuestForm({ ...guestForm, under_21 })}
                                        />
                                    </div>
                                </div>

                                {Array.from({ length: Math.max(0, guestForm.party_size - 1) }, (_, i) => (
                                    <div key={i}>
                                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                            Name Gast {i + 2} <span className="text-gray-400 font-normal">(leer lassen, falls unbekannt)</span>
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={guestForm.party_members[i]?.name ?? ''}
                                                onChange={(e) => {
                                                    const updated = [...guestForm.party_members];
                                                    while (updated.length <= i) updated.push({ name: null, attending: null, under21: false });
                                                    updated[i] = { ...updated[i], name: e.target.value || null };
                                                    setGuestForm({ ...guestForm, party_members: updated });
                                                }}
                                                className="flex-1 min-w-0 px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                                placeholder="Optional"
                                            />
                                            {/* Per-person answer. The RSVP form sets this; it is editable here for
                                                the people who answer by phone. The seating chart reads it: someone
                                                marked Not coming is not given a chair. */}
                                            <select
                                                value={guestForm.party_members[i]?.attending === true ? 'yes' : guestForm.party_members[i]?.attending === false ? 'no' : ''}
                                                onChange={(e) => {
                                                    const updated = [...guestForm.party_members];
                                                    while (updated.length <= i) updated.push({ name: null, attending: null, under21: false });
                                                    updated[i] = {
                                                        ...updated[i],
                                                        attending: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : null,
                                                    };
                                                    setGuestForm({ ...guestForm, party_members: updated });
                                                }}
                                                className="w-32 shrink-0 px-3 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-sm text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                                title="Kommt diese Person?"
                                            >
                                                <option value="">Keine Antwort</option>
                                                <option value="yes">Kommt</option>
                                                <option value="no">Kommt nicht</option>
                                            </select>
                                        </div>
                                        {guestForm.party_members[i]?.attending !== false && (
                                            <>
                                                <DietaryPills
                                                    entry={guestForm.dietary[i + 1] ?? {}}
                                                    onChange={entry => {
                                                        const dietary = [...guestForm.dietary];
                                                        while (dietary.length <= i + 1) dietary.push({});
                                                        dietary[i + 1] = entry;
                                                        setGuestForm({ ...guestForm, dietary });
                                                    }}
                                                />
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                    <Under21Pill
                                                        on={!!guestForm.party_members[i]?.under21}
                                                        onChange={under21 => {
                                                            const updated = [...guestForm.party_members];
                                                            while (updated.length <= i) updated.push({ name: null, attending: null, under21: false });
                                                            updated[i] = { ...updated[i], under21 };
                                                            setGuestForm({ ...guestForm, party_members: updated });
                                                        }}
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ))}

                                {/* Saving a restriction for a household that never
                                    answered has to create their RSVP — say so before
                                    it happens, not after. */}
                                {!rsvpFor(guestForm.guest_name) && guestForm.dietary.some(e => !isEmptyEntry(e)) && (
                                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                                        Für diese Gruppe liegt keine Rückmeldung vor. Beim Speichern eines Ernährungshinweises wird eine angelegt,
                                        sodass sie als beantwortet zählt – in der Übersicht, in der Kopfzahl des Budgets
                                        und auf der Rückmeldungsseite, falls sie diese besuchen.
                                    </p>
                                )}
                            </div>

                            {/* Contact + details */}
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">E-Mail</label>
                                    <input
                                        type="email"
                                        value={guestForm.email}
                                        onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                        placeholder="name@example.com"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Telefon</label>
                                    <input
                                        type="tel"
                                        value={guestForm.phone}
                                        onChange={(e) => setGuestForm({ ...guestForm, phone: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                        placeholder="0151 23456789"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Personenzahl</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={guestForm.party_size}
                                        onChange={(e) => {
                                            const size = parseInt(e.target.value) || 1;
                                            const slots = Array.from({ length: Math.max(0, size - 1) }, (_, i) => ({
                                                name: guestForm.party_members[i]?.name ?? null,
                                                attending: guestForm.party_members[i]?.attending ?? null,
                                            }));
                                            setGuestForm({ ...guestForm, party_size: size, party_members: slots });
                                        }}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Seite</label>
                                    <select
                                        value={guestForm.side}
                                        onChange={(e) => setGuestForm({ ...guestForm, side: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                    >
                                        <option value="">Nicht angegeben</option>
                                        <option value="bride">Seite von {config?.brideName || "Braut"}</option>
                                        <option value="groom">Seite von {config?.groomName || "Bräutigam"}</option>
                                    </select>
                                </div>
                            </div>

                            {/* Relationship */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Beziehung</label>
                                <input
                                    type="text"
                                    value={guestForm.relationship}
                                    onChange={(e) => setGuestForm({ ...guestForm, relationship: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                    placeholder="z. B. Familie, Freund:in, Cousine der Braut"
                                />
                            </div>

                            {/* Flag */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Markierung</label>
                                <div className="flex flex-wrap gap-2">
                                    {([
                                        { v: '', l: 'Keine', on: 'bg-gray-800 text-white', off: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
                                        { v: 'issue', l: '⚠️ Problem', on: 'bg-red-500 text-white', off: 'bg-red-50 text-red-600 hover:bg-red-100' },
                                        { v: 'need', l: '📌 Nachfassen', on: 'bg-amber-500 text-white', off: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
                                    ] as { v: string; l: string; on: string; off: string }[]).map(opt => (
                                        <button
                                            key={opt.v || 'none'}
                                            type="button"
                                            onClick={() => setGuestForm({ ...guestForm, flag: opt.v })}
                                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all shadow-sm ${(guestForm.flag || '') === opt.v ? opt.on + ' shadow-md' : opt.off}`}
                                        >
                                            {opt.l}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-400 mt-1.5">Fügt der Zeile des Gastes eine farbige Markierung hinzu, damit sie sofort auffällt.</p>
                            </div>

                            {/* Notes */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notizen</label>
                                <textarea
                                    value={guestForm.notes}
                                    onChange={(e) => setGuestForm({ ...guestForm, notes: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all resize-y"
                                    rows={3}
                                    placeholder="Alles, was man über diesen Gast wissen sollte …"
                                />
                                <p className="text-xs text-gray-400 mt-1.5">Gäste mit Notiz erhalten eine 📝-Markierung und lassen sich über den Filter „Mit Notiz“ finden.</p>
                            </div>

                            {/* Address */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Adresse</label>
                                <textarea
                                    value={guestForm.address}
                                    onChange={(e) => setGuestForm({ ...guestForm, address: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all resize-y"
                                    rows={2}
                                    placeholder="Musterstraße 1, 12345 Musterstadt"
                                />
                            </div>

                            {/* Invited toggle */}
                            <label className="flex items-center gap-3 cursor-pointer bg-gray-50 rounded-2xl px-4 py-3 border border-gray-200 hover:bg-gray-100 transition-colors">
                                <input
                                    type="checkbox"
                                    checked={guestForm.invited}
                                    onChange={(e) => setGuestForm({ ...guestForm, invited: e.target.checked })}
                                    className="h-5 w-5 text-accent border-gray-300 rounded-md focus:ring-accent"
                                />
                                <span className="text-sm font-medium text-gray-700">Eingeladen</span>
                            </label>

                            {editingGuest && (
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Rückmeldestatus (Admin)</label>
                                    <select
                                        value={guestForm.rsvp_status}
                                        onChange={(e) => setGuestForm({ ...guestForm, rsvp_status: e.target.value })}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                    >
                                        <option value="">Keine Antwort</option>
                                        <option value="attending">Zusage</option>
                                        <option value="declined">Absage</option>
                                        <option value="likely_not_coming">Kommt wohl nicht</option>
                                    </select>
                                    <p className="text-xs text-gray-400 mt-1.5">Nur für Admins. „Kommt wohl nicht“ nimmt diesen Gast aus der erwarteten Personenzahl und dem Sitzplan heraus.</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 sm:px-8 py-5 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white/95 backdrop-blur rounded-b-3xl">
                            <button
                                onClick={() => {
                                    setIsAddingGuest(false);
                                    setEditingGuest(null);
                                }}
                                className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-all duration-300 shadow-sm hover:shadow-md"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleSaveGuest}
                                disabled={!guestForm.guest_name}
                                className="px-7 py-2.5 text-sm font-semibold text-white bg-accent rounded-full hover:bg-accent/90 disabled:opacity-50 transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                {editingGuest ? 'Gast aktualisieren' : 'Gast hinzufügen'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Edit Modal — applies only the fields that were actually set */}
            {showBulkModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur rounded-t-3xl">
                            <h3 className="text-2xl font-bold text-gray-900">{selectedGuests.length} {selectedGuests.length === 1 ? 'Gast' : 'Gäste'} bearbeiten</h3>
                            <p className="text-sm text-gray-500 mt-1">Alles, was auf <span className="font-semibold">Unverändert lassen</span> steht, bleibt unberührt.</p>
                        </div>

                        <div className="px-6 sm:px-8 py-6 space-y-6">
                            {/* Flag */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Markierung</label>
                                <div className="flex flex-wrap gap-2">
                                    {([
                                        { v: '', l: 'Unverändert lassen', on: 'bg-gray-800 text-white', off: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
                                        { v: 'issue', l: '⚠️ Problem', on: 'bg-red-600 text-white', off: 'bg-red-50 text-red-700 hover:bg-red-100' },
                                        { v: 'need', l: '📌 Nachfassen', on: 'bg-amber-500 text-white', off: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
                                        { v: 'clear', l: 'Markierung entfernen', on: 'bg-gray-600 text-white', off: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
                                    ]).map(opt => (
                                        <button
                                            key={opt.v || 'none'}
                                            type="button"
                                            onClick={() => setBulkFlag(opt.v)}
                                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all shadow-sm ${bulkFlag === opt.v ? opt.on + ' shadow-md' : opt.off}`}
                                        >
                                            {opt.l}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Note */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notiz</label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {([
                                        { v: 'append', l: 'Anhängen' },
                                        { v: 'replace', l: 'Ersetzen' },
                                        { v: 'clear', l: 'Notizen löschen' },
                                    ] as { v: 'append' | 'replace' | 'clear'; l: string }[]).map(opt => (
                                        <button
                                            key={opt.v}
                                            type="button"
                                            onClick={() => setBulkNoteMode(opt.v)}
                                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all shadow-sm ${
                                                bulkNoteMode === opt.v ? 'bg-accent text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                        >
                                            {opt.l}
                                        </button>
                                    ))}
                                </div>
                                {bulkNoteMode !== 'clear' ? (
                                    <>
                                        <textarea
                                            value={bulkNote}
                                            onChange={(e) => setBulkNote(e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 placeholder-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all resize-y"
                                            rows={3}
                                            placeholder={bulkNoteMode === 'append' ? 'Wird bei jedem ausgewählten Gast in einer eigenen Zeile angehängt …' : 'Überschreibt die Notiz bei jedem ausgewählten Gast …'}
                                        />
                                        <p className="text-xs text-gray-400 mt-1.5">
                                            {bulkNoteMode === 'append'
                                                ? 'Bestehende Notizen bleiben erhalten – der Text kommt in eine neue Zeile darunter. Leer lassen zum Überspringen.'
                                                : '⚠️ Ersetzt die bisherige Notiz jedes ausgewählten Gastes. Leer lassen zum Überspringen.'}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-xs text-red-600 font-semibold">⚠️ Löscht die Notiz bei allen {selectedGuests.length} ausgewählten {selectedGuests.length === 1 ? 'Gast' : 'Gästen'}.</p>
                                )}
                            </div>

                            {/* Side */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Seite</label>
                                <select
                                    value={bulkSide}
                                    onChange={(e) => setBulkSide(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                >
                                    <option value="">Unverändert lassen</option>
                                    <option value="bride">Seite von {config?.brideName || 'Braut'}</option>
                                    <option value="groom">Seite von {config?.groomName || 'Bräutigam'}</option>
                                    <option value="clear">Seite entfernen</option>
                                </select>
                            </div>

                            {/* RSVP Status */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Rückmeldestatus</label>
                                <select
                                    value={bulkRsvp}
                                    onChange={(e) => setBulkRsvp(e.target.value)}
                                    className="w-full px-4 py-3 border border-gray-200 rounded-2xl bg-gray-50 text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-all"
                                >
                                    <option value="">Unverändert lassen</option>
                                    <option value="likely_not_coming">Kommt wohl nicht</option>
                                    <option value="attending">Zusage</option>
                                    <option value="declined">Absage</option>
                                    <option value="clear">Auf „Keine Antwort“ zurücksetzen</option>
                                </select>
                                <p className="text-xs text-gray-400 mt-1.5">Nur für Admins. Das ist die tatsächliche Antwort der Gäste – ändere sie nur mit Bedacht für mehrere auf einmal.</p>
                            </div>

                            {bulkResult && (
                                <p className="text-sm font-semibold text-red-600">{bulkResult}</p>
                            )}
                        </div>

                        <div className="px-6 sm:px-8 py-5 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white/95 backdrop-blur rounded-b-3xl">
                            <button
                                onClick={() => setShowBulkModal(false)}
                                className="px-6 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-all duration-300 shadow-sm hover:shadow-md"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={handleBulkEdit}
                                disabled={bulkSaving}
                                className="px-6 py-2.5 text-sm font-semibold text-white bg-accent rounded-full hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 shadow-md hover:shadow-lg"
                            >
                                {bulkSaving ? 'Wird angewendet …' : `Auf ${selectedGuests.length} anwenden`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Address Reconcile Modal */}
            {showReconcileModal && (
                <AddressReconcileModal
                    guests={guests}
                    onClose={() => setShowReconcileModal(false)}
                    onApplied={fetchGuests}
                />
            )}

            {/* CSV Import Modal */}
            {showImportModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">Gäste aus CSV importieren</h3>

                        {!importResults ? (
                            <>
                                <div className="mb-6">
                                    <p className="text-sm text-gray-600 mb-4">
                                        Lade eine CSV-Datei mit Gästedaten hoch. Die CSV braucht eine Kopfzeile mit diesen Spalten:
                                    </p>
                                    <div className="bg-gray-50 p-4 rounded-2xl">
                                        <code className="text-sm text-gray-800">
                                            name,email,phone,party_size,side,notes,plus_one_name,address
                                        </code>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Beispiel: Max Mustermann,john@email.com,555-1234,2,bride,Veganes Essen,Erika Mustermann,&quot;123 Main St, Milwaukee, WI 53201&quot;
                                    </p>
                                </div>

                                <div className="mb-6">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        CSV-Datei auswählen
                                    </label>
                                    <input
                                        type="file"
                                        accept=".csv"
                                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                                        className="w-full text-sm text-gray-600 file:mr-3 file:px-4 file:py-2 file:rounded-full file:border-0 file:bg-accent file:text-white file:font-semibold file:cursor-pointer border border-gray-200 bg-gray-50 rounded-2xl px-3 py-2.5"
                                    />
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => {
                                            setShowImportModal(false);
                                            setCsvFile(null);
                                            setImportResults(null);
                                        }}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        onClick={handleImportCSV}
                                        disabled={!csvFile || importing}
                                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-full hover:bg-green-700 disabled:opacity-50 transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        {importing ? 'Wird importiert …' : 'Importieren'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="mb-6">
                                    <h4 className="text-lg font-semibold text-gray-900 mb-3">Importergebnis</h4>
                                    <div className="grid grid-cols-3 gap-4 mb-4">
                                        <div className="bg-green-50 p-4 rounded-2xl">
                                            <p className="text-sm text-gray-600">Hinzugefügt</p>
                                            <p className="text-2xl font-bold text-green-600">{importResults.added}</p>
                                        </div>
                                        <div className="bg-blue-50 p-4 rounded-2xl">
                                            <p className="text-sm text-gray-600">Aktualisiert</p>
                                            <p className="text-2xl font-bold text-blue-600">{importResults.updated}</p>
                                        </div>
                                        <div className="bg-red-50 p-4 rounded-2xl">
                                            <p className="text-sm text-gray-600">Fehlgeschlagen</p>
                                            <p className="text-2xl font-bold text-red-600">{importResults.failed}</p>
                                        </div>
                                    </div>

                                    {importResults.errors.length > 0 && (
                                        <div className="bg-red-50 p-4 rounded-2xl max-h-48 overflow-y-auto">
                                            <p className="text-sm font-semibold text-red-800 mb-2">Fehler:</p>
                                            <ul className="text-xs text-red-700 space-y-1">
                                                {importResults.errors.map((error, idx) => (
                                                    <li key={idx}>• {error}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-end">
                                    <button
                                        onClick={() => {
                                            setShowImportModal(false);
                                            setCsvFile(null);
                                            setImportResults(null);
                                        }}
                                        className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-full hover:bg-accent/90 transition-all duration-300 shadow-md hover:shadow-lg"
                                    >
                                        Schließen
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
