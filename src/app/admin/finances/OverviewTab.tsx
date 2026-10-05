'use client';

import { useState } from 'react';
import type { PayerSummary } from '@/lib/finance';
import type { FinancePayload } from './useFinances';
import { ExportButtons, TrendCard, WhatIf } from './extras';
import { Bar, Card, EmptyState, StatTile, formatDate, formatMoney } from './ui';

type Scenario = 'pledged' | 'cash';

export default function OverviewTab({ data }: { data: FinancePayload }) {
    const { summary, weddingDate } = data;
    const [scenario, setScenario] = useState<Scenario>('cash');

    const optimistic = scenario === 'pledged';
    const deficit = optimistic ? summary.deficitPledged : summary.deficitCash;
    const stillToSpend = optimistic ? summary.stillToSpendPledged : summary.stillToSpendCash;
    const share = (p: PayerSummary) => (optimistic ? p.sharePledged : p.shareCash);
    const remaining = (p: PayerSummary) => (optimistic ? p.remainingPledged : p.remainingCash);
    const plan = (p: PayerSummary) => (optimistic ? p.planPledged : p.planCash);

    // No days left means the wedding date has passed or was never set, so a
    // per-month figure would be meaningless.
    const noHorizon = summary.horizon.days <= 0;

    // Only line-level overruns; a section paid in installments is tracked against
    // the section total, so its lines legitimately show no spend of their own.
    const overruns = summary.items
        .filter((i) => i.variance > 0)
        .sort((a, b) => b.variance - a.variance);
    const overpaidSections = summary.categories.filter((c) => c.remaining < 0);

    return (
        /*
         * One column up to xl, two above it. A page of full-width cards on a
         * 1600px screen puts "Vendor bills" and its one line of text across
         * fourteen hundred pixels; in two columns the same cards read at a
         * sensible measure and half the scrolling disappears. Multicol rather
         * than a grid because the cards are wildly different heights and a grid
         * would leave a ragged hole beside every short one.
         */
        <div className="space-y-5 xl:space-y-0 xl:columns-2 xl:gap-5
            [&>*]:xl:mb-5 [&>*]:xl:break-inside-avoid">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:[column-span:all]">
                <StatTile label="Gesamtbudget" value={formatMoney(summary.budgetTotal)}
                    hint={`${summary.itemCount} Posten`} />
                <StatTile label="Auf das Budget bezahlt" value={formatMoney(summary.paidTotal)}
                    hint={summary.giftAppliedTotal > 0
                        ? `${formatMoney(summary.budgetedOutOfPocket)} von euch + ${formatMoney(summary.giftAppliedTotal)} Geschenke`
                        : 'alles aus eigener Tasche'} />
                <StatTile label="Geldgeschenke erhalten" value={formatMoney(summary.receivedTotal)} tone="good"
                    hint={summary.giftUnapplied > 0
                        ? `${formatMoney(summary.giftUnapplied)} noch nicht angerechnet`
                        : 'alles auf Rechnungen angerechnet'} />
                <StatTile
                    label="Noch zu zahlen"
                    value={formatMoney(Math.max(0, stillToSpend))}
                    tone={stillToSpend > 0 ? 'warn' : 'good'}
                    hint={optimistic ? 'wenn alle Zusagen eintreffen' : 'nur Geld in der Hand'}
                />
            </div>

            {(summary.overdueTotal > 0 || summary.dueSoonTotal > 0) && (
                <Card className={`p-4 ${summary.overdueTotal > 0
                    ? 'border-rose-200 bg-rose-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className={`text-sm font-semibold ${summary.overdueTotal > 0
                            ? 'text-rose-900' : 'text-amber-900'}`}>
                            {summary.overdueTotal > 0
                                ? `${formatMoney(summary.overdueTotal)} überfällig`
                                : `${formatMoney(summary.dueSoonTotal)} fällig in den nächsten 30 Tagen`}
                        </span>
                        <span className="text-xs text-gray-500">
                            {summary.schedule.filter((sp) => !sp.settled).slice(0, 2)
                                .map((sp) => `${sp.label} ${formatDate(sp.due_on)}`).join(' · ')}
                        </span>
                    </div>
                </Card>
            )}

            <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold text-gray-800">Planungsszenario</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                            {optimistic
                                ? 'Jede Zusage zählt als Geld, das ihr bekommt.'
                                : 'Nur Geld, das schon da ist – die sichere Zahl.'}
                        </div>
                    </div>
                    <div className="flex gap-1.5">
                        <ScenarioPill active={!optimistic} onClick={() => setScenario('cash')}>
                            Geld in der Hand
                        </ScenarioPill>
                        <ScenarioPill active={optimistic} onClick={() => setScenario('pledged')}>
                            Wenn Zusagen eintreffen
                        </ScenarioPill>
                    </div>
                </div>
            </Card>

            <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                    <span className="font-semibold text-gray-800">Rechnungen der Dienstleister</span>
                    <span className="text-gray-500">
                        {formatMoney(summary.paidTotal)} von {formatMoney(summary.budgetTotal)} bezahlt
                        {' — '}
                        <strong className="text-gray-800">{formatMoney(summary.billRemaining)} noch offen</strong>
                    </span>
                </div>
                {summary.giftUnapplied > 0 && (
                    <p className="text-[11px] text-gray-400 mt-2">
                        Außerdem habt ihr {formatMoney(summary.giftUnapplied)} an Geldgeschenken, die noch
                        keinem Zweck zugeordnet sind – ordne sie im Tab „Geldgeschenke“ zu, dann zählen sie
                        für eine Rechnung.
                    </p>
                )}
                {summary.unlinkedSpend > 0 && (
                    <p className="text-[11px] text-gray-400 mt-1">
                        Und {formatMoney(summary.unlinkedSpend)} an Ausgaben gehören zu keinem
                        Budgetposten und zählen deshalb hier nicht. Ordne sie im Tab „Ausgaben“ zu –
                        oder lege einen Posten dafür an –, dann fließen sie in diese Zahlen ein.
                    </p>
                )}
            </Card>

            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Das müsst ihr beide tragen</h3>
                <p className="text-xs text-gray-400 mb-4">
                    Budget {formatMoney(summary.budgetTotal)} minus{' '}
                    {optimistic ? 'zugesagte' : 'erhaltene'} Beiträge{' '}
                    {formatMoney(optimistic ? summary.pledgedTotal : summary.receivedTotal)}
                    {' = '}
                    <strong className="text-gray-700">{formatMoney(deficit)}</strong>, unten nach Anteil aufgeteilt.
                </p>

                {summary.isOverFunded && (
                    <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        Die Beiträge decken bereits das ganze Budget, mit{' '}
                        <strong>{formatMoney(-deficit)}</strong> Überschuss – in diesem Szenario müsst ihr
                        nichts mehr selbst finanzieren.
                    </p>
                )}
                {!summary.isOverFunded && Math.abs(summary.unallocatedDeficitCash) > 0.5 && (
                    <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <strong>{formatMoney(summary.unallocatedDeficitCash)}</strong> der Lücke
                        sind niemandem zugeordnet. Gib mindestens einem Zahler in den Einstellungen einen
                        Anteil über 0 %, damit die Aufteilung aufgeht.
                    </p>
                )}

                {summary.payers.length ? (
                    <div className="space-y-3">
                        {summary.payers.map((payer) => {
                            const owed = remaining(payer);
                            const ahead = owed < 0;
                            const p = plan(payer);
                            return (
                                <div key={payer.id} className="rounded-2xl border border-gray-100 p-4">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                                        <div>
                                            <span className="font-semibold text-gray-900">{payer.name}</span>
                                            <span className="text-xs text-gray-400 ml-2">
                                                {payer.isContributorOnly
                                                    ? 'hilft mit – schuldet nichts'
                                                    : `${payer.sharePct} % Anteil`}
                                            </span>
                                        </div>
                                        <div className="text-right">
                                            <div className={`font-semibold tabular-nums ${ahead ? 'text-emerald-600' : 'text-gray-900'}`}>
                                                {payer.isContributorOnly
                                                    ? `${formatMoney(payer.spentOnBudget)} beigetragen`
                                                    : ahead
                                                        ? `${formatMoney(-owed)} im Voraus bezahlt`
                                                        : `${formatMoney(owed)} offen`}
                                            </div>
                                            <div className="text-[11px] text-gray-400">
                                                {!payer.isContributorOnly && `Anteil ${formatMoney(share(payer))} · `}
                                                bezahlt {formatMoney(payer.spentOnBudget)}
                                                {payer.spent !== payer.spentOnBudget && (
                                                    <> · {formatMoney(payer.spent - payer.spentOnBudget)} außerhalb des Budgets</>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {payer.isContributorOnly ? (
                                        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                                            {payer.name} hat keinen Anteil am Budget – alles, was bezahlt wird,
                                            verringert einfach, was ihr beide schuldet.
                                        </p>
                                    ) : ahead ? (
                                        <p className="text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2">
                                            {payer.name} hat bereits mehr als den eigenen Anteil bezahlt – die
                                            nächsten Ausgaben sollten von jemand anderem kommen, um auszugleichen.
                                        </p>
                                    ) : noHorizon ? (
                                        <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                                            Jetzt fällig – es bleibt keine Zeit mehr, das zu verteilen.{' '}
                                            {weddingDate
                                                ? 'Euer Hochzeitsdatum ist vorbei; lege in den Einstellungen einen Planungszeitraum fest, um den Plan weiter zu nutzen.'
                                                : 'Lege euer Hochzeitsdatum in den allgemeinen Einstellungen oder einen Planungszeitraum in den Einstellungen fest, um die Aufteilung zu sehen.'}
                                        </p>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2">
                                            <PlanCell label="pro Monat" value={p.perMonth} />
                                            <PlanCell label="pro Gehalt" value={p.perPaycheck} />
                                            <PlanCell label="pro Tag" value={p.perDay} />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <EmptyState>Lege in den Einstellungen Zahler an, um die Aufteilung zu sehen.</EmptyState>
                )}

                {!noHorizon && (
                    <p className="text-[11px] text-gray-400 mt-3">
                        Verteilt auf {summary.horizon.days.toLocaleString('de-DE')} Tage
                        {' '}({summary.horizon.months.toFixed(1).replace('.', ',')} Monate, ca. {Math.floor(summary.horizon.paychecks)} Gehälter)
                        {summary.horizon.derived && weddingDate
                            ? ` bis zum ${formatDate(weddingDate)}.`
                            : ' ab eurem eigenen Planungszeitraum.'}
                    </p>
                )}
            </Card>

            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Fortschritt je Bereich</h3>
                <p className="text-xs text-gray-400 mb-4">
                    Wie weit die Rechnung jedes Bereichs bezahlt ist – Teilzahlungen und Zahlungen
                    auf einzelne Posten zusammengezählt.
                </p>
                <div className="space-y-4">
                    {summary.categories.map((category) => {
                        const overpaid = category.remaining < 0;
                        return (
                            <div key={category.id}>
                                <div className="flex justify-between items-baseline text-sm mb-1">
                                    <span className="font-medium text-gray-700">
                                        {category.name}
                                        {category.installmentCount > 0 && (
                                            <span className="text-[11px] text-gray-400 ml-2">
                                                {category.installmentCount}{' '}
                                                {category.installmentCount === 1 ? 'Teilzahlung' : 'Teilzahlungen'}
                                            </span>
                                        )}
                                        {category.giftApplied > 0 && (
                                            <span className="text-[11px] text-emerald-600 ml-2">
                                                🎁 {formatMoney(category.giftApplied)}
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        <span className="tabular-nums font-medium text-gray-700">
                                            {formatMoney(category.paid)}
                                        </span>
                                        {' von '}
                                        <span className="tabular-nums">{formatMoney(category.total)}</span>
                                    </span>
                                </div>
                                <Bar pct={category.paidPct} tone={overpaid ? 'rose' : 'accent'} />
                                <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                                    <span>{category.paidPct.toFixed(0)}% bezahlt</span>
                                    <span className={overpaid ? 'text-rose-600 font-medium' : ''}>
                                        {overpaid
                                            ? `${formatMoney(-category.remaining)} zu viel bezahlt`
                                            : `${formatMoney(category.remaining)} noch offen`}
                                        {' · '}{category.pct.toFixed(1).replace('.', ',')} % des Budgets
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                    {!summary.categories.length && <EmptyState>Noch keine Budgetbereiche.</EmptyState>}
                </div>
            </Card>

            <Card className="p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Größte Posten</h3>
                <p className="text-xs text-gray-400 mb-4">Die zehn teuersten.</p>
                <div className="space-y-2">
                    {[...summary.items]
                        .sort((a, b) => b.total - a.total)
                        .slice(0, 10)
                        .map((item) => (
                            <div key={item.id} className="flex items-center gap-3 text-sm">
                                <span className="flex-1 truncate text-gray-700">
                                    {item.name}
                                    {item.isPaid && (
                                        <span className="ml-2 text-[10px] bg-emerald-100 text-emerald-700
                                            font-semibold px-1.5 py-0.5 rounded-full align-middle">BEZAHLT</span>
                                    )}
                                </span>
                                <span className="text-[11px] text-gray-400 tabular-nums w-12 text-right">
                                    {item.pct.toFixed(1)}%
                                </span>
                                <span className="tabular-nums w-24 text-right font-medium">
                                    {formatMoney(item.total)}
                                </span>
                            </div>
                        ))}
                    {!summary.items.length && <EmptyState>Noch keine Posten.</EmptyState>}
                </div>
            </Card>

            <Card className="p-5">
                <h3 className="mb-1 font-semibold text-gray-900">Kosten pro Gast</h3>
                <p className="mb-4 text-xs text-gray-400">
                    Praktisch, solange sich die Gästeliste noch ändert.
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            pro Gast
                        </div>
                        <div className="mt-0.5 text-sm font-semibold tabular-nums">
                            {formatMoney(summary.guestCost.perGuest)}
                        </div>
                        <div className="text-[11px] text-gray-400">
                            {summary.guestCost.guests} Gäste
                        </div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            ein Erwachsener mehr
                        </div>
                        <div className="mt-0.5 text-sm font-semibold tabular-nums text-amber-600">
                            +{formatMoney(summary.guestCost.marginalPerAdult)}
                        </div>
                        <div className="text-[11px] text-gray-400">
                            {summary.guestCost.marginalLines.length} Posten pro Gast
                        </div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            ein Tisch mit 10
                        </div>
                        <div className="mt-0.5 text-sm font-semibold tabular-nums text-amber-600">
                            +{formatMoney(summary.guestCost.marginalPerAdult * 10)}
                        </div>
                    </div>
                </div>
                {summary.guestCost.marginalLines.length > 0 && (
                    <p className="mt-3 text-[11px] text-gray-400">
                        Aus{' '}
                        {summary.guestCost.marginalLines
                            .map((l) => `${l.name} ${formatMoney(l.unitCost)}`).join(' + ')}
                    </p>
                )}
            </Card>

            {summary.warnings.length > 0 && (
                <Card className="border-amber-200 bg-amber-50/40 p-5">
                    <h3 className="mb-1 font-semibold text-amber-900">Mögliche Fehler</h3>
                    <p className="mb-3 text-xs text-amber-700">
                        Dinge, die doppelt erfasst sein könnten, oder ein Budgetwert, der nicht mehr
                        zur Realität passt.
                    </p>
                    <div className="space-y-1.5">
                        {summary.warnings.map((w, i) => (
                            <div key={`${w.kind}${i}`}
                                className="rounded-xl border border-amber-100 bg-white px-3 py-2 text-sm">
                                <div className="text-gray-700">{w.message}</div>
                                <div className="mt-0.5 text-[11px] text-gray-400">{w.detail}</div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <TrendCard snapshots={data.snapshots} />
            <WhatIf data={data} />

            <Card className="p-4 print:hidden">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold text-gray-800">Teilen</div>
                        <div className="mt-0.5 text-xs text-gray-400">
                            Eine Tabelle für eure Unterlagen oder eine druckbare Kopie für ein Gespräch mit Dienstleistern.
                        </div>
                    </div>
                    <ExportButtons data={data} />
                </div>
            </Card>

            {(overruns.length > 0 || overpaidSections.length > 0 || summary.unlinkedSpend > 0) && (
                <Card className="p-5 border-amber-200 bg-amber-50/40">
                    <h3 className="font-semibold text-amber-900 mb-1">Einen Blick wert</h3>
                    <p className="text-xs text-amber-700 mb-3">
                        Stellen, an denen die Zahlungen den Budgetbetrag überschritten haben, oder Geld,
                        das nirgends mitgezählt wird.
                    </p>
                    <div className="space-y-1.5">
                        {overpaidSections.map((category) => (
                            <div key={`c${category.id}`} className="flex items-center gap-2 text-sm bg-white
                                rounded-xl border border-amber-100 px-3 py-2">
                                <span className="flex-1 truncate text-gray-700">
                                    {category.name} <span className="text-gray-400 text-xs">(ganzer Bereich)</span>
                                </span>
                                <span className="text-[11px] text-gray-400">
                                    Budget {formatMoney(category.total)} · bezahlt {formatMoney(category.paid)}
                                </span>
                                <span className="text-rose-600 font-semibold tabular-nums text-xs">
                                    +{formatMoney(-category.remaining)}
                                </span>
                            </div>
                        ))}
                        {overruns.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-sm bg-white rounded-xl
                                border border-amber-100 px-3 py-2">
                                <span className="flex-1 truncate text-gray-700">{item.name}</span>
                                <span className="text-[11px] text-gray-400">
                                    Budget {formatMoney(item.total)} · bezahlt {formatMoney(item.paid)}
                                </span>
                                <span className="text-rose-600 font-semibold tabular-nums text-xs">
                                    +{formatMoney(item.variance)}
                                </span>
                            </div>
                        ))}
                        {summary.unlinkedSpend > 0 && (
                            <div className="flex items-center gap-2 text-sm bg-white rounded-xl
                                border border-amber-100 px-3 py-2">
                                <span className="flex-1 text-gray-700">Ausgaben, die nirgends mitzählen</span>
                                <span className="font-semibold tabular-nums text-xs text-amber-700">
                                    {formatMoney(summary.unlinkedSpend)}
                                </span>
                            </div>
                        )}
                    </div>
                </Card>
            )}
        </div>
    );
}

function PlanCell({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-gray-50 rounded-xl px-3 py-2 text-center">
            <div className="font-semibold tabular-nums text-sm text-gray-900">{formatMoney(value)}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mt-0.5">{label}</div>
        </div>
    );
}

function ScenarioPill({ active, onClick, children }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border
                ${active
                    ? 'bg-accent text-white border-transparent'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
        >
            {children}
        </button>
    );
}
