import { supabase } from '../connection.js';
import { h, pageHead, toast } from '../admin/ui.js';

const FIELD_NAMES = [
    'Field A',
    'Field B',
    'Field C',
    'Field D',
    'Field E',
    'Field F'
];

const STATUS_TABLES = {
    activity: 'planting_activity_statuses',
    crop: 'crop_statuses'
};

const INITIAL_ACTIVITY_STATUS = 'assigned';
const INITIAL_CROP_STATUS = 'not_planted';

const statusCache = new Map();
let plantingsChannel = null;
let plantingsReloadTimer = null;

function loadStatusReference(kind) {
    if (!statusCache.has(kind)) {
        const request = (async () => {
            const { data, error } = await supabase
                .from(STATUS_TABLES[kind])
                .select('code, label, display_order')
                .eq('is_active', true)
                .order('display_order', { ascending: true });

            if (error) throw error;

            return new Map(
                (data ?? []).map(status => [
                    status.code,
                    {
                        status_code: status.code,
                        status_label: status.label,
                        display_order: status.display_order
                    }
                ])
            );
        })();

        statusCache.set(kind, request);
        request.catch(() => statusCache.delete(kind));
    }

    return statusCache.get(kind);
}

async function loadStatusReferences() {
    const results = await Promise.allSettled([
        loadStatusReference('activity'),
        loadStatusReference('crop')
    ]);

    const [activityResult, cropResult] = results;

    const failed = results.find(result => result.status === 'rejected');

    return {
        activity:
            activityResult.status === 'fulfilled'
                ? activityResult.value
                : new Map(),
        crop:
            cropResult.status === 'fulfilled'
                ? cropResult.value
                : new Map(),
        error: failed?.reason ?? null
    };
}

// Turns a status code into a CSS-safe class suffix.
function statusClassName(code) {
    return (
        String(code ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-') || 'unknown'
    );
}

// Fallback only when a code has no matching reference record.
function fallbackStatusLabel(code) {
    return String(code)
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, character => character.toUpperCase());
}

function statusBadge(code, statusMap) {
    if (!code) {
        return h('span', { class: 'muted' }, '—');
    }

    const record = statusMap.get(code);

    return h(
        'span',
        {
            class: `crop-status crop-status--${statusClassName(code)}`
        },
        record?.status_label || fallbackStatusLabel(code)
    );
}

