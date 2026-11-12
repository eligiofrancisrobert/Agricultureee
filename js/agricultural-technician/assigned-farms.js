
import { supabase } from '../connection.js';

const BUCKET = 'farm-images';
const SIGNED_URL_DURATION = 3600;

const h = (tag, className = '', text = '') => {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== '') node.textContent = text;

    return node;
};

const formatDate = value => {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
};

const formatStatus = value => {
    if (!value) return 'Unknown';

    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
};

function createFarmImage(imageUrl, farmName) {
    const wrapper = h('div', 'at-farm-image-wrapper');

    const fallback = h(
        'div',
        'at-farm-image-fallback',
        'No farm photo yet'
    );

    wrapper.append(fallback);

    if (!imageUrl) return wrapper;

    const image = h('img', 'at-farm-image');

    image.src = imageUrl;
    image.alt = `Photo of ${farmName}`;
    image.loading = 'lazy';

    image.addEventListener('load', () => {
        fallback.remove();
    }, { once: true });

    image.addEventListener('error', () => {
        console.error(`Unable to display farm image: ${farmName}`);
        image.remove();
    }, { once: true });

    wrapper.append(image);

    return wrapper;
}

function createFarmCard(assignment) {
    const farm = assignment.farm;

    const card = h('article', 'at-farm-card');

    const image = createFarmImage(
        farm.imageUrl,
        farm.farm_name || 'Unnamed Farm'
    );

    const content = h('div', 'at-farm-card-content');
    const header = h('div', 'at-farm-card-header');

    const name = h(
        'h3',
        'at-farm-name',
        farm.farm_name || 'Unnamed Farm'
    );

    const status = h(
        'span',
        `at-status-badge ${farm.farm_status === 'active' ? 'is-active' : ''}`,
        formatStatus(farm.farm_status)
    );

    header.append(name, status);

    const location = h(
        'p',
        'at-farm-location',
        farm.farm_location || 'No farm location provided'
    );

    const details = h('div', 'at-farm-details');

    const assignedDate = h('div', 'at-farm-detail');

    assignedDate.append(
        h('small', '', 'Assigned Date'),
        h('strong', '', formatDate(assignment.assigned_at))
    );

    const farmId = h('div', 'at-farm-detail');

    farmId.append(
        h('small', '', 'Farm ID'),
        h('strong', '', farm.id)
    );

    details.append(assignedDate, farmId);

    const footer = h('div', 'at-farm-card-footer');

    footer.append(
        h('span', '', 'Current Assignment'),
        h('span', 'at-assignment-active', 'Active')
    );

    content.append(header, location, details, footer);
    card.append(image, content);

    return card;
}

function createEmptyState() {
    const empty = h('div', 'at-empty-state');

    empty.append(
        h('h3', '', 'No Assigned Farms Yet'),
        h(
            'p',
            '',
            'You currently have no active farm assignments. Your assigned farms will appear here once the administrator assigns them to you.'
        )
    );

    return empty;
}

function createErrorState(message) {
    const error = h('div', 'at-error-state');
    error.textContent = message;

    return error;
}

/**
 * Generate signed URLs for all assigned farm cover images.
 */
async function signFarmImages(farms) {
    const paths = farms
        .map(farm => farm.cover_image_path)
        .filter(Boolean);

    const urls = {};

    if (!paths.length) {
        return farms.map(farm => ({
            ...farm,
            imageUrl: null
        }));
    }

    const { data: signed, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_DURATION);

    if (error) {
        console.error('Could not sign farm image URLs:', error);
    }

    (signed || []).forEach(item => {
        if (item.signedUrl && item.path) {
            urls[item.path] = item.signedUrl;
        } else if (item.error) {
            console.error(
                'Farm image signing failed:',
                item.path,
                item.error
            );
        }
    });

    return farms.map(farm => ({
        ...farm,
        imageUrl: urls[farm.cover_image_path] || null
    }));
}

export async function render(root, ctx) {
    root.replaceChildren();

    const page = h('section', 'at-page');
    const heading = h('div', 'at-page-heading');

    heading.append(
        h('h2', '', 'Assigned Farms'),
        h(
            'p',
            '',
            'View all farms currently assigned to you for agricultural monitoring and field inspections.'
        )
    );

    const grid = h('div', 'at-farms-grid');
    grid.setAttribute('aria-live', 'polite');

    grid.append(
        h('p', 'at-loading-text', 'Loading your assigned farms...')
    );

    page.append(heading, grid);
    root.append(page);

    let cancelled = false;

    async function loadAssignedFarms() {
        grid.replaceChildren(
            h('p', 'at-loading-text', 'Loading your assigned farms...')
        );

        // 1. Get the technician's active assignments.
        const { data: assignments, error: assignmentError } = await supabase
            .from('agricultural_technician_farm_assignments')
            .select(`
                assignment_id,
                technician_staff_id,
                farm_id,
                assigned_at,
                assignment_status
            `)
            .eq('technician_staff_id', ctx.staff.staff_id)
            .eq('assignment_status', 'active')
            .order('assigned_at', { ascending: false });

        if (cancelled) return;

        if (assignmentError) {
            console.error('Assigned farms query error:', assignmentError);

            grid.replaceChildren(
                createErrorState(
                    `Unable to load farm assignments: ${assignmentError.message}`
                )
            );

            return;
        }

        if (!assignments?.length) {
            grid.replaceChildren(createEmptyState());
            return;
        }

        // 2. Get unique farm IDs.
        const farmIds = [
            ...new Set(
                assignments
                    .map(item => item.farm_id)
                    .filter(Boolean)
            )
        ];

        if (!farmIds.length) {
            grid.replaceChildren(createEmptyState());
            return;
        }

        // 3. Fetch farm records.
        const { data: farms, error: farmError } = await supabase
            .from('farmer_farms')
            .select(`
                id,
                farm_name,
                farm_location,
                farm_status,
                cover_image_path
            `)
            .in('id', farmIds);

        if (cancelled) return;

        if (farmError) {
            console.error('Farm records query error:', farmError);

            grid.replaceChildren(
                createErrorState(
                    `Unable to load farm details: ${farmError.message}`
                )
            );

            return;
        }

        // 4. Match assignments with their farm records.
        const farmMap = new Map(
            (farms || []).map(farm => [farm.id, farm])
        );

        const currentAssignments = assignments
            .map(assignment => ({
                ...assignment,
                farm: farmMap.get(assignment.farm_id)
            }))
            .filter(assignment => assignment.farm);

        if (!currentAssignments.length) {
            grid.replaceChildren(createEmptyState());
            return;
        }

        // 5. Sign all farm cover images.
        const farmsWithImages = await signFarmImages(
            currentAssignments.map(item => item.farm)
        );

        if (cancelled) return;

        const imageMap = new Map(
            farmsWithImages.map(farm => [farm.id, farm.imageUrl])
        );

        currentAssignments.forEach(assignment => {
            assignment.farm.imageUrl =
                imageMap.get(assignment.farm_id) || null;
        });

        // 6. Display assigned farm cards.
        grid.replaceChildren();

        currentAssignments.forEach(assignment => {
            grid.append(createFarmCard(assignment));
        });
    }

    await loadAssignedFarms();

    return {
        cleanup() {
            cancelled = true;
        }
    };
}
