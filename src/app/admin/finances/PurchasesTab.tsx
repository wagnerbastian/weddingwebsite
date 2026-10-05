'use client';

import { useMemo, useState } from 'react';
import type { FinanceApi, FinancePayload } from './useFinances';
import {
    Card, DeleteButton, EmptyState, GlyphButton, InlineNumber, InlineText, Modal, PillButton,
    RowDate, RowField, RowSelect, SelectField, StatTile, TextField, formatMoney, todayLocal,
} from './ui';

/**
 * Every payment that has gone out, from any source.
 *
 * Gift money that's been earmarked to a bill appears here too — Rob's $5,000 paid
 * the venue just as much as an own-pocket installment did, and leaving it off this
 * list made the venue look half as paid down as it really was. Gift rows are
 * badged, and editing one writes through to the receipt behind it.
 */

type Row = {
    key: string;
    id: number;
    kind: 'purchase' | 'gift';
    label: string;
    date: string | null;
    amount: number;
    payerId: number | null;
    /** contributor name, gift rows only */
    who: string | null;
    contributorId: number | null;
    itemId: number | null;
    categoryId: number | null;
    notes: string | null;
    receiptPath: string | null;
};

export default function PurchasesTab({ data, api }: { data: FinancePayload; api: FinanceApi }) {
    const { purchases, contributors, payers, categories, summary } = data;
    const [payerFilter, setPayerFilter] = useState<'all' | 'gift' | number>('all');
    const [search, setSearch] = useState('');
    // Mobile collapses each payment to what you scan for; the rest is a tap away.
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkOpen, setBulkOpen] = useState(false);
    const [receiptFor, setReceiptFor] = useState<Row | null>(null);
    const toggleExpanded = (key: string) => setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    /**
     * One dropdown covers both targets: a whole section (for lump-sum bills paid
     * in installments) or a single line. Encoded as `c:<id>` / `i:<id>` so the
     * two can never both be set.
     */
    const targetGroups = useMemo(
        () => categories.map((c) => ({
            name: c.name,
            sectionValue: `c:${c.id}`,
            items: c.items.map((i) => ({ value: `i:${i.id}`, name: i.name })),
        })),
        [categories],
    );
    const targetValue = (r: { itemId: number | null; categoryId: number | null }) =>
        r.itemId != null ? `i:${r.itemId}` : r.categoryId != null ? `c:${r.categoryId}` : '';
    const targetPatch = (raw: string) => {
        if (!raw) return { item_id: null, category_id: null };
        const id = Number(raw.slice(2));
        return raw.startsWith('c:')
            ? { category_id: id, item_id: null }
            : { item_id: id, category_id: null };
    };

    const rows: Row[] = useMemo(() => {
        const own: Row[] = purchases.map((p) => ({
            key: `p${p.id}`, id: p.id, kind: 'purchase', label: p.description,
            date: p.purchased_on, amount: p.amount, payerId: p.payer_id, who: null,
            contributorId: null, itemId: p.item_id, categoryId: p.category_id,
            notes: p.notes, receiptPath: p.receipt_path ?? null,
        }));
        const gifts: Row[] = contributors.flatMap((c) =>
            (c.receipts || [])
                // Unearmarked gift money is cash in hand, not a payment made.
                .filter((r) => r.item_id != null || r.category_id != null)
                .map((r) => ({
                    key: `r${r.id}`, id: r.id, kind: 'gift' as const, label: r.note ?? '',
                    date: r.received_on, amount: r.amount, payerId: null, who: c.name,
                    contributorId: c.id, itemId: r.item_id, categoryId: r.category_id,
                    notes: null, receiptPath: null,
                })));
        return [...own, ...gifts].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    }, [purchases, contributors]);

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (payerFilter === 'gift' && r.kind !== 'gift') return false;
            if (typeof payerFilter === 'number' && r.payerId !== payerFilter) return false;
            if (!term) return true;
            return r.label.toLowerCase().includes(term)
                || (r.who ?? '').toLowerCase().includes(term);
        });
    }, [rows, payerFilter, search]);

    const visibleTotal = visible.reduce((sum, r) => sum + r.amount, 0);
    // Only own purchases can be bulk-edited; gift rows live in the receipts table.
    const selectableIds = visible.filter((r) => r.kind === 'purchase').map((r) => r.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
    const toggleSelected = (id: number) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const untracked = rows.filter((r) => r.itemId == null && r.categoryId == null && r.amount !== 0);

    /**
     * Turn an untracked payment into a budget line and link the two, so the money
     * starts counting. Lands in the last section, at its actual cost.
     */
    const adopt = async (row: Row) => {
        const section = categories[categories.length - 1];
        if (!section) return;
        const created = await api.create('items', {
            category_id: section.id,
            name: row.label || 'Unbenannt',
            unit_cost: row.amount,
            quantity: 1,
            qty_source: 'manual',
            sort_order: section.items.length,
        });
        if (!created) return;
        // The create response isn't threaded back, so find the new line by name.
        const fresh = await fetch('/api/admin/finances', { cache: 'no-store' }).then((r) => r.json());
        const match = (fresh.categories as typeof categories)
            .flatMap((c) => c.items)
            .filter((i) => i.name === (row.label || 'Unbenannt'))
            .pop();
        if (match) {
            await api.update(row.kind === 'gift' ? 'receipts' : 'purchases',
                { id: row.id, item_id: match.id, category_id: null });
        }
    };

    const addPurchase = () =>
        api.create('purchases', {
            description: 'Neue Ausgabe',
            amount: 0,
            payer_id: typeof payerFilter === 'number' ? payerFilter : payers[0]?.id ?? null,
            purchased_on: todayLocal(),
        });

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Aufs Budget angerechnet" value={formatMoney(summary.paidTotal)}
                    hint={`${rows.length} ${rows.length === 1 ? 'Zahlung' : 'Zahlungen'} erfasst`} />
                {summary.payers.map((p) => (
                    <StatTile key={p.id} label={`${p.name} bezahlt`} value={formatMoney(p.spent)} />
                ))}
                <StatTile label="Aus Geldgeschenken" value={formatMoney(summary.giftAppliedTotal)} tone="good"
                    hint={summary.giftUnapplied > 0
                        ? `${formatMoney(summary.giftUnapplied)} erhalten, nicht angerechnet`
                        : undefined} />
                {summary.unlinkedSpend > 0 && (
                    <StatTile label="Nicht im Budget" value={formatMoney(summary.unlinkedSpend)}
                        tone="warn" hint="Zählt zu keiner Summe" />
                )}
            </div>

            {untracked.length > 0 && (
                <Card className="border-amber-200 bg-amber-50/40 p-4">
                    <h3 className="text-sm font-semibold text-amber-900">
                        {untracked.length} {untracked.length === 1 ? 'Zahlung' : 'Zahlungen'} nicht im Budget
                    </h3>
                    <p className="mt-0.5 mb-3 text-xs text-amber-700">
                        Diese zählen zu keinem Bereich und fehlen deshalb in allen Summen. Lege für
                        jede einen Budgetposten an, dann zählen sie mit.
                    </p>
                    <div className="space-y-1.5">
                        {untracked.map((row) => (
                            <div key={row.key}
                                className="flex flex-wrap items-center gap-2 rounded-xl border
                                    border-amber-100 bg-white px-3 py-2 text-sm">
                                <span className="min-w-0 flex-1 truncate text-gray-700">{row.label}</span>
                                <span className="tabular-nums text-gray-500">{formatMoney(row.amount)}</span>
                                <button
                                    onClick={() => adopt(row)}
                                    className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white
                                        transition-opacity hover:opacity-90"
                                >
                                    + Zum Budget hinzufügen
                                </button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1.5">
                        <FilterPill active={payerFilter === 'all'} onClick={() => setPayerFilter('all')}>
                            Alle
                        </FilterPill>
                        {payers.map((p) => (
                            <FilterPill key={p.id} active={payerFilter === p.id} onClick={() => setPayerFilter(p.id)}>
                                {p.name}
                            </FilterPill>
                        ))}
                        <FilterPill active={payerFilter === 'gift'} onClick={() => setPayerFilter('gift')}>
                            🎁 Geldgeschenke
                        </FilterPill>
                    </div>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Zahlungen suchen …"
                        className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2
                            text-base md:w-auto md:flex-1 md:min-w-[10rem] md:py-1.5 md:text-sm
                            focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <PillButton tone="accent" onClick={addPurchase}>+ Ausgabe erfassen</PillButton>
                </div>

                {selectableIds.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-50 pt-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                            <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={(e) => setSelected(e.target.checked
                                    ? new Set(selectableIds) : new Set())}
                                className="h-4 w-4 rounded border-gray-300"
                            />
                            Alle {selectableIds.length} auswählen
                        </label>
                        {selected.size > 0 && (
                            <>
                                <span className="text-xs text-gray-400">{selected.size} ausgewählt</span>
                                <PillButton onClick={() => setBulkOpen(true)}>Auswahl bearbeiten …</PillButton>
                                <PillButton tone="danger" onClick={async () => {
                                    if (!confirm(`${selected.size === 1 ? '1 Zahlung' : `${selected.size} Zahlungen`} archivieren? ${selected.size === 1 ? 'Sie zählt' : 'Sie zählen'} nicht mehr zu den Summen, ${selected.size === 1 ? 'bleibt' : 'bleiben'} aber wiederherstellbar.`)) return;
                                    await api.updateMany('purchases', [...selected], { archived: true });
                                    setSelected(new Set());
                                }}>Archivieren</PillButton>
                            </>
                        )}
                    </div>
                )}
            </Card>

            <Card className="overflow-hidden">
                <div className="hidden gap-2 border-b border-gray-100 px-4 py-2 text-[10px] font-semibold
                    uppercase tracking-wide text-gray-400
                    md:grid md:grid-cols-[1.25rem_minmax(0,1.6fr)_6.75rem_6.5rem_minmax(0,1.5fr)_4.5rem_minmax(0,1.1fr)_6.5rem_1.5rem]">
                    <div />
                    <div>Was</div>
                    <div>Datum</div>
                    <div>Bezahlt von</div>
                    <div>Zählt für</div>
                    <div>Beleg</div>
                    <div>Notiz</div>
                    <div className="text-right">Betrag</div>
                    <div />
                </div>

                {visible.map((row) => {
                    const resource = row.kind === 'gift' ? 'receipts' as const : 'purchases' as const;
                    const labelField = row.kind === 'gift' ? 'note' : 'description';
                    const dateField = row.kind === 'gift' ? 'received_on' : 'purchased_on';
                    const patch = (fields: Record<string, unknown>) =>
                        api.update(resource, { id: row.id, ...fields });
                    const isOpen = expanded.has(row.key);
                    return (
                        <div key={row.key}
                            className={`grid grid-cols-1 gap-2 px-4 py-2 border-b border-gray-100 last:border-0
                                md:grid-cols-[1.25rem_minmax(0,1.6fr)_6.75rem_6.5rem_minmax(0,1.5fr)_4.5rem_minmax(0,1.1fr)_6.5rem_1.5rem]
                                md:items-center
                                ${row.kind === 'gift' ? 'bg-emerald-50/40' : ''}`}>
                            <div className="flex min-w-0 items-center gap-1 md:contents">
                                {row.kind !== 'purchase' && <span className="hidden md:block" />}
                                {row.kind === 'purchase' && (
                                    <input
                                        type="checkbox"
                                        checked={selected.has(row.id)}
                                        onChange={() => toggleSelected(row.id)}
                                        aria-label={`${row.label} auswählen`}
                                        className="h-4 w-4 shrink-0 rounded border-gray-300 md:justify-self-center"
                                    />
                                )}
                                <GlyphButton
                                    onClick={() => toggleExpanded(row.key)}
                                    label={`${row.label} ${isOpen ? 'einklappen' : 'ausklappen'}`}
                                    className={`text-xs text-gray-400 transition-transform md:hidden
                                        ${isOpen ? 'rotate-90' : ''}`}
                                >
                                    ▶
                                </GlyphButton>
                                <InlineText
                                    value={row.label}
                                    placeholder={row.kind === 'gift' ? 'Wofür es ist …' : 'Was gekauft wurde'}
                                    onCommit={(v) => patch({ [labelField]: v })}
                                    className="text-gray-800"
                                />
                                {/* Amount stays on the collapsed line — it's the other half of a glance. */}
                                <div className="w-24 shrink-0 md:hidden">
                                    <InlineNumber
                                        value={row.amount} prefix="$"
                                        onCommit={(amount) => patch({ amount })}
                                    />
                                </div>
                            </div>
                            <div className={`${isOpen ? 'grid grid-cols-1 gap-2 pb-1 pl-7' : 'hidden'} md:contents`}>
                            <RowField label="Datum">
                                <RowDate
                                    value={(row.date ?? '').slice(0, 10)}
                                    aria-label={`Datum für ${row.label}`}
                                    onChange={(e) => patch({ [dateField]: e.target.value })}
                                />
                            </RowField>
                            <RowField label={row.kind === 'gift' ? 'Geschenk von' : 'Bezahlt von'}>
                                {row.kind === 'gift' ? (
                                    <span className="block truncate px-1 text-right text-xs font-medium
                                        text-emerald-700 md:text-left"
                                        title={`Geldgeschenk von ${row.who}`}>
                                        🎁 {row.who}
                                    </span>
                                ) : (
                                    <RowSelect
                                        value={row.payerId ?? ''}
                                        aria-label={`Wer hat ${row.label} bezahlt`}
                                        onChange={(e) => patch({ payer_id: e.target.value || null })}
                                    >
                                        <option value="">Nicht zugeordnet</option>
                                        {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </RowSelect>
                                )}
                            </RowField>
                            <RowField label="Zählt für">
                                <RowSelect
                                    value={targetValue(row)}
                                    aria-label={`Wofür ${row.label} zählt`}
                                    onChange={(e) => patch(targetPatch(e.target.value))}
                                >
                                    <option value="">– nichts –</option>
                                    {targetGroups.map((group) => (
                                        <optgroup key={group.name} label={group.name}>
                                            <option value={group.sectionValue}>
                                                {group.name} – ganzer Bereich
                                            </option>
                                            {group.items.map((i) => (
                                                <option key={i.value} value={i.value}>{i.name}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </RowSelect>
                            </RowField>
                            {row.kind === 'purchase' && (
                                <RowField label="Beleg">
                                    <div className="flex items-center justify-end gap-2 md:justify-start">
                                        {row.receiptPath ? (
                                            <>
                                                <a href={`/api/photos/${row.receiptPath}`} target="_blank"
                                                    rel="noreferrer"
                                                    className="text-xs font-medium text-accent underline">
                                                    Ansehen
                                                </a>
                                                <button onClick={() => api.removeReceipt(row.id)}
                                                    aria-label={`Beleg für ${row.label} entfernen`}
                                                    className="text-[11px] text-gray-400 hover:text-rose-500">
                                                    entfernen
                                                </button>
                                            </>
                                        ) : (
                                            <button onClick={() => setReceiptFor(row)}
                                                className="text-xs text-gray-400 hover:text-gray-700">
                                                📎 Anhängen
                                            </button>
                                        )}
                                    </div>
                                </RowField>
                            )}
                            <RowField label="Notiz">
                                <InlineText
                                    value={row.notes ?? ''}
                                    placeholder="Notiz …"
                                    onCommit={(notes) => patch({ notes })}
                                    className="md:text-xs"
                                />
                            </RowField>
                            <RowField label="Betrag" className="hidden md:flex">
                                <InlineNumber
                                    value={row.amount} prefix="$"
                                    onCommit={(amount) => patch({ amount })}
                                />
                            </RowField>
                            <DeleteButton
                                label={`${row.label} löschen`}
                                onClick={() => api.removeWithUndo(
                                    resource, row.id,
                                    row.kind === 'gift' ? `${row.label} von ${row.who}` : `„${row.label}“`,
                                    row.kind === 'gift'
                                        ? {
                                            contributor_id: row.contributorId, amount: row.amount,
                                            received_on: row.date, note: row.label,
                                            item_id: row.itemId, category_id: row.categoryId,
                                        }
                                        : {
                                            description: row.label, amount: row.amount,
                                            purchased_on: row.date, payer_id: row.payerId,
                                            item_id: row.itemId, category_id: row.categoryId,
                                            notes: row.notes,
                                        },
                                )}
                            />
                            </div>
                        </div>
                    );
                })}

                {!visible.length && (
                    <EmptyState>
                        {rows.length ? 'Keine Zahlungen für diesen Filter.' : 'Noch keine Zahlungen erfasst.'}
                    </EmptyState>
                )}

                {visible.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60 border-t border-gray-100">
                        <span className="text-xs text-gray-500">
                            {visible.length} angezeigt
                            {visible.length !== rows.length && ` von ${rows.length}`}
                        </span>
                        <span className="font-semibold tabular-nums text-sm">{formatMoney(visibleTotal)}</span>
                    </div>
                )}
            </Card>

            {bulkOpen && (
                <BulkEdit
                    data={data} api={api} ids={[...selected]}
                    onClose={() => setBulkOpen(false)}
                    onDone={() => { setSelected(new Set()); setBulkOpen(false); }}
                />
            )}
            {receiptFor && (
                <ReceiptUpload
                    api={api} row={receiptFor} onClose={() => setReceiptFor(null)}
                />
            )}

            <p className="text-[11px] text-gray-400 px-1">
                Grüne Zeilen sind Geldgeschenke, die einer Rechnung zugeordnet sind – sie zählen zum
                Budget, aber nicht zu euren Ausgaben aus eigener Tasche. Geldgeschenke ohne Zuordnung
                sind noch Bargeld in der Hand und werden hier nicht aufgeführt.
            </p>
        </div>
    );
}

/** Retag several payments at once — payer, target, or date. */
function BulkEdit({ data, api, ids, onClose, onDone }: {
    data: FinancePayload;
    api: FinanceApi;
    ids: number[];
    onClose: () => void;
    onDone: () => void;
}) {
    const [payer, setPayer] = useState('');
    const [target, setTarget] = useState('');
    const [date, setDate] = useState('');
    const [busy, setBusy] = useState(false);

    const apply = async () => {
        // Only send what was actually set, so a bulk edit never blanks a field
        // the user left alone.
        const fields: Record<string, unknown> = {};
        if (payer) fields.payer_id = payer === 'none' ? null : Number(payer);
        if (target) {
            if (target === 'none') { fields.item_id = null; fields.category_id = null; }
            else if (target.startsWith('c:')) fields.category_id = Number(target.slice(2));
            else fields.item_id = Number(target.slice(2));
        }
        if (date) fields.purchased_on = date;
        if (!Object.keys(fields).length) { onClose(); return; }
        setBusy(true);
        await api.updateMany('purchases', ids, fields);
        setBusy(false);
        onDone();
    };

    return (
        <Modal title={`${ids.length === 1 ? '1 Zahlung' : `${ids.length} Zahlungen`} bearbeiten`} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-xs text-gray-400">
                    Alles, was auf <em>Unverändert lassen</em> steht, bleibt, wie es ist.
                </p>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-500">Bezahlt von</span>
                    <SelectField value={payer} onChange={(e) => setPayer(e.target.value)}>
                        <option value="">Unverändert lassen</option>
                        <option value="none">Nicht zugeordnet</option>
                        {data.payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </SelectField>
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-500">Zählt für</span>
                    <SelectField value={target} onChange={(e) => setTarget(e.target.value)}>
                        <option value="">Unverändert lassen</option>
                        <option value="none">– nichts –</option>
                        {data.categories.map((c) => (
                            <optgroup key={c.id} label={c.name}>
                                <option value={`c:${c.id}`}>{c.name} – ganzer Bereich</option>
                                {c.items.map((i) => <option key={i.id} value={`i:${i.id}`}>{i.name}</option>)}
                            </optgroup>
                        ))}
                    </SelectField>
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-gray-500">Datum</span>
                    <TextField type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <div className="flex justify-end gap-2">
                    <PillButton onClick={onClose}>Abbrechen</PillButton>
                    <PillButton tone="accent" onClick={apply} disabled={busy}>
                        {busy ? 'Wird gespeichert …' : 'Übernehmen'}
                    </PillButton>
                </div>
            </div>
        </Modal>
    );
}

/** Attach a photo or PDF of the receipt — the point of logging on a phone. */
function ReceiptUpload({ api, row, onClose }: {
    api: FinanceApi;
    row: Row;
    onClose: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');

    const pick = async (file: File | null) => {
        if (!file) return;
        setProblem('');
        setBusy(true);
        const ok = await api.uploadReceipt(row.id, file);
        setBusy(false);
        if (ok) onClose();
        else setProblem('Das Hochladen ist fehlgeschlagen – versuche es mit einem JPG, PNG oder PDF unter 12 MB.');
    };

    return (
        <Modal title={`Beleg für ${row.label}`} onClose={onClose}>
            <div className="space-y-4">
                <p className="text-xs text-gray-400">
                    Fotografiere den Beleg oder wähle ein PDF. Auf dem Handy öffnet sich die Kamera.
                </p>
                <input
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    onChange={(e) => pick(e.target.files?.[0] ?? null)}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm"
                />
                {busy && <p className="text-xs text-gray-500">Wird hochgeladen …</p>}
                {problem && <p className="text-xs text-rose-600">{problem}</p>}
                <div className="flex justify-end">
                    <PillButton onClick={onClose}>Fertig</PillButton>
                </div>
            </div>
        </Modal>
    );
}

function FilterPill({ active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium
                transition-colors md:h-auto md:py-1.5
                ${active
                    ? 'bg-accent text-white border-transparent'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
        >
            {children}
        </button>
    );
}
