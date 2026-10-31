
import { supabase } from '../connection.js';
import { h, pageHead, toast } from '../admin/ui.js';

const BUCKET = 'farm-images';
const MAX_BYTES = 3 * 1024 * 1024;

const TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
};

const NOT_SET = 'Not set';

const LEAF = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21v-8M12 13c0-4 2.5-6.5 7-7 0 4.5-2.5 7-7 7ZM12 15c0-3-2-5-6-5.5 0 3.5 2 5.5 6 5.5Z"/></svg>';


async function getAssignedMunicipality() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) throw new Error('No authenticated user found.');

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) throw staffError;
    if (!staff) throw new Error('Farm Manager staff record not found.');

    const { data, error } = await supabase
        .from('farm_manager_details')
        .select('assigned_farm_location')
        .eq('staff_id', staff.staff_id)
        .maybeSingle();

    if (error) throw error;

    return data?.assigned_farm_location?.trim() || null;
}


function normalizeLocation(value) {
    return (value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}


// RLS must enforce which farm records the manager may access.
// This client-side filter only matches the assigned location.
export async function loadFarms() {
    const municipality = await getAssignedMunicipality();

    if (!municipality) return [];

    const [farmRes, ownerRes] = await Promise.all([
        supabase
            .from('farmer_farms')
            .select('id, farmer_id, farm_name, farm_location, cover_image_path')
            .order('farm_name'),

        supabase.rpc('manager_list_farmers')
    ]);

    if (farmRes.error) throw farmRes.error;
    if (ownerRes.error) throw ownerRes.error;

    const owners = new Map(
        (ownerRes.data ?? []).map((r) => [r.farm_id, r])
    );

    const assignedParts = normalizeLocation(municipality)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

    const municipalityKeyword = assignedParts[0];
    const provinceKeyword = assignedParts[1] ?? '';

    const farms = (farmRes.data ?? []).filter((farm) => {
        const farmLocation = normalizeLocation(farm.farm_location);

        const matchesMunicipality =
            farmLocation.includes(municipalityKeyword);

        const matchesProvince =
            !provinceKeyword || farmLocation.includes(provinceKeyword);

        return matchesMunicipality && matchesProvince;
    });

    const paths = farms
        .map((farm) => farm.cover_image_path)
        .filter(Boolean);

    const urls = {};

    if (paths.length) {
        const { data: signed, error: signErr } = await supabase.storage
            .from(BUCKET)
            .createSignedUrls(paths, 3600);

        if (signErr) {
            console.error('Could not sign image URLs:', signErr);
        }

        (signed ?? []).forEach((item) => {
            if (item.signedUrl) {
                urls[item.path] = item.signedUrl;
            }
        });
    }

    return farms.map((farm) => ({
        ...farm,
        imageUrl: urls[farm.cover_image_path] ?? null,
        farmerName: owners.get(farm.id)?.full_name ?? 'Unknown farmer',
        farmerEmail: owners.get(farm.id)?.email ?? ''
    }));
}


function confirmRemove(farm, onConfirm) {
    const ok = h(
        'button',
        {
            class: 'btn danger',
            type: 'button'
        },
        'Remove Photo'
    );

    const dialog = h(
        'dialog',
        {
            class: 'details staff-dialog',
            'aria-label': 'Remove farm photo'
        },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'Remove Farm Photo?')
        ),
        h(
            'p',
            {},
            `The photo for ${farm.farm_name} will be deleted. You can add a new one later.`
        ),
        h(
            'div',
            { class: 'staff-buttons' },
            h(
                'button',
                {
                    class: 'btn ghost',
                    type: 'button',
                    onclick: () => dialog.close()
                },
                'Cancel'
            ),
            ok
        )
    );

    dialog.addEventListener('close', () => dialog.remove());

    ok.addEventListener('click', async () => {
        if (ok.disabled) return;

        ok.disabled = true;
        ok.textContent = 'Removing...';

        try {
            await onConfirm();
            dialog.close();
        } catch (err) {
            console.error('Remove photo failed:', err);
            toast(errText(err));

            ok.disabled = false;
            ok.textContent = 'Remove Photo';
        }
    });

    document.body.append(dialog);
    dialog.showModal();
}


