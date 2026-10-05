'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SaveStatus, useAutosave } from '@/components/admin/useAutosave';
import type { FundItem } from '@/lib/config';
import type { RegistryItem } from '@/app/api/admin/registry-items/route';

interface PaymentEntry { handle: string; label: string; }

interface FundConfig {
    enabled: boolean;
    showFinancials: boolean;
    title: string;
    subtitle: string;
    description: string;
    zelle: PaymentEntry;
    venmo: PaymentEntry;
    cashapp: PaymentEntry;
    paypal: PaymentEntry;
    items: FundItem[];
}

const DEFAULTS: FundConfig = {
    enabled: false,
    showFinancials: true,
    title: 'Wunschliste',
    subtitle: 'Helft uns, unser gemeinsames Abenteuer zu starten',
    description: 'Eure Anwesenheit bei unserer Hochzeit ist das schönste Geschenk. Wenn ihr uns trotzdem eine kleine Freude machen möchtet, würden wir uns über einen Beitrag zu unserer Wunschliste riesig freuen!',
    zelle: { handle: '', label: 'Per Zelle senden' },
    venmo: { handle: '', label: 'Per Venmo senden' },
    cashapp: { handle: '', label: 'Per Cash App senden' },
    paypal: { handle: '', label: 'Per PayPal senden (Freunde & Familie)' },
    items: [],
};

const BLANK_ITEM: Omit<FundItem, 'id'> = { title: '', description: '', emoji: '✈️', price: 0, funded: 0 };

function genId() { return Math.random().toString(36).slice(2, 10); }

