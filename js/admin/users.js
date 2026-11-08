
import {
    h, table, badge, person, select, fmtDate, toast, pageHead, ROLE
} from './ui.js';
import {
    listUsers, setUserStatus, deleteUserPermanently
} from './api.js';
import { openDetails } from './details.js';

const HEADINGS = {
    '': ['Users', 'Every registered account, including pending ones.'],
    pending: ['Pending accounts', 'Accounts waiting for approval.'],
    active: ['Active users', 'Approved accounts.'],
    suspended: ['Suspended users', 'Accounts that are blocked from signing in.'],
    rejected: ['Rejected accounts', 'Applications that were declined.'],
};

export async function render(root, ctx) {
    const status = HEADINGS[ctx.sub] !== undefined ? ctx.sub : '';
    const filter = { role: 'all' };
    const holder = h('div');

    /** Update a user's status and refresh the list and pending badge. */
    const change = async (user, next, doneText) => {
        try {
            await setUserStatus(user, next);
            toast(`${doneText} ${user.name}`);
            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Could not update user:', err);
            toast(err.message || 'Could not update this user.');
        }
    };

    /** Resolve true only after the user confirms the timed deletion dialog. */
    function confirmUserDeletion(user, seconds = 5) {
        return new Promise((resolve) => {
            const confirmBtn = h(
                'button',
                {
                    class: 'btn danger',
                    type: 'button',
                    disabled: true,
                },
                `Delete permanently (${seconds})`
            );

            const dialog = h(
                'dialog',
                {
                    id: 'userDeleteDialog',
                    class: 'details staff-dialog',
                    'aria-label': 'Confirm permanent user deletion',
                },
                h(
                    'div',
                    { class: 'card-head' },
                    h('h2', {}, 'Delete user permanently?')
                ),
                h(
                    'p',
                    {},
                    `${user.name || user.full_name || user.email} (${user.email}) will be permanently deleted. This action cannot be undone.`
                ),
                h(
                    'div',
                    { class: 'staff-buttons' },
                    h(
                        'button',
                        {
                            class: 'btn ghost',
                            type: 'button',
                            onclick: () => dialog.close(),
                        },
                        'Cancel'
                    ),
                    confirmBtn
                )
            );

            document.getElementById('userDeleteDialog')?.remove();

            let left = seconds;
            let settled = false;

            const finish = (confirmed) => {
                if (settled) return;
                settled = true;
                clearInterval(timer);
                dialog.close();
                resolve(confirmed);
            };

            confirmBtn.addEventListener('click', () => {
                if (confirmBtn.disabled || settled) return;
                finish(true);
            });

            dialog.addEventListener('close', () => {
                clearInterval(timer);
                if (!settled) {
                    settled = true;
                    resolve(false);
                }
                dialog.remove();
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) dialog.close();
            });

            document.body.append(dialog);
            dialog.showModal();

            const timer = setInterval(() => {
                left -= 1;

                if (left > 0) {
                    confirmBtn.textContent = `Delete permanently (${left})`;
                } else {
                    clearInterval(timer);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Delete permanently';
                }
            }, 1000);
        });
    }


    /** Permanently delete a confirmed user and refresh the visible counts. */
    const removeUser = async (user) => {
        const confirmed = await confirmUserDeletion(user);

        if (!confirmed) return;

        try {
            const result = await deleteUserPermanently(user.id);

            // Immediately remove the deleted account from the visible table.
            const row = holder.querySelector(`[data-user-id="${user.id}"]`);
            row?.remove();

            // Reload the current list and update counts.
            await draw();
            ctx.refreshBadge();

            toast(`${user.name || user.email} was permanently deleted.`);

            // Display any warning returned by the deletion function.
            if (result?.warning) {
                toast(result.warning);
            }
        } catch (err) {
            console.error('Permanent deletion failed:', err);
            toast(err.message || 'Could not permanently delete this account.');
        }
    };


    const actionsFor = (u) => [
        h('button', {
            class: 'btn ghost',
            type: 'button',
            onclick: () => openDetails(
                u,
                (s) => change(
                    u,
                    s,
                    s === 'active' ? 'Approved' : 'Rejected'
                )
            )
        }, 'View details'),

        u.status === 'pending' && h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => change(u, 'active', 'Approved')
        }, 'Approve'),

        u.status === 'pending' && h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: () => change(u, 'rejected', 'Rejected')
        }, 'Reject'),

        u.status === 'rejected' && h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => change(u, 'active', 'Approved')
        }, 'Approve'),

        u.status === 'active' && h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: () => change(u, 'suspended', 'Suspended')
        }, 'Suspend'),

        u.status === 'suspended' && h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => change(u, 'active', 'Reactivated')
        }, 'Reactivate'),

        h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: () => removeUser(u)
        }, 'Delete')
    ].filter(Boolean);

    /** Render users matching the current route, role filter, and search query. */
    const draw = async () => {
        try {
            const q = ctx.query.toLowerCase();

            const rows = (await listUsers()).filter((u) =>
                (!status || u.status === status) &&
                (filter.role === 'all' || u.role === filter.role) &&
                `${u.name} ${u.email}`.toLowerCase().includes(q)
            );

            holder.replaceChildren(table([
                { label: 'User', cell: person },
                { label: 'Email', cell: (u) => u.email },
                {
                    label: 'Role',
                    cell: (u) => ROLE[u.role]?.label?.slice(0, -1) ?? u.role
                },
                { label: 'Joined', cell: (u) => fmtDate(u.joined) },
                { label: 'Status', cell: (u) => badge(u.status) },
                {
                    label: 'Action',
                    cell: (u) => h(
                        'div',
                        { class: 'actions' },
                        ...actionsFor(u)
                    )
                },
            ], rows, status
                ? `No ${status} accounts match these filters.`
                : 'No users match these filters.'));
        } catch (err) {
            console.error('Failed to load users:', err);
            holder.replaceChildren(
                h('p', { class: 'msg error' },
                    'Could not load users. Check the browser console and Supabase permissions.')
            );
        }
    };

    root.append(
        pageHead(...HEADINGS[status]),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select(
                    [
                        ['all', 'All roles'],
                        ['farmer', 'Farmers'],
                        ['buyer', 'Buyers'],
                        ['supplier', 'Suppliers']
                    ],
                    filter.role,
                    (v) => {
                        filter.role = v;
                        draw();
                    },
                    'User role'
                ),
                select(
                    [
                        ['', 'All statuses'],
                        ['pending', 'Pending'],
                        ['active', 'Active'],
                        ['suspended', 'Suspended'],
                        ['rejected', 'Rejected']
                    ],
                    status,
                    (v) => {
                        location.hash = v ? `users/${v}` : 'users';
                    },
                    'Account status'
                )
            ),
            holder
        )
    );

    await draw();
}