async function uploadCover(farm, file) {
    const ext = TYPES[file.type];

    if (!ext) {
        throw new Error('Use a JPG, PNG, or WebP image.');
    }

    if (file.size > MAX_BYTES) {
        throw new Error('The image must be 3 MB or smaller.');
    }

    const path = `${farm.id}/cover-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
            contentType: file.type
        });

    if (upErr) throw upErr;

    const { data: oldPath, error: rpcErr } = await supabase
        .rpc('set_farm_cover_image', {
            p_farm_id: farm.id,
            p_path: path
        });

    if (rpcErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw rpcErr;
    }

    if (oldPath) {
        const { error: removeErr } = await supabase.storage
            .from(BUCKET)
            .remove([oldPath]);

        if (removeErr) {
            console.error('Could not remove old farm photo:', removeErr);
        }
    }
}


async function removeCover(farm) {
    const { data: oldPath, error } = await supabase
        .rpc('set_farm_cover_image', {
            p_farm_id: farm.id,
            p_path: null
        });

    if (error) throw error;

    if (oldPath) {
        const { error: removeErr } = await supabase.storage
            .from(BUCKET)
            .remove([oldPath]);

        if (removeErr) {
            console.error('Could not delete old farm photo:', removeErr);
        }
    }
}


export const statBox = (label, value) =>
    h(
        'div',
        { class: 'stat-box' },
        h('small', {}, label),
        h('b', {}, value)
    );


// Combined Edit Photo menu
function openPhotoActions(farm, fileIn, onChanged) {
    const dialog = h(
        'dialog',
        {
            class: 'details staff-dialog',
            'aria-label': 'Edit farm photo'
        },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'Edit Farm Photo')
        ),
        h(
            'p',
            {},
            farm.imageUrl
                ? 'Change or remove the current farm photo.'
                : 'Upload a photo for this farm.'
        ),
        h(
            'div',
            { class: 'staff-buttons' },
            h(
                'button',
                {
                    class: 'btn ghost',
                    type: 'button',
                    onclick: () => dialog.close()
                },
                'Cancel'
            ),
            h(
                'button',
                {
                    class: 'btn ghost',
                    type: 'button',
                    onclick: () => {
                        dialog.close();
                        fileIn.click();
                    }
                },
                'Change Photo'
            ),
            h(
                'button',
                {
                    class: 'btn danger',
                    type: 'button',
                    disabled: !farm.imageUrl,
                    onclick: () => {
                        dialog.close();

                        confirmRemove(farm, async () => {
                            await removeCover(farm);
                            toast('Photo removed.');
                            await onChanged();
                        });
                    }
                },
                'Remove Photo'
            )
        )
    );

    dialog.addEventListener('close', () => dialog.remove());

    document.body.append(dialog);
    dialog.showModal();
}


function errText(err) {
    if (
        err?.code === '42501' ||
        /row-level security|not authorized/i.test(err?.message ?? '')
    ) {
        return 'You are not allowed to change this farm.';
    }

    if (
        err?.message &&
        /JPG|3 MB/.test(err.message)
    ) {
        return err.message;
    }

    return 'Something went wrong. Please try again.';
}


export function farmCard(farm, onChanged) {
    const empty = !farm.imageUrl;

    const cover = empty
        ? h(
            'div',
            { class: 'fm-cover-empty' },
            (() => {
                const span = h('span', { class: 'fm-leaf' });
                span.innerHTML = LEAF;
                return span;
            })(),
            h('small', {}, 'No farm photo yet')
        )
        : h('img', {
            class: 'fm-cover',
            src: farm.imageUrl,
            alt: `Photo of ${farm.farm_name}`,
            loading: 'lazy'
        });

    const fileIn = h('input', {
        type: 'file',
        accept: Object.keys(TYPES).join(','),
        hidden: true,
        'aria-label': `Choose photo for ${farm.farm_name}`
    });

    const editPhotoBtn = h(
        'button',
        {
            class: 'btn ghost',
            type: 'button',
            onclick: () => openPhotoActions(farm, fileIn, onChanged)
        },
        'Edit Photo'
    );

    fileIn.addEventListener('change', async () => {
        const file = fileIn.files[0];
        fileIn.value = '';

        if (!file) return;

        editPhotoBtn.disabled = true;
        editPhotoBtn.textContent = 'Uploading...';

        try {
            await uploadCover(farm, file);
            toast('Photo saved.');
            await onChanged();
        } catch (err) {
            console.error('Upload failed:', err);
            toast(errText(err));

            editPhotoBtn.disabled = false;
            editPhotoBtn.textContent = 'Edit Photo';
        }
    });

    const farmActions = h(
        'div',
        { class: 'fm-action-grid' },

        editPhotoBtn,

        h(
            'button',
            {
                class: 'btn ghost',
                type: 'button',
                onclick: () => {
                    toast('View Details action is not connected yet.');
                }
            },
            'View Details'
        ),
    );

    return h(
        'article',
        {
            class: `hero fm-hero${empty ? ' hero--empty' : ''}`
        },
        cover,

        h(
            'div',
            { class: 'hero-card' },

            h(
                'div',
                { class: 'hero-head' },
                h(
                    'div',
                    {},
                    h('h3', {}, farm.farmerName),
                    h('small', {}, farm.farm_name),
                    h('small', {}, farm.farm_location)
                )
            ),

            farmActions,

            fileIn
        )
    );
}


export async function render(root, ctx) {
    const holder = h('div');

    root.append(
        pageHead(
            'My Farms',
            'Farms in your assigned municipality.'
        ),
        holder
    );

    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading farms...')
        );

        try {
            const q = (ctx?.query ?? '').toLowerCase();

            const farms = (await loadFarms()).filter((farm) =>
                `${farm.farmerName} ${farm.farm_name} ${farm.farm_location}`
                    .toLowerCase()
                    .includes(q)
            );

            if (!farms.length) {
                holder.replaceChildren(
                    h(
                        'section',
                        { class: 'card' },
                        h(
                            'p',
                            { class: 'muted' },
                            q
                                ? 'No farms match your search.'
                                : 'No farms found in your assigned municipality. Check the farm location format or contact the administrator.'
                        )
                    )
                );

                return;
            }

            holder.replaceChildren(
                h(
                    'div',
                    { class: 'fm-grid' },
                    farms.map((farm) => farmCard(farm, load))
                )
            );
        } catch (err) {
            console.error('Failed to load farms:', err);

            holder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Could not load farms.'
                ),
                h(
                    'button',
                    {
                        class: 'btn ghost staff-retry',
                        type: 'button',
                        onclick: load
                    },
                    'Retry'
                )
            );
        }
    };

    await load();
}