function normalizeLocation(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function normalizeName(value) {
    return normalizeLocation(value);
}

function getLocationParts(value) {
    return normalizeLocation(value)
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
}

function isInAssignedMunicipality(location, assignedLocation) {
    const assignedParts = getLocationParts(assignedLocation);
    const locationParts = getLocationParts(location);

    if (!assignedParts.length || !locationParts.length) {
        return false;
    }

    const municipality = assignedParts[0];
    const province = assignedParts[1] ?? '';

    const municipalityMatches =
        locationParts[0] === municipality ||
        locationParts.some(part => part === municipality);

    const provinceMatches =
        !province || locationParts.some(part => part === province);

    return municipalityMatches && provinceMatches;
}

function getFarmerKey(farmer) {
    if (farmer?.email) {
        return `email:${normalizeLocation(farmer.email)}`;
    }

    if (farmer?.full_name) {
        return `name:${normalizeName(farmer.full_name)}`;
    }

    return null;
}

function option(value, label) {
    return h('option', { value: String(value) }, label);
}

function createSelect(id, label, placeholder) {
    const select = h(
        'select',
        {
            id,
            name: id,
            class: 'crop-select',
            required: true
        },
        option('', placeholder)
    );

    return {
        element: h(
            'div',
            { class: 'crop-form-group' },
            h('label', { for: id }, label),
            select
        ),
        select
    };
}

function createInput(id, label, type, required = false) {
    const input = h('input', {
        id,
        name: id,
        type,
        required,
        class: 'crop-input'
    });

    return {
        element: h(
            'div',
            { class: 'crop-form-group' },
            h('label', { for: id }, label),
            input
        ),
        input
    };
}

/*
 * Crop Picker
 * - Loads registered crops from farmer_farm_crops.
 * - Removes duplicate names case-insensitively.
 * - Supports custom crop names through Other.
 */
function createCropPicker() {
    const picker = h('div', {
        id: 'cropPicker',
        class: 'crop-form-group crop-picker'
    });

    const summary = h(
        'span',
        { id: 'cropPickerSummary' },
        'Choose a crop'
    );

    const trigger = h(
        'button',
        {
            type: 'button',
            id: 'cropPickerTrigger',
            class: 'crop-select crop-picker-trigger',
            'aria-expanded': 'false'
        },
        summary,
        h('span', { 'aria-hidden': 'true' }, '▾')
    );

    const dropdown = h('div', {
        id: 'cropPickerDropdown',
        class: 'crop-picker-dropdown',
        hidden: true
    });

    const otherField = h('div', {
        class: 'crop-form-group',
        hidden: true
    });

    const otherInput = h('input', {
        type: 'text',
        id: 'cropOtherInput',
        class: 'crop-input',
        placeholder: 'Enter a crop name',
        maxlength: 100
    });

    otherField.append(
        h('label', { for: 'cropOtherInput' }, 'Other crop'),
        otherInput
    );

    function getSelectedCrop() {
        const selected = picker.querySelector(
            'input[name="cropProduct"]:checked'
        );

        if (!selected) return '';

        if (selected.value === '__other__') {
            return otherInput.value.trim();
        }

        return selected.value;
    }

    function updateSummary() {
        const selected = picker.querySelector(
            'input[name="cropProduct"]:checked'
        );

        if (!selected) {
            summary.textContent = 'Choose a crop';
            return;
        }

        if (selected.value === '__other__') {
            summary.textContent =
                otherInput.value.trim() || 'Other';
            return;
        }

        summary.textContent = selected.value;
    }

    function setCrops(items) {
        dropdown.replaceChildren();
        otherInput.value = '';
        otherField.hidden = true;
        summary.textContent = 'Choose a crop';

        const uniqueCrops = new Map();

        for (const crop of items ?? []) {
            const name = crop.crop_name?.trim();

            if (!name || name.toLowerCase() === 'other') {
                continue;
            }

            const key = name.toLowerCase();

            if (!uniqueCrops.has(key)) {
                uniqueCrops.set(key, name);
            }
        }

        const cropNames = [...uniqueCrops.values()].sort(
            (a, b) => a.localeCompare(b)
        );

        if (!cropNames.length) {
            dropdown.append(
                h(
                    'p',
                    { class: 'muted' },
                    'No crops are registered for this farm. You can select Other to enter a crop name.'
                )
            );
        }

        const options = [
            ...cropNames.map(name => ({
                value: name,
                label: name
            })),
            {
                value: '__other__',
                label: 'Other'
            }
        ];

        for (const crop of options) {
            const radio = h('input', {
                type: 'radio',
                name: 'cropProduct',
                value: crop.value,
                required: true
            });

            radio.addEventListener('change', () => {
                otherField.hidden = crop.value !== '__other__';

                if (crop.value !== '__other__') {
                    otherInput.value = '';
                }

                updateSummary();

                picker.dispatchEvent(
                    new Event('change', { bubbles: true })
                );
            });

            dropdown.append(
                h(
                    'label',
                    { class: 'crop-picker-option' },
                    radio,
                    h('span', {}, crop.label)
                )
            );
        }

        dropdown.append(otherField);
    }

    trigger.addEventListener('click', () => {
        const isOpen =
            trigger.getAttribute('aria-expanded') === 'true';

        dropdown.hidden = isOpen;
        trigger.setAttribute('aria-expanded', String(!isOpen));
    });

    otherInput.addEventListener('input', () => {
        updateSummary();

        picker.dispatchEvent(
            new Event('change', { bubbles: true })
        );
    });

    document.addEventListener('click', event => {
        if (!picker.contains(event.target)) {
            dropdown.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            dropdown.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
        }
    });

    picker.append(
        h('label', {}, 'Crop'),
        trigger,
        dropdown
    );

    return {
        element: picker,
        setCrops,
        getSelectedCrop,

        getSelectedCropId: getSelectedCrop,

        clear: () => {
            picker.querySelectorAll(
                'input[name="cropProduct"]'
            ).forEach(input => {
                input.checked = false;
            });

            otherInput.value = '';
            otherField.hidden = true;
            summary.textContent = 'Choose a crop';
            dropdown.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }
    };
}

function dateLabel(value) {
    if (!value) return '—';

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) return value;

    return date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function errorMessage(error) {
    if (
        error?.code === '42501' ||
        /row-level security|not authorized|permission denied/i.test(
            error?.message ?? ''
        )
    ) {
        return 'Access denied by database security. Check the RLS policies for this operation.';
    }

    return error?.message ||
        'Something went wrong. Please try again.';
}

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

    if (!staff) {
        throw new Error('Farm Manager staff record not found.');
    }

    const { data: manager, error: managerError } = await supabase
        .from('farm_manager_details')
        .select('assigned_farm_location')
        .eq('staff_id', staff.staff_id)
        .maybeSingle();

    if (managerError) throw managerError;

    const location = manager?.assigned_farm_location?.trim();

    if (!location) {
        throw new Error(
            'No municipality is assigned to your account. Please contact the administrator.'
        );
    }

    return location;
}

