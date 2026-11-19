
import { supabase } from '../connection.js';

const ROLE_KEY = 'agricultural_technician';

let permissionCache = new Map();

export async function loadPermissions(forceRefresh = false) {
    permissionCache.clear();

    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) throw new Error('No authenticated user.');

    const [
        roleResult,
        userResult
    ] = await Promise.all([
        supabase
            .from('role_permissions')
            .select('*')
            .eq('role_key', ROLE_KEY),

        supabase
            .from('user_permissions')
            .select('*')
            .eq('user_id', user.id)
    ]);

    console.log('[AT] Role permissions:', roleResult);
    console.log('[AT] Individual permissions:', userResult);

    if (roleResult.error) throw roleResult.error;
    if (userResult.error) throw userResult.error;

    for (const item of roleResult.data || []) {
        permissionCache.set(
            item.permission_key,
            item.is_allowed === true
        );
    }

    for (const item of userResult.data || []) {
        permissionCache.set(
            item.permission_key,
            item.is_allowed === true
        );
    }

    console.log(
        '[AT] Final permission cache:',
        Object.fromEntries(permissionCache)
    );

    return permissionCache;
}

export function hasPermission(permissionKey) {
    return permissionCache.get(permissionKey) === true;
}

export function hasAnyPermission(keys = []) {
    return keys.some(hasPermission);
}

export function hasAllPermissions(keys = []) {
    return keys.every(hasPermission);
}

export function clearPermissions() {
    permissionCache.clear();
}

export function filterByPermission(items, permissionMap) {
    return items.filter((item) => {
        const key = permissionMap[item.id];
        return !key || hasPermission(key);
    });
}
