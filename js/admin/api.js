
import { supabase } from '../connection.js';

// UI status -> value stored in profiles.status.
const DB_STATUS = {
    active: 'approved',
    pending: 'pending',
    rejected: 'rejected',
    suspended: 'suspended'
};

const ROLES = ['farmer', 'buyer', 'supplier'];
const COLUMNS =
    'id, full_name, first_name, middle_name, surname, suffix, email, phone, residential_address, role, status, created_at';

const toUi = (s) =>
    Object.keys(DB_STATUS).find((k) => DB_STATUS[k] === s) ?? s;

const normalize = (p) => ({
    ...p,
    name: [
        p.first_name,
        p.middle_name,
        p.surname,
        p.suffix
    ].filter((part) => String(part ?? '').trim())
        .map((part) => String(part).trim())
        .join(' ') || p.full_name || p.email || 'Unnamed',
    role: String(p.role ?? '').toLowerCase(),
    status: toUi(p.status),
    joined: p.created_at,
});

/** Fetch supported applicant profiles newest-first and normalize their UI fields. */
async function fetchProfiles() {
    const { data, error } = await supabase
        .from('profiles')
        .select(COLUMNS)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return (data ?? [])
        .map(normalize)
        .filter((p) => ROLES.includes(p.role));
}

// --- Auth -------------------------------------------------------------------
/** Confirm the current user has an admin_users row; sign out unauthorized users. */
export async function requireAdmin() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();

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

/** End the current Supabase session and propagate any sign-out error. */
export async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

// --- Users & applications ---------------------------------------------------
export const listUsers = fetchProfiles;

/** Change an applicant's status through the admin decision function. */
export async function setUserStatus(user, status, reason = '') {
    if (status === 'rejected' && !reason.trim()) {
        throw new Error('A rejection reason is required.');
    }

    const { data, error } = await supabase.functions.invoke(
        'admin-decide-application',
        {
            body: {
                userId: user.id,
                status,
                reason: reason.trim()
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

// --- Permanently delete a user ----------------------------------------------
// Requires the admin-delete-user Supabase Edge Function to be deployed.
/** Permanently delete the specified user through the admin Edge Function. */
export async function deleteUserPermanently(userId) {
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
        throw new Error(
            error.message || 'Failed to delete user.'
        );
    }

    if (!data?.success) {
        throw new Error(
            data?.error || 'Failed to delete user.'
        );
    }

    return data;
}

// --- Applicant details (role-specific tables) -------------------------------

const ROLE_DETAILS = {
    farmer: {
        table: 'farmer_farms',
        fields: [
            ['Farm name', 'farm_name'],
            ['Farm location', 'farm_location']
        ]
    },
    buyer: {
        table: 'buyer_details',
        fields: [
            ['Buyer type', 'buyer_type'],
            ['Business name', 'business_name']
        ]
    },
    supplier: {
        table: 'supplier_details',
        fields: [
            ['Business name', 'business_name'],
            ['Business address', 'business_address']
        ]
    }
};

/** Load profile details, farms/crops, or business/product interests by role. */
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

/** Invoke the admin document-review function for the requested action. */
async function review(body) {
    const { data, error } = await supabase.functions.invoke(
        'admin-review-application',
        { body }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    return data;
}

/** List private registration documents for one applicant. */
export const listDocuments = async (userId) =>
    (await review({ action: 'list', userId }))?.documents ?? [];

/** Request a signed viewing URL for one private registration document. */
export async function getDocumentUrl(documentId) {
    const data = await review({ action: 'view', documentId });

    if (!data?.signedUrl) {
        throw new Error('No document viewing link was returned.');
    }

    return data.signedUrl;
}

// --- Dashboard --------------------------------------------------------------

/** Aggregate profile counts, approval rates, and the trailing seven days. */
export async function getStats() {
    const u = await fetchProfiles();
    const count = (k, v) => u.filter((x) => x[k] === v).length;

    const days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (6 - i));
        return d;
    });

    const perDay = (role) => days.map((d) =>
        u.filter((x) =>
            x.role === role &&
            new Date(x.joined).toDateString() === d.toDateString()
        ).length
    );

    return {
        total: u.length,
        pending: count('status', 'pending'),

        byRole: Object.fromEntries(
            ROLES.map((r) => [r, count('role', r)])
        ),

        byStatus: Object.fromEntries(
            Object.keys(DB_STATUS).map((s) => [s, count('status', s)])
        ),

        approval: ROLES.map((role) => {
            const decided = u.filter(
                (x) => x.role === role && x.status !== 'pending'
            );

            const approved = decided.filter(
                (x) => x.status === 'active' || x.status === 'suspended'
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
                ROLES.map((r) => [r, perDay(r)])
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
    const { data, error } = await supabase
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
        .limit(500);

    if (error) throw error;

    const rows = data ?? [];

    const profileIds = [
        ...new Set(
            rows.flatMap((row) => [
                row.actor_id,
                row.target_user_id
            ]).filter(Boolean)
        )
    ];

    let profiles = [];

    if (profileIds.length) {
        const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', profileIds);

        if (profileError) {
            console.warn('Could not resolve audit profile names:', profileError);
        } else {
            profiles = profileData ?? [];
        }
    }

    const nameById = new Map(
        profiles.map((profile) => [
            profile.id,
            profile.full_name || profile.email || profile.id
        ])
    );

    return rows.map((row) => ({
        id: row.id,
        time: row.created_at,
        actor: row.actor_id
            ? nameById.get(row.actor_id) || row.actor_id
            : 'System / Unknown',
        action: row.action,
        target: [
            row.entity_table,
            row.target_user_id
                ? nameById.get(row.target_user_id) || row.target_user_id
                : null
        ].filter(Boolean).join(' — '),
        old_data: row.old_data,
        new_data: row.new_data
    }));
}

export const getSettings = async () => structuredClone(settings);

/** Update the in-memory settings object and return a defensive copy. */
export async function saveSettings(values) {
    Object.assign(settings, values);
    log('Updated settings', 'Platform');
    return structuredClone(settings);
}
