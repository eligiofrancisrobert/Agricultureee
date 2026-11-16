
import { supabase } from '../connection.js';

const formatQuantity = value => {
    return new Intl.NumberFormat('en-PH', {
        maximumFractionDigits: 2
    }).format(Number(value || 0));
};

const formatDateAdded = value => {
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
    return createElement('td', className, text);
}

function createHeader(text) {
    return createElement('th', '', text);
}

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

    let loadToken = 0;

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

    function renderRows(contributions, inventory) {
        const inventoryMap = new Map(
            (inventory || []).map(item => [
                item.produce_id,
                item
            ])
        );

        const runningTotals = new Map();
        const rows = [];

        for (const contribution of contributions || []) {
            const produce = inventoryMap.get(
                contribution.produce_id
            );

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

            const quantityAdded = Number(
                contribution.quantity_added || 0
            );

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

        rows.sort((a, b) => {
            const dateDifference =
                new Date(a.createdAt) - new Date(b.createdAt);

            if (dateDifference !== 0) return dateDifference;

            return String(a.contributionId).localeCompare(
                String(b.contributionId)
            );
        });

        if (!rows.length) {
            renderEmptyState('No harvest contributions found.');
            return;
        }

        const fragment = document.createDocumentFragment();

        for (const item of rows) {
            const row = document.createElement('tr');

            row.append(
                createCell(item.cropName),
                createCell(formatDateAdded(item.createdAt)),
                createCell(
                    `${formatQuantity(item.quantityAdded)} ${item.unit}`.trim()
                ),
                createCell(
                    `${formatQuantity(item.totalQuantity)} ${item.unit}`.trim(),
                    'harvest-contributions-total'
                )
            );

            fragment.appendChild(row);
        }

        tbody.replaceChildren(fragment);
    }

    /**
     * Pass preloaded records to avoid duplicate database requests.
     * If called without arguments, the function loads its own data.
     */
    async function load(
        preloadedContributions,
        preloadedInventory
    ) {
        const currentToken = ++loadToken;

        renderEmptyState('Loading harvest contributions...');

        try {
            let contributions = preloadedContributions;
            let inventory = preloadedInventory;

            const hasPreloadedData =
                Array.isArray(contributions)
                && Array.isArray(inventory);

            if (!hasPreloadedData) {
                const { data, error } = await supabase
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

                if (error) throw error;

                contributions = data || [];

                if (!contributions.length) {
                    if (currentToken === loadToken) {
                        renderEmptyState(
                            'No harvest contributions found.'
                        );
                    }

                    return;
                }

                const produceIds = [
                    ...new Set(
                        contributions
                            .map(item => item.produce_id)
                            .filter(Boolean)
                    )
                ];

                if (!produceIds.length) {
                    if (currentToken === loadToken) {
                        renderEmptyState(
                            'No harvest contributions found.'
                        );
                    }

                    return;
                }

                const { data: inventoryData, error: inventoryError } =
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

                inventory = inventoryData || [];
            }

            if (currentToken !== loadToken) return;

            renderRows(contributions, inventory);

        } catch (error) {
            console.error(
                'Error loading harvest contributions:',
                error
            );

            if (currentToken === loadToken) {
                renderEmptyState(
                    'Unable to load harvest contributions.'
                );
            }
        }
    }

    return {
        element: section,
        load
    };
}
