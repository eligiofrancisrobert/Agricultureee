
import { supabase } from '../connection.js';

// =====================================================
// PERMISSION CACHE
// =====================================================

const CACHE_DURATION = 30 * 1000;

const permissionCache = new Map();
const pendingRequests = new Map();

let cacheGeneration = 0;

// Clear cached permissions when the authenticated session changes.
supabase.auth.onAuthStateChange((event) => {
    if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        event === 'PASSWORD_RECOVERY'
    ) {
        clearPermissionCache();
    }
});

// =====================================================
// CACHE MANAGEMENT
// =====================================================

export function clearPermissionCache() {
    cacheGeneration++;

    permissionCache.clear();
    pendingRequests.clear();
}

// =====================================================
// SINGLE PERMISSION CHECK
// =====================================================

export async function hasPermission(permissionKey) {
    if (
        typeof permissionKey !== 'string' ||
        !permissionKey.trim()
    ) {
        return false;
    }

    const key = permissionKey.trim();
    const now = Date.now();

    // Return valid cached result.
    const cached = permissionCache.get(key);

    if (cached && cached.expiresAt > now) {
        return cached.allowed;
    }

    // Remove expired cache entry.
    if (cached) {
        permissionCache.delete(key);
    }

    // Reuse an existing request instead of sending another RPC.
    const existingRequest = pendingRequests.get(key);

    if (existingRequest) {
        return existingRequest;
    }

    const requestGeneration = cacheGeneration;

    const request = (async () => {
        try {
            const { data, error } = await supabase.rpc(
                'has_tanikala_permission',
                {
                    p_permission_key: key
                }
            );

            if (error) {
                console.error(
                    `Permission check failed (${key}):`,
                    error
                );

                return false;
            }

            // Ignore results from an outdated authentication session.
            if (requestGeneration !== cacheGeneration) {
                return false;
            }

            const allowed = data === true;

            permissionCache.set(key, {
                allowed,
                expiresAt: Date.now() + CACHE_DURATION
            });

            return allowed;
        } catch (error) {
            console.error(
                `Permission check failed (${key}):`,
                error
            );

            return false;
        }
    })();

    pendingRequests.set(key, request);

    try {
        return await request;
    } finally {
        // Do not delete a newer request for the same permission.
        if (pendingRequests.get(key) === request) {
            pendingRequests.delete(key);
        }
    }
}

// =====================================================
// MULTIPLE PERMISSION CHECKS
// =====================================================

export async function hasPermissions(permissionKeys = []) {
    if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
        return {};
    }

    const uniqueKeys = [
        ...new Set(
            permissionKeys.filter(
                key => typeof key === 'string' && key.trim()
            ).map(key => key.trim())
        )
    ];

    const results = await Promise.all(
        uniqueKeys.map(async key => [
            key,
            await hasPermission(key)
        ])
    );

    return Object.fromEntries(results);
}

// =====================================================
// REQUIRED PERMISSION
// =====================================================

export async function requirePermission(permissionKey) {
    return hasPermission(permissionKey);
}
