
import { supabase } from '../connection.js';

const h = (tag, className = '', text = '') => {
    const node = document.createElement(tag);

    if (className) node.className = className;
    if (text !== '') node.textContent = text;

    return node;
};

const formatStatus = value => {
    if (!value) return 'Unknown';

    return String(value)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
};

const formatDate = value => {
    if (!value) return '—';

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
};

const createBadge = (value, className = '') => {
    return h(
        'span',
        `at-status-badge ${className}`,
        formatStatus(value)
    );
};

const createEmptyState = () => {
    const empty = h('div', 'at-empty-state');

    empty.append(
        h('h3', '', 'No Recommendations Found'),
        h(
            'p',
            '',
            'There are currently no recommendations matching your search or filters.'
        )
    );

    return empty;
};

const createErrorState = () => {
    const error = h('div', 'at-error-state');
    error.textContent =
        'Unable to load recommendations. Please try again.';

    return error;
};

function populateFilter(select, values, defaultLabel) {
    select.replaceChildren();

    const allOption = h('option', '', defaultLabel);
    allOption.value = 'all';
    select.append(allOption);

    values.forEach(value => {
        if (!value) return;

        const option = h('option', '', formatStatus(value));
        option.value = value;
        select.append(option);
    });
}

function createRecommendationCard(advisory) {
    const card = h('article', 'at-recommendation-card');

    const header = h('div', 'at-recommendation-card-header');

    const title = h(
        'h3',
        'at-recommendation-title',
        advisory.advisory_title
    );

    const priority = createBadge(
        advisory.priority,
        `at-priority-${String(advisory.priority || '').toLowerCase()}`
    );

    header.append(title, priority);

    const farm = h(
        'p',
        'at-recommendation-farm',
        advisory.farm?.farm_name || 'Unknown Farm'
    );

    const metadata = h('div', 'at-recommendation-metadata');

    const category = h(
        'span',
        'at-recommendation-category',
        `Category: ${formatStatus(advisory.advisory_category)}`
    );

    const status = createBadge(advisory.advisory_status);

    const date = h(
        'span',
        'at-recommendation-date',
        `Created: ${formatDate(advisory.created_at)}`
    );

    metadata.append(category, status, date);

    const content = h('div', 'at-recommendation-content');

    content.append(
        h('h4', '', 'Recommendation Details'),
        h('p', '', advisory.advisory_content)
    );

    card.append(header, farm, metadata, content);

    return card;
}

