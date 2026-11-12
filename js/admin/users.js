
import {
    h, table, badge, person, select, fmtDate, toast, pageHead, ROLE
} from './ui.js';

import {
    listUsers,
    listDeletedUsers,
    listLoginSecurityAccounts,
    unlockLoginAccount,
    setUserStatus,
    softDeleteUser,
    restoreUser
} from './api.js';

import { openDetails } from './details.js';

const HEADINGS = {
    '': ['Users', 'Every registered account, including pending ones.'],
    pending: ['Pending accounts', 'Accounts waiting for approval.'],
    active: ['Active users', 'Approved accounts.'],
    suspended: ['Suspended users', 'Accounts blocked from signing in.'],
    rejected: ['Rejected accounts', 'Applications that were declined.'],
    deleted: ['Deleted users', 'Soft-deleted accounts that can still be restored.']
};

export async function render(root, ctx) {
    const status = HEADINGS[ctx.sub] !== undefined ? ctx.sub : '';
    const filter = { role: 'all' };
    const holder = h('div');

    // --- Update account status ----------------------------------------------

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

    // --- Unlock login account ------------------------------------------------

    const unlockAccount = async (user) => {
        const confirmed = window.confirm(
            `Unlock ${user.name || user.email}?\n\n` +
            'This will reset failed login attempts and remove the login lockdown.\n\n' +
            'It will NOT change the account approval, rejection, or suspension status.'
        );

        if (!confirmed) return;

        try {
            await unlockLoginAccount(user.id);

            toast(`${user.name || user.email} has been unlocked.`);

            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Account unlock failed:', err);
            toast(err.message || 'Could not unlock this account.');
        }
    };

    // --- Account actions -----------------------------------------------------

    const actionsFor = (user) => {
        if (status === 'deleted') {
            return [
                h('button', {
                    class: 'btn',
                    type: 'button',
                    onclick: () => restoreAccount(user)
                }, 'Restore Account')
            ];
        }

        return [
            h('button', {
                class: 'btn ghost',
                type: 'button',
                onclick: () => openDetails(
                    user,
                    (nextStatus) => change(
                        user,
                        nextStatus,
                        nextStatus === 'active' ? 'Approved' : 'Rejected'
                    )
                )
            }, 'View details'),

            user.isLocked && h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => unlockAccount(user)
            }, 'Unlock Account'),

            user.status === 'pending' && h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => change(user, 'active', 'Approved')
            }, 'Approve'),

            user.status === 'pending' && h('button', {
                class: 'btn danger',
                type: 'button',
                onclick: () => change(user, 'rejected', 'Rejected')
            }, 'Reject'),

            user.status === 'rejected' && h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => change(user, 'active', 'Approved')
            }, 'Approve'),

            user.status === 'active' && h('button', {
                class: 'btn danger',
                type: 'button',
                onclick: () => change(user, 'suspended', 'Suspended')
            }, 'Suspend'),

            user.status === 'suspended' && h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => change(user, 'active', 'Reactivated')
            }, 'Reactivate'),

            user.status === 'suspended' && h('button', {
                class: 'btn danger',
                type: 'button',
                onclick: () => softDelete(user)
            }, 'Soft Delete')
        ].filter(Boolean);
    };

    // --- Soft delete ---------------------------------------------------------

    const softDelete = async (user) => {
        const confirmed = window.confirm(
            `Soft-delete ${user.name || user.email}?\n\n` +
            'This will move the suspended account to Deleted Users. ' +
            'The Auth account and historical records will be retained.'
        );

        if (!confirmed) return;

        try {
            await softDeleteUser(user.id);

            toast(
                `${user.name || user.email} was moved to Deleted Users.`
            );

            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Soft deletion failed:', err);
            toast(err.message || 'Could not soft-delete this account.');
        }
    };

    // --- Restore account -----------------------------------------------------

    const restoreAccount = async (user) => {
        const confirmed = window.confirm(
            `Restore ${user.name || user.email}?\n\n` +
            'This will remove the soft-delete marker and return the account ' +
            'to Suspended status. The user will not be able to sign in.'
        );

        if (!confirmed) return;

        try {
            await restoreUser(user.id);

            toast(
                `${user.name || user.email} was restored as a suspended account.`
            );

            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Account restoration failed:', err);
            toast(err.message || 'Could not restore this account.');
        }
    };

    // --- Render table --------------------------------------------------------

    const draw = async () => {
        try {
            const q = String(ctx.query || '').toLowerCase();

            const source = status === 'deleted'
                ? await listDeletedUsers()
                : await listUsers();

            // Load security information only for non-deleted accounts.
            const securityAccounts = status === 'deleted'
                ? []
                : await listLoginSecurityAccounts();

            const securityByUserId = new Map(
                securityAccounts.map((account) => [
                    account.user_id,
                    account
                ])
            );

            const usersWithSecurity = source.map((user) => {
                const security = securityByUserId.get(user.id);

                return {
                    ...user,
                    login_locked_at: security?.locked_at ?? null,
                    login_failed_attempts: security?.failed_attempts ?? 0,
                    login_locked_reason: security?.locked_reason ?? null,
                    isLocked: Boolean(security?.locked_at)
                };
            });

            const rows = usersWithSecurity.filter((user) =>
                (status === 'deleted' || !status || user.status === status) &&
                (filter.role === 'all' || user.role === filter.role) &&
                `${user.name} ${user.email}`.toLowerCase().includes(q)
            );

            holder.replaceChildren(
                table([
                    { label: 'User', cell: person },
                    { label: 'Email', cell: (user) => user.email },
                    {
                        label: 'Role',
                        cell: (user) =>
                            ROLE[user.role]?.label?.slice(0, -1) ?? user.role
                    },
                    {
                        label: 'Joined',
                        cell: (user) => fmtDate(user.joined)
                    },
                    {
                        label: 'Status',
                        cell: (user) => {
                            if (status === 'deleted') {
                                return badge('deleted');
                            }

                            return user.isLocked
                                ? badge('locked')
                                : badge(user.status);
                        }
                    },
                    {
                        label: 'Action',
                        cell: (user) => h(
                            'div',
                            { class: 'actions' },
                            ...actionsFor(user)
                        )
                    }
                ], rows, status === 'deleted'
                    ? 'No deleted accounts found.'
                    : status
                        ? `No ${status} accounts match these filters.`
                        : 'No users match these filters.')
            );
        } catch (err) {
            console.error('Failed to load users:', err);

            holder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Could not load users. Check the browser console and Supabase permissions.'
                )
            );
        }
    };

    // --- Toolbar -------------------------------------------------------------

    const toolbar = [
        select(
            [
                ['all', 'All roles'],
                ['farmer', 'Farmers'],
                ['buyer', 'Buyers'],
                ['supplier', 'Suppliers']
            ],
            filter.role,
            (value) => {
                filter.role = value;
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
                ['rejected', 'Rejected'],
                ['deleted', 'Deleted']
            ],
            status,
            (value) => {
                location.hash = value
                    ? `users/${value}`
                    : 'users';
            },
            'Account status'
        )
    ];

    root.append(
        pageHead(...HEADINGS[status]),

        h(
            'section',
            { class: 'card' },

            h(
                'div',
                { class: 'toolbar' },
                ...toolbar
            ),

            holder
        )
    );

    await draw();
}
