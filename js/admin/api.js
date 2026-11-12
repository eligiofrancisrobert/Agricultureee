
import { supabase } from '../connection.js';

// UI status -> value stored in profiles.status.
const DB_STATUS = {
    active: 'approved',
    pending: 'pending',
    rejected: 'rejected',
    suspended: 'suspended'
};

const ROLES = ['farmer', 'buyer', 'supplier'];

const COLUMNS = [
    'id',
    'full_name',
    'first_name',
    'middle_name',
    'surname',
    'suffix',
    'email',
    'phone',
    'residential_address',
    'role',
    'status',
    'created_at',
    'deleted_at',
    'deleted_by'
].join(', ');

const toUi = (status) =>
    Object.keys(DB_STATUS).find((key) => DB_STATUS[key] === status) ?? status;

const normalize = (profile) => ({
    ...profile,
    name: [
        profile.first_name,
        profile.middle_name,
        profile.surname,
        profile.suffix
    ]
        .filter((part) => String(part ?? '').trim())
        .map((part) => String(part).trim())
        .join(' ') || profile.full_name || profile.email || 'Unnamed',
    role: String(profile.role ?? '').toLowerCase(),
    status: toUi(profile.status),
    joined: profile.created_at
});

// --- Profile fetching -------------------------------------------------------

async function fetchProfiles({ deleted = false } = {}) {
    let query = supabase
        .from('profiles')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

    query = deleted
        ? query.not('deleted_at', 'is', null)
        : query.is('deleted_at', null);

    const { data, error } = await query;

    if (error) throw error;

    return (data ?? [])
        .map(normalize)
        .filter((profile) => ROLES.includes(profile.role));
}

// --- Auth -------------------------------------------------------------------

export async function requireAdmin() {
    try {
        const {
            data: { user },
            error
        } = await supabase.auth.getUser();

        if (error || !user) return false;

        const { data: admin, error: adminError } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (adminError) {
            console.error('Admin lookup failed:', adminError);
            return false;
        }

        if (!admin) {
            await supabase.auth.signOut();
            return false;
        }

        return true;
    } catch (err) {
        console.error('Admin verification failed:', err);
        return false;
    }
}

export async function logout() {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;
}

// --- Users & applications ---------------------------------------------------

export async function listUsers() {
    return fetchProfiles({ deleted: false });
}

export async function listDeletedUsers() {
    return fetchProfiles({ deleted: true });
}

// --- Login security / Account lockdown --------------------------------------

export async function listLoginSecurityAccounts() {
    const { data, error } = await supabase.rpc(
        'admin_list_login_security_accounts'
    );

    if (error) {
        console.error('Failed to load login security accounts:', error);
        throw error;
    }

    return data ?? [];
}

export async function unlockLoginAccount(userId) {
    if (!userId) {
        throw new Error('A valid user ID is required.');
    }

    const { data, error } = await supabase.rpc(
        'admin_unlock_login_account',
        {
            p_user_id: userId
        }
    );

    if (error) {
        console.error('Failed to unlock account:', error);
        throw error;
    }

    if (!data?.success) {
        throw new Error(data?.message || 'Account is not locked.');
    }

    return data;
}

// --- Soft deletion ----------------------------------------------------------

export async function softDeleteUser(userId) {
    if (!userId) {
        throw new Error('A valid user ID is required.');
    }

    const { data, error } = await supabase.functions.invoke(
        'admin-delete-user',
        {
            body: { userId }
        }
    );

    if (error) {
        console.error('Soft deletion request failed:', {
            message: error.message,
            context: error.context,
            data
        });

        throw new Error(
            data?.error ||
            error.message ||
            'Failed to soft-delete account.'
        );
    }

    if (!data?.success || !data?.softDeleted) {
        throw new Error(
            data?.error ||
            'The account was not successfully soft-deleted.'
        );
    }

    log('Soft-deleted user', userId);

    return data;
}

// --- Restore soft-deleted account -------------------------------------------

export async function restoreUser(userId) {
    if (!userId) {
        throw new Error('A valid user ID is required.');
    }

    const { data, error } = await supabase
        .from('profiles')
        .update({
            deleted_at: null,
            deleted_by: null,
            status: 'suspended'
        })
        .eq('id', userId)
        .not('deleted_at', 'is', null)
        .select('id')
        .maybeSingle();

    if (error) {
        console.error('Account restoration failed:', error);

        throw new Error(
            error.message ||
            'Could not restore this account.'
        );
    }

    if (!data) {
        throw new Error(
            'Account was not restored. It may no longer be soft-deleted.'
        );
    }

    log('Restored soft-deleted user', userId);

    return data;
}

// --- Account status ---------------------------------------------------------

