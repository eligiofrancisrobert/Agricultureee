
// Supabase calls for Staff Account Management only.
import { supabase } from '../connection.js';

const SELECT = `
    staff_id,
    user_id,
    full_name,
    email,
    role_id,
    status_id,
    staff_roles(role_name),
    account_statuses(status_name)
`;

const normalize = (r) => ({
    id: r.staff_id,
    userId: r.user_id,
    name: r.full_name,
    email: r.email,
    roleId: r.role_id,
    statusId: r.status_id,
    role: r.staff_roles?.role_name ?? '',
    status: (r.account_statuses?.status_name ?? '').toLowerCase(),
});

export function friendlyError(err) {
    const code = err?.code;

    if (code === '23505') {
        return 'Another staff account already uses this email.';
    }

    if (code === '23514') {
        return 'The database rejected a value. Check the email format.';
    }

    if (code === '23503') {
        return 'The selected role or status no longer exists. Refresh and try again.';
    }

    if (code === 'PGRST116') {
        return 'No record was changed. It may have been deleted, or you may not have permission.';
    }

    if (
        code === '42501' ||
        /row-level security|permission denied/i.test(err?.message ?? '')
    ) {
        return 'Permission denied. Check the Row Level Security policies.';
    }

    if (
        code === 'WEAK_PASSWORD' ||
        code === 'NOT_DELETED' ||
        code === 'SELF_DELETE'
    ) {
        return err.message;
    }

    return 'Something went wrong. Check the browser console and try again.';
}

/** Load role and status lookup rows. */
export async function getLookups() {
    const [roles, statuses] = await Promise.all([
        supabase
            .from('staff_roles')
            .select('role_id, role_name')
            .order('role_id'),

        supabase
            .from('account_statuses')
            .select('status_id, status_name')
            .order('status_id'),
    ]);

    if (roles.error) throw roles.error;
    if (statuses.error) throw statuses.error;

    return {
        roles: (roles.data ?? []).map((r) => ({
            id: r.role_id,
            name: r.role_name
        })),

        statuses: (statuses.data ?? []).map((s) => ({
            id: s.status_id,
            name: s.status_name
        })),
    };
}

/** Fetch staff accounts newest-first. */
export async function listStaff() {
    const { data, error } = await supabase
        .from('staff_accounts')
        .select(SELECT)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return (data ?? []).map(normalize);
}

/** Fetch current login lockdown information. */
export async function listLoginSecurityAccounts() {
    const { data, error } = await supabase
        .from('login_security_accounts')
        .select(`
            user_id,
            email,
            failed_attempts,
            locked_at,
            locked_reason,
            last_failed_at,
            updated_at
        `);

    if (error) throw error;

    return data ?? [];
}

/** Unlock a staff account and reset its failed login attempts. */
export async function unlockLoginAccount(userId) {
    if (!userId) {
        throw new Error('This staff account has no linked authentication user.');
    }

    const { error } = await supabase.rpc('reset_login_failures', {
        p_user_id: userId
    });

    if (error) throw error;

    // Verify that the lockdown was actually removed.
    const { data, error: verifyError } = await supabase
        .from('login_security_accounts')
        .select('user_id, locked_at, failed_attempts')
        .eq('user_id', userId)
        .maybeSingle();

    if (verifyError) throw verifyError;

    if (data?.locked_at) {
        throw new Error('The account is still locked. Check the reset_login_failures function.');
    }

    return data;
}

/** Create a staff account through the create-staff Edge Function. */
export async function createStaff({
    name,
    email,
    roleId,
    statusId,
    password
}) {
    const { data, error } = await supabase.functions.invoke('create-staff', {
        body: { name, email, roleId, statusId, password },
    });

    if (error) {
        let body = null;

        try {
            body = await error.context.json();
        } catch {
            // No JSON body.
        }

        throw Object.assign(
            new Error(body?.error ?? error.message),
            { code: body?.code }
        );
    }

    return normalize(data);
}

/** Update only supplied staff fields. */
export async function updateStaff(id, patch) {
    const columns = {};

    if (patch.name !== undefined) columns.full_name = patch.name;
    if (patch.email !== undefined) columns.email = patch.email;
    if (patch.roleId !== undefined) columns.role_id = patch.roleId;
    if (patch.statusId !== undefined) columns.status_id = patch.statusId;

    const { data, error } = await supabase
        .from('staff_accounts')
        .update(columns)
        .eq('staff_id', id)
        .select(SELECT)
        .single();

    if (error) throw error;

    return normalize(data);
}

/** Delete a staff row. */
export async function deleteStaff(id) {
    const { data, error } = await supabase
        .from('staff_accounts')
        .delete()
        .eq('staff_id', id)
        .select('staff_id');

    if (error) throw error;

    if (!data?.length) {
        throw Object.assign(
            new Error('No rows deleted'),
            { code: 'PGRST116' }
        );
    }
}

/** Permanently remove a staff user through the delete-staff Edge Function. */
export async function deleteStaffPermanently(id) {
    const { data, error } = await supabase.functions.invoke('delete-staff', {
        body: { staffId: id }
    });

    if (error) {
        let body = null;

        try {
            body = await error.context.json();
        } catch {
            // No JSON body.
        }

        throw Object.assign(
            new Error(body?.error ?? error.message),
            { code: body?.code }
        );
    }

    return data;
}
