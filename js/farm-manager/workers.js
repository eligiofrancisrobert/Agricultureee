
import { supabase } from '../connection.js';
import { h, pageHead, table, person } from '../admin/ui.js';

const STAFF_ROLES = {
    2: 'Warehouse Officer',
    3: 'Agricultural Technician',
    4: 'Accountant'
};

/** Render the worker list scoped to the current farm-manager assignment. */
export async function render(root, ctx) {
    const holder = h('div');

    root.append(
        pageHead(
            'Workers',
            'Staff members assigned to your municipality.'
        ),
        holder
    );

    /** Fetch and display the latest workers for the manager's assigned farm. */
    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading workers...')
        );

        try {
            const { data, error } = await supabase.rpc(
                'manager_list_municipality_staff'
            );

            if (error) throw error;

            const q = (ctx?.query ?? '').trim().toLowerCase();

            const rows = (data ?? [])
                .map((r) => ({
                    staff_id: r.staff_id,
                    name: r.full_name,
                    email: r.email,
                    type: STAFF_ROLES[r.role_id] ?? 'Staff',
                    municipality: r.municipality,
                    assigned_farm_id: r.assigned_farm_id
                }))
                .filter((r) =>
                    [
                        r.name,
                        r.email,
                        r.type,
                        r.municipality
                    ]
                        .join(' ')
                        .toLowerCase()
                        .includes(q)
                );

            holder.replaceChildren(
                h(
                    'section',
                    { class: 'card' },
                    table(
                        [
                            {
                                label: 'Staff Member',
                                cell: person
                            },
                            {
                                label: 'Position',
                                cell: (r) => r.type
                            },
                            {
                                label: 'Municipality',
                                cell: (r) => r.municipality
                            }
                        ],
                        rows,
                        q
                            ? 'No workers match your search.'
                            : 'No assigned workers found in your municipality.'
                    )
                )
            );
        } catch (err) {
            console.error('Failed to load workers:', err);

            holder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Could not load workers.'
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