export async function render(root, ctx) {
    root.replaceChildren();

    const page = h('section', 'at-page');

    const heading = h('div', 'at-page-heading');

    heading.append(
        h('h2', '', 'Recommendations'),
        h(
            'p',
            '',
            'Review agricultural advisories and recommendations prepared for your assigned farms.'
        )
    );

    const summaryGrid = h('div', 'at-recommendation-summary-grid');

    const totalValue = h('strong', '', '0');
    const highPriorityValue = h('strong', '', '0');
    const activeValue = h('strong', '', '0');

    const createSummaryCard = (label, value, className) => {
        const card = h(
            'div',
            `at-recommendation-summary-card ${className}`
        );

        card.append(value, h('span', '', label));

        return card;
    };

    summaryGrid.append(
        createSummaryCard('Total Recommendations', totalValue, 'total'),
        createSummaryCard('High Priority', highPriorityValue, 'priority'),
        createSummaryCard('Active Advisories', activeValue, 'active')
    );

    const toolbar = h('div', 'at-recommendation-toolbar');

    const search = h('input', 'at-search-input');
    search.type = 'search';
    search.placeholder = 'Search title, farm, or recommendation...';
    search.setAttribute('aria-label', 'Search recommendations');

    const categoryFilter = h('select', 'at-filter-select');
    categoryFilter.setAttribute('aria-label', 'Filter recommendation category');

    const priorityFilter = h('select', 'at-filter-select');
    priorityFilter.setAttribute('aria-label', 'Filter recommendation priority');

    const statusFilter = h('select', 'at-filter-select');
    statusFilter.setAttribute('aria-label', 'Filter advisory status');

    toolbar.append(
        search,
        categoryFilter,
        priorityFilter,
        statusFilter
    );

    const countSummary = h('div', 'at-section-summary');
    const visibleCount = h('strong', 'at-assigned-farm-count', '0');

    countSummary.append(
        visibleCount,
        h('span', '', 'Recommendations')
    );

    const grid = h('div', 'at-recommendations-grid');
    grid.setAttribute('aria-live', 'polite');

    grid.append(
        h('p', 'at-loading-text', 'Loading recommendations...')
    );

    page.append(
        heading,
        summaryGrid,
        toolbar,
        countSummary,
        grid
    );

    root.append(page);

    let cancelled = false;
    let recommendations = [];

    function updateSummary(data) {
        totalValue.textContent = String(data.length);

        highPriorityValue.textContent = String(
            data.filter(item =>
                String(item.priority || '').toLowerCase() === 'high'
            ).length
        );

        activeValue.textContent = String(
            data.filter(item =>
                String(item.advisory_status || '').toLowerCase() === 'active'
            ).length
        );
    }

    function displayRecommendations() {
        if (cancelled) return;

        const keyword = search.value.trim().toLowerCase();

        const selectedCategory = categoryFilter.value;
        const selectedPriority = priorityFilter.value;
        const selectedStatus = statusFilter.value;

        const filtered = recommendations.filter(item => {
            const searchableValues = [
                item.advisory_title,
                item.advisory_content,
                item.advisory_category,
                item.priority,
                item.advisory_status,
                item.farm?.farm_name
            ];

            const matchesSearch = searchableValues.some(value =>
                String(value || '').toLowerCase().includes(keyword)
            );

            const matchesCategory =
                selectedCategory === 'all' ||
                item.advisory_category === selectedCategory;

            const matchesPriority =
                selectedPriority === 'all' ||
                item.priority === selectedPriority;

            const matchesStatus =
                selectedStatus === 'all' ||
                item.advisory_status === selectedStatus;

            return (
                matchesSearch &&
                matchesCategory &&
                matchesPriority &&
                matchesStatus
            );
        });

        visibleCount.textContent = String(filtered.length);
        grid.replaceChildren();

        if (filtered.length === 0) {
            grid.append(createEmptyState());
            return;
        }

        filtered.forEach(item => {
            grid.append(createRecommendationCard(item));
        });
    }

    search.addEventListener('input', displayRecommendations);
    categoryFilter.addEventListener('change', displayRecommendations);
    priorityFilter.addEventListener('change', displayRecommendations);
    statusFilter.addEventListener('change', displayRecommendations);

    async function loadRecommendations() {
        const { data, error } = await supabase
            .from('crop_advisories')
            .select(`
                advisory_id,
                inspection_id,
                technician_staff_id,
                farm_id,
                planting_id,
                advisory_title,
                advisory_content,
                advisory_category,
                priority,
                advisory_status,
                created_at,
                updated_at,
                farm:farmer_farms (
                    farm_name,
                    farm_location
                )
            `)
            .eq('technician_staff_id', ctx.staff.staff_id)
            .order('created_at', { ascending: false });

        if (cancelled) return;

        if (error) {
            console.error('Failed to load recommendations:', error);
            grid.replaceChildren(createErrorState());
            return;
        }

        recommendations = data || [];

        populateFilter(
            categoryFilter,
            [...new Set(recommendations.map(item => item.advisory_category))].sort(),
            'All Categories'
        );

        populateFilter(
            priorityFilter,
            [...new Set(recommendations.map(item => item.priority))].sort(),
            'All Priorities'
        );

        populateFilter(
            statusFilter,
            [...new Set(recommendations.map(item => item.advisory_status))].sort(),
            'All Statuses'
        );

        updateSummary(recommendations);
        displayRecommendations();
    }

    await loadRecommendations();

    return {
        cleanup() {
            cancelled = true;

            search.removeEventListener('input', displayRecommendations);
            categoryFilter.removeEventListener('change', displayRecommendations);
            priorityFilter.removeEventListener('change', displayRecommendations);
            statusFilter.removeEventListener('change', displayRecommendations);
        }
    };
}
