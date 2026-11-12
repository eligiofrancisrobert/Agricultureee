
import { h, table, select, fmtDateTime, pageHead } from './ui.js';
import { getLogs } from './api.js';

export async function render(root, ctx) {
    root.replaceChildren();

    let logs = [];

    try {
        logs = await getLogs() || [];
    } catch (error) {
        console.error('Failed to load audit logs:', error);

        root.append(
            pageHead('Audit Logs', 'Monitor administrative and security activities.'),
            h('section', { class: 'card' },
                h('p', { class: 'muted' }, 'Unable to load audit logs. Please try again.')
            )
        );
        return;
    }

    let action = 'all';
    let searchTerm = '';

    const page = h('div', { class: 'audit-page' });
    const holder = h('div', { class: 'audit-table-wrap' });
    const countLabel = h('span', { class: 'audit-result-count' });

    const showValue = (value) => {
        if (value === null || value === undefined || value === '') {
            return 'No data recorded';
        }

        return typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
    };

    const today = new Date().toLocaleDateString();

    const todayLogs = logs.filter(log =>
        log.time && new Date(log.time).toLocaleDateString() === today
    );

    const uniqueActors = new Set(
        logs.map(log => log.actor).filter(Boolean)
    ).size;

    const uniqueActions = new Set(
        logs.map(log => log.action).filter(Boolean)
    ).size;

    const metricCard = (label, value, description, icon, color) =>
        h('article', { class: `audit-metric audit-metric--${color}` },
            h('div', { class: 'audit-metric-top' },
                h('span', { class: 'audit-metric-icon' }, icon),
                h('span', { class: 'audit-metric-label' }, label)
            ),
            h('strong', { class: 'audit-metric-value' }, String(value)),
            h('span', { class: 'audit-metric-description' }, description)
        );

    const metrics = h('section', { class: 'audit-metrics' },
        metricCard(
            'Total Events',
            logs.length,
            'Recorded audit activities',
            '▤',
            'brown'
        ),
        metricCard(
            "Today's Events",
            todayLogs.length,
            'Activities recorded today',
            '◷',
            'green'
        ),
        metricCard(
            'Unique Actors',
            uniqueActors,
            'Accounts with recorded activity',
            '♙',
            'blue'
        ),
        metricCard(
            'Action Types',
            uniqueActions,
            'Different recorded actions',
            '⌘',
            'orange'
        )
    );

    const detailsContent = h('div', {
        class: 'audit-detail-content'
    });

    const detailsDialog = h('dialog', {
        class: 'audit-detail-dialog',
        'aria-labelledby': 'audit-detail-title'
    });

    const detailSection = (title, value) =>
        h('section', { class: 'audit-detail-section' },
            h('h3', {}, title),
            h('pre', { class: 'audit-detail-data' }, showValue(value))
        );

    const detailItem = (label, value) =>
        h('div', { class: 'audit-detail-item' },
            h('span', { class: 'audit-detail-label' }, label),
            h('strong', { class: 'audit-detail-value' },
                value || 'Not recorded'
            )
        );

    const openDetails = (log) => {
        const metadata = log.metadata || log.new_data?.metadata || {};

        detailsContent.replaceChildren(
            h('div', { class: 'audit-detail-summary' },
                h('span', { class: 'audit-detail-summary-label' }, 'ACTION'),
                h('h3', {}, log.action || 'Unknown action'),
                h('p', {}, log.target || 'No target specified')
            ),

            h('section', { class: 'audit-detail-section' },
                h('h3', {}, 'Event Information'),
                h('div', { class: 'audit-detail-grid' },
                    detailItem('Date & Time', fmtDateTime(log.time)),
                    detailItem('Actor / Account', log.actor),
                    detailItem('Action', log.action),
                    detailItem('Target', log.target)
                )
            ),

            h('section', { class: 'audit-detail-section' },
                h('h3', {}, 'Device & Location'),
                h('div', { class: 'audit-detail-grid' },
                    detailItem('IP Address', log.ip_address || metadata.ip_address),
                    detailItem('Location', log.location || metadata.location),
                    detailItem('Device', log.device || metadata.device),
                    detailItem('Browser', log.browser || metadata.browser),
                    detailItem('Operating System', log.operating_system || metadata.operating_system)
                )
            ),

            detailSection('Previous Values', log.old_data),
            detailSection('New Values', log.new_data)
        );

        if (!detailsDialog.open) {
            detailsDialog.showModal();
        }
    };

    detailsDialog.append(
        h('div', { class: 'audit-detail-header' },
            h('div', {},
                h('span', { class: 'audit-eyebrow' }, 'ACTIVITY RECORD'),
                h('h2', { id: 'audit-detail-title' }, 'Audit Log Details')
            ),
            h('button', {
                type: 'button',
                class: 'audit-close-button',
                'aria-label': 'Close details',
                onclick: () => detailsDialog.close()
            }, '×')
        ),
        detailsContent
    );

    detailsDialog.addEventListener('click', event => {
        if (event.target === detailsDialog) {
            detailsDialog.close();
        }
    });

    const actionBadge = (value) => {
        const normalized = String(value || 'Unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-');

        return h('span', {
            class: `audit-action-badge audit-action--${normalized}`
        }, value || 'Unknown');
    };

    const draw = () => {
        const q = searchTerm.trim().toLowerCase();

        const rows = logs.filter(log => {
            const matchesAction =
                action === 'all' || log.action === action;

            const searchable = [
                log.actor,
                log.action,
                log.target,
                log.ip_address,
                log.location,
                log.device,
                log.browser,
                JSON.stringify(log.metadata || {})
            ].join(' ').toLowerCase();

            return matchesAction && searchable.includes(q);
        });

        countLabel.textContent =
            `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`;

        holder.replaceChildren(
            table([
                {
                    label: 'Date & Time',
                    cell: log => fmtDateTime(log.time) || 'Unknown'
                },
                {
                    label: 'Actor',
                    cell: log => h('div', { class: 'audit-actor' },
                        h('strong', {}, log.actor || 'Unknown'),
                        h('span', {}, log.target || '—')
                    )
                },
                {
                    label: 'Action',
                    cell: log => actionBadge(log.action)
                },
                {
                    label: 'Target',
                    cell: log => log.target || '—'
                },
                {
                    label: '',
                    cell: log => h('button', {
                        type: 'button',
                        class: 'audit-view-button',
                        onclick: () => openDetails(log)
                    }, 'View details →')
                }
            ], rows, 'No audit records found.')
        );
    };

    const actions = [
        ...new Set(logs.map(log => log.action).filter(Boolean))
    ].sort().map(value => [value, value]);

    const searchInput = h('input', {
        type: 'search',
        class: 'audit-search',
        placeholder: 'Search actor, action, target...',
        'aria-label': 'Search audit logs',
        oninput: event => {
            searchTerm = event.target.value;
            draw();
        }
    });

    const actionFilter = select(
        [['all', 'All actions'], ...actions],
        action,
        value => {
            action = value;
            draw();
        },
        'Filter by action'
    );

    const toolbar = h('section', { class: 'audit-toolbar' },
        h('div', { class: 'audit-toolbar-heading' },
            h('div', {},
                h('h2', {}, 'Activity History'),
                h('p', {}, 'Review and inspect recorded system activities.')
            ),
            countLabel
        ),
        h('div', { class: 'audit-toolbar-controls' },
            searchInput,
            actionFilter
        )
    );

    page.append(metrics, toolbar,
        h('section', { class: 'audit-table-card' }, holder)
    );

    root.append(
        pageHead(
            'Audit Logs',
            'Monitor administrative actions and system activities.'
        ),
        page,
        detailsDialog
    );

    draw();
}
