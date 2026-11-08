
import { supabase } from '../connection.js';

const formatQuantity = (value) => {
    return new Intl.NumberFormat('en-PH', {
        maximumFractionDigits: 2
    }).format(Number(value || 0));
};

const formatDateAdded = (value) => {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const createElement = (tag, className, text) => {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;

    return element;
};

function createCell(text, className = '') {
    const cell = createElement('td', className, text);
    return cell;
}

function createHeader(text) {
    return createElement('th', '', text);
}

/**
 * Build the contribution table and its asynchronous loader.
 * @returns {{ element: HTMLElement, load: () => Promise<void> }}
 */
export function createHarvestContributionsSection() {
    const section = createElement(
        'section',
        'harvest-contributions-section'
    );

    const heading = createElement(
        'h3',
        'harvest-contributions-title',
        'Harvest Contributions'
    );

    const description = createElement(
        'p',
        'harvest-contributions-description',
        'Track harvest quantities added to warehouse inventory and their cumulative totals.'
    );

    const tableWrapper = createElement(
        'div',
        'harvest-contributions-table-wrapper'
    );

    const table = createElement(
        'table',
        'harvest-contributions-table'
    );

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    [
        'Crop',
        'Date Added',
        'Quantity Added',
        'Total Quantity'
    ].forEach(label => {
        headerRow.appendChild(createHeader(label));
    });

    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');

    table.append(thead, tbody);
    tableWrapper.appendChild(table);

    section.append(
        heading,
        description,
        tableWrapper
    );

    /** Fetch contributions and inventory, then render farm/crop running totals. */
    async function load() {
        tbody.replaceChildren();

        const loadingRow = document.createElement('tr');
        const loadingCell = createCell('Loading harvest contributions...');

        loadingCell.colSpan = 4;
        loadingCell.className = 'harvest-contributions-empty';

        loadingRow.appendChild(loadingCell);
        tbody.appendChild(loadingRow);

        try {
            // 1. Fetch contributions in chronological order.
            const { data: contributions, error: contributionError } =
                await supabase
                    .from('warehouse_produce_harvests')
                    .select(`
            contribution_id,
            produce_id,
            harvest_id,
            quantity_added,
            created_at
        `)
                    .order('created_at', { ascending: true })
                    .order('contribution_id', { ascending: true });
            console.log('ALL CONTRIBUTIONS:', contributions);

            if (contributionError) throw contributionError;
            console.log('HARVEST CONTRIBUTIONS:', contributions);
            console.log('CONTRIBUTION COUNT:', contributions?.length);

            if (!contributions?.length) {
                renderEmptyState('No harvest contributions found.');
                return;
            }

            // 2. Fetch aggregate inventory information.
            const produceIds = [
                ...new Set(contributions.map(item => item.produce_id))
            ];

            const { data: inventory, error: inventoryError } =
                await supabase
                    .from('warehouse_produce_inventory')
                    .select(`
                    produce_id,
                    farm_id,
                    crop_name,
                    unit
                `)
                    .in('produce_id', produceIds);

            if (inventoryError) throw inventoryError;

            console.log('INVENTORY RECORDS:', inventory);

            const inventoryMap = new Map(
                (inventory || []).map(item => [
                    item.produce_id,
                    item
                ])
            );

            // 3. Calculate cumulative totals chronologically.
            const runningTotals = new Map();
            const rows = [];

            for (const contribution of contributions) {
                const produce = inventoryMap.get(contribution.produce_id);

                if (!produce) continue;

                const cropName = String(
                    produce.crop_name || 'Unspecified Crop'
                ).trim();

                const unit = String(produce.unit || '').trim();

                const groupKey = [
                    produce.farm_id || '',
                    cropName.toLowerCase(),
                    unit.toLowerCase()
                ].join('|');

                const quantityAdded = Number(contribution.quantity_added || 0);

                const totalQuantity =
                    (runningTotals.get(groupKey) || 0) + quantityAdded;

                runningTotals.set(groupKey, totalQuantity);

                rows.push({
                    contributionId: contribution.contribution_id,
                    cropName,
                    unit,
                    createdAt: contribution.created_at,
                    quantityAdded,
                    totalQuantity
                });
            }

            // 4. Keep display in chronological order (oldest to newest).
            rows.sort((a, b) => {
                const dateDifference =
                    new Date(a.createdAt) - new Date(b.createdAt);

                if (dateDifference !== 0) return dateDifference;

                return String(a.contributionId).localeCompare(
                    String(b.contributionId)
                );
            });

            tbody.replaceChildren();

            if (!rows.length) {
                renderEmptyState('No harvest contributions found.');
                return;
            }

            for (const item of rows) {
                const row = document.createElement('tr');

                row.append(
                    createCell(item.cropName),
                    createCell(formatDateAdded(item.createdAt)),
                    createCell(
                        `${formatQuantity(item.quantityAdded)} ${item.unit}`
                    ),
                    createCell(
                        `${formatQuantity(item.totalQuantity)} ${item.unit}`,
                        'harvest-contributions-total'
                    )
                );

                tbody.appendChild(row);
            }

        } catch (error) {
            console.error('Error loading harvest contributions:', error);

            renderEmptyState('Unable to load harvest contributions.');
        }
    }

    function renderEmptyState(message) {
        tbody.replaceChildren();

        const row = document.createElement('tr');
        const cell = createCell(
            message,
            'harvest-contributions-empty'
        );

        cell.colSpan = 4;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    return {
        element: section,
        load
    };
}