async function loadFarmers() {
    const { data, error } = await supabase.rpc(
        'manager_list_residential_farmers'
    );

    if (error) throw error;

    return (data ?? []).map(farmer => ({
        ...farmer,
        full_name: farmer.full_name || 'Unnamed farmer',
        email: farmer.email || ''
    }));
}

async function loadFarms(assignedLocation) {
    const [farmResult, ownerResult] = await Promise.all([
        supabase
            .from('farmer_farms')
            .select('id, farm_name, farm_location')
            .order('farm_name'),

        supabase.rpc('manager_list_farmers')
    ]);

    if (farmResult.error) throw farmResult.error;
    if (ownerResult.error) throw ownerResult.error;

    const owners = new Map(
        (ownerResult.data ?? []).map(owner => [
            owner.farm_id,
            owner
        ])
    );

    return (farmResult.data ?? [])
        .filter(farm =>
            isInAssignedMunicipality(
                farm.farm_location,
                assignedLocation
            )
        )
        .map(farm => ({
            ...farm,
            owner: owners.get(farm.id) ?? null
        }));
}

async function loadProducts() {
    const { data, error } = await supabase
        .from('products')
        .select('id, product_name')
        .order('product_name');

    if (error) throw error;

    return data ?? [];
}


async function loadCropCatalog(managerId) {
    if (!managerId) {
        throw new Error('Farm Manager account could not be identified.');
    }

    const { data, error } = await supabase
        .from('crops_catalog')
        .select('crops_id, crops_name, crops_description')
        .eq('farm_manager_id', managerId)
        .is('crops_date_deleted', null)
        .eq('is_active', true)
        .order('crops_name', { ascending: true });

    if (error) throw error;

    const uniqueCrops = new Map();

    for (const crop of data ?? []) {
        const name = crop.crops_name?.trim();

        if (!name) continue;

        const key = name.toLowerCase();

        if (!uniqueCrops.has(key)) {
            uniqueCrops.set(key, {
                id: crop.crops_id,
                crop_name: name,
                crop_description: crop.crops_description
            });
        }
    }

    return [...uniqueCrops.values()];
}


/*
 * A matching product is optional for new planting assignments.
 * If multiple product names match, choose the lowest ID.
 */
function findProductForCrop(cropName, products) {
    const normalizedCrop = normalizeLocation(cropName);

    if (!normalizedCrop) return null;

    return (products ?? [])
        .filter(product =>
            normalizeLocation(product.product_name) === normalizedCrop
        )
        .sort((a, b) => Number(a.id) - Number(b.id))[0] ?? null;
}