export default function AdminRegistryPage() {
    const [fund, setFund] = useState<FundConfig>(DEFAULTS);
    const [bgColor, setBgColor] = useState('#ffffff');
    const [registryPageSubtitle, setRegistryPageSubtitle] = useState('');
    const [loading, setLoading] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [tab, setTab] = useState<'settings' | 'experiences' | 'registry'>('experiences');
    const [registryItems, setRegistryItems] = useState<RegistryItem[]>([]);
    const [urlInput, setUrlInput] = useState('');
    const [fetching, setFetching] = useState(false);
    const [fetchError, setFetchError] = useState('');
    const [pendingItem, setPendingItem] = useState<Partial<RegistryItem> | null>(null);
    const [editingRegItem, setEditingRegItem] = useState<RegistryItem | null>(null);
    const urlInputRef = useRef<HTMLInputElement>(null);
    const [editingItem, setEditingItem] = useState<FundItem | null>(null);
    const [newItem, setNewItem] = useState<Omit<FundItem, 'id'>>(BLANK_ITEM);
    const [showAddForm, setShowAddForm] = useState(false);
    const [contributingItem, setContributingItem] = useState<FundItem | null>(null);
    const [contributionAmount, setContributionAmount] = useState('');
    const [donorGuests, setDonorGuests] = useState<{ id: number; guest_name: string; party_members?: { name: string | null }[]; plus_one_name?: string | null }[]>([]);
    const [donorSearch, setDonorSearch] = useState('');
    const [selectedDonor, setSelectedDonor] = useState<{ id: number | null; guest_name: string } | null>(null);
    const [donationEvent, setDonationEvent] = useState('Wedding Day');
    const [otherEvent, setOtherEvent] = useState('');
    const [coGivers, setCoGivers] = useState<{ id: number | null; name: string }[]>([]);
    const [coGiverSearch, setCoGiverSearch] = useState('');
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [targetImporting, setTargetImporting] = useState(false);
    const [targetImportResult, setTargetImportResult] = useState<{ added: number; skipped: number } | null>(null);
    const [showTargetBookmarklet, setShowTargetBookmarklet] = useState(false);
    const targetCsvRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch('/api/admin/site-config')
            .then(r => r.json())
            .then(data => {
                if (data.registry) setFund({ ...DEFAULTS, ...data.registry, items: data.registry.items || [] });
                setBgColor(data.pageBgColors?.registry || '#ffffff');
                if (data.registryPageSubtitle) setRegistryPageSubtitle(data.registryPageSubtitle);
                setLoaded(true);
            })
            .finally(() => setLoading(false));
        fetch('/api/admin/registry-items')
            .then(r => r.json())
            .then(items => setRegistryItems(Array.isArray(items) ? items : []));
        fetch('/api/admin/guest-list')
            .then(r => r.json())
            .then(data => setDonorGuests(Array.isArray(data) ? data.map((g: { id: number; guest_name: string; party_members?: { name: string | null }[]; plus_one_name?: string | null }) => ({ id: g.id, guest_name: g.guest_name, party_members: g.party_members, plus_one_name: g.plus_one_name })) : []));
    }, []);

    const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        setImportResult(null);
        try {
            const text = await file.text();
            const res = await fetch('/api/admin/registry-items/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: text }),
            });
            const data = await res.json();
            if (data.success) {
                setImportResult({ added: data.added, skipped: data.skipped });
                // Refresh item list
                const items = await fetch('/api/admin/registry-items').then(r => r.json());
                setRegistryItems(Array.isArray(items) ? items : []);
            } else {
                setImportResult({ added: 0, skipped: -1 });
                alert(data.error || 'Import fehlgeschlagen.');
            }
        } catch {
            alert('Die CSV-Datei konnte nicht gelesen werden.');
        } finally {
            setImporting(false);
            // Reset file input so same file can be re-selected
            if (csvInputRef.current) csvInputRef.current.value = '';
        }
    };

    const handleTargetCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setTargetImporting(true);
        setTargetImportResult(null);
        try {
            const text = await file.text();
            const res = await fetch('/api/admin/registry-items/import-target', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: text }),
            });
            const data = await res.json();
            if (data.success) {
                setTargetImportResult({ added: data.added, skipped: data.skipped });
                const items = await fetch('/api/admin/registry-items').then(r => r.json());
                setRegistryItems(Array.isArray(items) ? items : []);
            } else {
                alert(data.error || 'Import fehlgeschlagen.');
            }
        } catch {
            alert('Die CSV-Datei konnte nicht gelesen werden.');
        } finally {
            setTargetImporting(false);
            if (targetCsvRef.current) targetCsvRef.current.value = '';
        }
    };

    const fetchMeta = async () => {
        if (!urlInput.trim()) return;
        setFetching(true);
        setFetchError('');
        setPendingItem(null);
        try {
            const res = await fetch('/api/admin/fetch-meta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: urlInput.trim() }),
            });
            const data = await res.json();
            setPendingItem({
                id: Math.random().toString(36).slice(2, 10),
                store: data.store || 'other',
                title: data.title || '',
                description: data.description || '',
                image: data.image || '',
                price: data.price || '',
                url: urlInput.trim(),
            });
            if (!data.success) setFetchError(data.error || 'Automatisches Abrufen nicht möglich – bitte unten manuell ausfüllen.');
        } catch {
            setFetchError('Netzwerkfehler beim Abrufen der URL.');
            setPendingItem({ id: Math.random().toString(36).slice(2, 10), store: 'other', title: '', description: '', image: '', price: '', url: urlInput.trim() });
        } finally {
            setFetching(false);
        }
    };

    const saveRegistryItem = async (item: RegistryItem) => {
        const res = await fetch('/api/admin/registry-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
        });
        if (res.ok) {
            setRegistryItems(prev => [...prev, item]);
            setPendingItem(null);
            setUrlInput('');
            setFetchError('');
        }
    };

    const updateRegistryItem = async (item: RegistryItem) => {
        const res = await fetch('/api/admin/registry-items', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
        });
        if (res.ok) {
            setRegistryItems(prev => prev.map(i => i.id === item.id ? item : i));
            setEditingRegItem(null);
        }
    };

    const deleteRegistryItem = async (id: string) => {
        const res = await fetch('/api/admin/registry-items', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        if (res.ok) setRegistryItems(prev => prev.filter(i => i.id !== id));
    };

    /*
     * Only this page's keys.
     *
     * This used to GET the whole config, mutate three fields and POST all of it
     * back, which overwrote whatever another editor had saved in between. That
     * was a narrow window with a Save button; with autosave firing on every
     * keystroke it would be a wide one.
     */
    const save = useCallback(async (body: {
        registry: FundConfig; pageBgColors: { registry: string }; registryPageSubtitle: string;
    }) => {
        const res = await fetch('/api/admin/site-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
    }, []);

    const addItem = () => {
        if (!newItem.title || !newItem.price) return;
        const item: FundItem = { ...newItem, id: genId() };
        const updated = { ...fund, items: [...fund.items, item] };
        setFund(updated);
        setNewItem(BLANK_ITEM);
        setShowAddForm(false);
    };

    const payload = useMemo(() => ({
        registry: fund,
        pageBgColors: { registry: bgColor },
        registryPageSubtitle,
    }), [fund, bgColor, registryPageSubtitle]);

    const { state, retry } = useAutosave({ value: payload, ready: loaded, save });

    const deleteItem = (id: string) => {
        const updated = { ...fund, items: fund.items.filter(i => i.id !== id) };
        setFund(updated);
    };

    const saveEditItem = () => {
        if (!editingItem) return;
        const updated = { ...fund, items: fund.items.map(i => i.id === editingItem.id ? editingItem : i) };
        setFund(updated);
        setEditingItem(null);
    };

    // People selectable as a donor / co-giver: every primary guest PLUS their
    // plus-ones and party members (nested names on the guest row, not their own
    // guest-list entries). id is null for non-primary people.
    const donorPeople = donorGuests.flatMap(g => {
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

    const addCoGiver = (person: { id: number | null; name: string }) => {
        const name = person.name.trim();
        if (!name) return;
        if (coGivers.some(c => c.name.toLowerCase() === name.toLowerCase())) { setCoGiverSearch(''); return; }
        setCoGivers([...coGivers, { id: person.id, name }]);
        setCoGiverSearch('');
    };
    const removeCoGiver = (name: string) => setCoGivers(coGivers.filter(c => c.name !== name));

    const logContribution = async () => {
        if (!contributingItem) return;
        const amount = parseFloat(contributionAmount);
        if (!amount || isNaN(amount)) return;
        const eventValue = donationEvent === 'Other' ? (otherEvent.trim() || 'Other') : donationEvent;
        const updated = {
            ...fund,
            items: fund.items.map(i => i.id === contributingItem.id
                ? { ...i, funded: Math.min(i.price, i.funded + amount) }
                : i
            ),
        };
        setFund(updated);
        if (selectedDonor) {
            try {
                await fetch('/api/admin/donations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        guest_id: selectedDonor.id,
                        guest_name: selectedDonor.guest_name,
                        amount,
                        fund_item_id: contributingItem.id,
                        fund_item_title: contributingItem.title,
                        event: eventValue,
                        co_donors: coGivers,
                    }),
                });
            } catch (e) {
                console.error('Failed to record donation:', e);
            }
        }
        setContributingItem(null);
        setContributionAmount('');
        setDonorSearch('');
        setSelectedDonor(null);
        setDonationEvent('Wedding Day');
        setOtherEvent('');
        setCoGivers([]);
        setCoGiverSearch('');
    };

    const updatePayment = (key: 'zelle' | 'venmo' | 'cashapp' | 'paypal', field: keyof PaymentEntry, value: string) => {
        setFund(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    };

    if (loading) return <div className="p-8 text-gray-500">Wird geladen …</div>;

    const totalGoal = fund.items.reduce((s, i) => s + i.price, 0);
    const totalFunded = fund.items.reduce((s, i) => s + i.funded, 0);

    return (
        <div className="max-w-4xl">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold mb-1">Wunschliste</h1>
                    <p className="text-gray-500">Erstelle deine Wunschliste im Honeyfund-Stil.</p>
                </div>
                <div className="flex items-center gap-4">
                    <SaveStatus state={state} onRetry={retry} />
                    <a
                        href="/admin/rsvps?tab=donations"
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 shadow-md hover:shadow-lg transition-all duration-300"
                    >
                        Spenden ansehen →
                    </a>
                    <a
                        href="/registry"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent-dark shadow-md hover:shadow-lg transition-all duration-300"
                    >
                        Seite ansehen →
                    </a>
                </div>
            </div>

            {/* Enable toggle */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-3 flex items-center justify-between">
                <div>
                    <h2 className="font-semibold text-gray-900">Seite aktiviert</h2>
                    <p className="text-sm text-gray-500">Diese Seite für Besucher anzeigen</p>
                </div>
                <button
                    onClick={() => setFund(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${fund.enabled ? 'bg-accent' : 'bg-gray-300'}`}
                >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${fund.enabled ? 'translate-x-8' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Show financials toggle */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 flex items-center justify-between">
                <div>
                    <h2 className="font-semibold text-gray-900">Finanzdetails anzeigen</h2>
                    <p className="text-sm text-gray-500">Preise, Fortschrittsbalken und Beträge für Gäste anzeigen</p>
                </div>
                <button
                    onClick={() => { const updated = { ...fund, showFinancials: !fund.showFinancials }; setFund(updated); }}
                    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${fund.showFinancials !== false ? 'bg-accent' : 'bg-gray-300'}`}
                >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-sm ${fund.showFinancials !== false ? 'translate-x-8' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
                {([
                    { key: 'experiences', label: 'Flitterwochen-Fonds' },
                    { key: 'registry', label: 'Wunschlisten-Artikel' },
                    { key: 'settings', label: 'Einstellungen' },
                ] as const).map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── EXPERIENCES TAB ── */}
            {tab === 'experiences' && (
                <div>
                    {/* Stats */}
                    {fund.items.length > 0 && (
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            {[
                                { label: 'Gesamtziel', value: `$${totalGoal.toLocaleString('de-DE')}` },
                                { label: 'Bisher finanziert', value: `$${totalFunded.toLocaleString('de-DE')}` },
                                { label: 'Fortschritt', value: `${totalGoal > 0 ? Math.round((totalFunded / totalGoal) * 100) : 0}%` },
                            ].map(s => (
                                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
                                    <p className="text-2xl font-bold text-accent">{s.value}</p>
                                    <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Items list */}
                    <div className="space-y-4 mb-6">
                        {fund.items.map(item => {
                            const pct = Math.min(100, item.price > 0 ? Math.round((item.funded / item.price) * 100) : 0);
                            return (
                                <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                                    {editingItem?.id === item.id ? (
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Emoji</label>
                                                    <input value={editingItem.emoji} onChange={e => setEditingItem({ ...editingItem, emoji: e.target.value })}
                                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Preis ($)</label>
                                                    <input type="number" value={editingItem.price} onChange={e => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) || 0 })}
                                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-1 block">Titel</label>
                                                <input value={editingItem.title} onChange={e => setEditingItem({ ...editingItem, title: e.target.value })}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-1 block">Beschreibung</label>
                                                <textarea rows={2} value={editingItem.description} onChange={e => setEditingItem({ ...editingItem, description: e.target.value })}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={saveEditItem} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium">Speichern</button>
                                                <button onClick={() => setEditingItem(null)} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm">Abbrechen</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-start gap-4">
                                            <span className="text-3xl">{item.emoji}</span>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <h3 className="font-bold text-gray-900">{item.title}</h3>
                                                    {pct >= 100 && <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">Finanziert!</span>}
                                                </div>
                                                <p className="text-gray-500 text-sm mb-2">{item.description}</p>
                                                <div className="flex items-center gap-3 text-sm">
                                                    <span className="font-semibold text-accent">${item.funded.toLocaleString('de-DE')} / ${item.price.toLocaleString('de-DE')}</span>
                                                    <span className="text-gray-400">{pct}%</span>
                                                </div>
                                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
                                                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
                                                </div>
                                            </div>
                                            <div className="flex gap-2 shrink-0">
                                                <button onClick={() => { setContributingItem(item); setContributionAmount(''); }}
                                                    className="text-xs bg-green-50 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg font-medium hover:bg-green-100 transition-colors">
                                                    + Geschenk erfassen
                                                </button>
                                                <button onClick={() => setEditingItem(item)}
                                                    className="text-xs bg-gray-50 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                                                    Bearbeiten
                                                </button>
                                                <button onClick={() => deleteItem(item.id)}
                                                    className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                                                    Löschen
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Add item */}
                    {showAddForm ? (
                        <div className="bg-white rounded-2xl border-2 border-dashed border-accent/30 p-6 space-y-4">
                            <h3 className="font-semibold text-gray-900">Neues Erlebnis</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Emoji</label>
                                    <input value={newItem.emoji} onChange={e => setNewItem({ ...newItem, emoji: e.target.value })}
                                        placeholder="✈️" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-600 mb-1 block">Preis ($)</label>
                                    <input type="number" value={newItem.price || ''} onChange={e => setNewItem({ ...newItem, price: parseFloat(e.target.value) || 0 })}
                                        placeholder="250" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Titel</label>
                                <input value={newItem.title} onChange={e => setNewItem({ ...newItem, title: e.target.value })}
                                    placeholder="Eine Nacht im Resort" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 mb-1 block">Beschreibung</label>
                                <textarea rows={2} value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                                    placeholder="Helft uns, eine wunderschöne Nacht in unserem Traumresort zu genießen …" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                            </div>
                            <div className="flex gap-2">
                                <button onClick={addItem} disabled={!newItem.title || !newItem.price}
                                    className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                                    Erlebnis hinzufügen
                                </button>
                                <button onClick={() => { setShowAddForm(false); setNewItem(BLANK_ITEM); }}
                                    className="bg-gray-100 text-gray-700 px-5 py-2 rounded-lg text-sm">
                                    Abbrechen
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setShowAddForm(true)}
                            className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-4 text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-colors text-sm font-medium">
                            + Erlebnis hinzufügen
                        </button>
                    )}
                </div>
            )}

            {/* ── REGISTRY ITEMS TAB ── */}
            {tab === 'registry' && (
                <div>
                    <p className="text-sm text-gray-500 mb-6">Füge die URL eines Produkts von Target oder Amazon ein, und die Details werden automatisch übernommen. Vor dem Speichern lässt sich alles bearbeiten.</p>

                    {/* Amazon CSV import */}
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <h3 className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                                    📦 Aus Amazon-Wunschlisten-CSV importieren
                                </h3>
                                <p className="text-xs text-amber-700 mt-1">
                                    Gehe bei Amazon zu deiner Wunschliste → <strong>Verwalten</strong> → <strong>Liste als Tabelle herunterladen (.csv)</strong>. Lade sie dann hier hoch – jeder Artikel wird einzeln importiert.
                                </p>
                                {importResult && (
                                    <p className={`text-xs mt-2 font-medium ${importResult.added > 0 ? 'text-green-700' : 'text-gray-600'}`}>
                                        ✓ {importResult.added} {importResult.added !== 1 ? 'Artikel' : 'Artikel'} hinzugefügt
                                        {importResult.skipped > 0 ? `, ${importResult.skipped} übersprungen (bereits vorhanden)` : ''}
                                    </p>
                                )}
                            </div>
                            <div className="shrink-0">
                                <input
                                    ref={csvInputRef}
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={handleCsvImport}
                                />
                                <button
                                    onClick={() => csvInputRef.current?.click()}
                                    disabled={importing}
                                    className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {importing ? 'Wird importiert …' : 'CSV hochladen'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Target import */}
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-semibold text-red-900 flex items-center gap-2">
                                    🎯 Aus Target-Wunschliste importieren
                                </h3>
                                <p className="text-xs text-red-700 mt-1">
                                    Target bietet keinen eigenen Export, nutze daher das Bookmarklet unten.
                                    Führe es auf deiner Target-Wunschlistenseite aus – es lädt automatisch eine CSV herunter.
                                </p>

                                {/* Bookmarklet section */}
                                <div className="mt-3">
                                    <button
                                        onClick={() => setShowTargetBookmarklet(v => !v)}
                                        className="text-xs text-red-700 underline font-medium"
                                    >
                                        Anleitung zum Bookmarklet {showTargetBookmarklet ? 'ausblenden' : 'anzeigen'} →
                                    </button>

                                    {showTargetBookmarklet && (
                                        <div className="mt-3 space-y-3">
                                            <p className="text-xs text-red-800 font-medium">Schritt 1 – Bookmarklet zum Browser hinzufügen:</p>
                                            <p className="text-xs text-red-700">
                                                Ziehe diesen Link in deine Lesezeichenleiste oder klicke mit der rechten Maustaste → Link als Lesezeichen speichern:
                                            </p>
                                            <a
                                                href={`javascript:(function(){var items=[];document.querySelectorAll('[data-test="registry-item"]').forEach(function(el){var title=(el.querySelector('[data-test="product-title"]')||el.querySelector('a[href*="/p/"]')||{}).textContent||'';var price=(el.querySelector('[data-test="current-price"]')||el.querySelector('[data-test="reg-price"]')||{}).textContent||'';var img=(el.querySelector('img')||{}).src||'';var link=el.querySelector('a[href*="/p/"]');var url=link?'https://www.target.com'+link.getAttribute('href'):'';if(title.trim())items.push({title:title.trim(),price:price.trim(),image:img,url:url});});if(!items.length){alert('Keine Artikel gefunden. Stelle sicher, dass du auf deiner Target-Wunschlistenseite bist und die Artikel sichtbar sind.');return;}var csv='title,price,image,url\\n'+items.map(function(i){return[i.title,i.price,i.image,i.url].map(function(v){return'"'+v.replace(/"/g,'""')+'"';}).join(',');}).join('\\n');var a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='target-registry.csv';a.click();alert(items.length+' Artikel heruntergeladen. Lade die CSV-Datei im Admin-Bereich hoch.');})();`}
                                                className="inline-block bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg cursor-grab"
                                                onClick={e => e.preventDefault()}
                                            >
                                                🎯 Target-Wunschliste exportieren
                                            </a>
                                            <p className="text-xs text-red-800 font-medium">Schritt 2 – Auf Target ausführen:</p>
                                            <ol className="text-xs text-red-700 list-decimal list-inside space-y-1">
                                                <li>Öffne <strong>target.com</strong> → deine Wunschliste → <strong>Manage registry</strong></li>
                                                <li>Scrolle nach unten, damit alle Artikel auf der Seite geladen sind</li>
                                                <li>Klicke auf das Lesezeichen <strong>„🎯 Export Target Registry“</strong></li>
                                                <li>Eine Datei <code>target-registry.csv</code> wird automatisch heruntergeladen</li>
                                            </ol>
                                            <p className="text-xs text-red-800 font-medium">Schritt 3 – Hier hochladen:</p>
                                        </div>
                                    )}
                                </div>

                                {targetImportResult && (
                                    <p className={`text-xs mt-2 font-medium ${targetImportResult.added > 0 ? 'text-green-700' : 'text-gray-600'}`}>
                                        ✓ {targetImportResult.added} Artikel hinzugefügt
                                        {targetImportResult.skipped > 0 ? `, ${targetImportResult.skipped} übersprungen (bereits vorhanden)` : ''}
                                    </p>
                                )}
                            </div>

                            <div className="shrink-0">
                                <input
                                    ref={targetCsvRef}
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={handleTargetCsvImport}
                                />
                                <button
                                    onClick={() => targetCsvRef.current?.click()}
                                    disabled={targetImporting}
                                    className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    {targetImporting ? 'Wird importiert …' : 'CSV hochladen'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* URL fetch bar */}
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Artikel per URL hinzufügen</label>
                        <div className="flex gap-2">
                            <input
                                ref={urlInputRef}
                                type="url"
                                value={urlInput}
                                onChange={e => setUrlInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && fetchMeta()}
                                placeholder="https://www.target.com/p/..."
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                disabled={fetching}
                            />
                            <button
                                onClick={fetchMeta}
                                disabled={fetching || !urlInput.trim()}
                                className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40 shrink-0"
                            >
                                {fetching ? 'Wird abgerufen …' : 'Abrufen →'}
                            </button>
                        </div>
                        {fetchError && <p className="text-amber-600 text-xs mt-2">⚠️ {fetchError}</p>}
                    </div>

                    {/* Pending item preview / edit form */}
                    {pendingItem && (
                        <div className="bg-white rounded-2xl border-2 border-accent/30 shadow-sm p-5 mb-6">
                            <h3 className="font-semibold text-gray-900 mb-4">Prüfen &amp; speichern</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Image preview */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Bild-URL</label>
                                    <input
                                        type="text"
                                        value={pendingItem.image || ''}
                                        onChange={e => setPendingItem(p => p ? { ...p, image: e.target.value } : p)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs mb-2"
                                        placeholder="https://..."
                                    />
                                    {pendingItem.image && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={pendingItem.image} alt="" className="w-full h-40 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                                    )}
                                </div>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Shop</label>
                                        <select
                                            value={pendingItem.store || 'other'}
                                            onChange={e => setPendingItem(p => p ? { ...p, store: e.target.value as RegistryItem['store'] } : p)}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                        >
                                            <option value="target">Target</option>
                                            <option value="amazon">Amazon</option>
                                            <option value="other">Sonstiges</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                                        <input
                                            type="text"
                                            value={pendingItem.title || ''}
                                            onChange={e => setPendingItem(p => p ? { ...p, title: e.target.value } : p)}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Preis (nur zur Anzeige)</label>
                                        <input
                                            type="text"
                                            value={pendingItem.price || ''}
                                            onChange={e => setPendingItem(p => p ? { ...p, price: e.target.value } : p)}
                                            placeholder="$29.99"
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3">
                                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                                <textarea
                                    rows={2}
                                    value={pendingItem.description || ''}
                                    onChange={e => setPendingItem(p => p ? { ...p, description: e.target.value } : p)}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                                />
                            </div>
                            <div className="flex gap-2 mt-4">
                                <button
                                    onClick={() => pendingItem.title && saveRegistryItem(pendingItem as RegistryItem)}
                                    disabled={!pendingItem.title}
                                    className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                                >
                                    Artikel speichern
                                </button>
                                <button
                                    onClick={() => { setPendingItem(null); setUrlInput(''); setFetchError(''); }}
                                    className="bg-gray-100 text-gray-700 px-5 py-2 rounded-lg text-sm"
                                >
                                    Abbrechen
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Saved items list */}
                    {registryItems.length === 0 && !pendingItem && (
                        <div className="text-center py-16 text-gray-400">
                            <p className="text-4xl mb-3">🛍️</p>
                            <p className="text-sm">Noch keine Artikel – füge oben eine URL ein, um den ersten hinzuzufügen.</p>
                        </div>
                    )}

                    {['target', 'amazon', 'other'].map(store => {
                        const storeItems = registryItems.filter(i => i.store === store);
                        if (storeItems.length === 0) return null;
                        const storeLabel = store === 'target' ? '🎯 Target' : store === 'amazon' ? '📦 Amazon' : '🛍️ Sonstiges';
                        return (
                            <div key={store} className="mb-8">
                                <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wider mb-3">{storeLabel}</h3>
                                <div className="space-y-3">
                                    {storeItems.map(item => (
                                        <div key={item.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                                            {editingRegItem?.id === item.id ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1">Bild-URL</label>
                                                        <input type="text" value={editingRegItem.image}
                                                            onChange={e => setEditingRegItem(p => p ? { ...p, image: e.target.value } : p)}
                                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs mb-2" />
                                                        {editingRegItem.image && (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={editingRegItem.image} alt="" className="w-full h-32 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                                                        )}
                                                    </div>
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                                                            <input type="text" value={editingRegItem.title}
                                                                onChange={e => setEditingRegItem(p => p ? { ...p, title: e.target.value } : p)}
                                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-600 mb-1">Preis</label>
                                                            <input type="text" value={editingRegItem.price}
                                                                onChange={e => setEditingRegItem(p => p ? { ...p, price: e.target.value } : p)}
                                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                                                            <textarea rows={2} value={editingRegItem.description}
                                                                onChange={e => setEditingRegItem(p => p ? { ...p, description: e.target.value } : p)}
                                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                                                        </div>
                                                    </div>
                                                    <div className="sm:col-span-2 flex gap-2">
                                                        <button onClick={() => updateRegistryItem(editingRegItem)} className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium">Speichern</button>
                                                        <button onClick={() => setEditingRegItem(null)} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm">Abbrechen</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-4">
                                                    {item.image
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        ? <img src={item.image} alt={item.title} className="w-16 h-16 object-contain rounded-lg border border-gray-100 bg-gray-50 shrink-0" />
                                                        : <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-2xl shrink-0">🛍️</div>
                                                    }
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-gray-900 text-sm truncate">{item.title}</p>
                                                        {item.price && <p className="text-accent font-medium text-sm">{item.price}</p>}
                                                        <p className="text-gray-400 text-xs truncate mt-0.5">{item.description}</p>
                                                    </div>
                                                    <div className="flex gap-2 shrink-0">
                                                        <button onClick={() => setEditingRegItem(item)}
                                                            className="text-xs bg-gray-50 text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                                                            Bearbeiten
                                                        </button>
                                                        <button onClick={() => deleteRegistryItem(item.id)}
                                                            className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                                                            Löschen
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── SETTINGS TAB ── */}
            {tab === 'settings' && (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
                        <h2 className="text-lg font-semibold text-gray-900">Seiteninhalt</h2>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Seitentitel</label>
                            <input type="text" value={fund.title} onChange={e => setFund(p => ({ ...p, title: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Wunschliste" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Untertitel</label>
                            <input type="text" value={fund.subtitle} onChange={e => setFund(p => ({ ...p, subtitle: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                            <textarea rows={4} value={fund.description} onChange={e => setFund(p => ({ ...p, description: e.target.value }))}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Untertitel der Navigationskarte</label>
                            <p className="text-xs text-gray-500 mb-1">Kurzer Slogan auf der Wunschlisten-Karte unten auf der Startseite.</p>
                            <input type="text" value={registryPageSubtitle} onChange={e => setRegistryPageSubtitle(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                placeholder="z. B. Helft uns, unser Abenteuer zu starten" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Hintergrundfarbe</label>
                            <div className="flex items-center gap-3">
                                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                                    className="h-9 w-16 rounded border border-gray-300 cursor-pointer p-0.5" />
                                <input type="text" value={bgColor} onChange={e => setBgColor(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 font-mono" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Zahlungsmethoden</h2>
                            <p className="text-sm text-gray-500 mt-0.5">Lass das Feld leer, um die Methode auf der öffentlichen Seite auszublenden.</p>
                        </div>
                        {([
                            { key: 'zelle' as const, name: 'Zelle', icon: '🏦', placeholder: 'Telefon oder E-Mail' },
                            { key: 'venmo' as const, name: 'Venmo', icon: '💙', placeholder: '@deinname' },
                            { key: 'cashapp' as const, name: 'Cash App', icon: '💚', placeholder: '$deincashtag' },
                            { key: 'paypal' as const, name: 'PayPal', icon: '💛', placeholder: 'deinname' },
                        ]).map(({ key, name, icon, placeholder }) => (
                            <div key={key} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xl">{icon}</span>
                                    <h3 className="font-semibold text-gray-900">{name}</h3>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Benutzername</label>
                                        <input type="text" value={fund[key].handle} onChange={e => updatePayment(key, 'handle', e.target.value)}
                                            placeholder={placeholder} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Beschriftung</label>
                                        <input type="text" value={fund[key].label} onChange={e => updatePayment(key, 'label', e.target.value)}
                                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            )}

            {/* Log contribution modal */}
            {contributingItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40" onClick={() => { setContributingItem(null); setDonorSearch(''); setSelectedDonor(null); setDonationEvent('Wedding Day'); setOtherEvent(''); setCoGivers([]); setCoGiverSearch(''); }} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
                        <h2 className="text-lg font-bold text-gray-900 mb-1">Geschenk erfassen</h2>
                        <p className="text-sm text-gray-500 mb-4">{contributingItem.emoji} {contributingItem.title}</p>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Erhaltener Betrag ($)</label>
                        <input
                            type="number"
                            value={contributionAmount}
                            onChange={e => setContributionAmount(e.target.value)}
                            placeholder={`noch bis zu $${(contributingItem.price - contributingItem.funded).toLocaleString('de-DE')}`}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
                            autoFocus
                        />
                        <label className="block text-sm font-medium text-gray-700 mb-1">Wer hat gespendet?</label>
                        {selectedDonor ? (
                            <div className="flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4">
                                <span>{selectedDonor.guest_name}</span>
                                <button type="button" onClick={() => { setSelectedDonor(null); setDonorSearch(''); }} className="text-gray-400 hover:text-gray-600">✕</button>
                            </div>
                        ) : (
                            <div className="mb-4">
                                <input
                                    type="text"
                                    value={donorSearch}
                                    onChange={e => setDonorSearch(e.target.value)}
                                    placeholder="Gästeliste durchsuchen …"
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                                />
                                {donorSearch.trim() && (
                                    <div className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                                        {donorPeople
                                            .filter(p => p.name.toLowerCase().includes(donorSearch.toLowerCase()))
                                            .slice(0, 8)
                                            .map(p => (
                                                <button
                                                    key={p.key}
                                                    type="button"
                                                    onClick={() => { setSelectedDonor({ id: p.id, guest_name: p.name }); setDonorSearch(''); }}
                                                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                                                >
                                                    {p.name}
                                                </button>
                                            ))}
                                        {donorPeople.filter(p => p.name.toLowerCase().includes(donorSearch.toLowerCase())).length === 0 && (
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
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                        {coGiverSearch.trim() && (
                            <div className="mt-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg mb-4">
                                {donorPeople
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
                        {!coGiverSearch.trim() && <div className="mb-4" />}
                        <label className="block text-sm font-medium text-gray-700 mb-1">Bei welchem Anlass?</label>
                        <select
                            value={donationEvent}
                            onChange={e => setDonationEvent(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3"
                        >
                            <option value="Bridal Shower">Junggesellinnenabschied</option>
                            <option value="Engagement Party">Verlobungsfeier</option>
                            <option value="Wedding Day">Hochzeitstag</option>
                            <option value="Other">Sonstiges</option>
                        </select>
                        {donationEvent === 'Other' && (
                            <input
                                type="text"
                                value={otherEvent}
                                onChange={e => setOtherEvent(e.target.value)}
                                placeholder="Name des Anlasses"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4"
                            />
                        )}
                        <div className="flex gap-2">
                            <button onClick={logContribution} disabled={!contributionAmount}
                                className="flex-1 bg-accent text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                                Speichern
                            </button>
                            <button onClick={() => { setContributingItem(null); setDonorSearch(''); setSelectedDonor(null); setDonationEvent('Wedding Day'); setOtherEvent(''); setCoGivers([]); setCoGiverSearch(''); }}
                                className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm">
                                Abbrechen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
