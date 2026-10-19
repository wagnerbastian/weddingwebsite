import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    // No DDL here: the middleware calls this on every public page view, and an
    // ALTER would take an ACCESS EXCLUSIVE lock each time. The schema is
    // database/init.sql's job, applied once per boot.
    const result = await pool.query(
      'SELECT page_path, is_wip, COALESCE(is_hidden, false) as is_hidden FROM wip_toggles WHERE is_wip = true OR is_hidden = true'
    );

    const wipPages: Record<string, { is_wip: boolean; is_hidden: boolean }> = {};
    result.rows.forEach((row) => {
      wipPages[row.page_path] = { is_wip: row.is_wip, is_hidden: row.is_hidden };
    });

    return NextResponse.json(wipPages);
  } catch (error) {
    console.error('Error fetching WIP status:', error);
    return NextResponse.json({}, { status: 200 });
  }
}
