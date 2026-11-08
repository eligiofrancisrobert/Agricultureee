// Supabase calls for Staff Account Management only (staff_accounts, staff_roles, account_statuses).
import { supabase } from '../connection.js';

const SELECT = 'staff_id, full_name, email, role_id, status_id, staff_roles(role_name), account_statuses(status_name)';

const normalize = (r) => ({
    id: r.staff_id,
    name: r.full_name,
    email: r.email,
    roleId: r.role_id,
    statusId: r.status_id,
    role: r.staff_roles?.role_name ?? '',
    status: (r.account_statuses?.status_name ?? '').toLowerCase(),
});

// Turns a Supabase/Postgres error into a message that is safe to show on screen.
export function friendlyError(err) {
    const code = err?.code;
    if (code === '23505') return 'Another staff account already uses this email.';
    if (code === '23514') return 'The database rejected a value. Check the email format.';
    if (code === '23503') return 'The selected role or status no longer exists. Refresh and try again.';
    if (code === 'PGRST116') return 'No record was changed. It may have been deleted, or you may not have permission.';
    if (code === '42501' || /row-level security|permission denied/i.test(err?.message ?? '')) {
        return 'Permission denied. Check the Row Level Security policies on the staff tables.';
    }
    if (code === 'WEAK_PASSWORD' || code === 'NOT_DELETED' || code === 'SELF_DELETE') return err.message;
    return 'Something went wrong. Check the browser console and try again.';
}

/** Load role and status lookup rows used by the staff editor. */
export async function getLookups() {
    const [roles, statuses] = await Promise.all([
        supabase.from('staff_roles').select('role_id, role_name').order('role_id'),
        supabase.from('account_statuses').select('status_id, status_name').order('status_id'),
    ]);
    
    if (roles.error) throw roles.error;
    if (statuses.error) throw statuses.error;
    return {
        roles: roles.data.map((r) => ({ id: r.role_id, name: r.role_name })),
        statuses: statuses.data.map((s) => ({ id: s.status_id, name: s.status_name })),
    };
}

/** Fetch staff accounts newest-first and map database columns to UI fields. */
export async function listStaff() {
    const { data, error } = await supabase.from('staff_accounts').select(SELECT).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalize);
}

/** Create a staff account through the create-staff Edge Function. */
export async function createStaff({ name, email, roleId, statusId, password }) {
    const { data, error } = await supabase.functions.invoke('create-staff', {
        body: { name, email, roleId, statusId, password },
    });
    if (error) {
        let body = null;
        try { body = await error.context.json(); } catch { /* no JSON body */ }
        throw Object.assign(new Error(body?.error ?? error.message), { code: body?.code });
    }
    return normalize(data);
}
// patch uses the UI field names: any of { name, email, roleId, statusId }
/** Update only supplied staff fields and return the normalized account. */
export async function updateStaff(id, patch) {
    const columns = {};
    if (patch.name !== undefined) columns.full_name = patch.name;
    if (patch.email !== undefined) columns.email = patch.email;
    if (patch.roleId !== undefined) columns.role_id = patch.roleId;
    if (patch.statusId !== undefined) columns.status_id = patch.statusId;

    const { data, error } = await supabase.from('staff_accounts')
        .update(columns).eq('staff_id', id).select(SELECT).single();
    if (error) throw error;
    return normalize(data);
}

/** Delete a staff row and detect when row-level security removed no rows. */
export async function deleteStaff(id) {
    const { data, error } = await supabase.from('staff_accounts').delete().eq('staff_id', id).select('staff_id');
    if (error) throw error;
    // RLS can silently block a delete without an error, so confirm a row was actually removed.
    if (!data?.length) throw Object.assign(new Error('No rows deleted'), { code: 'PGRST116' });
}

/** Permanently remove a staff user through the delete-staff Edge Function. */
export async function deleteStaffPermanently(id) {
    const { data, error } = await supabase.functions.invoke('delete-staff', { body: { staffId: id } });
    if (error) {
        let body = null;
        try { body = await error.context.json(); } catch { /* no JSON body */ }
        throw Object.assign(new Error(body?.error ?? error.message), { code: body?.code });
    }
    return data;
}