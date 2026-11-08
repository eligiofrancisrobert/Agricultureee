
import { h, table, select, fmtDateTime, pageHead } from './ui.js';
import { getLogs } from './api.js';

export async function render(root, ctx) {
    const logs = await getLogs();
    let action = 'all';

    const holder = h('div');
    const detailsContent = h('div');
    const detailsDialog = h('dialog', {
        class: 'audit-detail-dialog',
        'aria-labelledby': 'audit-detail-title'
    });

    const showValue = (value) => {
        if (value === null || value === undefined) {
            return 'No data recorded';
        }

        return typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
    };

    const detailSection = (title, value) =>
        h('section', { class: 'audit-detail-section' },
            h('h3', {}, title),
            h('pre', { class: 'audit-detail-data' }, showValue(value))
        );

    /** Show the selected log's recorded metadata and before/after values. */
    const openDetails = (log) => {
        detailsContent.replaceChildren(
            h('p', {},
                h('strong', {}, 'When: '),
                fmtDateTime(log.time) || 'Unknown'
            ),
            h('p', {},
                h('strong', {}, 'Admin: '),
                log.actor || 'Unknown'
            ),
            h('p', {},
                h('strong', {}, 'Action: '),
                log.action || 'Unknown'
            ),
            h('p', {},
                h('strong', {}, 'Target: '),
                log.target || 'Unknown'
            ),
            detailSection('Previous values', log.old_data),
            detailSection('New values', log.new_data)
        );

        if (!detailsDialog.open) {
            detailsDialog.showModal();
        }
    };

    detailsDialog.append(
        h('div', { class: 'audit-detail-header' },
            h('h2', { id: 'audit-detail-title' }, 'Audit Log Details'),
            h('button', {
                type: 'button',
                class: 'btn ghost',
                onclick: () => detailsDialog.close()
            }, 'Close')
        ),
        detailsContent
    );

    detailsDialog.addEventListener('click', (event) => {
        if (event.target === detailsDialog) {
            detailsDialog.close();
        }
    });

    /** Filter the loaded audit records and rebuild the table. */
    const draw = () => {
        const q = (ctx.query || '').toLowerCase();

        const rows = logs.filter((l) =>
            (action === 'all' || l.action === action) &&
            `${l.actor} ${l.action} ${l.target}`
                .toLowerCase()
                .includes(q)
        );

        holder.replaceChildren(
            table([
                {
                    label: 'When',
                    cell: (l) => fmtDateTime(l.time)
                },
                {
                    label: 'Admin',
                    cell: (l) => l.actor
                },
                {
                    label: 'Action',
                    cell: (l) => l.action
                },
                {
                    label: 'Target',
                    cell: (l) => l.target
                },

                {
                    label: 'Details',
                    cell: (l) => {
                        const wrapper = h('div', {
                            style: 'display:flex;justify-content:center;align-items:center;width:100%;'
                        });

                        wrapper.append(
                            h('button', {
                                type: 'button',
                                class: 'btn ghost audit-details-button',
                                onclick: () => openDetails(l)
                            }, 'View details')
                        );

                        return wrapper;
                    }
                }

            ], rows, 'No log entries match these filters.')
        );
    };

    const actions = [
        ...new Set(logs.map((l) => l.action))
    ].map((a) => [a, a]);

    root.append(
        pageHead('Audit logs', 'Every admin action, newest first.'),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select(
                    [['all', 'All actions'], ...actions],
                    action,
                    (v) => {
                        action = v;
                        draw();
                    },
                    'Action type'
                )
            ),
            holder
        ),
        detailsDialog
    );

    draw();
}