export async function setUserStatus(user, status, reason = '') {
    if (!user?.id) {
        throw new Error('A valid user ID is required.');
    }

    if (!Object.prototype.hasOwnProperty.call(DB_STATUS, status)) {
        throw new Error('Invalid account status.');
    }

    if (status === 'rejected' && !String(reason).trim()) {
        throw new Error('A rejection reason is required.');
    }

    const { data, error } = await supabase.functions.invoke(
        'admin-decide-application',
        {
            body: {
                userId: user.id,
                status,
                reason: String(reason).trim()
            }
        }
    );

    if (error) {
        throw new Error(
            data?.error ||
            error.message ||
            'Failed to update account status.'
        );
    }

    if (!data?.success) {
        throw new Error(
            data?.error || 'Failed to update account status.'
        );
    }

    log(
        status === 'active'
            ? (user.status === 'suspended'
                ? 'Reactivated user'
                : 'Approved application')
            : status === 'rejected'
                ? 'Rejected application'
                : 'Suspended user',
        user.name
    );

    return {
        ...user,
        status: toUi(data.status ?? DB_STATUS[status] ?? status),
        emailSent: data.emailSent
    };
}

// --- Applicant details (role-specific tables) -------------------------------

export async function getApplicantDetails(app) {
    const role = String(app.role ?? '').toLowerCase();

    if (role === 'farmer') {
        const { data: farms, error } = await supabase
            .from('farmer_farms')
            .select('id, farm_name, farm_location')
            .eq('farmer_id', app.id)
            .order('created_at', { ascending: true });

        if (error) throw error;

        console.log('Applicant ID:', app.id);
        console.log('Farmer farms returned:', farms);

        const result = [];

        for (const farm of farms ?? []) {
            result.push(
                ['Farm name', farm.farm_name],
                ['Farm location', farm.farm_location]
            );

            const { data: crops, error: cropsError } = await supabase
                .from('farmer_farm_crops')
                .select('crop_name')
                .eq('farm_id', farm.id)
                .order('crop_name', { ascending: true });

            if (cropsError) throw cropsError;

            result.push([
                `Crops grown at ${farm.farm_name || 'farm'}`,
                (crops ?? [])
                    .map((crop) => crop.crop_name)
                    .join(', ') || 'None listed'
            ]);
        }

        if (!farms?.length) {
            return [
                ['Farm name', 'None listed'],
                ['Farm location', 'None listed'],
                ['Crops grown', 'None listed']
            ];
        }

        return result;
    }

    const configs = {
        buyer: {
            table: 'buyer_details',
            fields: [
                ['Buyer type', 'buyer_type'],
                ['Business name', 'business_name']
            ],
            linkTable: 'buyer_interests',
            linkLabel: 'Interested products'
        },
        supplier: {
            table: 'supplier_details',
            fields: [
                ['Business name', 'business_name'],
                ['Business address', 'business_address']
            ],
            linkTable: 'supplier_products',
            linkLabel: 'Supplied products'
        }
    };

    const cfg = configs[role];

    if (!cfg) return [];

    const { data, error } = await supabase
        .from(cfg.table)
        .select(cfg.fields.map(([, key]) => key).join(', '))
        .eq('user_id', app.id)
        .maybeSingle();

    if (error) throw error;

    const { data: links, error: linksError } = await supabase
        .from(cfg.linkTable)
        .select('product_id')
        .eq('user_id', app.id);

    if (linksError) throw linksError;

    const productIds = [
        ...new Set(
            (links ?? [])
                .map((item) => item.product_id)
                .filter(Boolean)
        )
    ];

    let productNames = [];

    if (productIds.length) {
        const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, product_name')
            .in('id', productIds);

        if (productsError) throw productsError;

        productNames = (products ?? []).map(
            (product) => product.product_name
        );
    }

    return [
        ...cfg.fields.map(([label, key]) => [label, data?.[key]]),
        [cfg.linkLabel, productNames.join(', ') || 'None listed']
    ];
}

// --- Registration documents (private, via Edge Function) --------------------