async function loadOrCreateFields(farmId) {
    const { data: existingFields, error } = await supabase
        .from('farm_fields')
        .select('id, farm_id, field_name, area_ha')
        .eq('farm_id', farmId);

    if (error) throw error;

    const fields = [...(existingFields ?? [])];

    const existingNames = new Set(
        fields.map(field =>
            normalizeLocation(field.field_name)
        )
    );

    const missingNames = FIELD_NAMES.filter(
        name => !existingNames.has(normalizeLocation(name))
    );

    if (missingNames.length) {
        const newFields = missingNames.map(fieldName => ({
            farm_id: farmId,
            field_name: fieldName,
            area_ha: 0.01
        }));

        const { data: inserted, error: insertError } = await supabase
            .from('farm_fields')
            .insert(newFields)
            .select('id, farm_id, field_name, area_ha');

        if (insertError) {
            throw new Error(
                `Could not create fields for this farm. ${errorMessage(insertError)}`
            );
        }

        fields.push(...(inserted ?? []));
    }

    const byName = new Map(
        fields.map(field => [
            normalizeLocation(field.field_name),
            field
        ])
    );

    return FIELD_NAMES
        .map(name => byName.get(normalizeLocation(name)))
        .filter(Boolean);
}

async function loadPlantings(farms) {
    if (!farms.length) return [];

    const farmIds = farms.map(farm => farm.id);

    const { data: fields, error: fieldsError } = await supabase
        .from('farm_fields')
        .select('id, farm_id, field_name')
        .in('farm_id', farmIds);

    if (fieldsError) throw fieldsError;
    if (!fields?.length) return [];

    const { data: plantings, error: plantingsError } = await supabase
        .from('farm_plantings')
        .select(
            'id, field_id, product_id, crop_name, sowing_date, expected_harvest_date, activity_status, crop_status, notes'
        )
        .in(
            'field_id',
            fields.map(field => field.id)
        )
        .order('created_at', { ascending: true });

    if (plantingsError) throw plantingsError;

    const fieldMap = new Map(
        fields.map(field => [field.id, field])
    );

    return (plantings ?? []).map(planting => ({
        ...planting,
        field: fieldMap.get(planting.field_id)
    }));
}

function cleanupPlantingsRealtime() {
    clearTimeout(plantingsReloadTimer);
    plantingsReloadTimer = null;

    if (plantingsChannel) {
        supabase.removeChannel(plantingsChannel);
        plantingsChannel = null;
    }
}

function subscribeToPlantings(onUpdate) {
    cleanupPlantingsRealtime();

    plantingsChannel = supabase
        .channel('farm-manager-plantings')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'farm_plantings'
            },
            () => {
                clearTimeout(plantingsReloadTimer);

                plantingsReloadTimer = setTimeout(() => {
                    onUpdate();
                }, 400);
            }
        )
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                console.log(
                    'Farm Manager Plantings Realtime connected.'
                );
            } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT'
            ) {
                console.error(
                    'Farm Manager Plantings Realtime failed:',
                    status
                );
            }
        });
}

export function cleanup() {
    cleanupPlantingsRealtime();
}

