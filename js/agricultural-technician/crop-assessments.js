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

    return date.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const createBadge = (value, className = '') => {
    return h('span', `at-status-badge ${className}`, formatStatus(value));
};

const createEmptyState = () => {
    const empty = h('div', 'at-empty-state');

    empty.append(
        h('h3', '', 'No Crop Assessments Found'),
        h(
            'p',
            '',
            'There are currently no crop assessment records available.'
        )
    );

    return empty;
};

const createErrorState = () => {
    const error = h('div', 'at-error-state');
    error.textContent = 'Unable to load crop assessments. Please try again.';

    return error;
};

function createAssessmentCard(record) {
    const card = h('article', 'at-assessment-card');

    const header = h('div', 'at-assessment-card-header');

    header.append(
        h(
            'h3',
            'at-assessment-title',
            record.farm?.farm_name || 'Unknown Farm'
        ),
        createBadge(record.crop_health_status)
    );

    const date = h(
        'p',
        'at-assessment-date',
        `Assessment Date: ${formatDate(record.monitoring_date)}`
    );

    const details = h('div', 'at-assessment-details');

    const fields = [
        ['Growth Stage', formatStatus(record.growth_stage)],
        ['Monitoring Status', formatStatus(record.monitoring_status)],
        ['Pest Observed', record.pest_observed ? 'Yes' : 'No'],
        ['Disease Observed', record.disease_observed ? 'Yes' : 'No'],
        ['Action Required', record.action_required ? 'Yes' : 'No']
    ];

    fields.forEach(([label, value]) => {
        const item = h('div', 'at-assessment-detail');

        item.append(
            h('small', '', label),
            h('strong', '', value || '—')
        );

        details.append(item);
    });

    const observations = h('div', 'at-assessment-section');
    observations.append(
        h('h4', '', 'Observations'),
        h('p', '', record.observations || 'No observations recorded.')
    );

    const pestSection = h('div', 'at-assessment-section');
    pestSection.append(
        h('h4', '', 'Pest Details'),
        h(
            'p',
            '',
            record.pest_observed
                ? record.pest_details || 'Pests observed, but no details provided.'
                : 'No pests observed.'
        )
    );

    const diseaseSection = h('div', 'at-assessment-section');
    diseaseSection.append(
        h('h4', '', 'Disease Details'),
        h(
            'p',
            '',
            record.disease_observed
                ? record.disease_details || 'Disease observed, but no details provided.'
                : 'No disease observed.'
        )
    );

    const recommendation = h('div', 'at-assessment-recommendation');

    recommendation.append(
        h('h4', '', 'Recommended Action'),
        h(
            'p',
            '',
            record.recommended_action || 'No recommended action provided.'
        )
    );

    const actionBadge = h(
        'div',
        `at-assessment-action ${record.action_required ? 'is-required' : 'is-clear'}`,
        record.action_required
            ? 'Follow-up Action Required'
            : 'No Follow-up Action Required'
    );

    card.append(
        header,
        date,
        details,
        observations,
        pestSection,
        diseaseSection,
        recommendation,
        actionBadge
    );

    return card;
}