async function review(body) {
    const { data, error } = await supabase.functions.invoke(
        'admin-review-application',
        { body }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return data;
}

export const listDocuments = async (userId) =>
    (await review({ action: 'list', userId }))?.documents ?? [];

export async function getDocumentUrl(documentId) {
    const data = await review({ action: 'view', documentId });

    if (!data?.signedUrl) {
        throw new Error('No document viewing link was returned.');
    }

    return data.signedUrl;
}

// --- Dashboard --------------------------------------------------------------

export async function getStats() {
    const u = await fetchProfiles({ deleted: false });

    const count = (key, value) =>
        u.filter((item) => item[key] === value).length;

    const days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (6 - i));
        return d;
    });

    const perDay = (role) => days.map((d) =>
        u.filter((item) =>
            item.role === role &&
            new Date(item.joined).toDateString() === d.toDateString()
        ).length
    );

    return {
        total: u.length,
        pending: count('status', 'pending'),

        byRole: Object.fromEntries(
            ROLES.map((role) => [role, count('role', role)])
        ),

        byStatus: Object.fromEntries(
            Object.keys(DB_STATUS).map((status) => [
                status,
                count('status', status)
            ])
        ),

        approval: ROLES.map((role) => {
            const decided = u.filter(
                (item) => item.role === role && item.status !== 'pending'
            );

            const approved = decided.filter(
                (item) =>
                    item.status === 'active' ||
                    item.status === 'suspended'
            ).length;

            return {
                role,
                decided: decided.length,
                approved,
                rate: decided.length
                    ? Math.round((approved / decided.length) * 100)
                    : 0
            };
        }),

        weekly: {
            labels: days.map((d) =>
                d.toLocaleDateString('en-US', { weekday: 'short' })
            ),
            ...Object.fromEntries(
                ROLES.map((role) => [role, perDay(role)])
            )
        }
    };
}

// --- Audit logs & settings ---------------------------------------------------

const settings = {
    requireApproval: true,
    allowFarmer: true,
    allowBuyer: true,
    allowSupplier: true,
    maintenance: false
};

const log = (action, target) => {
    console.info('Audit event:', action, target);
};

export async function getLogs() {
    // Fetch existing admin audit logs and login security logs.
    const [auditResult, securityResult] = await Promise.all([
        supabase
            .from('audit_logs')
            .select(`
                id,
                actor_id,
                action,
                entity_table,
                target_user_id,
                old_data,
                new_data,
                created_at
            `)
            .order('created_at', { ascending: false })
            .limit(500),

        supabase
            .from('login_security_logs')
            .select(`
                id,
                user_id,
                email,
                event_type,
                ip_address,
                location,
                device,
                browser,
                operating_system,
                metadata,
                created_at
            `)
            .order('created_at', { ascending: false })
            .limit(500)
    ]);

    if (auditResult.error) throw auditResult.error;
    if (securityResult.error) throw securityResult.error;

    const auditRows = auditResult.data ?? [];
    const securityRows = securityResult.data ?? [];

    // Resolve names for both existing audit events and login events.
    const profileIds = [
        ...new Set([
            ...auditRows.flatMap(row => [
                row.actor_id,
                row.target_user_id
            ]),
            ...securityRows.flatMap(row => [
                row.user_id,
                row.metadata?.admin_user_id
            ])
        ].filter(Boolean))
    ];

    let profiles = [];

    if (profileIds.length) {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', profileIds);

        if (error) {
            console.warn(
                'Could not resolve audit profile names:',
                error
            );
        } else {
            profiles = data ?? [];
        }
    }

    const nameById = new Map(
        profiles.map(profile => [
            profile.id,
            profile.full_name || profile.email || profile.id
        ])
    );

    // Existing administrator audit events.
    const adminLogs = auditRows.map(row => ({
        id: `audit-${row.id}`,
        time: row.created_at,

        actor: row.actor_id
            ? nameById.get(row.actor_id) || row.actor_id
            : 'System / Unknown',

        action: row.action,

        target: [
            row.entity_table,
            row.target_user_id
                ? nameById.get(row.target_user_id) ||
                  row.target_user_id
                : null
        ].filter(Boolean).join(' — '),

        old_data: row.old_data,
        new_data: row.new_data,

        ip_address: null,
        location: null,
        device: null,
        browser: null,
        operating_system: null,
        metadata: null
    }));

    // Login security events.
    const loginLogs = securityRows.map(row => ({
        id: `security-${row.id}`,
        time: row.created_at,

        actor: row.metadata?.admin_user_id
            ? nameById.get(row.metadata.admin_user_id) ||
              row.metadata.admin_user_id
            : 'System / Login Security',

        action: row.event_type,

        target: [
            row.email || 'Unknown account',
            row.user_id
                ? nameById.get(row.user_id) || row.user_id
                : null
        ].filter(Boolean).join(' — '),

        old_data: null,
        new_data: row.metadata,

        ip_address: row.ip_address,
        location: row.location,
        device: row.device,
        browser: row.browser,
        operating_system: row.operating_system,
        metadata: row.metadata
    }));

    // Combine and sort newest first.
    return [...adminLogs, ...loginLogs]
        .sort(
            (a, b) =>
                new Date(b.time).getTime() -
                new Date(a.time).getTime()
        )
        .slice(0, 500);
}

export const getSettings = async () => structuredClone(settings);

export async function saveSettings(values) {
    Object.assign(settings, values);
    log('Updated settings', 'Platform');
    return structuredClone(settings);
}