export async function render(root, ctx) {
    cleanupPlantingsRealtime();
    const holder = h('div', { class: 'crop-page' });

    root.append(
        pageHead('Plant Management',),
        holder
    );

    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading crop management...')
        );

        try {
            const assignedLocation = await getAssignedMunicipality();

            const {
                data: { user },
                error: authError
            } = await supabase.auth.getUser();

            if (authError) throw authError;
            if (!user) throw new Error('No authenticated user found.');

            const { data: manager, error: managerError } = await supabase
                .from('staff_accounts')
                .select('staff_id')
                .eq('user_id', user.id)
                .maybeSingle();

            if (managerError) throw managerError;
            if (!manager) throw new Error('Farm Manager account not found.');

            const managerId = manager.staff_id;

            const [farmers, products, statuses] = await Promise.all([
                loadFarmers(),
                loadProducts(),
                loadStatusReferences()
            ]);

            // Status labels are non-critical: the page still works if
            // they fail to load, showing readable codes instead.
            if (statuses.error) {
                console.error(
                    'Could not load status reference tables:',
                    statuses.error
                );

                toast(
                    `Could not load status labels. ${errorMessage(statuses.error)}`
                );
            }

            const farms = await loadFarms(assignedLocation);

            const farmMap = new Map(
                farms.map(farm => [farm.id, farm])
            );

            const productMap = new Map(
                products.map(product => [
                    String(product.id),
                    product
                ])
            );

            const farmerDropdown = createSelect(
                'cropFarmer',
                'Farmer',
                'Select farmer'
            );

            const farmDropdown = createSelect(
                'cropFarm',
                'Farm',
                'Select farm'
            );

            const fieldDropdown = createSelect(
                'cropField',
                'Farm Field',
                'Select farm first'
            );

            const productDropdown = createCropPicker();

            const sowingDate = createInput(
                'cropSowingDate',
                'Planting Date',
                'date',
                true
            );

            const harvestDate = createInput(
                'cropHarvestDate',
                'Expected Harvest Date',
                'date'
            );

            const notes = h('textarea', {
                id: 'cropNotes',
                name: 'cropNotes',
                rows: 3,
                class: 'crop-input',
                placeholder: 'Optional notes'
            });

            const notesGroup = h(
                'div',
                { class: 'crop-form-group crop-form-full' },
                h('label', { for: 'cropNotes' }, 'Notes'),
                notes
            );

            const message = h('p', {
                class: 'muted',
                role: 'status'
            });

            const saveButton = h(
                'button',
                {
                    type: 'submit',
                    class: 'btn',
                    disabled: true
                },
                'Save Planting'
            );

            const form = h(
                'form',
                { class: 'card crop-form' },
                h(
                    'div',
                    { class: 'card-head' },
                    h('h2', {}, 'Create Planting Assignment'),
                    h(
                        'p',
                        { class: 'muted' },
                        `Assigned municipality: ${assignedLocation}`
                    )
                ),
                h(
                    'div',
                    { class: 'crop-form-grid' },
                    farmerDropdown.element,
                    farmDropdown.element,
                    fieldDropdown.element,
                    productDropdown.element,
                    sowingDate.element,
                    harvestDate.element,
                    notesGroup
                ),
                message,
                saveButton
            );

            const farmerSelect = farmerDropdown.select;
            const farmSelect = farmDropdown.select;
            const fieldSelect = fieldDropdown.select;

            farmerSelect.replaceChildren(
                option('', 'Select farmer'),
                ...farmers.map(farmer =>
                    option(
                        farmer.farmer_id,
                        farmer.full_name
                    )
                )
            );

            const fieldInfo = h('p', {
                class: 'muted',
                role: 'status'
            });

            const records = h('div', { class: 'crop-records' });

            holder.replaceChildren(
                form,
                fieldInfo,
                records
            );

            function getSelectedFarm() {
                return farmMap.get(farmSelect.value);
            }

            function updateSaveButton() {
                const selectedFarm = getSelectedFarm();
                const selectedCrop = productDropdown.getSelectedCrop();

                saveButton.disabled = !(
                    farmerSelect.value &&
                    selectedFarm &&
                    fieldSelect.value &&
                    selectedCrop &&
                    sowingDate.input.value
                );
            }

            function updateFarmOptions() {
                const previousFarm = farmSelect.value;

                farmSelect.replaceChildren(
                    option('', 'Select farm'),
                    ...farms.map(farm =>
                        option(
                            farm.id,
                            `${farm.farm_name} — ${farm.farm_location}`
                        )
                    )
                );

                if (farms.some(farm => farm.id === previousFarm)) {
                    farmSelect.value = previousFarm;
                }

                updateSaveButton();
            }

            async function updateFieldOptions() {
                const farmId = farmSelect.value;

                fieldSelect.disabled = true;
                fieldSelect.replaceChildren(
                    option(
                        '',
                        farmId ? 'Loading fields...' : 'Select farm first'
                    )
                );

                fieldInfo.textContent = '';
                updateSaveButton();

                if (!farmId) return;

                try {
                    const fields = await loadOrCreateFields(farmId);

                    // Ignore stale responses if the farm changes.
                    if (farmSelect.value !== farmId) return;

                    fieldSelect.replaceChildren(
                        option('', 'Select field'),
                        ...fields.map(field =>
                            option(field.id, field.field_name)
                        )
                    );

                    fieldSelect.disabled = false;

                    if (!fields.length) {
                        fieldSelect.replaceChildren(
                            option('', 'No fields available')
                        );

                        fieldInfo.textContent =
                            'No fields could be loaded for this farm.';
                    }
                } catch (error) {
                    console.error('Could not load fields:', error);

                    fieldSelect.replaceChildren(
                        option('', 'Could not load fields')
                    );

                    fieldInfo.textContent = errorMessage(error);
                }

                updateSaveButton();
            }

            async function updateCropOptions() {
                productDropdown.clear();
                updateSaveButton();

                const farmId = farmSelect.value;

                if (!farmId) {
                    message.textContent = '';
                    return;
                }

                message.textContent = 'Loading crop catalog...';

                try {
                    const crops = await loadCropCatalog(managerId);

                    if (farmSelect.value !== farmId) return;

                    productDropdown.setCrops(crops);

                    message.textContent = crops.length
                        ? ''
                        : 'No active crops are available in the crop catalog. Please contact the Farm Manager.';
                } catch (error) {
                    console.error('Could not load crop catalog:', error);

                    if (farmSelect.value !== farmId) return;

                    message.textContent =
                        `Could not load crops. ${errorMessage(error)}`;
                }

                updateSaveButton();
            }

            function renderRecords(plantings) {
                if (!plantings.length) {
                    records.replaceChildren(
                        h(
                            'section',
                            { class: 'card' },
                            h(
                                'p',
                                { class: 'muted' },
                                'No planting records found for these farms.'
                            )
                        )
                    );

                    return;
                }

                const rows = plantings.map(planting => {
                    const field = planting.field;
                    const farm = field
                        ? farmMap.get(field.farm_id)
                        : null;

                    const product = productMap.get(
                        String(planting.product_id)
                    );

                    // Prefer the saved crop name, then fall back to
                    // the product catalog for older planting records.
                    const cropName =
                        planting.crop_name?.trim() ||
                        product?.product_name ||
                        '—';

                    return h(
                        'tr',
                        {},
                        h('td', {}, farm?.owner?.full_name ?? '—'),
                        h('td', {}, farm?.farm_name ?? '—'),
                        h('td', {}, field?.field_name ?? '—'),
                        h('td', {}, cropName),
                        h('td', {}, dateLabel(planting.sowing_date)),
                        h('td', {}, dateLabel(planting.expected_harvest_date)),
                        h(
                            'td',
                            {},
                            statusBadge(
                                planting.activity_status,
                                statuses.activity
                            )
                        ),
                        h(
                            'td',
                            {},
                            statusBadge(
                                planting.crop_status,
                                statuses.crop
                            )
                        )
                    );
                });

                records.replaceChildren(
                    h(
                        'section',
                        { class: 'card crop-table-card' },
                        h(
                            'div',
                            { class: 'card-head' },
                            h('h2', {}, 'Planting Records')
                        ),
                        h(
                            'div',
                            { class: 'table-wrap' },
                            h(
                                'table',
                                { class: 'crop-table' },
                                h(
                                    'thead',
                                    {},
                                    h(
                                        'tr',
                                        {},
                                        h('th', {}, 'Farmer'),
                                        h('th', {}, 'Farm'),
                                        h('th', {}, 'Field'),
                                        h('th', {}, 'Crop'),
                                        h('th', {}, 'Planting Date'),
                                        h('th', {}, 'Expected Harvest'),
                                        h('th', {}, 'Activity Status'),
                                        h('th', {}, 'Crop Status')
                                    )
                                ),
                                h('tbody', {}, rows)
                            )
                        )
                    )
                );
            }

            async function refreshRecords() {
                try {
                    const plantings = await loadPlantings(farms);
                    renderRecords(plantings);
                } catch (error) {
                    console.error(
                        'Could not load planting records:',
                        error
                    );

                    records.replaceChildren(
                        h(
                            'p',
                            { class: 'msg error' },
                            errorMessage(error)
                        )
                    );
                }
            }

            farmerSelect.addEventListener('change', async () => {
                updateFarmOptions();

                await Promise.all([
                    updateFieldOptions(),
                    updateCropOptions()
                ]);

                updateSaveButton();
            });

            farmSelect.addEventListener('change', async () => {
                await Promise.all([
                    updateFieldOptions(),
                    updateCropOptions()
                ]);

                updateSaveButton();
            });

            fieldSelect.addEventListener(
                'change',
                updateSaveButton
            );

            productDropdown.element.addEventListener(
                'change',
                updateSaveButton
            );

            sowingDate.input.addEventListener(
                'change',
                updateSaveButton
            );

            harvestDate.input.addEventListener('change', () => {
                if (
                    harvestDate.input.value &&
                    sowingDate.input.value &&
                    harvestDate.input.value < sowingDate.input.value
                ) {
                    message.textContent =
                        'Expected harvest date cannot be earlier than planting date.';
                } else {
                    message.textContent = '';
                }
            });

            form.addEventListener('submit', async event => {
                event.preventDefault();

                const farm = getSelectedFarm();
                const cropName = productDropdown.getSelectedCrop();

                if (
                    !farmerSelect.value ||
                    !farm ||
                    !fieldSelect.value ||
                    !cropName ||
                    !sowingDate.input.value
                ) {
                    toast('Please complete the required fields.');
                    updateSaveButton();
                    return;
                }

                if (
                    harvestDate.input.value &&
                    harvestDate.input.value < sowingDate.input.value
                ) {
                    message.textContent =
                        'Expected harvest date cannot be earlier than planting date.';

                    toast(
                        'Expected harvest date cannot be earlier than planting date.'
                    );

                    return;
                }

                /*
                 * Product match is optional:
                 * - Existing catalog crop: save its product ID.
                 * - Custom crop: save NULL for product_id.
                 *
                 * crop_name stores the actual selected crop in both cases.
                 */
                const matchingProduct = findProductForCrop(
                    cropName,
                    products
                );

                const {
                    data: { user },
                    error: authError
                } = await supabase.auth.getUser();

                if (authError) throw authError;

                if (!user) {
                    message.textContent = 'No authenticated user found. Please log in again.';
                    return;
                }

                // New assignments start as assigned / not_planted.
                // The legacy `status` column is intentionally not written.
                const planting = {
                    farmer_id: farmerSelect.value,
                    field_id: fieldSelect.value,
                    product_id: matchingProduct
                        ? Number(matchingProduct.id)
                        : null,
                    crop_name: cropName.trim(),
                    sowing_date: sowingDate.input.value,
                    expected_harvest_date:
                        harvestDate.input.value || null,
                    activity_status: INITIAL_ACTIVITY_STATUS,
                    crop_status: INITIAL_CROP_STATUS,
                    notes: notes.value.trim() || null,
                    assigned_by: user.id
                };

                saveButton.disabled = true;
                saveButton.textContent = 'Saving...';
                message.textContent = '';

                try {
                    const { error } = await supabase
                        .from('farm_plantings')
                        .insert(planting);

                    if (error) throw error;

                    toast('Planting assignment saved.');

                    form.reset();
                    productDropdown.clear();

                    fieldSelect.disabled = true;
                    fieldSelect.replaceChildren(
                        option('', 'Select farm first')
                    );

                    updateFarmOptions();

                    await Promise.all([
                        updateFieldOptions(),
                        updateCropOptions()
                    ]);

                    await refreshRecords();
                } catch (error) {
                    console.error(
                        'Could not save planting:',
                        error
                    );

                    message.textContent = errorMessage(error);
                    toast('Could not save planting.');
                } finally {
                    saveButton.textContent = 'Save Planting';
                    updateSaveButton();
                }
            });

            if (!farmers.length) {
                message.textContent =
                    'No residential farmers were returned by manager_list_residential_farmers.';
            } else if (!farms.length) {
                message.textContent =
                    'No farms matched the assigned municipality. Check farm_location and manager_list_farmers.';
            }

            updateFarmOptions();

           await refreshRecords();
updateSaveButton();

// Listen for Farmer updates to planting records.
subscribeToPlantings(refreshRecords);
        } catch (error) {
            console.error(
                'Failed to load crop management:',
                error
            );

            const retryButton = h(
                'button',
                {
                    class: 'btn ghost',
                    type: 'button',
                    onclick: load
                },
                'Retry'
            );

            holder.replaceChildren(
                h('p', { class: 'msg error' }, errorMessage(error)),
                retryButton
            );
        }
    };

    await load();
}