export async function render(root, ctx) {
    root.replaceChildren();

    const page = h('section', 'at-page');

    const heading = h('div', 'at-page-heading');

    heading.append(
        h('h2', '', 'Crop Assessments'),
        h(
            'p',
            '',
            'Review crop health assessments, growth conditions, pest observations, and disease findings from your assigned farms.'
        )
    );

    const summaryGrid = h('div', 'at-assessment-summary-grid');

    const totalValue = h('strong', '', '0');
    const healthyValue = h('strong', '', '0');
    const actionValue = h('strong', '', '0');

    const summaryCard = (label, value, className) => {
        const card = h('div', `at-assessment-summary-card ${className}`);

        card.append(value, h('span', '', label));

        return card;
    };

    summaryGrid.append(
        summaryCard('Total Assessments', totalValue, 'total'),
        summaryCard('Healthy Crops', healthyValue, 'healthy'),
        summaryCard('Action Required', actionValue, 'action')
    );

    const toolbar = h('div', 'at-assessment-toolbar');

    const search = h('input', 'at-search-input');
    search.type = 'search';
    search.placeholder = 'Search farm, observations, or recommendations...';
    search.setAttribute('aria-label', 'Search crop assessments');

    const healthFilter = h('select', 'at-filter-select');
    healthFilter.setAttribute('aria-label', 'Filter crop health');

    [
        ['all', 'All Health Conditions'],
        ['healthy', 'Healthy'],
        ['good', 'Good'],
        ['fair', 'Fair'],
        ['poor', 'Poor'],
        ['critical', 'Critical']
    ].forEach(([value, label]) => {
        const option = h('option', '', label);
        option.value = value;
        healthFilter.append(option);
    });

    const actionFilter = h('select', 'at-filter-select');
    actionFilter.setAttribute('aria-label', 'Filter action required');

    [
        ['all', 'All Actions'],
        ['yes', 'Action Required'],
        ['no', 'No Action Required']
    ].forEach(([value, label]) => {
        const option = h('option', '', label);
        option.value = value;
        actionFilter.append(option);
    });

    toolbar.append(search, healthFilter, actionFilter);

    const grid = h('div', 'at-assessments-grid');
    grid.setAttribute('aria-live', 'polite');
    grid.append(h('p', 'at-loading-text', 'Loading crop assessments...'));

    page.append(
        heading,
        summaryGrid,
        toolbar,
        grid
    );

    root.append(page);

    let cancelled = false;
    let assessments = [];

    function updateSummary(data) {
        totalValue.textContent = String(data.length);

        healthyValue.textContent = String(
            data.filter(record =>
                ['healthy', 'good'].includes(
                    String(record.crop_health_status || '').toLowerCase()
                )
            ).length
        );

        actionValue.textContent = String(
            data.filter(record => record.action_required === true).length
        );
    }

    function displayAssessments() {
        if (cancelled) return;

        const keyword = search.value.trim().toLowerCase();
        const selectedHealth = healthFilter.value;
        const selectedAction = actionFilter.value;

        const filtered = assessments.filter(record => {
            const searchableValues = [
                record.farm?.farm_name,
                record.growth_stage,
                record.crop_health_status,
                record.observations,
                record.pest_details,
                record.disease_details,
                record.recommended_action
            ];

            const matchesSearch = searchableValues.some(value =>
                String(value || '').toLowerCase().includes(keyword)
            );

            const matchesHealth =
                selectedHealth === 'all' ||
                String(record.crop_health_status || '').toLowerCase() === selectedHealth;

            const matchesAction =
                selectedAction === 'all' ||
                (selectedAction === 'yes' && record.action_required === true) ||
                (selectedAction === 'no' && record.action_required === false);

            return matchesSearch && matchesHealth && matchesAction;
        });

        grid.replaceChildren();

        if (filtered.length === 0) {
            grid.append(createEmptyState());
            return;
        }

        filtered.forEach(record => {
            grid.append(createAssessmentCard(record));
        });
    }

    search.addEventListener('input', displayAssessments);
    healthFilter.addEventListener('change', displayAssessments);
    actionFilter.addEventListener('change', displayAssessments);

    async function loadAssessments() {
        const { data, error } = await supabase
            .from('agricultural_technician_crop_monitoring')
            .select(`
                monitoring_id,
                planting_id,
                farm_id,
                technician_staff_id,
                growth_stage,
                crop_health_status,
                pest_observed,
                pest_details,
                disease_observed,
                disease_details,
                observations,
                action_required,
                recommended_action,
                monitoring_date,
                monitoring_status,
                evidence_photo_path,
                created_at,
                updated_at,
                farm:farmer_farms (
                    farm_name,
                    farm_location
                )
            `)
            .eq('technician_staff_id', ctx.staff.staff_id)
            .order('monitoring_date', { ascending: false });

        if (cancelled) return;

        if (error) {
            console.error('Failed to load crop assessments:', error);
            grid.replaceChildren(createErrorState());
            return;
        }

        assessments = data || [];

        updateSummary(assessments);
        displayAssessments();
    }

    await loadAssessments();

    return {
        cleanup() {
            cancelled = true;

            search.removeEventListener('input', displayAssessments);
            healthFilter.removeEventListener('change', displayAssessments);
            actionFilter.removeEventListener('change', displayAssessments);
        }
    };
}