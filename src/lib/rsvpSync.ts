/**
 * Keeping a household's RSVP row in step with the status the guest list shows.
 *
 * The guest list's `rsvp_status` and the RSVP's `attending` are two copies of one
 * answer. The public form writes both, so they only drift when the admin edits
 * the guest list — which used to change `rsvp_status` alone, leaving an RSVP that
 * still said "Zusage" (and still counted its guests) for a household marked
 * "Absage" or "Keine Antwort".
 *
 * `attending` has three values because the RSVP row has two jobs. Besides
 * holding a reply, it is where a household's dietary answers live, so the admin
 * can record "Kindermenü" for a household that has not answered — a row that
 * stores food and no reply:
 *
 *   true  — they are coming (the guest list says `attending`)
 *   false — they are not (`declined`)
 *   null  — no answer: `rsvp_status` empty or `likely_not_coming`. Dietary
 *           answers only; every count of replies and guests leaves it out.
 */
import type { PoolClient } from 'pg';
import { cleanNameSql } from '@/lib/names';
import { partyAttendees } from '@/lib/seating';
import type { GuestListEntry } from '@/components/seating/types';

/** What the guest list's status means for the RSVP row. */
export function attendingFromStatus(status: string | null | undefined): boolean | null {
    if (status === 'attending') return true;
    if (status === 'declined') return false;
    return null;
}

/**
 * Bring the RSVP row(s) of these households in line with their `rsvp_status`.
 *
 * Only ever updates: a household without an RSVP row stays without one, because
 * "no answer" needs no row. An RSVP that becomes a Zusage with no guest count
 * gets the people the party expects (`partyAttendees` — party_size minus anyone
 * who declined); one that stops being a Zusage drops to 0 guests. A row that is
 * already right is left alone, so saving a guest does not stamp `updated_at` and
 * show up in the activity feed as the household changing its reply.
 *
 * Run inside the caller's transaction, after the guest_list update.
 */
export async function syncRsvpsToStatus(client: PoolClient, guestIds: number[]): Promise<void> {
    if (guestIds.length === 0) return;
    const rows = await client.query(
        `SELECT id, guest_name, plus_one_name, party_size, party_members, rsvp_status
           FROM guest_list WHERE id = ANY($1::int[])`,
        [guestIds],
    );
    for (const row of rows.rows) {
        const attending = attendingFromStatus(row.rsvp_status);
        const expected = attending
            ? partyAttendees({
                ...row,
                party_members: Array.isArray(row.party_members) ? row.party_members : [],
            } as GuestListEntry).length
            : 0;
        await client.query(
            `UPDATE rsvps
                SET attending = $1::boolean,
                    number_of_guests = CASE
                      WHEN $1::boolean IS NOT TRUE THEN 0
                      WHEN COALESCE(number_of_guests, 0) > 0 THEN number_of_guests
                      ELSE $2::int END,
                    updated_at = NOW()
              WHERE ${cleanNameSql('guest_name')} = ${cleanNameSql('$3::text')}
                AND (attending IS DISTINCT FROM $1::boolean
                     OR ($1::boolean IS TRUE AND COALESCE(number_of_guests, 0) = 0)
                     OR ($1::boolean IS NOT TRUE AND COALESCE(number_of_guests, 0) <> 0))`,
            [attending, expected, row.guest_name],
        );
    }
}
